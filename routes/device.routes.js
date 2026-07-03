const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { authenticate } = require('../middlewares/auth');
const { deviceCommandLimiter } = require('../middlewares/rateLimiter');
const {
  updateDeviceValidator,
  deviceIdValidator,
  deviceCommandValidator
} = require('../middlewares/validators');

// Fetch devices for client apps (token in body, not Bearer header)
router.post('/fetch', deviceController.fetchDevices);

// All routes below require JWT authentication
router.use(authenticate);

// Device CRUD
router.get('/', deviceController.getDevices);
router.get('/:deviceId', deviceIdValidator, deviceController.getDevice);
router.put('/:deviceId', updateDeviceValidator, deviceController.updateDevice);
router.delete('/:deviceId', deviceIdValidator, deviceController.deleteDevice);

// Device commands
router.post('/:deviceId/command', deviceCommandLimiter, deviceCommandValidator, deviceController.sendCommand);
router.post('/:deviceId/trigger', deviceCommandLimiter, deviceIdValidator, deviceController.triggerDevice);

module.exports = router;
