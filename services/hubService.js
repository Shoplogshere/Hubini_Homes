const { query } = require('../config/database');
const { ERROR_CODES } = require('../config/constants');

/**
 * Register hub from WebSocket addH command.
 * Idempotent: returns existing hub if local_id already registered for this user.
 */
const registerHubFromWS = async (userId, { hubLocalId, hubName, type, model, localUsername, guestPin }) => {
  const existing = await query(
    'SELECT id FROM hubs WHERE user_id = ? AND local_id = ?',
    [userId, hubLocalId]
  );

  if (existing.length > 0) {
    return { id: existing[0].id };
  }

  const result = await query(
    `INSERT INTO hubs (user_id, local_id, hub_name, type, model, local_username, guest_pin)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [userId, hubLocalId, hubName, type, model, localUsername || null, guestPin || null]
  );

  return { id: result[0].id };
};

/**
 * Look up a hub by local_id + user_id (used on ping reconnect).
 */
const getHubByLocalId = async (userId, hubLocalId) => {
  const rows = await query(
    'SELECT id, local_id, is_online FROM hubs WHERE user_id = ? AND local_id = ?',
    [userId, hubLocalId]
  );
  return rows[0] || null;
};

/**
 * Add a node device to a hub (called from AdHN ping command).
 * Idempotent: no-op if device already linked to this hub.
 */
const addHubNode = async (userId, hubId, { localId, name, type, trigs }) => {
  const existing = await query(
    'SELECT id FROM devices WHERE user_id = ? AND local_id = ? AND hub_id = ?',
    [userId, localId, hubId]
  );

  if (existing.length > 0) return { id: existing[0].id };

  const result = await query(
    `INSERT INTO devices (user_id, hub_id, local_id, name, type, trigs)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [userId, hubId, localId, name, type, trigs || null]
  );

  return { id: result[0].id };
};

/**
 * Get all hubs for user (paginated).
 */
const getUserHubs = async (userId, { page, limit, offset }) => {
  const countResult = await query(
    'SELECT COUNT(*)::int as total FROM hubs WHERE user_id = ?',
    [userId]
  );

  const hubs = await query(
    `SELECT id, local_id, hub_name, type, model, local_username, guest_pin, is_online, last_seen, created_at
     FROM hubs WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  return {
    hubs: hubs.map(h => ({
      id: h.id,
      localId: h.local_id,
      hubName: h.hub_name,
      type: h.type,
      model: h.model,
      localUsername: h.local_username,
      guestPin: h.guest_pin,
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
 * Get single hub (with ownership check).
 */
const getHub = async (userId, hubId) => {
  const hubs = await query(
    `SELECT id, local_id, hub_name, type, model, local_username, guest_pin, is_online, last_seen, created_at, updated_at
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
    localId: h.local_id,
    hubName: h.hub_name,
    type: h.type,
    model: h.model,
    localUsername: h.local_username,
    guestPin: h.guest_pin,
    isOnline: Boolean(h.is_online),
    lastSeen: h.last_seen,
    createdAt: h.created_at,
    updatedAt: h.updated_at
  };
};

/**
 * Update hub fields.
 */
const updateHub = async (userId, hubId, updates) => {
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

  const fields = [];
  const values = [];

  if (updates.hubName !== undefined) { fields.push('hub_name = ?'); values.push(updates.hubName); }
  if (updates.type !== undefined)    { fields.push('type = ?');     values.push(updates.type); }
  if (updates.model !== undefined)   { fields.push('model = ?');    values.push(updates.model); }

  if (fields.length > 0) {
    values.push(hubId);
    await query(`UPDATE hubs SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return getHub(userId, hubId);
};

/**
 * Set hub online/offline status by DB id.
 */
const setHubOnline = async (hubId, isOnline) => {
  await query(
    'UPDATE hubs SET is_online = ?, last_seen = NOW() WHERE id = ?',
    [isOnline, hubId]
  );
};

/**
 * Delete hub and unlink its devices.
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

  await query('UPDATE devices SET hub_id = NULL WHERE hub_id = ?', [hubId]);
  await query('DELETE FROM hubs WHERE id = ?', [hubId]);

  return { message: 'Hub deleted successfully' };
};

/**
 * Get all devices linked to a hub.
 */
const getHubDevices = async (userId, hubId) => {
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
    `SELECT id, local_id, name, type, model, trigs, last_state, is_online, last_seen
     FROM devices WHERE hub_id = ?
     ORDER BY created_at DESC`,
    [hubId]
  );

  return devices.map(d => ({
    id: d.id,
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
 * Link a standalone device to a hub.
 */
const linkDevice = async (userId, hubId, deviceId) => {
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
 * Unlink a device from its hub.
 */
const unlinkDevice = async (userId, deviceId) => {
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

  await query('UPDATE devices SET hub_id = NULL WHERE id = ?', [deviceId]);
  return { message: 'Device unlinked from hub successfully' };
};

module.exports = {
  registerHubFromWS,
  getHubByLocalId,
  addHubNode,
  getUserHubs,
  getHub,
  updateHub,
  setHubOnline,
  deleteHub,
  getHubDevices,
  linkDevice,
  unlinkDevice
};
