const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const deviceService = require('../services/deviceService');
const hubService = require('../services/hubService');
const { validateAddDeviceToken, markAddDeviceTokenUsed } = require('../services/authService');

const generateAppId = () => crypto.randomBytes(10).toString('hex'); // 20 hex chars

class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map();        // userId  -> Set<ws>   (authenticated app clients)
    this.appConnections = new Map(); // appId   -> ws
    this.devices = new Map();        // dbId    -> ws
    this.hubs = new Map();           // dbId    -> ws
    this.deviceMeta = new Map();     // dbId    -> { userId, localId }
    this.hubMeta = new Map();        // dbId    -> { userId, hubLocalId }
    this.pendingPongs = new Map();   // dbId    -> Array<{ cmd, data }>
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
        case 'addd':  return this.handleAddDevice(ws, parts);
        case 'addh':  return this.handleAddHub(ws, parts);
        case 'auth':  return this.handleAuth(ws, parts);
        case 'getds': return this.handleGetDevices(ws);
        case 'c_nd':  return this.handleClientCommand(ws, parts);
        case 'r_nd':  return this.handleNodeResponse(ws, parts);
        case 'ping':  return this.handlePing(ws, parts);
        default:
          this.send(ws, `error|Unknown command: ${cmd}`);
      }
    } catch (err) {
      console.error('WS message error:', err.message);
      this.send(ws, 'error|Error processing message');
    }
  }

  // ─────────────────────────────────────────────
  // ADD DEVICE  —  addD|<Local_ID>|<Name>|<Type>|<trigs>|<Model>|<add_device_token>
  // Response: AdD_resp|<local_ID>|suc|<cloud_user_id>
  // ─────────────────────────────────────────────

  async handleAddDevice(ws, parts) {
    const [, localId, name, type, trigs, model, token] = parts;

    if (!localId || !name || !type || !model || !token) {
      return this.send(ws, 'error|Missing required fields');
    }

    const tokenRecord = await validateAddDeviceToken(token);
    if (!tokenRecord) {
      return this.send(ws, 'error|Invalid or expired add-device token');
    }

    const { id: tokenId, userId } = tokenRecord;

    try {
      const device = await deviceService.registerDeviceFromWS(userId, { localId, name, type, trigs, model });
      await markAddDeviceTokenUsed(tokenId);

      ws.dbId = String(device.id);
      ws.localId = localId;
      ws.userId = userId;
      ws.connectionType = 'device';

      this.devices.set(String(device.id), ws);
      this.deviceMeta.set(String(device.id), { userId, localId });

      await deviceService.setDeviceOnline(device.id, true);

      console.log(` Device registered: localId=${localId}, dbId=${device.id}, userId=${userId}`);
      this.send(ws, `AdD_resp|${localId}|suc|${userId}`);
    } catch (err) {
      console.error('addD error:', err.message);
      this.send(ws, 'error|Failed to register device');
    }
  }

  // ─────────────────────────────────────────────
  // ADD HUB  —  addH|<hubID>|<HubName>|<type>|<model>|<local_username>|<guest_pin>|<add_device_token>
  // Response: AdD_resp|<hubID>|suc|<cloud_user_id>
  // ─────────────────────────────────────────────

  async handleAddHub(ws, parts) {
    const [, hubLocalId, hubName, type, model, localUsername, guestPin, token] = parts;

    if (!hubLocalId || !hubName || !type || !model || !token) {
      return this.send(ws, 'error|Missing required fields');
    }

    const tokenRecord = await validateAddDeviceToken(token);
    if (!tokenRecord) {
      return this.send(ws, 'error|Invalid or expired add-device token');
    }

    const { id: tokenId, userId } = tokenRecord;

    try {
      const hub = await hubService.registerHubFromWS(userId, {
        hubLocalId, hubName, type, model, localUsername, guestPin
      });
      await markAddDeviceTokenUsed(tokenId);

      ws.dbId = String(hub.id);
      ws.hubLocalId = hubLocalId;
      ws.userId = userId;
      ws.connectionType = 'hub';

      this.hubs.set(String(hub.id), ws);
      this.hubMeta.set(String(hub.id), { userId, hubLocalId });

      await hubService.setHubOnline(hub.id, true);

      console.log(` Hub registered: localId=${hubLocalId}, dbId=${hub.id}, userId=${userId}`);
      this.send(ws, `AdD_resp|${hubLocalId}|suc|${userId}`);
    } catch (err) {
      console.error('addH error:', err.message);
      this.send(ws, 'error|Failed to register hub');
    }
  }

  // ─────────────────────────────────────────────
  // CLIENT AUTH  —  auth|<jwt>
  // Response: auth|<appId>
  // ─────────────────────────────────────────────

  async handleAuth(ws, parts) {
    const token = parts[1];
    if (!token) return this.send(ws, 'error|Token required');

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      ws.userId = decoded.userId;
      ws.authenticated = true;
      ws.connectionType = 'app';

      if (!this.clients.has(decoded.userId)) {
        this.clients.set(decoded.userId, new Set());
      }
      this.clients.get(decoded.userId).add(ws);

      console.log(` App authenticated: userId=${decoded.userId}`);
      this.send(ws, `auth|${ws.appId}`);
    } catch {
      this.send(ws, 'error|Invalid token');
    }
  }

  // ─────────────────────────────────────────────
  // GET DEVICES (WS)  —  getds
  // Response: ds|<id>:<localId>:<name>:<type>:<state>:<trigs>|...
  // ─────────────────────────────────────────────

  async handleGetDevices(ws) {
    if (!ws.authenticated || !ws.userId) {
      return this.send(ws, 'error|Not authenticated');
    }

    try {
      const devices = await deviceService.getDevicesForClient(ws.userId);

      if (devices.length === 0) return this.send(ws, 'ds|empty');

      const encoded = devices.map(d =>
        `${d.id}:${d.Local_ID}:${d.name}:${d.type}:${d.Last_state || 'unknown'}:${d.Trigs || ''}`
      ).join('|');

      this.send(ws, `ds|${encoded}`);
    } catch (err) {
      console.error('getds error:', err.message);
      this.send(ws, 'error|Failed to fetch devices');
    }
  }

  // ─────────────────────────────────────────────
  // PING  —  ping|<localId>|<userId>|<cmd_or_dash>|<optional_args>
  //
  // Default (no queued data): ping|<localId>|<userId>|-
  // With embedded command:    ping|<localId>|<userId>|AdHN|<device_data>
  //
  // On first receive: re-maps the WS connection to the right device/hub in case
  // this is a reconnection (new socket, same hardware).
  // ─────────────────────────────────────────────

  async handlePing(ws, parts) {
    const localId = parts[1];
    const userId  = parseInt(parts[2]);
    const cmd     = parts[3]; // '-' or a command name
    const args    = parts.slice(4).join('|');

    if (!localId || isNaN(userId)) return;

    // Re-map this socket to the device/hub if it reconnected without sending addD/addH again
    if (!ws.dbId) {
      await this.remapConnection(ws, localId, userId);
    }

    // Update last_seen
    if (ws.connectionType === 'device' && ws.dbId) {
      try { await deviceService.setDeviceOnline(parseInt(ws.dbId), true); } catch { /* non-critical */ }
    } else if (ws.connectionType === 'hub' && ws.dbId) {
      try { await hubService.setHubOnline(parseInt(ws.dbId), true); } catch { /* non-critical */ }
    }

    // Drain any server-queued data waiting for this ping
    if (ws.dbId) {
      const queue = this.pendingPongs.get(ws.dbId);
      if (queue && queue.length > 0) {
        for (const { cmd: pCmd, data } of queue) {
          this.send(ws, `pong|${ws.dbId}|${pCmd}|${data}`);
        }
        this.pendingPongs.delete(ws.dbId);
      }
    }

    // Handle embedded command (replaces '-' when hub has queued data)
    if (cmd && cmd !== '-') {
      if (cmd.toLowerCase() === 'adhn') {
        return this.handleAddHubNode(ws, localId, userId, args);
      }
    }
  }

  // ─────────────────────────────────────────────
  // HUB ADD NODE  —  embedded in ping as AdHN
  // ping|<hubId>|<userId>|AdHN|<device_ID>,<device_name>,<deviceType>,<triggers>;
  // Response: AdHN_resp|<hubId>|suc|<device_ID>
  // ─────────────────────────────────────────────

  async handleAddHubNode(ws, hubLocalId, userId, deviceData) {
    // Strip trailing semicolon (used as separator on the hardware side)
    const clean = deviceData.replace(/;$/, '');
    const [deviceLocalId, deviceName, deviceType, deviceTrigs] = clean.split(',');

    if (!deviceLocalId || !deviceName || !deviceType) {
      return this.send(ws, 'error|Invalid hub node data');
    }

    if (!ws.dbId) {
      return this.send(ws, 'error|Hub not registered');
    }

    try {
      await hubService.addHubNode(userId, parseInt(ws.dbId), {
        localId: deviceLocalId,
        name: deviceName,
        type: deviceType,
        trigs: deviceTrigs || null
      });
      this.send(ws, `AdHN_resp|${hubLocalId}|suc|${deviceLocalId}`);
    } catch (err) {
      console.error('AdHN error:', err.message);
      this.send(ws, 'error|Failed to add hub node');
    }
  }

  // ─────────────────────────────────────────────
  // REMAP CONNECTION  (reconnect helper)
  // Looks up device then hub by localId + userId. Called from ping when ws.dbId is unset.
  // ─────────────────────────────────────────────

  async remapConnection(ws, localId, userId) {
    try {
      const device = await deviceService.getDeviceByLocalId(userId, localId);
      if (device) {
        ws.dbId = String(device.id);
        ws.localId = localId;
        ws.userId = userId;
        ws.connectionType = 'device';
        this.devices.set(String(device.id), ws);
        this.deviceMeta.set(String(device.id), { userId, localId });
        return;
      }

      const hub = await hubService.getHubByLocalId(userId, localId);
      if (hub) {
        ws.dbId = String(hub.id);
        ws.hubLocalId = localId;
        ws.userId = userId;
        ws.connectionType = 'hub';
        this.hubs.set(String(hub.id), ws);
        this.hubMeta.set(String(hub.id), { userId, hubLocalId: localId });
      }
    } catch (err) {
      console.error('remapConnection error:', err.message);
    }
  }

  // ─────────────────────────────────────────────
  // APP → CLOUD → DEVICE  —  c_nd|<dbId>|<appId>|<todo>|<args...>
  // Cloud relays to device as: c_nd|<localId>|<appId>|<todo>|<args>
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
      return this.send(ws, 'error|Device ID and command required');
    }

    try {
      const device   = await deviceService.getDeviceForCommand(ws.userId, parseInt(dbDeviceId));
      const meta     = this.deviceMeta.get(String(dbDeviceId));
      const targetWs = this.devices.get(String(dbDeviceId));

      if (!targetWs || targetWs.readyState !== 1) {
        return this.send(ws, 'error|Device offline');
      }

      const devToken = meta?.localId || String(dbDeviceId);
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
  // DEVICE → CLOUD → APP  —  r_nd|<localId>|<appId>|<respTodo>|<stateData>
  //
  // Updates DB state then routes response back to originating app.
  // appId '-' → no specific app to notify; broadcast state to all user sessions.
  // ─────────────────────────────────────────────

  async handleNodeResponse(ws, parts) {
    const localId   = parts[1];
    const appId     = parts[2];
    const respTodo  = parts[3];
    const stateData = parts.slice(4).join('|');

    if (ws.dbId) {
      try { await deviceService.updateDeviceState(parseInt(ws.dbId), stateData); } catch { /* non-critical */ }
    }

    if (!appId || appId === '-') {
      const meta = ws.dbId ? this.deviceMeta.get(ws.dbId) : null;
      if (meta) {
        this.notifyUser(meta.userId, `r_nd|${localId}|-|${respTodo}|${stateData}`);
      }
      return;
    }

    const appWs = this.appConnections.get(appId);
    if (appWs && appWs.readyState === 1) {
      this.send(appWs, parts.join('|'));
    }
  }

  // ─────────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────────

  async handleDisconnect(ws) {
    if (ws.appId) this.appConnections.delete(ws.appId);

    if (ws.userId && this.clients.has(ws.userId)) {
      this.clients.get(ws.userId).delete(ws);
      if (this.clients.get(ws.userId).size === 0) this.clients.delete(ws.userId);
    }

    if (ws.connectionType === 'device' && ws.dbId) {
      this.devices.delete(ws.dbId);
      this.deviceMeta.delete(ws.dbId);
      try { await deviceService.setDeviceOnline(parseInt(ws.dbId), false); } catch { /* ignore */ }
      console.log(` Device disconnected: dbId=${ws.dbId}`);
    }

    if (ws.connectionType === 'hub' && ws.dbId) {
      this.hubs.delete(ws.dbId);
      this.hubMeta.delete(ws.dbId);
      try { await hubService.setHubOnline(parseInt(ws.dbId), false); } catch { /* ignore */ }
      console.log(` Hub disconnected: dbId=${ws.dbId}`);
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC HELPERS
  // ─────────────────────────────────────────────

  /**
   * Send a command to a device from an HTTP request (no WS app session).
   * appId is always '-'; device knows the response is a broadcast state update.
   */
  sendCommandToDevice(dbId, todo, args = '') {
    const ws = this.devices.get(String(dbId));
    if (!ws || ws.readyState !== 1) return false;

    const meta     = this.deviceMeta.get(String(dbId));
    const devToken = meta?.localId || String(dbId);

    const message = args
      ? `c_nd|${devToken}|-|${todo}|${args}`
      : `c_nd|${devToken}|-|${todo}`;

    this.send(ws, message);
    return true;
  }

  /**
   * Broadcast a message to all WS sessions belonging to a user.
   */
  notifyUser(userId, message) {
    const connections = this.clients.get(userId);
    if (connections) {
      connections.forEach((ws) => { if (ws.readyState === 1) this.send(ws, message); });
    }
  }

  /**
   * Queue data to be delivered to a device on its next ping (e.g. plan changes).
   */
  queuePong(dbId, cmd, data) {
    const key = String(dbId);
    if (!this.pendingPongs.has(key)) this.pendingPongs.set(key, []);
    this.pendingPongs.get(key).push({ cmd, data });
  }

  send(ws, data) {
    if (ws.readyState === 1) ws.send(data);
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
