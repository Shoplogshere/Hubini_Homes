const { query } = require('../config/database');
const { ERROR_CODES } = require('../config/constants');

/**
 * Register device from WebSocket addD command.
 * Idempotent: returns existing device if local_id already registered for this user.
 */
const registerDeviceFromWS = async (userId, { localId, name, type, trigs, model }) => {
  const existing = await query(
    'SELECT id FROM devices WHERE user_id = ? AND local_id = ?',
    [userId, localId]
  );

  if (existing.length > 0) {
    return { id: existing[0].id };
  }

  const result = await query(
    `INSERT INTO devices (user_id, local_id, name, type, model, trigs)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [userId, localId, name, type, model, trigs || null]
  );

  return { id: result[0].id };
};

/**
 * Look up a device by local_id + user_id (used on ping reconnect).
 */
const getDeviceByLocalId = async (userId, localId) => {
  const rows = await query(
    'SELECT id, local_id, is_online FROM devices WHERE user_id = ? AND local_id = ?',
    [userId, localId]
  );
  return rows[0] || null;
};

/**
 * Get all devices for user (paginated, with optional type/search filters).
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

  const countResult = await query(
    `SELECT COUNT(*)::int as total FROM devices ${whereClause}`,
    params
  );

  const devices = await query(
    `SELECT id, local_id, name, type, model, trigs, last_state, is_online, last_seen, created_at
     FROM devices ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    devices: devices.map(d => ({
      id: d.id,
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
 * Get all devices for user in the getDs client format (all devices, hub-connected included).
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
 * Get single device (with ownership check).
 */
const getDevice = async (userId, deviceId) => {
  const devices = await query(
    `SELECT id, local_id, name, type, model, trigs, last_state, is_online, last_seen, created_at, updated_at
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
 * Update device fields.
 */
const updateDevice = async (userId, deviceId, updates) => {
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

  const fields = [];
  const values = [];

  if (updates.Name !== undefined) { fields.push('name = ?'); values.push(updates.Name); }
  if (updates.Type !== undefined) { fields.push('type = ?'); values.push(updates.Type); }
  if (updates.trigs !== undefined) { fields.push('trigs = ?'); values.push(updates.trigs); }

  if (fields.length > 0) {
    values.push(deviceId);
    await query(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return getDevice(userId, deviceId);
};

/**
 * Update device last_state (called when device sends r_nd).
 */
const updateDeviceState = async (deviceId, state) => {
  await query(
    'UPDATE devices SET last_state = ?, last_seen = NOW(), is_online = TRUE WHERE id = ?',
    [state, deviceId]
  );
};

/**
 * Set device online/offline status by DB id.
 */
const setDeviceOnline = async (deviceId, isOnline) => {
  await query(
    'UPDATE devices SET is_online = ?, last_seen = NOW() WHERE id = ?',
    [isOnline, deviceId]
  );
};

/**
 * Delete device (with ownership check).
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
 * Get device for command dispatch (ownership check + online status).
 */
const getDeviceForCommand = async (userId, deviceId) => {
  const devices = await query(
    'SELECT id, local_id, is_online FROM devices WHERE id = ? AND user_id = ?',
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
 * Log a command sent to a device.
 */
const logCommand = async (deviceId, userId, command, status = 'pending') => {
  await query(
    'INSERT INTO device_commands (device_id, user_id, command, status) VALUES (?, ?, ?, ?)',
    [deviceId, userId, command, status]
  );
};

module.exports = {
  registerDeviceFromWS,
  getDeviceByLocalId,
  getUserDevices,
  getDevicesForClient,
  getDevice,
  updateDevice,
  updateDeviceState,
  setDeviceOnline,
  deleteDevice,
  getDeviceForCommand,
  logCommand
};
