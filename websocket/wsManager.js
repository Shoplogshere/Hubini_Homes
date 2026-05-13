const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const deviceService = require('../services/deviceService');
const hubService = require('../services/hubService');

const generateAppId = () => crypto.randomBytes(10).toString('hex'); // 20 hex chars

// Sent to every device/hub on mews/mewh so hardware knows the current tier pricing
const PLANS = 'basic:0,stellar:2000,premium:5000,prime:8000';

class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map();        // userId  -> Set<ws>
    this.appConnections = new Map(); // appId   -> ws
    this.devices = new Map();        // dbId (string) -> ws
    this.hubs = new Map();           // dbId (string) -> ws
    this.deviceMeta = new Map();     // dbId -> { cloudId, userId, userPlan, devPlan }
    this.hubMeta = new Map();        // dbId -> { cloudId, userId }
    this.pendingPongs = new Map();   // dbId (string) -> Array<{ cmd, data }>
  }

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────

  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    console.log(' WebSocket server initialized');
  }

  // ─────────────────────────────────────────────
  // CONNECTION
  // ─────────────────────────────────────────────

  handleConnection(ws, req) {
    console.log(' New WebSocket connection');

    ws.appId = generateAppId();
    ws.authenticated = false;
    ws.connectionType = null; // 'app' | 'device' | 'hub'

    this.appConnections.set(ws.appId, ws);

    ws.on('message', (data) => this.handleMessage(ws, data.toString().trim()));
    ws.on('close', () => this.handleDisconnect(ws));
    ws.on('error', (err) => console.error('WebSocket error:', err.message));
  }

  // ─────────────────────────────────────────────
  // MESSAGE ROUTER
  // ─────────────────────────────────────────────

  async handleMessage(ws, rawData) {
    try {
      const parts = rawData.split('|');
      const cmd = parts[0].toLowerCase();

      switch (cmd) {
        case 'mews':  return this.handleDeviceMapping(ws, parts);
        case 'mewh':  return this.handleHubMapping(ws, parts);
        case 'auth':  return this.handleAuth(ws, parts);
        case 'getds': return this.handleGetDevices(ws);
        case 'c_nd':  return this.handleClientCommand(ws, parts);  // app → cloud → device
        case 'r_nd':  return this.handleNodeResponse(ws, parts);   // device → cloud → app
        case 'ping':  return this.handleDevicePing(ws);
        default:
          this.send(ws, `error|Unknown command: ${cmd}`);
      }
    } catch (err) {
      console.error('WS message error:', err.message);
      this.send(ws, 'error|Error processing message');
    }
  }

  // ─────────────────────────────────────────────
  // DEVICE MAPPING  —  mews|<dbId>
  // Response: registered|<dbId>|<userPlan>|<devPlan>|<plans>
  // plans = comma-separated tier:price pairs (e.g. basic:0,stellar:2000,...)
  // Device stores all of this at connection time — not repeated in every command
  // ─────────────────────────────────────────────

  async handleDeviceMapping(ws, parts) {
    const dbId = parts[1]?.trim();
    if (!dbId || isNaN(dbId)) {
      return this.send(ws, 'error|Valid device ID required');
    }

    try {
      const device = await deviceService.getDeviceById(parseInt(dbId));
      if (!device) {
        return this.send(ws, `error|Device ${dbId} not found`);
      }

      ws.dbId = String(dbId);
      ws.cloudId = device.cloud_id;
      ws.connectionType = 'device';

      const userPlan = 'free'; // extend when plan field added to users table
      const devPlan = 'free';

      this.devices.set(String(dbId), ws);
      this.deviceMeta.set(String(dbId), {
        cloudId: device.cloud_id,
        userId: device.user_id,
        userPlan,
        devPlan
      });

      deviceService.cancelActivationTimer(parseInt(dbId));
      await deviceService.setDeviceOnline(device.cloud_id, true);

      console.log(` Device mapped: dbId=${dbId}, cloud_id=${device.cloud_id}`);

      this.send(ws, `registered|${dbId}|${userPlan}|${devPlan}|${PLANS}`);
    } catch (err) {
      console.error('Device mapping error:', err.message);
      this.send(ws, 'error|Mapping failed');
    }
  }

  // ─────────────────────────────────────────────
  // HUB MAPPING  —  mewh|<dbId>
  // Response: registered|<dbId>|<userPlan>|<devPlan>|<plans>
  // ─────────────────────────────────────────────

  async handleHubMapping(ws, parts) {
    const dbId = parts[1]?.trim();
    if (!dbId || isNaN(dbId)) {
      return this.send(ws, 'error|Valid hub ID required');
    }

    try {
      const hub = await hubService.getHubById(parseInt(dbId));
      if (!hub) {
        return this.send(ws, `error|Hub ${dbId} not found`);
      }

      ws.dbId = String(dbId);
      ws.cloudId = hub.cloud_id;
      ws.connectionType = 'hub';

      const userPlan = 'free';
      const devPlan = 'free';

      this.hubs.set(String(dbId), ws);
      this.hubMeta.set(String(dbId), {
        cloudId: hub.cloud_id,
        userId: hub.user_id
      });

      hubService.cancelActivationTimer(parseInt(dbId));
      await hubService.setHubOnline(hub.cloud_id, true);

      console.log(` Hub mapped: dbId=${dbId}, cloud_id=${hub.cloud_id}`);
      this.send(ws, `registered|${dbId}|${userPlan}|${devPlan}|${PLANS}`);
    } catch (err) {
      console.error('Hub mapping error:', err.message);
      this.send(ws, 'error|Mapping failed');
    }
  }

  // ─────────────────────────────────────────────
  // CLIENT AUTH  —  auth|<jwt>
  // ─────────────────────────────────────────────

  async handleAuth(ws, parts) {
    const token = parts[1];
    if (!token) {
      return this.send(ws, 'error|Token required');
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      ws.userId = decoded.userId;
      ws.authenticated = true;
      ws.connectionType = 'app';

      if (!this.clients.has(decoded.userId)) {
        this.clients.set(decoded.userId, new Set());
      }
      this.clients.get(decoded.userId).add(ws);

      console.log(` Client authenticated: userId=${decoded.userId}, appId=${ws.appId}`);
      // App receives its assigned appId — used in all subsequent c_nd commands
      this.send(ws, `auth|${ws.appId}`);
    } catch (err) {
      this.send(ws, 'error|Invalid token');
    }
  }

  // ─────────────────────────────────────────────
  // GET DEVICES  —  getds
  // Response: ds|<id>:<localId>:<name>:<type>:<state>:<trigs>|...
  // ─────────────────────────────────────────────

  async handleGetDevices(ws) {
    if (!ws.authenticated || !ws.userId) {
      return this.send(ws, 'error|Not authenticated');
    }

    try {
      const devices = await deviceService.getDevicesForClient(ws.userId);

      if (devices.length === 0) {
        return this.send(ws, 'ds|empty');
      }

      const encoded = devices.map(d =>
        `${d.id}:${d.Local_ID}:${d.name}:${d.type}:${d.Last_state || 'unknown'}:${d.Trigs || ''}`
      ).join('|');

      this.send(ws, `ds|${encoded}`);
    } catch (err) {
      console.error('Error fetching devices:', err.message);
      this.send(ws, 'error|Failed to fetch devices');
    }
  }

  // ─────────────────────────────────────────────
  // APP → CLOUD → DEVICE  —  c_nd|<dbId>|<appId>|<todo>|<args...>
  //
  // Cloud relays to device as:
  //   c_nd|<cloudId>|<appId>|<todo>|<args>
  //
  // No plan fields in relay — device already has them from mews handshake
  // ─────────────────────────────────────────────

  async handleClientCommand(ws, parts) {
    if (!ws.authenticated || !ws.userId) {
      return this.send(ws, 'error|Not authenticated');
    }

    const dbDeviceId = parts[1];
    const appId      = parts[2] || ws.appId;
    const todo       = parts[3];
    const args       = parts.slice(4).join('|');

    if (!dbDeviceId || !todo) {
      return this.send(ws, 'error|Device ID and todo required');
    }

    try {
      const device    = await deviceService.getDeviceForCommand(ws.userId, parseInt(dbDeviceId));
      const meta      = this.deviceMeta.get(String(dbDeviceId));
      const targetWs  = this.devices.get(String(dbDeviceId));

      if (!targetWs || targetWs.readyState !== 1) {
        return this.send(ws, 'error|Device offline');
      }

      const devToken = meta?.cloudId || String(dbDeviceId);

      // Relay to device
      const relay = args
        ? `c_nd|${devToken}|${appId}|${todo}|${args}`
        : `c_nd|${devToken}|${appId}|${todo}`;

      this.send(targetWs, relay);
      await deviceService.logCommand(device.id, ws.userId, todo);
    } catch (err) {
      this.send(ws, `error|${err.message || 'Failed to send command'}`);
    }
  }

  // ─────────────────────────────────────────────
  // DEVICE → CLOUD → APP  —  r_nd|<cloudId>|<appId>|<respTodo>|<args>|<stateName>
  //
  // Cloud updates DB then forwards full response to the originating app.
  // If appId is '-' → no app to notify, just update DB and broadcast state to user.
  // ─────────────────────────────────────────────

  async handleNodeResponse(ws, parts) {
    const devToken  = parts[1];
    const appId     = parts[2];
    const respTodo  = parts[3];
    const stateData = parts.slice(4).join('|'); // everything after respTodo

    // Best-effort DB state update
    if (ws.dbId) {
      try {
        await deviceService.updateDeviceState(parseInt(ws.dbId), stateData);
      } catch (err) { /* non-critical */ }
    }

    if (!appId || appId === '-') {
      // Server-device only — notify the device owner's app connections of state change
      const meta = ws.dbId ? this.deviceMeta.get(ws.dbId) : null;
      if (meta) {
        this.notifyUser(meta.userId, `r_nd|${devToken}|-|${respTodo}|${stateData}`);
      }
      return;
    }

    // Route full response back to the originating app session
    const appWs = this.appConnections.get(appId);
    if (appWs && appWs.readyState === 1) {
      this.send(appWs, parts.join('|'));
    }
  }

  // ─────────────────────────────────────────────
  // DEVICE PING  —  ping  (device sends every 30 s)
  //
  // Updates last_seen. Only replies if the server has queued data for this
  // device (plan change, booking, etc.). Silence = nothing pending.
  // Reply format: pong|<devId>|<cmd>|<data>
  // ─────────────────────────────────────────────

  async handleDevicePing(ws) {
    if (ws.cloudId) {
      try {
        await deviceService.setDeviceOnline(ws.cloudId, true);
      } catch (err) { /* non-critical */ }
    }

    const dbId = ws.dbId;
    if (!dbId) return;

    const queue = this.pendingPongs.get(dbId);
    if (!queue || queue.length === 0) return;

    // Drain the queue — send each pending pong then clear
    const meta = this.deviceMeta.get(dbId);
    const devId = meta?.cloudId || dbId;

    for (const { cmd, data } of queue) {
      this.send(ws, `pong|${devId}|${cmd}|${data}`);
    }
    this.pendingPongs.delete(dbId);
  }

  // ─────────────────────────────────────────────
  // QUEUE A PONG  —  called externally when server needs to push data to a device
  // e.g. plan change, booking queued while device was mid-cycle
  // The data will be delivered on the device's next ping.
  // ─────────────────────────────────────────────

  queuePong(dbId, cmd, data) {
    const key = String(dbId);
    if (!this.pendingPongs.has(key)) {
      this.pendingPongs.set(key, []);
    }
    this.pendingPongs.get(key).push({ cmd, data });
  }

  // ─────────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────────

  async handleDisconnect(ws) {
    if (ws.appId) {
      this.appConnections.delete(ws.appId);
    }

    if (ws.userId && this.clients.has(ws.userId)) {
      this.clients.get(ws.userId).delete(ws);
      if (this.clients.get(ws.userId).size === 0) {
        this.clients.delete(ws.userId);
      }
    }

    if (ws.connectionType === 'device' && ws.dbId) {
      this.devices.delete(ws.dbId);
      this.deviceMeta.delete(ws.dbId);
      if (ws.cloudId) {
        try { await deviceService.setDeviceOnline(ws.cloudId, false); } catch (e) { /* ignore */ }
      }
      console.log(` Device disconnected: dbId=${ws.dbId}`);
    }

    if (ws.connectionType === 'hub' && ws.dbId) {
      this.hubs.delete(ws.dbId);
      this.hubMeta.delete(ws.dbId);
      if (ws.cloudId) {
        try { await hubService.setHubOnline(ws.cloudId, false); } catch (e) { /* ignore */ }
      }
      console.log(` Hub disconnected: dbId=${ws.dbId}`);
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC HELPERS
  // ─────────────────────────────────────────────

  /**
   * Send a c_nd command to a device from an HTTP request (no app WS session).
   * appId is always '-' since there's no WS client session to route a response to.
   * Format: c_nd|<cloudId>|-|<todo>|<args>
   */
  sendCommandToDevice(dbId, todo, args = '') {
    const ws = this.devices.get(String(dbId));
    if (!ws || ws.readyState !== 1) return false;

    const meta     = this.deviceMeta.get(String(dbId));
    const devToken = meta?.cloudId || String(dbId);

    const message = args
      ? `c_nd|${devToken}|-|${todo}|${args}`
      : `c_nd|${devToken}|-|${todo}`;

    this.send(ws, message);
    return true;
  }

  /**
   * Notify all WS connections belonging to a user.
   */
  notifyUser(userId, message) {
    const connections = this.clients.get(userId);
    if (connections) {
      connections.forEach((ws) => {
        if (ws.readyState === 1) this.send(ws, message);
      });
    }
  }

  send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }

  getStats() {
    return {
      totalConnections: this.wss?.clients.size || 0,
      authenticatedClients: this.clients.size,
      connectedDevices: this.devices.size,
      connectedHubs: this.hubs.size
    };
  }

  shutdown() {
    if (this.wss) this.wss.close();
  }
}

const wsManager = new WebSocketManager();
module.exports = wsManager;
