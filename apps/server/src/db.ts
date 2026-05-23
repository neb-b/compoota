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

export type FeedItemRow = {
  id: string;
  device_id: string;
  dedupe_key: string;
  title: string;
  summary: string;
  category: string;
  starts_at: string;
  ends_at: string | null;
  venue: string;
  area: string;
  source_url: string;
  image_url: string | null;
  price_text: string | null;
  reason: string;
  score: number;
  distance_miles: number | null;
  created_at: string;
  updated_at: string;
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
      r2_key TEXT,
      r2_bucket TEXT,
      remote_url TEXT,
      uploaded_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pairing_codes_code_hash ON pairing_codes(code_hash);
    CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_log_device_id ON audit_log(device_id);
    CREATE INDEX IF NOT EXISTS idx_media_device_id ON media(device_id);

    CREATE TABLE IF NOT EXISTS feed_preferences (
      device_id TEXT PRIMARY KEY,
      home_location TEXT NOT NULL,
      radius_miles INTEGER NOT NULL,
      liked_signals_json TEXT NOT NULL,
      disliked_signals_json TEXT NOT NULL,
      hidden_categories_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feed_refresh_runs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feed_items (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      venue TEXT NOT NULL,
      area TEXT NOT NULL,
      source_url TEXT NOT NULL,
      image_url TEXT,
      price_text TEXT,
      reason TEXT NOT NULL,
      score REAL NOT NULL,
      distance_miles REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feed_feedback (
      device_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (device_id, item_id),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES feed_items(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_items_device_dedupe ON feed_items(device_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_feed_items_device_starts ON feed_items(device_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_feed_feedback_device_value ON feed_feedback(device_id, value);
  `);

  const mediaColumns = new Set(
    db.prepare("PRAGMA table_info(media)").all().map((column) => (column as { name: string }).name)
  );
  for (const [column, definition] of [
    ["r2_key", "TEXT"],
    ["r2_bucket", "TEXT"],
    ["remote_url", "TEXT"],
    ["uploaded_at", "TEXT"]
  ] as const) {
    if (!mediaColumns.has(column)) {
      db.prepare(`ALTER TABLE media ADD COLUMN ${column} ${definition}`).run();
    }
  }

  return db;
}
