const { body, param, query, validationResult } = require('express-validator');
const response = require('../utils/response');

/**
 * Handle validation results
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return response.validationError(res, {
      message: 'Validation failed',
      errors: errors.array().map(e => ({
        field: e.path || e.param,
        message: e.msg,
        value: e.value
      }))
    });
  }

  next();
};

// ==================== AUTH VALIDATORS ====================

const registerValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, underscores'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').optional().trim().isLength({ max: 100 }),
  body('lastName').optional().trim().isLength({ max: 100 }),
  body('role')
    .trim()
    .notEmpty().withMessage('Role is required')
    .isIn(['host', 'developer']).withMessage('Role must be one of: host, developer'),
  body('organizationName')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Organization name must not exceed 255 characters'),
  body('gender')
    .notEmpty().withMessage('Gender is required')
    .isIn(['male', 'female', 'other', 'prefer_not_to_say']).withMessage('Gender must be one of: male, female, other, prefer_not_to_say'),
  body('dateOfBirth')
    .notEmpty().withMessage('Date of birth is required')
    .isISO8601().withMessage('Date of birth must be a valid date (YYYY-MM-DD)')
    .isBefore(new Date().toISOString()).withMessage('Date of birth must be in the past'),
  validate
];

const loginValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format'),
  body('password')
    .notEmpty().withMessage('Password is required'),
  validate
];

const forgotPasswordValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format'),
  validate
];

const resetPasswordValidator = [
  body('token')
    .trim()
    .notEmpty().withMessage('Reset token is required'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
];

const changePasswordValidator = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
];

const refreshTokenValidator = [
  body('refreshToken')
    .trim()
    .notEmpty().withMessage('Refresh token is required'),
  validate
];

// ==================== DEVICE VALIDATORS ====================

const registerDeviceValidator = [
  body('Local_ID')
    .trim()
    .notEmpty().withMessage('Local_ID is required')
    .isLength({ max: 100 }),
  body('Name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ max: 100 }),
  body('Type')
    .trim()
    .notEmpty().withMessage('Type is required')
    .isLength({ max: 50 }),
  body('Model')
    .trim()
    .notEmpty().withMessage('Model is required')
    .isLength({ max: 50 }),
  body('trigs')
    .optional()
    .trim()
    .isLength({ max: 255 }),
  validate
];

const updateDeviceValidator = [
  param('deviceId').isInt().withMessage('Device ID must be a number'),
  body('Name').optional().trim().isLength({ max: 100 }),
  body('Type').optional().trim().isLength({ max: 50 }),
  body('trigs').optional().trim().isLength({ max: 255 }),
  validate
];

const deviceIdValidator = [
  param('deviceId').isInt().withMessage('Device ID must be a number'),
  validate
];

const deviceCommandValidator = [
  param('deviceId').isInt().withMessage('Device ID must be a number'),
  body('command')
    .trim()
    .notEmpty().withMessage('Command is required')
    .isLength({ max: 255 }),
  validate
];

// ==================== HUB VALIDATORS ====================

const registerHubValidator = [
  body('hubToken')
    .trim()
    .notEmpty().withMessage('Hub token is required')
    .isLength({ max: 255 }),
  body('hubName')
    .trim()
    .notEmpty().withMessage('Hub name is required')
    .isLength({ max: 100 }),
  body('type')
    .trim()
    .notEmpty().withMessage('Type is required')
    .isLength({ max: 50 }),
  body('model')
    .trim()
    .notEmpty().withMessage('Model is required')
    .isLength({ max: 50 }),
  validate
];

const hubIdValidator = [
  param('hubId').isInt().withMessage('Hub ID must be a number'),
  validate
];

// ==================== USER VALIDATORS ====================

const updateProfileValidator = [
  body('firstName').optional().trim().isLength({ max: 100 }),
  body('lastName').optional().trim().isLength({ max: 100 }),
  body('phone').optional().trim().isLength({ max: 20 }),
  body('dateOfBirth').optional().isISO8601().withMessage('Invalid date format'),
  validate
];

module.exports = {
  validate,
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  refreshTokenValidator,
  registerDeviceValidator,
  updateDeviceValidator,
  deviceIdValidator,
  deviceCommandValidator,
  registerHubValidator,
  hubIdValidator,
  updateProfileValidator
};