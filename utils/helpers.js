const crypto = require('crypto');

/**
 * Generate short app session ID (max 20 chars)
 * Assigned to every WS connection on connect.
 */
const generateAppId = () => crypto.randomBytes(10).toString('hex');

/**
 * Generate unique cloud ID for devices/hubs
 */
const generateCloudId = (prefix = 'DEV') => {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`.toUpperCase();
};

/**
 * Generate secure random token
 */
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Generate 20-char add-device token (issued at login when RequestAddDevice is set)
 */
const generateAddDeviceToken = () => crypto.randomBytes(10).toString('hex');

/**
 * Get client IP from request
 */
const getClientIP = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip;
};

/**
 * Sanitize object - remove null/undefined values
 */
const sanitizeObject = (obj) => {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== null && value !== undefined)
  );
};

/**
 * Parse pagination params from query
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

module.exports = {
  generateAppId,
  generateCloudId,
  generateToken,
  generateAddDeviceToken,
  getClientIP,
  sanitizeObject,
  parsePagination
};