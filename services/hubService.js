const { query } = require('../config/database');
const { generateCloudId } = require('../utils/helpers');
const { ERROR_CODES } = require('../config/constants');

// Hub must connect via WebSocket within this window or be auto-deleted
const ACTIVATION_TIMEOUT_MS = 1000 * 1000; // 1000 seconds

const activationTimers = new Map(); // hubId -> timer handle

const scheduleActivationCleanup = (hubId) => {
  cancelActivationTimer(hubId);
  const timer = setTimeout(async () => {
    activationTimers.delete(hubId);
    try {
      const rows = await query('SELECT is_online FROM hubs WHERE id = ?', [hubId]);
      if (rows.length > 0 && !rows[0].is_online) {
        await query('DELETE FROM hubs WHERE id = ?', [hubId]);
        console.log(` Auto-deleted inactive hub: id=${hubId}`);
      }
    } catch (err) {
      console.error('Hub cleanup timer error:', err.message);
    }
  }, ACTIVATION_TIMEOUT_MS);
  activationTimers.set(hubId, timer);
};

const cancelActivationTimer = (hubId) => {
  if (activationTimers.has(hubId)) {
    clearTimeout(activationTimers.get(hubId));
    activationTimers.delete(hubId);
  }
};

/**
 * Register new hub
 */
