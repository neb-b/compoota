import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

export type DeviceRow = {
  id: string;
  name: string;
  token_hash: string;
  expo_push_token: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type PairingCodeRow = {
  id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export function openDatabase(databasePath: string): Database.Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pairing_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expo_push_token TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      action TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      original_name TEXT,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pairing_codes_code_hash ON pairing_codes(code_hash);
    CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_log_device_id ON audit_log(device_id);
    CREATE INDEX IF NOT EXISTS idx_media_device_id ON media(device_id);
  `);

  return db;
}
