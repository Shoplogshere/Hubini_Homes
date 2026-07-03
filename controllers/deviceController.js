const jwt = require('jsonwebtoken');
const deviceService = require('../services/deviceService');
const response = require('../utils/response');
const { SUCCESS_MESSAGES, ERROR_CODES } = require('../config/constants');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('../utils/helpers');

// WebSocket manager injected after server start
let wsManager = null;
const setWsManager = (manager) => { wsManager = manager; };

/**
 * Fetch devices for client apps (getDs).
 * POST /api/v1/devices/fetch
 * Body: { "cmd": "getDs", "logintoken": "<jwt>" }
 * No Bearer header needed — token is in body.
 */
const fetchDevices = asyncHandler(async (req, res) => {
  const { cmd, logintoken } = req.body;

  if (cmd !== 'getDs') {
    return response.badRequest(res, { message: 'Invalid command. Expected: getDs' });
  }

  if (!logintoken) {
    return response.unauthorized(res, { message: 'Login token required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(logintoken, process.env.JWT_SECRET);
  } catch {
    return response.unauthorized(res, { message: 'Invalid or expired login token' });
  }

  const devices = await deviceService.getDevicesForClient(decoded.userId);
  return res.json(devices);
});

/**
 * Get All Devices (paginated)
 * GET /api/v1/devices
 */
const getDevices = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { type, search } = req.query;

  const result = await deviceService.getUserDevices(req.user.id, { page, limit, offset, type, search });

  return response.paginated(res, {
    data: result.devices,
    page: result.page,
    limit: result.limit,
    total: result.total
  });
});

/**
 * Get Single Device
 * GET /api/v1/devices/:deviceId
 */
const getDevice = asyncHandler(async (req, res) => {
  const device = await deviceService.getDevice(req.user.id, parseInt(req.params.deviceId));
  return response.success(res, { data: device });
});

/**
 * Update Device
 * PUT /api/v1/devices/:deviceId
 */
const updateDevice = asyncHandler(async (req, res) => {
  const device = await deviceService.updateDevice(req.user.id, parseInt(req.params.deviceId), req.body);
  return response.success(res, { data: device, message: SUCCESS_MESSAGES.DEVICE_UPDATED });
});

/**
 * Delete Device
 * DELETE /api/v1/devices/:deviceId
 */
const deleteDevice = asyncHandler(async (req, res) => {
  const result = await deviceService.deleteDevice(req.user.id, parseInt(req.params.deviceId));
  return response.success(res, { data: result, message: SUCCESS_MESSAGES.DEVICE_DELETED });
});

/**
 * Send Command to Device
 * POST /api/v1/devices/:deviceId/command
 */
const sendCommand = asyncHandler(async (req, res) => {
  const { command } = req.body;
  const device = await deviceService.getDeviceForCommand(req.user.id, parseInt(req.params.deviceId));

  if (!device.is_online) {
    return response.badRequest(res, { message: 'Device is offline', errorCode: ERROR_CODES.DEVICE_OFFLINE });
  }

  await deviceService.logCommand(device.id, req.user.id, command);

  if (wsManager) {
    const sent = wsManager.sendCommandToDevice(device.id, 'command', command);
    if (sent) return response.success(res, { message: 'Command sent successfully' });
  }

  return response.badRequest(res, { message: 'Device connection not available', errorCode: ERROR_CODES.DEVICE_COMMAND_FAILED });
});

/**
 * Trigger Device
 * POST /api/v1/devices/:deviceId/trigger
 */
const triggerDevice = asyncHandler(async (req, res) => {
  const { trigger } = req.body;
  const device = await deviceService.getDeviceForCommand(req.user.id, parseInt(req.params.deviceId));

  if (wsManager) {
    const sent = wsManager.sendCommandToDevice(device.id, 'trigger', trigger);
    if (sent) return response.success(res, { message: 'Device triggered successfully' });
  }

  return response.badRequest(res, { message: 'Device offline or not connected', errorCode: ERROR_CODES.DEVICE_OFFLINE });
});

module.exports = {
  fetchDevices,
  getDevices,
  getDevice,
  updateDevice,
  deleteDevice,
  sendCommand,
  triggerDevice,
  setWsManager
};
