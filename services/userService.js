const { query } = require('../config/database');
const { ERROR_CODES } = require('../config/constants');

/**
 * Get user profile
 */
const getProfile = async (userId) => {
  const users = await query(
    `SELECT id, email, username, first_name, last_name, date_of_birth, phone, profile_picture, 
            is_verified, created_at, last_login
     FROM users WHERE id = ?`,
    [userId]
  );

  if (users.length === 0) {
    const error = new Error('User not found');
    error.statusCode = 404;
    error.errorCode = ERROR_CODES.USER_NOT_FOUND;
    throw error;
  }

  const user = users[0];
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    dateOfBirth: user.date_of_birth,
    phone: user.phone,
    profilePicture: user.profile_picture,
    isVerified: Boolean(user.is_verified),
    createdAt: user.created_at,
    lastLogin: user.last_login
  };
};

/**
 * Update user profile
 */
const updateProfile = async (userId, updates) => {
  const fields = [];
  const values = [];

  if (updates.firstName !== undefined) {
    fields.push('first_name = ?');
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    fields.push('last_name = ?');
    values.push(updates.lastName);
  }
  if (updates.phone !== undefined) {
    fields.push('phone = ?');
    values.push(updates.phone);
  }
  if (updates.dateOfBirth !== undefined) {
    fields.push('date_of_birth = ?');
    values.push(updates.dateOfBirth);
  }
  if (updates.profilePicture !== undefined) {
    fields.push('profile_picture = ?');
    values.push(updates.profilePicture);
  }

  if (fields.length > 0) {
    values.push(userId);
    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return getProfile(userId);
};

/**
 * Get user statistics
 */
const getUserStats = async (userId) => {
  // Device stats
  const deviceStats = await query(
    `SELECT COUNT(*)::int as total, SUM(CASE WHEN is_online THEN 1 ELSE 0 END)::int as online
     FROM devices WHERE user_id = ?`,
    [userId]
  );

  // Hub stats
  const hubStats = await query(
    `SELECT COUNT(*)::int as total, SUM(CASE WHEN is_online THEN 1 ELSE 0 END)::int as online
     FROM hubs WHERE user_id = ?`,
    [userId]
  );

  // Commands in last 24 hours
  const commandStats = await query(
    `SELECT COUNT(*)::int as total FROM device_commands
     WHERE user_id = ? AND created_at >= NOW() - INTERVAL '24 hours'`,
    [userId]
  );

  return {
    devices: {
      total: deviceStats[0].total || 0,
      online: deviceStats[0].online || 0
    },
    hubs: {
      total: hubStats[0].total || 0,
      online: hubStats[0].online || 0
    },
    commands: {
      last24Hours: commandStats[0].total || 0
    }
  };
};

/**
 * Get user activity log
 */
const getActivityLog = async (userId, { page, limit, offset }) => {
  const countResult = await query(
    'SELECT COUNT(*)::int as total FROM activity_logs WHERE user_id = ?',
    [userId]
  );

  const logs = await query(
    `SELECT al.id, al.action, al.details, al.ip_address, al.created_at,
            d.name as device_name, h.hub_name
     FROM activity_logs al
     LEFT JOIN devices d ON al.device_id = d.id
     LEFT JOIN hubs h ON al.hub_id = h.id
     WHERE al.user_id = ?
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  return {
    logs: logs.map(l => ({
      id: l.id,
      action: l.action,
      details: l.details,
      deviceName: l.device_name,
      hubName: l.hub_name,
      ipAddress: l.ip_address,
      createdAt: l.created_at
    })),
    total: countResult[0].total,
    page,
    limit
  };
};

/**
 * Log activity
 */
const logActivity = async (userId, { action, details, deviceId, hubId, ipAddress, userAgent }) => {
  await query(
    `INSERT INTO activity_logs (user_id, device_id, hub_id, action, details, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, deviceId || null, hubId || null, action, details || null, ipAddress || null, userAgent || null]
  );
};

/**
 * Deactivate account
 */
const deactivateAccount = async (userId) => {
  await query('UPDATE users SET is_active = FALSE WHERE id = ?', [userId]);
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return { message: 'Account deactivated successfully' };
};

/**
 * Delete account
 */
const deleteAccount = async (userId) => {
  await query('DELETE FROM users WHERE id = ?', [userId]);
  return { message: 'Account deleted successfully' };
};

module.exports = {
  getProfile,
  updateProfile,
  getUserStats,
  getActivityLog,
  logActivity,
  deactivateAccount,
  deleteAccount
};