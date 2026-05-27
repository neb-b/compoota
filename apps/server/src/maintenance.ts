import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type MaintenanceTaskInput = {
  title: string;
  cadenceDays?: number | null;
  nextDueAt?: string | null;
  notes?: string | null;
};

type MaintenanceTaskRow = {
  id: string;
  household_id: string;
  title: string;
  cadence_days: number | null;
  next_due_at: string | null;
  last_completed_at: string | null;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type MaintenanceCompletionRow = {
  id: string;
  task_id: string;
  completed_at: string;
  notes: string;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseOptionalFutureDate(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Enter a valid due date.");
  }
  return new Date(timestamp).toISOString();
}

function taskResponse(row: MaintenanceTaskRow, completions: MaintenanceCompletionRow[] = []) {
  return {
    id: row.id,
    title: row.title,
    cadenceDays: row.cadence_days,
    nextDueAt: row.next_due_at,
    lastCompletedAt: row.last_completed_at,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completions: completions.map((completion) => ({
      id: completion.id,
      taskId: completion.task_id,
      completedAt: completion.completed_at,
      notes: completion.notes,
      createdAt: completion.created_at
    }))
  };
}

function scheduleMaintenanceReminder(
  db: Database.Database,
  householdId: string,
  taskId: string,
  title: string,
  nextDueAt: string | null
): void {
  if (!nextDueAt || Date.parse(nextDueAt) <= Date.now()) {
    return;
  }

  const now = nowIso();
  db.prepare(
    `INSERT INTO reminders (
      id, household_id, source_type, source_id, remind_at, title, body, data_json, status, created_at, updated_at
    ) VALUES (?, ?, 'maintenance', ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    randomUUID(),
    householdId,
    taskId,
    nextDueAt,
    title,
    `Maintenance due: ${title}`,
    JSON.stringify({ type: "maintenance", id: taskId }),
    now,
    now
  );
}

export function listMaintenanceTasks(db: Database.Database, householdId: string) {
  const tasks = db
    .prepare("SELECT * FROM maintenance_tasks WHERE household_id = ? AND status = 'active' ORDER BY COALESCE(next_due_at, '9999-12-31T23:59:59.999Z') ASC, title ASC")
    .all(householdId) as MaintenanceTaskRow[];
  const completions = db
    .prepare(
      `SELECT mc.* FROM maintenance_completions mc
       JOIN maintenance_tasks mt ON mt.id = mc.task_id
       WHERE mt.household_id = ?
       ORDER BY mc.completed_at DESC
       LIMIT 50`
    )
    .all(householdId) as MaintenanceCompletionRow[];

  return tasks.map((task) => taskResponse(task, completions.filter((completion) => completion.task_id === task.id)));
}

export function createMaintenanceTask(
  db: Database.Database,
  householdId: string,
  input: MaintenanceTaskInput
) {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Enter a maintenance task title.");
  }
  const cadenceDays = input.cadenceDays && Number.isFinite(input.cadenceDays)
    ? Math.max(1, Math.round(input.cadenceDays))
    : null;
  const nextDueAt = parseOptionalFutureDate(input.nextDueAt ?? null);
  const now = nowIso();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO maintenance_tasks (
      id, household_id, title, cadence_days, next_due_at, last_completed_at, notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?)`
  ).run(id, householdId, title, cadenceDays, nextDueAt, input.notes?.trim() ?? "", now, now);

  if (nextDueAt) {
    scheduleMaintenanceReminder(db, householdId, id, title, nextDueAt);
  }

  const row = db.prepare("SELECT * FROM maintenance_tasks WHERE id = ?").get(id) as MaintenanceTaskRow;
  return taskResponse(row);
}

export function completeMaintenanceTask(
  db: Database.Database,
  householdId: string,
  taskId: string,
  input: { completedAt?: string | null; notes?: string | null }
) {
  const task = db
    .prepare("SELECT * FROM maintenance_tasks WHERE id = ? AND household_id = ? AND status = 'active'")
    .get(taskId, householdId) as MaintenanceTaskRow | undefined;
  if (!task) {
    return null;
  }

  const completedAt = input.completedAt ? parseOptionalFutureDate(input.completedAt) ?? nowIso() : nowIso();
  const nextDueAt = task.cadence_days
    ? new Date(Date.parse(completedAt) + task.cadence_days * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const now = nowIso();

  db.prepare(
    "INSERT INTO maintenance_completions (id, household_id, task_id, completed_at, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(randomUUID(), householdId, taskId, completedAt, input.notes?.trim() ?? "", now);
  db.prepare(
    "UPDATE reminders SET status = 'canceled', updated_at = ? WHERE household_id = ? AND source_type = 'maintenance' AND source_id = ? AND status = 'pending'"
  ).run(now, householdId, taskId);
  db.prepare(
    "UPDATE maintenance_tasks SET last_completed_at = ?, next_due_at = ?, updated_at = ? WHERE id = ?"
  ).run(completedAt, nextDueAt, now, taskId);

  if (nextDueAt) {
    scheduleMaintenanceReminder(db, householdId, taskId, task.title, nextDueAt);
  }

  const row = db.prepare("SELECT * FROM maintenance_tasks WHERE id = ?").get(taskId) as MaintenanceTaskRow;
  const completions = db
    .prepare("SELECT * FROM maintenance_completions WHERE task_id = ? ORDER BY completed_at DESC")
    .all(taskId) as MaintenanceCompletionRow[];
  return taskResponse(row, completions);
}

export function archiveMaintenanceTask(db: Database.Database, householdId: string, taskId: string): boolean {
  const now = nowIso();
  const result = db
    .prepare("UPDATE maintenance_tasks SET status = 'archived', updated_at = ? WHERE id = ? AND household_id = ?")
    .run(now, taskId, householdId);
  if (result.changes > 0) {
    db.prepare(
      "UPDATE reminders SET status = 'canceled', updated_at = ? WHERE household_id = ? AND source_type = 'maintenance' AND source_id = ? AND status = 'pending'"
    ).run(now, householdId, taskId);
  }
  return result.changes > 0;
}
