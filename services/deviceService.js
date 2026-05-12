const { query } = require('../config/database');
const { generateCloudId } = require('../utils/helpers');
const { ERROR_CODES } = require('../config/constants');

// Device must connect via WebSocket within this window or be auto-deleted
const ACTIVATION_TIMEOUT_MS = 1000 * 1000; // 1000 seconds

const activationTimers = new Map(); // deviceId -> timer handle

const scheduleActivationCleanup = (deviceId) => {
  cancelActivationTimer(deviceId);
  const timer = setTimeout(async () => {
    activationTimers.delete(deviceId);
    try {
      const rows = await query('SELECT is_online FROM devices WHERE id = ?', [deviceId]);
      if (rows.length > 0 && !rows[0].is_online) {
        await query('DELETE FROM devices WHERE id = ?', [deviceId]);
        console.log(` Auto-deleted inactive device: id=${deviceId}`);
      }
    } catch (err) {
      console.error('Device cleanup timer error:', err.message);
    }
  }, ACTIVATION_TIMEOUT_MS);
  activationTimers.set(deviceId, timer);
};

const cancelActivationTimer = (deviceId) => {
  if (activationTimers.has(deviceId)) {
    clearTimeout(activationTimers.get(deviceId));
    activationTimers.delete(deviceId);
  }
};

/**
 * Register new device
 */
const registerDevice = async (userId, { Local_ID, Name, Type, Model, trigs }) => {
  // Check if device exists for this user
  const existing = await query(
    'SELECT id FROM devices WHERE user_id = ? AND local_id = ?',
    [userId, Local_ID]
  );

  if (existing.length > 0) {
    const error = new Error('Device with this Local_ID already exists');
    error.statusCode = 409;
    error.errorCode = ERROR_CODES.DEVICE_EXISTS;
    throw error;
  }

  // Generate cloud ID
  const cloudId = generateCloudId('DEV');

  const result = await query(
    `INSERT INTO devices (cloud_id, user_id, local_id, name, type, model, trigs)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [cloudId, userId, Local_ID, Name, Type, Model, trigs || null]
  );

  // Start activation timer — device must connect via WS or it gets deleted
  scheduleActivationCleanup(result[0].id);

  return {
    id: result[0].id,
    yourCloudID: cloudId
  };
};

/**
 * Get all devices for user
 */
const getUserDevices = async (userId, { page, limit, offset, type, search }) => {
  let whereClause = 'WHERE user_id = ?';
  const params = [userId];

  if (type) {
    whereClause += ' AND type = ?';
    params.push(type);
  }

  if (search) {
    whereClause += ' AND (name LIKE ? OR local_id LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Get count
  const countResult = await query(
    `SELECT COUNT(*)::int as total FROM devices ${whereClause}`,
    params
  );

  // Get devices
  const devices = await query(
    `SELECT id, cloud_id, local_id, name, type, model, trigs, last_state, is_online, last_seen, created_at
     FROM devices ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    devices: devices.map(d => ({
      id: d.id,
      cloudId: d.cloud_id,
      Local_ID: d.local_id,
      name: d.name,
      type: d.type,
      model: d.model,
      Trigs: d.trigs,
      Last_state: d.last_state,
      isOnline: Boolean(d.is_online),
      lastSeen: d.last_seen,
      createdAt: d.created_at
    })),
    total: countResult[0].total,
    page,
    limit
  };
};

/**
 * Get devices in client format (getDs)
 */