const registerHub = async (userId, { hubToken, hubName, type, model }) => {
  // Check if hub with this token exists for this user
  const existing = await query(
    'SELECT id FROM hubs WHERE user_id = ? AND hub_token = ?',
    [userId, hubToken]
  );

  if (existing.length > 0) {
    const error = new Error('Hub with this token already exists');
    error.statusCode = 409;
    error.errorCode = ERROR_CODES.HUB_EXISTS;
    throw error;
  }

  // Generate cloud ID
  const cloudId = generateCloudId('HUB');

  const result = await query(
    `INSERT INTO hubs (cloud_id, user_id, hub_token, hub_name, type, model)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [cloudId, userId, hubToken, hubName, type, model]
  );

  // Start activation timer — hub must connect via WS or it gets deleted
  scheduleActivationCleanup(result[0].id);

  return {
    id: result[0].id,
    your_cloudID: cloudId
  };
};

/**
 * Get all hubs for user
 */
const getUserHubs = async (userId, { page, limit, offset }) => {
  // Get count
  const countResult = await query(
    'SELECT COUNT(*)::int as total FROM hubs WHERE user_id = ?',
    [userId]
  );

  // Get hubs
  const hubs = await query(
    `SELECT id, cloud_id, hub_token, hub_name, type, model, is_online, last_seen, created_at
     FROM hubs WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  return {
    hubs: hubs.map(h => ({
      id: h.id,
      cloudId: h.cloud_id,
      hubToken: h.hub_token,
      hubName: h.hub_name,
      type: h.type,
      model: h.model,
      isOnline: Boolean(h.is_online),
      lastSeen: h.last_seen,
      createdAt: h.created_at
    })),
    total: countResult[0].total,
    page,
    limit
  };
};

/**
 * Get single hub
 */
const getHub = async (userId, hubId) => {
  const hubs = await query(
    `SELECT id, cloud_id, hub_token, hub_name, type, model, is_online, last_seen, created_at, updated_at
     FROM hubs WHERE id = ? AND user_id = ?`,
    [hubId, userId]
  );

  if (hubs.length === 0) {
    const error = new Error('Hub not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.HUB_NOT_FOUND;
    throw error;
  }

  const h = hubs[0];
  return {
    id: h.id,
    cloudId: h.cloud_id,
    hubToken: h.hub_token,
    hubName: h.hub_name,
    type: h.type,
    model: h.model,
    isOnline: Boolean(h.is_online),
    lastSeen: h.last_seen,
    createdAt: h.created_at,
    updatedAt: h.updated_at
  };
};

/**
 * Get hub by DB integer ID (used by WS mapping)
 */
const getHubById = async (hubId) => {
  const hubs = await query(
    'SELECT id, cloud_id, user_id, hub_token, hub_name, type, model, is_online FROM hubs WHERE id = ?',
    [hubId]
  );
  return hubs[0] || null;
};

/**
 * Get hub by cloud ID
 */
const getHubByCloudId = async (cloudId) => {
  const hubs = await query(
    'SELECT id, cloud_id, user_id, hub_id, hub_name, type, model, is_online FROM hubs WHERE cloud_id = ?',
    [cloudId]
  );
  return hubs[0] || null;
};

/**
 * Update hub
 */
const updateHub = async (userId, hubId, updates) => {
  // Check exists
  const existing = await query(
    'SELECT id FROM hubs WHERE id = ? AND user_id = ?',
    [hubId, userId]
  );

  if (existing.length === 0) {
    const error = new Error('Hub not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.HUB_NOT_FOUND;
    throw error;
  }

  // Build update
  const fields = [];
  const values = [];

  if (updates.hubName !== undefined) {
    fields.push('hub_name = ?');
    values.push(updates.hubName);
  }
  if (updates.type !== undefined) {
    fields.push('type = ?');
    values.push(updates.type);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }

  if (fields.length > 0) {
    values.push(hubId);
    await query(`UPDATE hubs SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return getHub(userId, hubId);
};

/**
 * Set hub online status
 */
const setHubOnline = async (cloudId, isOnline) => {
  await query(
    'UPDATE hubs SET is_online = ?, last_seen = NOW() WHERE cloud_id = ?',
    [isOnline, cloudId]
  );
};

/**
 * Delete hub
 */
const deleteHub = async (userId, hubId) => {
  const existing = await query(
    'SELECT id FROM hubs WHERE id = ? AND user_id = ?',
    [hubId, userId]
  );

  if (existing.length === 0) {
    const error = new Error('Hub not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.HUB_NOT_FOUND;
    throw error;
  }

  // Unlink devices from hub
  await query('UPDATE devices SET hub_id = NULL WHERE hub_id = ?', [hubId]);

  // Delete hub
  await query('DELETE FROM hubs WHERE id = ?', [hubId]);

  return { message: 'Hub deleted successfully' };
};

/**
 * Get hub devices
 */
const getHubDevices = async (userId, hubId) => {
  // Verify ownership
  const hubs = await query(
    'SELECT id FROM hubs WHERE id = ? AND user_id = ?',
    [hubId, userId]
  );

  if (hubs.length === 0) {
    const error = new Error('Hub not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.HUB_NOT_FOUND;
    throw error;
  }

  const devices = await query(
    `SELECT id, cloud_id, local_id, name, type, model, trigs, last_state, is_online, last_seen
     FROM devices WHERE hub_id = ?
     ORDER BY created_at DESC`,
    [hubId]
  );

  return devices.map(d => ({
    id: d.id,
    cloudId: d.cloud_id,
    Local_ID: d.local_id,
    name: d.name,
    type: d.type,
    model: d.model,
    Trigs: d.trigs,
    Last_state: d.last_state,
    isOnline: Boolean(d.is_online),
    lastSeen: d.last_seen
  }));
};

/**
 * Link device to hub
 */
const linkDevice = async (userId, hubId, deviceId) => {
  // Verify hub ownership
  const hubs = await query(
    'SELECT id FROM hubs WHERE id = ? AND user_id = ?',
    [hubId, userId]
  );

  if (hubs.length === 0) {
    const error = new Error('Hub not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.HUB_NOT_FOUND;
    throw error;
  }

  // Verify device ownership
  const devices = await query(
    'SELECT id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, userId]
  );

  if (devices.length === 0) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.DEVICE_NOT_FOUND;
    throw error;
  }

  await query('UPDATE devices SET hub_id = ? WHERE id = ?', [hubId, deviceId]);

  return { message: 'Device linked to hub successfully' };
};

/**
 * Unlink device from hub
 */
const unlinkDevice = async (userId, deviceId) => {
  const devices = await query(
    'SELECT id, hub_id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, userId]
  );

  if (devices.length === 0) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.DEVICE_NOT_FOUND;
    throw error;
  }

  await query('UPDATE devices SET hub_id = NULL WHERE id = ?', [deviceId]);

  return { message: 'Device unlinked from hub successfully' };
};

module.exports = {
  registerHub,
  getUserHubs,
  getHub,
  getHubById,
  getHubByCloudId,
  updateHub,
  setHubOnline,
  deleteHub,
  getHubDevices,
  linkDevice,
  unlinkDevice,
  scheduleActivationCleanup,
  cancelActivationTimer
};