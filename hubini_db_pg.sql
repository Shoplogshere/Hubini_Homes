-- Hubini IoT Platform Database Schema (PostgreSQL)
-- Use this file with Render PostgreSQL, NOT the MySQL hubini_db.sql

-- Auto-update trigger function (replaces MySQL's ON UPDATE CURRENT_TIMESTAMP)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  verification_token VARCHAR(255) DEFAULT NULL,
  verification_token_expires TIMESTAMP DEFAULT NULL,
  reset_password_token VARCHAR(255) DEFAULT NULL,
  reset_password_expires TIMESTAMP DEFAULT NULL,
  first_name VARCHAR(100) DEFAULT NULL,
  last_name VARCHAR(100) DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  gender VARCHAR(20) DEFAULT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'host',
  organization_name VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  profile_picture VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_password_token);

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Table: refresh_tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP DEFAULT NULL,
  replaced_by VARCHAR(500) DEFAULT NULL,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

-- Table: hubs
CREATE TABLE IF NOT EXISTS hubs (
  id SERIAL PRIMARY KEY,
  cloud_id VARCHAR(100) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  hub_token VARCHAR(255) NOT NULL,
  hub_name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  model VARCHAR(50) NOT NULL,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hubs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hubs_user_id ON hubs(user_id);
CREATE INDEX IF NOT EXISTS idx_hubs_hub_token ON hubs(hub_token);

CREATE TRIGGER update_hubs_updated_at
  BEFORE UPDATE ON hubs
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Table: devices
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  cloud_id VARCHAR(100) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  hub_id INTEGER DEFAULT NULL,
  local_id VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  model VARCHAR(50) NOT NULL,
  trigs VARCHAR(255) DEFAULT NULL,
  last_state VARCHAR(100) DEFAULT NULL,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_devices_hub FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_hub_id ON devices(hub_id);
CREATE INDEX IF NOT EXISTS idx_devices_local_id ON devices(local_id);
CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(type);

CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Table: device_commands
CREATE TABLE IF NOT EXISTS device_commands (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  command VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'failed')),
  response TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at TIMESTAMP DEFAULT NULL,
  CONSTRAINT fk_commands_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_commands_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_commands_device_id ON device_commands(device_id);
CREATE INDEX IF NOT EXISTS idx_device_commands_user_id ON device_commands(user_id);

-- Table: activity_logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER DEFAULT NULL,
  device_id INTEGER DEFAULT NULL,
  hub_id INTEGER DEFAULT NULL,
  action VARCHAR(100) NOT NULL,
  details TEXT DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
