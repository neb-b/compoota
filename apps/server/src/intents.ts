import type Database from "better-sqlite3";
import { createMaintenanceTask, completeMaintenanceTask } from "./maintenance.js";
import { createReminder } from "./notifications.js";

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextEvening(): Date {
  const next = addDays(new Date(), 1);
  next.setHours(19, 0, 0, 0);
  return next;
}

function parseReminderDate(text: string): Date | null {
  const lower = text.toLowerCase();
  if (lower.includes("tomorrow")) {
    const next = addDays(new Date(), 1);
    next.setHours(lower.includes("morning") ? 9 : lower.includes("night") || lower.includes("evening") ? 19 : 12, 0, 0, 0);
    return next;
  }
  const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays) {
    return addDays(new Date(), Number(inDays[1]));
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function parseDurationDays(text: string, prefix: "in" | "every"): number | null {
  const match = text.toLowerCase().match(new RegExp(`\\b${prefix}\\s+(\\d+)\\s+(day|days|week|weeks|month|months)\\b`));
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("day")) return amount;
  if (unit.startsWith("week")) return amount * 7;
  return amount * 30;
}

function stripReminderPrefix(text: string): string {
  return text
    .replace(/^remind\s+(me|us|everyone)\s+(to\s+)?/i, "")
    .replace(/\b(tomorrow|tonight|this evening|this morning|in \d+ days?)\b/gi, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

function parseCadenceDays(text: string): number | null {
  const lower = text.toLowerCase();
  const everyNumber = parseDurationDays(lower, "every");
  if (everyNumber) return everyNumber;
  const inNumber = parseDurationDays(lower, "in");
  if (inNumber) return inNumber;
  if (lower.includes("weekly")) return 7;
  if (lower.includes("monthly")) return 30;
  if (lower.includes("quarterly")) return 90;
  return null;
}

function cleanupMaintenanceTitle(text: string): string {
  return text
    .replace(/^remind\s+(me|us|everyone)\s+(to\s+)?/i, "")
    .replace(/^create\s+(a\s+)?maintenance\s+(task\s+)?(to\s+)?/i, "")
    .replace(/\bevery\s+\d+\s+(day|days|week|weeks|month|months)\b/gi, "")
    .replace(/\bin\s+\d+\s+(day|days|week|weeks|month|months)\b/gi, "")
    .replace(/\b(weekly|monthly|quarterly)\b/gi, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

export function handleStructuredIntent(
  db: Database.Database,
  householdId: string,
  text: string
): { handled: true; reply: string } | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (/^(remind|create).*(maintenance|furnace|filter|hvac|water filter)/i.test(trimmed) || parseCadenceDays(trimmed)) {
    const cadenceDays = parseCadenceDays(trimmed) ?? 90;
    const title = cleanupMaintenanceTitle(trimmed) || "House maintenance";
    const nextDueAt = addDays(new Date(), cadenceDays).toISOString();
    const task = createMaintenanceTask(db, householdId, { title, cadenceDays, nextDueAt });
    return {
      handled: true,
      reply: `Done. I added "${task.title}" as household maintenance every ${cadenceDays} days. Next reminder is ${new Date(nextDueAt).toLocaleDateString()}.`
    };
  }

  if (/^(we|i)\s+(changed|replaced|completed|did)\b/i.test(trimmed)) {
    const tasks = db
      .prepare("SELECT id, title FROM maintenance_tasks WHERE household_id = ? AND status = 'active' ORDER BY updated_at DESC")
      .all(householdId) as Array<{ id: string; title: string }>;
    const task = tasks.find((candidate) => lower.includes(candidate.title.toLowerCase())) ??
      tasks.find((candidate) => candidate.title.toLowerCase().split(/\s+/).some((word) => word.length > 3 && lower.includes(word)));
    if (task) {
      const updated = completeMaintenanceTask(db, householdId, task.id, {});
      return {
        handled: true,
        reply: updated?.nextDueAt
          ? `Logged. "${updated.title}" is marked done, and the next reminder is ${new Date(updated.nextDueAt).toLocaleDateString()}.`
          : `Logged. "${task.title}" is marked done.`
      };
    }
  }

  if (/^remind\s+(me|us|everyone)\b/i.test(trimmed)) {
    const remindAt = parseReminderDate(trimmed) ?? nextEvening();
    const title = stripReminderPrefix(trimmed) || "Household reminder";
    createReminder(db, householdId, {
      remindAt: remindAt.toISOString(),
      title,
      body: title,
      data: { type: "reminder" }
    });
    return {
      handled: true,
      reply: `Done. I’ll remind the household: "${title}" on ${remindAt.toLocaleString()}.`
    };
  }

  return null;
}
