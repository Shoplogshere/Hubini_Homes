const hubService = require('../services/hubService');
const response = require('../utils/response');
const { SUCCESS_MESSAGES } = require('../config/constants');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('../utils/helpers');

/**
 * Get All Hubs
 * GET /api/v1/hubs
 */
const getHubs = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);

  const result = await hubService.getUserHubs(req.user.id, {
    page,
    limit,
    offset
  });

  return response.paginated(res, {
    data: result.hubs,
    page: result.page,
    limit: result.limit,
    total: result.total
  });
});

/**
 * Get Single Hub
 * GET /api/v1/hubs/:hubId
 */
const getHub = asyncHandler(async (req, res) => {
  const { hubId } = req.params;

  const hub = await hubService.getHub(req.user.id, parseInt(hubId));

  return response.success(res, { data: hub });
});

/**
 * Update Hub
 * PUT /api/v1/hubs/:hubId
 */
const updateHub = asyncHandler(async (req, res) => {
  const { hubId } = req.params;

  const hub = await hubService.updateHub(req.user.id, parseInt(hubId), req.body);

  return response.success(res, {
    data: hub,
    message: SUCCESS_MESSAGES.HUB_UPDATED
  });
});

/**
 * Delete Hub
 * DELETE /api/v1/hubs/:hubId
 */
const deleteHub = asyncHandler(async (req, res) => {
  const { hubId } = req.params;

  const result = await hubService.deleteHub(req.user.id, parseInt(hubId));

  return response.success(res, {
    data: result,
    message: SUCCESS_MESSAGES.HUB_DELETED
  });
});

/**
 * Get Hub Devices
 * GET /api/v1/hubs/:hubId/devices
 */
const getHubDevices = asyncHandler(async (req, res) => {
  const { hubId } = req.params;

  const devices = await hubService.getHubDevices(req.user.id, parseInt(hubId));

  return response.success(res, { data: devices });
});

/**
 * Link Device to Hub
 * POST /api/v1/hubs/:hubId/devices/:deviceId
 */
const linkDevice = asyncHandler(async (req, res) => {
  const { hubId, deviceId } = req.params;

  const result = await hubService.linkDevice(
    req.user.id,
    parseInt(hubId),
    parseInt(deviceId)
  );

  return response.success(res, {
    data: result,
    message: 'Device linked to hub successfully'
  });
});

/**
 * Unlink Device from Hub
 * DELETE /api/v1/hubs/devices/:deviceId
 */
const unlinkDevice = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;

  const result = await hubService.unlinkDevice(req.user.id, parseInt(deviceId));

  return response.success(res, {
    data: result,
    message: 'Device unlinked from hub successfully'
  });
});

module.exports = {
  getHubs,
  getHub,
  updateHub,
  deleteHub,
  getHubDevices,
  linkDevice,
  unlinkDevice
};