const response = require('../utils/response');
const { ERROR_CODES } = require('../config/constants');

/**
 * Not found handler (404)
 */
const notFoundHandler = (req, res, next) => {
  return response.notFound(res, {
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message);

  // Validation errors from express-validator
  if (err.array && typeof err.array === 'function') {
    return response.validationError(res, {
      message: 'Validation failed',
      errors: err.array().map(e => ({
        field: e.path || e.param,
        message: e.msg
      }))
    });
  }

  // JSON syntax error
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return response.badRequest(res, {
      message: 'Invalid JSON in request body'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return response.unauthorized(res, {
      message: 'Invalid token',
      errorCode: ERROR_CODES.TOKEN_INVALID
    });
  }

  if (err.name === 'TokenExpiredError') {
    return response.unauthorized(res, {
      message: 'Token expired',
      errorCode: ERROR_CODES.TOKEN_EXPIRED
    });
  }

  // MySQL duplicate entry
  if (err.code === 'ER_DUP_ENTRY') {
    return response.conflict(res, {
      message: 'Duplicate entry exists'
    });
  }

  // Infrastructure errors — generic user messages, full detail in logs only
  const INFRA_ERROR_MAP = {
    ER_ACCESS_DENIED_ERROR: 'Service configuration issue. Please contact support.',
    ER_BAD_DB_ERROR:        'Service setup issue. Please contact support.',
    ER_CON_COUNT_ERROR:     'Service is currently busy. Please try again shortly.',
    ECONNREFUSED:           'Service is temporarily unavailable. Please try again later.',
    PROTOCOL_CONNECTION_LOST: 'Connection interrupted. Please try again.',
    ETIMEDOUT:              'Request timed out. Please try again.',
  };
  if (err.code && INFRA_ERROR_MAP[err.code]) {
    console.error(`[INFRA ERROR ${err.code}]:`, err.message);
    return response.error(res, {
      message: INFRA_ERROR_MAP[err.code],
      errorCode: ERROR_CODES.SERVER_ERROR
    });
  }

  // Custom application errors
  if (err.statusCode) {
    return response.error(res, {
      message: err.message,
      statusCode: err.statusCode,
      errorCode: err.errorCode
    });
  }

  // Default server error — log full details, send safe message
  console.error('[UNHANDLED ERROR]:', err.message, err.stack);
  return response.error(res, {
    message: 'Something went wrong. Please try again.',
    errorCode: ERROR_CODES.SERVER_ERROR
  });
};

/**
 * Async handler wrapper - catches async errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  notFoundHandler,
  errorHandler,
  asyncHandler
};