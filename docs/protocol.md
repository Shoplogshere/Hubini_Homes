# Hubini IoT Protocol Reference

## 1. Add-Device Flow

### Step 1 — Login and get add-device token

**POST** `/api/v1/auth/login`

```json
{
  "email": "user@example.com",
  "password": "password123",
  "RequestAddDevice": true
}
```

Response includes the standard login data plus `addDeviceToken` (20-char hex):

```json
{
  "user": { ... },
  "tokens": { "accessToken": "...", "refreshToken": "..." },
  "addDeviceToken": "K9fX2m7PqW4vB1zL8tNx"
}
```

- Token is **single-use** and expires after **24 hours**.
- Relay this token to the ESP/device via BLE, serial, or local Wi-Fi.

---

### Step 2a — Device registers via WebSocket

Connect to `ws://<host>/ws` and send:

```
addD|<Local_ID>|<Name>|<Type>|<trigs>|<Model>|<add_device_token>
```

| Field             | Example         | Notes                               |
|-------------------|-----------------|-------------------------------------|
| Local_ID          | `0:Usp23`       | Hardware-assigned local identifier  |
| Name              | `Room Table`    | Human-readable device name          |
| Type              | `light`         | Device type                         |
| trigs             | `On_Off`        | Supported trigger commands          |
| Model             | `BW-sdb0001`    | Hardware model                      |
| add_device_token  | `K9fX2m7...`    | Token received at login             |

**Example:**
```
addD|0:Usp23|Room Table|light|On_Off|BW-sdb0001|K9fX2m7PqW4vB1zL8tNx
```

**Cloud responds:**
```
AdD_resp|<local_ID>|suc|<cloud_user_id>
```
Example: `AdD_resp|0:Usp23|suc|22`

The cloud now recognises this WebSocket connection as that device.

---

### Step 2b — Hub registers via WebSocket

Connect to `ws://<host>/ws` and send:

```
addH|<hubID>|<HubName>|<type>|<model>|<local_username>|<guest_pin>|<add_device_token>
```

| Field            | Example         | Notes                                      |
|------------------|-----------------|--------------------------------------------|
| hubID            | `H123`          | Hardware-assigned local hub identifier     |
| HubName          | `Pod proto`     | Human-readable hub name                    |
| type             | `hub_mini`      | Hub type                                   |
| model            | `hub001`        | Hub model                                  |
| local_username   | `local_admin`   | Local hub admin username (stored, not used by cloud) |
| guest_pin        | `123456`        | Guest access PIN (stored, returned on request) |
| add_device_token | `A7mQ3v...`     | Token received at login                    |

**Example:**
```
addH|H123|Pod proto|hub_mini|hub001|local_admin|123456|A7mQ3vR9xK2wB5zL1pXt
```

**Cloud responds:**
```
AdD_resp|<hubID>|suc|<cloud_user_id>
```
Example: `AdD_resp|H123|suc|5`

**Note:** If the cloud doesn't respond, device/hub retries every 30 seconds to 10 minutes (depending on subscription plan) for up to 24 hours.

---

## 2. Hub Adding Nodes (Hub Devices)

Hubs relay their connected nodes to the cloud via the `AdHN` command embedded inside a ping:

```
ping|<hubID>|<userID>|AdHN|<device_ID>,<device_name>,<deviceType>,<triggers>;
```

**Example:**
```
ping|H#01|5|AdHN|1:s7hp,Guest 1 meter,switch,On_Off;
```

**Cloud responds:**
```
AdHN_resp|<hubID>|suc|<device_ID>
```
Example: `AdHN_resp|H#01|suc|1:s7hp`

- One device is sent per ping message.
- The `;` at the end is a line terminator (separator for when hub sends the full list to the app later).
- Cloud saves the node as a device in the database linked to the hub.

---

## 3. Ping Architecture

**Default ping** (no queued data):
```
ping|<localId>|<userId>|-
```

**Ping with embedded command** (replacing `-`):
```
ping|<localId>|<userId>|<cmd>|<args>
```

- Sent every **30 seconds to 10 minutes** depending on user subscription plan.
- `|-` means nothing queued; cloud updates `last_seen` and returns nothing.
- When a device reconnects after a disconnect, the first ping re-maps its WebSocket connection on the cloud.

---

## 4. Fetch Devices (App)

**POST** `/api/v1/devices/fetch`

```json
{
  "cmd": "getDs",
  "logintoken": "<jwt_access_token>"
}
```

The `logintoken` is the same JWT access token received at login.

**Response:**

```json
[
  {
    "id": "1",
    "Local_ID": "0:q3",
    "name": "Living Room Light",
    "type": "bulb",
    "Last_state": "on",
    "Trigs": "a_b-dim_bright"
  },
  {
    "id": "2",
    "Local_ID": "7:b3",
    "name": "Kitchen Switch",
    "type": "switch",
    "Last_state": "off",
    "Trigs": "a_b-off_on"
  }
]
```

Returns **all** user devices (standalone and hub-connected).

---

## 5. Command Relay (App → Device)

Apps send commands via WebSocket after authenticating with `auth|<jwt>`.

**App → Cloud:**
```
c_nd|<dbId>|<appId>|<todo>|<args>
```

**Cloud → Device:**
```
c_nd|<localId>|<appId>|<todo>|<args>
```

**Device → Cloud (response):**
```
r_nd|<localId>|<appId>|<respTodo>|<stateData>
```

**Cloud → App:**
```
r_nd|<localId>|<appId>|<respTodo>|<stateData>
```

If `appId` is `-` (command came from HTTP), cloud broadcasts state to all user app sessions.

---

## 6. App WebSocket Auth

```
auth|<jwt_access_token>
```

**Cloud responds:**
```
auth|<appId>
```

The `appId` (20-char session ID) is used in `c_nd` commands to route device responses back to the correct app session.

---

## 7. WS Command Summary

| Command        | Direction         | Format                                                        |
|----------------|-------------------|---------------------------------------------------------------|
| `addD`         | Device → Cloud    | `addD\|localId\|name\|type\|trigs\|model\|token`              |
| `addH`         | Hub → Cloud       | `addH\|hubId\|name\|type\|model\|username\|pin\|token`        |
| `auth`         | App → Cloud       | `auth\|<jwt>`                                                 |
| `getds`        | App → Cloud       | `getds`                                                       |
| `ping`         | Device/Hub→Cloud  | `ping\|localId\|userId\|-` or `ping\|...\|cmd\|args`          |
| `c_nd`         | App → Cloud       | `c_nd\|dbId\|appId\|todo\|args`                               |
| `r_nd`         | Device → Cloud    | `r_nd\|localId\|appId\|respTodo\|stateData`                   |
| `AdD_resp`     | Cloud → Device    | `AdD_resp\|localId\|suc\|userId`                              |
| `AdHN_resp`    | Cloud → Hub       | `AdHN_resp\|hubId\|suc\|deviceLocalId`                        |
| `ds`           | Cloud → App       | `ds\|id:localId:name:type:state:trigs\|...`                   |
