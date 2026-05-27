import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

export type DeviceRow = {
  id: string;
  household_id: string;
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
  household_id: string;
  dedupe_key: string;
  title: string;
  summary: string;
  category: string;
  starts_at: string;
  ends_at: string | null;
  is_all_day: number;
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

export type HouseholdRow = {
  id: string;
  name: string;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function getDefaultHouseholdId(db: Database.Database): string {
  const existing = db.prepare("SELECT id FROM households ORDER BY created_at ASC LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (existing) {
    return existing.id;
  }

  const id = "default";
  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(id, "Home", nowIso());
  return id;
}

export function openDatabase(databasePath: string): Database.Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      household_id TEXT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expo_push_token TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
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
    CREATE INDEX IF NOT EXISTS idx_devices_household_id ON devices(household_id);
    CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_log_device_id ON audit_log(device_id);
    CREATE INDEX IF NOT EXISTS idx_media_device_id ON media(device_id);

    CREATE TABLE IF NOT EXISTS event_preferences (
      household_id TEXT PRIMARY KEY,
      home_location TEXT NOT NULL,
      radius_miles INTEGER NOT NULL,
      liked_signals_json TEXT NOT NULL,
      disliked_signals_json TEXT NOT NULL,
      hidden_categories_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_refresh_runs (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
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
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_feedback (
      household_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (household_id, event_id),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS maintenance_tasks (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cadence_days INTEGER,
      next_due_at TEXT,
      last_completed_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS maintenance_completions (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES maintenance_tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      remind_at TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      expo_push_token TEXT NOT NULL,
      status TEXT NOT NULL,
      expo_ticket_id TEXT,
      error_message TEXT,
      attempted_at TEXT NOT NULL,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_household_dedupe ON events(household_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_events_household_starts ON events(household_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_event_feedback_household_value ON event_feedback(household_id, value);
    CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_household_status ON maintenance_tasks(household_id, status, next_due_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(status, remind_at);
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_reminder ON notification_deliveries(reminder_id);
  `);

  const defaultHouseholdId = getDefaultHouseholdId(db);

  const deviceColumns = new Set(
    db.prepare("PRAGMA table_info(devices)").all().map((column) => (column as { name: string }).name)
  );
  if (!deviceColumns.has("household_id")) {
    db.prepare("ALTER TABLE devices ADD COLUMN household_id TEXT").run();
  }
  db.prepare("UPDATE devices SET household_id = ? WHERE household_id IS NULL").run(defaultHouseholdId);

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

  const eventColumns = new Set(
    db.prepare("PRAGMA table_info(events)").all().map((column) => (column as { name: string }).name)
  );
  if (!eventColumns.has("is_all_day")) {
    db.prepare("ALTER TABLE events ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0").run();
  }

  return db;
}
