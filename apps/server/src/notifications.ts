import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type ReminderRow = {
  id: string;
  household_id: string;
  source_type: string;
  source_id: string | null;
  remind_at: string;
  title: string;
  body: string;
  data_json: string;
  status: string;
};

type DevicePushRow = {
  id: string;
  expo_push_token: string;
};

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

function nowIso(): string {
  return new Date().toISOString();
}

function parseDataJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function sendExpoPush(messages: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (messages.length === 0) {
    return [];
  }

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(messages)
  });

  const body = await response.json().catch(() => undefined) as
    | { data?: Array<Record<string, unknown>>; errors?: unknown }
    | undefined;
  if (!response.ok) {
    throw new Error(`Expo push failed with status ${response.status}.`);
  }
  return Array.isArray(body?.data) ? body.data : [];
}

export function listReminders(db: Database.Database, householdId: string) {
  const rows = db
    .prepare(
      "SELECT * FROM reminders WHERE household_id = ? AND status = 'pending' ORDER BY remind_at ASC LIMIT 100"
    )
    .all(householdId) as ReminderRow[];

  return rows.map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    remindAt: row.remind_at,
    title: row.title,
    body: row.body,
    data: parseDataJson(row.data_json),
    status: row.status
  }));
}

export function createReminder(
  db: Database.Database,
  householdId: string,
  input: {
    sourceType?: string;
    sourceId?: string | null;
    remindAt: string;
    title: string;
    body?: string | null;
    data?: Record<string, unknown>;
  }
) {
  const remindAt = new Date(Date.parse(input.remindAt));
  if (!Number.isFinite(remindAt.getTime())) {
    throw new Error("Enter a valid reminder time.");
  }
  if (remindAt.getTime() <= Date.now()) {
    throw new Error("Reminder time must be in the future.");
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("Enter a reminder title.");
  }

  const now = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO reminders (
      id, household_id, source_type, source_id, remind_at, title, body, data_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id,
    householdId,
    input.sourceType?.trim() || "ad_hoc",
    input.sourceId ?? null,
    remindAt.toISOString(),
    title,
    input.body?.trim() || title,
    JSON.stringify(input.data ?? { type: "reminder", id }),
    now,
    now
  );

  return listReminders(db, householdId).find((reminder) => reminder.id === id);
}

async function processDueReminders(db: Database.Database): Promise<void> {
  const reminders = db
    .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ? ORDER BY remind_at ASC LIMIT 25")
    .all(nowIso()) as ReminderRow[];

  for (const reminder of reminders) {
    const devices = db
      .prepare(
        "SELECT id, expo_push_token FROM devices WHERE household_id = ? AND revoked_at IS NULL AND expo_push_token IS NOT NULL AND expo_push_token != ''"
      )
      .all(reminder.household_id) as DevicePushRow[];
    const attemptedAt = nowIso();

    if (devices.length === 0) {
      db.prepare("UPDATE reminders SET status = 'sent', updated_at = ? WHERE id = ?").run(attemptedAt, reminder.id);
      continue;
    }

    const messages = devices.map((device) => ({
      to: device.expo_push_token,
      sound: "default",
      title: reminder.title,
      body: reminder.body,
      data: parseDataJson(reminder.data_json)
    }));

    try {
      const tickets = await sendExpoPush(messages);
      devices.forEach((device, index) => {
        const ticket = tickets[index] ?? {};
        const status = typeof ticket.status === "string" ? ticket.status : "sent";
        const ticketId = typeof ticket.id === "string" ? ticket.id : null;
        const message = typeof ticket.message === "string" ? ticket.message : null;
        db.prepare(
          `INSERT INTO notification_deliveries (
            id, reminder_id, device_id, expo_push_token, status, expo_ticket_id, error_message, attempted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(randomUUID(), reminder.id, device.id, device.expo_push_token, status, ticketId, message, attemptedAt);
      });
      db.prepare("UPDATE reminders SET status = 'sent', updated_at = ? WHERE id = ?").run(nowIso(), reminder.id);
    } catch (error) {
      for (const device of devices) {
        db.prepare(
          `INSERT INTO notification_deliveries (
            id, reminder_id, device_id, expo_push_token, status, expo_ticket_id, error_message, attempted_at
          ) VALUES (?, ?, ?, ?, 'failed', NULL, ?, ?)`
        ).run(
          randomUUID(),
          reminder.id,
          device.id,
          device.expo_push_token,
          error instanceof Error ? error.message : "Expo push failed",
          attemptedAt
        );
      }
    }
  }
}

export function startNotificationScheduler(db: Database.Database): void {
  if (schedulerTimer) {
    return;
  }

  schedulerTimer = setInterval(() => {
    if (schedulerRunning) {
      return;
    }
    schedulerRunning = true;
    processDueReminders(db)
      .catch(() => undefined)
      .finally(() => {
        schedulerRunning = false;
      });
  }, 60_000);

  processDueReminders(db).catch(() => undefined);
}

export function stopNotificationScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