const getDevicesForClient = async (userId) => {
  const devices = await query(
    `SELECT id, local_id, name, type, last_state, trigs
     FROM devices WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );

  return devices.map(d => ({
    id: String(d.id),
    Local_ID: d.local_id,
    name: d.name,
    type: d.type,
    Last_state: d.last_state || 'unknown',
    Trigs: d.trigs
  }));
};

/**
 * Get single device
 */
const getDevice = async (userId, deviceId) => {
  const devices = await query(
    `SELECT id, cloud_id, local_id, name, type, model, trigs, last_state, is_online, last_seen, created_at, updated_at
     FROM devices WHERE id = ? AND user_id = ?`,
    [deviceId, userId]
  );

  if (devices.length === 0) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.DEVICE_NOT_FOUND;
    throw error;
  }

  const d = devices[0];
  return {
    id: d.id,
    cloudId: d.cloud_id,
    Local_ID: d.local_id,
    name: d.name,
    type: d.type,
    model: d.model,
    Trigs: d.trigs,
    Last_state: d.last_state,
    isOnline: Boolean(d.is_online),
    lastSeen: d.last_seen,
    createdAt: d.created_at,
    updatedAt: d.updated_at
  };
};

/**
 * Get device by DB integer ID (used by WS mapping)
 */
const getDeviceById = async (deviceId) => {
  const devices = await query(
    'SELECT id, cloud_id, user_id, local_id, name, type, model, trigs, last_state, is_online FROM devices WHERE id = ?',
    [deviceId]
  );
  return devices[0] || null;
};

/**
 * Get device by cloud ID
 */
const getDeviceByCloudId = async (cloudId) => {
  const devices = await query(
    'SELECT id, cloud_id, user_id, local_id, name, type, model, trigs, last_state, is_online FROM devices WHERE cloud_id = ?',
    [cloudId]
  );
  return devices[0] || null;
};

/**
 * Update device
 */
const updateDevice = async (userId, deviceId, updates) => {
  // Check exists
  const existing = await query(
    'SELECT id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, userId]
  );

  if (existing.length === 0) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.DEVICE_NOT_FOUND;
    throw error;
  }

  // Build update
  const fields = [];
  const values = [];

  if (updates.Name !== undefined) {
    fields.push('name = ?');
    values.push(updates.Name);
  }
  if (updates.Type !== undefined) {
    fields.push('type = ?');
    values.push(updates.Type);
  }
  if (updates.trigs !== undefined) {
    fields.push('trigs = ?');
    values.push(updates.trigs);
  }

  if (fields.length > 0) {
    values.push(deviceId);
    await query(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return getDevice(userId, deviceId);
};

/**
 * Update device state
 */
const updateDeviceState = async (deviceId, state) => {
  await query(
    'UPDATE devices SET last_state = ?, last_seen = NOW(), is_online = TRUE WHERE id = ?',
    [state, deviceId]
  );
};

/**
 * Set device online status
 */
const setDeviceOnline = async (cloudId, isOnline) => {
  await query(
    'UPDATE devices SET is_online = ?, last_seen = NOW() WHERE cloud_id = ?',
    [isOnline, cloudId]
  );
};

/**
 * Delete device
 */
const deleteDevice = async (userId, deviceId) => {
  const existing = await query(
    'SELECT id FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, userId]
  );

  if (existing.length === 0) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.DEVICE_NOT_FOUND;
    throw error;
  }

  await query('DELETE FROM devices WHERE id = ?', [deviceId]);
  return { message: 'Device deleted successfully' };
};

/**
 * Get device for command (with ownership check)
 */
const getDeviceForCommand = async (userId, deviceId) => {
  const devices = await query(
    'SELECT id, cloud_id, is_online FROM devices WHERE id = ? AND user_id = ?',
    [deviceId, userId]
  );

  if (devices.length === 0) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.DEVICE_NOT_FOUND;
    throw error;
  }

  return devices[0];
};

/**
 * Log device command
 */
const logCommand = async (deviceId, userId, command, status = 'pending') => {
  await query(
    'INSERT INTO device_commands (device_id, user_id, command, status) VALUES (?, ?, ?, ?)',
    [deviceId, userId, command, status]
  );
};

module.exports = {
  registerDevice,
  getUserDevices,
  getDevicesForClient,
  getDevice,
  getDeviceById,
  getDeviceByCloudId,
  updateDevice,
  updateDeviceState,
  setDeviceOnline,
  deleteDevice,
  getDeviceForCommand,
  logCommand,
  scheduleActivationCleanup,
  cancelActivationTimer
};