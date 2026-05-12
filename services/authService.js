const bcrypt = require('bcrypt');
const { query, transaction } = require('../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../middlewares/auth');
const { generateToken } = require('../utils/helpers');
const { ERROR_CODES } = require('../config/constants');

const SALT_ROUNDS = 12;

/**
 * Register new user
 */
const register = async ({ email, username, password, firstName, lastName }) => {
  // Check if email exists
  const existingEmail = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existingEmail.length > 0) {
    const error = new Error('Email already registered');
    error.statusCode = 409;
    error.errorCode = ERROR_CODES.EMAIL_EXISTS;
    throw error;
  }

  // Check if username exists
  const existingUsername = await query('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUsername.length > 0) {
    const error = new Error('Username already taken');
    error.statusCode = 409;
    error.errorCode = ERROR_CODES.USERNAME_EXISTS;
    throw error;
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Generate verification token
  const verificationToken = generateToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Insert user
  const result = await query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, verification_token, verification_token_expires)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [email, username, passwordHash, firstName || null, lastName || null, verificationToken, verificationExpires]
  );

  return {
    userId: result[0].id,
    email,
    username,
    verificationToken // For email sending
  };
};

/**
 * Login user
 */
const login = async ({ email, password }) => {
  // Find user
  const users = await query(
    'SELECT id, email, username, password_hash, is_verified, is_active, first_name, last_name FROM users WHERE email = ?',
    [email]
  );

  if (users.length === 0) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  const user = users[0];

  if (!user.is_active) {
    const error = new Error('Account has been deactivated');
    error.statusCode = 403;
    error.errorCode = ERROR_CODES.USER_INACTIVE;
    throw error;
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  // Generate tokens
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  // Store refresh token
  const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [user.id, refreshToken, refreshExpires]
  );

  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      isVerified: Boolean(user.is_verified)
    },
    tokens: {
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    }
  };
};

/**
 * Verify email
 */
const verifyEmail = async (token) => {
  const users = await query(
    'SELECT id, is_verified, verification_token_expires FROM users WHERE verification_token = ?',
    [token]
  );

  if (users.length === 0) {
    const error = new Error('Invalid verification token');
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.TOKEN_INVALID;
    throw error;
  }

  const user = users[0];

  if (user.is_verified) {
    return { message: 'Email already verified' };
  }

  if (new Date(user.verification_token_expires) < new Date()) {
    const error = new Error('Verification token expired');
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.TOKEN_EXPIRED;
    throw error;
  }

  await query(
    'UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
    [user.id]
  );

  return { message: 'Email verified successfully' };
};

/**
 * Forgot password
 */
const forgotPassword = async (email) => {
  const users = await query('SELECT id, username, is_active FROM users WHERE email = ?', [email]);

  // Always return success to prevent email enumeration
  const response = { message: 'If the email exists, reset instructions have been sent' };

  if (users.length === 0 || !users[0].is_active) {
    return response;
  }

  const resetToken = generateToken();
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await query(
    'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
    [resetToken, resetExpires, users[0].id]
  );

  // Return token for email sending
  return { ...response, resetToken, username: users[0].username };
};

/**
 * Reset password
 */
const resetPassword = async (token, newPassword) => {
  const users = await query(
    'SELECT id, reset_password_expires FROM users WHERE reset_password_token = ?',
    [token]
  );

  if (users.length === 0) {
    const error = new Error('Invalid reset token');
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.INVALID_RESET_TOKEN;
    throw error;
  }

  if (new Date(users[0].reset_password_expires) < new Date()) {
    const error = new Error('Reset token expired');
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.TOKEN_EXPIRED;
    throw error;
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await query(
    'UPDATE users SET password_hash = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
    [passwordHash, users[0].id]
  );

  // Revoke all refresh tokens
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [users[0].id]
  );

  return { message: 'Password reset successful' };
};

/**
 * Refresh access token
 */
const refreshAccessToken = async (refreshToken) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    const error = new Error('Invalid refresh token');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.TOKEN_INVALID;
    throw error;
  }

  // Check token in database
  const tokens = await query(
    'SELECT id, expires_at, revoked_at FROM refresh_tokens WHERE token = ? AND user_id = ?',
    [refreshToken, decoded.userId]
  );

  if (tokens.length === 0) {
    const error = new Error('Refresh token not found');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.TOKEN_INVALID;
    throw error;
  }

  if (tokens[0].revoked_at) {
    const error = new Error('Refresh token revoked');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.TOKEN_INVALID;
    throw error;
  }

  if (new Date(tokens[0].expires_at) < new Date()) {
    const error = new Error('Refresh token expired');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.TOKEN_EXPIRED;
    throw error;
  }

  // Generate new tokens
  const newAccessToken = generateAccessToken(decoded.userId);
  const newRefreshToken = generateRefreshToken(decoded.userId);
  const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Revoke old and create new (token rotation)
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = ? WHERE id = ?',
    [newRefreshToken, tokens[0].id]
  );

  await query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [decoded.userId, newRefreshToken, refreshExpires]
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  };
};

/**
 * Logout
 */
const logout = async (userId, refreshToken) => {
  if (refreshToken) {
    await query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND token = ?',
      [userId, refreshToken]
    );
  }
  return { message: 'Logged out successfully' };
};

/**
 * Logout from all devices
 */
const logoutAll = async (userId) => {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return { message: 'Logged out from all devices' };
};

/**
 * Change password
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  const users = await query('SELECT password_hash FROM users WHERE id = ?', [userId]);

  const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);
  if (!isValid) {
    const error = new Error('Current password is incorrect');
    error.statusCode = 401;
    error.errorCode = ERROR_CODES.INVALID_CREDENTIALS;
    throw error;
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

  return { message: 'Password changed successfully' };
};

module.exports = {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  refreshAccessToken,
  logout,
  logoutAll,
  changePassword
};