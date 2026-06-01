const authService = require('../../services/authService');
const response = require('../../utils/response');
const { SUCCESS_MESSAGES } = require('../../config/constants');
const { asyncHandler } = require('../../middlewares/errorHandler');

/**
 * Register
 * POST /api/v1/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { email, username, password, firstName, lastName, role, organizationName, gender, dateOfBirth } = req.body;

  const result = await authService.register({
    email,
    username,
    password,
    firstName,
    lastName,
    role,
    organizationName,
    gender,
    dateOfBirth
  });

  return response.created(res, {
    data: {
      userId: result.userId,
      email: result.email,
      username: result.username
    },
    message: SUCCESS_MESSAGES.REGISTER
  });
});

/**
 * Login
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.login({ email, password });

  return response.success(res, {
    data: result,
    message: SUCCESS_MESSAGES.LOGIN
  });
});

/**
 * Verify Email
 * POST /api/v1/auth/verify-email
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;

  const result = await authService.verifyEmail(token);

  return response.success(res, {
    data: result,
    message: SUCCESS_MESSAGES.EMAIL_VERIFIED
  });
});

/**
 * Resend Verification
 * POST /api/v1/auth/resend-verification
 */
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // TODO: Implement resend logic with email service

  return response.success(res, {
    message: 'If the email exists, a verification link has been sent'
  });
});

/**
 * Forgot Password
 * POST /api/v1/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const result = await authService.forgotPassword(email);

  return response.success(res, {
    message: SUCCESS_MESSAGES.PASSWORD_RESET_SENT
  });
});

/**
 * Reset Password
 * POST /api/v1/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const result = await authService.resetPassword(token, password);

  return response.success(res, {
    data: result,
    message: SUCCESS_MESSAGES.PASSWORD_RESET
  });
});

/**
 * Refresh Token
 * POST /api/v1/auth/refresh-token
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const result = await authService.refreshAccessToken(refreshToken);

  return response.success(res, {
    data: result,
    message: SUCCESS_MESSAGES.TOKEN_REFRESHED
  });
});

/**
 * Logout
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const result = await authService.logout(req.user.id, refreshToken);

  return response.success(res, {
    data: result,
    message: SUCCESS_MESSAGES.LOGOUT
  });
});

/**
 * Logout All
 * POST /api/v1/auth/logout-all
 */
const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.logoutAll(req.user.id);

  return response.success(res, {
    data: result,
    message: 'Logged out from all devices'
  });
});

/**
 * Change Password
 * POST /api/v1/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const result = await authService.changePassword(req.user.id, currentPassword, newPassword);

  return response.success(res, {
    data: result,
    message: 'Password changed successfully'
  });
});

/**
 * Get Current User
 * GET /api/v1/auth/me
 */
const me = asyncHandler(async (req, res) => {
  return response.success(res, {
    data: { user: req.user }
  });
});

module.exports = {
  register,
  login,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  refreshToken,
  logout,
  logoutAll,
  changePassword,
  me
};