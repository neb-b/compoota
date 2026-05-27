import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { Config } from "./config.js";
import type { DeviceRow, FeedItemRow } from "./db.js";
import { runHermesCommand } from "./hermes.js";

type FeedFeedbackValue = "like" | "dislike" | "hide" | "save";
export type FeedFeedbackInput = FeedFeedbackValue | "clear";

type FeedPreferencesRow = {
  device_id: string;
  home_location: string;
  radius_miles: number;
  liked_signals_json: string;
  disliked_signals_json: string;
  hidden_categories_json: string;
  created_at: string;
  updated_at: string;
};

type FeedRefreshRunRow = {
  id: string;
  device_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  item_count: number;
  error_message: string | null;
};

export type FeedPreferencesResponse = {
  homeLocation: string;
  radiusMiles: number;
  likedSignals: string[];
  dislikedSignals: string[];
  hiddenCategories: string[];
};

export type FeedItemResponse = {
  id: string;
  title: string;
  summary: string;
  category: string;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  area: string;
  sourceUrl: string;
  imageUrl: string | null;
  priceText: string | null;
  reason: string;
  score: number;
  distanceMiles: number | null;
  feedback: FeedFeedbackValue | null;
  createdAt: string;
  updatedAt: string;
};

export type FeedRefreshResponse = {
  run: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    itemCount: number;
    errorMessage: string | null;
  };
  items: FeedItemResponse[];
};

export type FeedRefreshAllResult = {
  deviceId: string;
  deviceName: string;
  result: FeedRefreshResponse;
};

export type FeedRefreshBusyResult = {
  busy: true;
  runningRuns: FeedRefreshResponse["run"][];
};

export type ManualFeedItemInput = {
  text: string;
  startsAt: string;
  endsAt?: string | null;
};

const hermesFeedItemSchema = z.object({
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(80),
  startsAt: z.string().trim().min(1),
  endsAt: z.string().trim().min(1).nullable().optional(),
  venue: z.string().trim().min(1).max(160),
  area: z.string().trim().min(1).max(160),
  sourceUrl: z.string().trim().url(),
  imageUrl: z.string().trim().url().nullable().optional(),
  priceText: z.string().trim().max(80).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
  score: z.number().min(0).max(100),
  distanceMiles: z.number().min(0).max(200).nullable().optional()
});

const hermesFeedSchema = z.object({
  items: z.array(hermesFeedItemSchema)
});

type HermesFeedItem = z.infer<typeof hermesFeedItemSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseEventDate(value: string, fieldName: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Hermes returned an invalid ${fieldName}: ${value}`);
  }
  return new Date(timestamp).toISOString();
}

function parseManualEventDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Enter a valid future date and time.");
  }
  if (timestamp <= Date.now()) {
    throw new Error("Personal events must be in the future.");
  }
  return new Date(timestamp).toISOString();
}

function parseOptionalManualEventDate(value: string | null | undefined, startsAt: string): string | null {
  if (!value?.trim()) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Enter a valid end date and time.");
  }
  if (timestamp <= Date.parse(startsAt)) {
    throw new Error("Event end time must be after the start time.");
  }
  return new Date(timestamp).toISOString();
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function stringifyStringArray(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
}

function preferencesResponse(row: FeedPreferencesRow): FeedPreferencesResponse {
  return {
    homeLocation: row.home_location,
    radiusMiles: row.radius_miles,
    likedSignals: parseJsonArray(row.liked_signals_json),
    dislikedSignals: parseJsonArray(row.disliked_signals_json),
    hiddenCategories: parseJsonArray(row.hidden_categories_json)
  };
}

export function getOrCreateFeedPreferences(
  db: Database.Database,
  config: Config,
  deviceId: string
): FeedPreferencesResponse {
  const existing = db
    .prepare("SELECT * FROM feed_preferences WHERE device_id = ?")
    .get(deviceId) as FeedPreferencesRow | undefined;
  if (existing) {
    return preferencesResponse(existing);
  }

  const createdAt = nowIso();
  db.prepare(
    "INSERT INTO feed_preferences (device_id, home_location, radius_miles, liked_signals_json, disliked_signals_json, hidden_categories_json, created_at, updated_at) VALUES (?, ?, ?, '[]', '[]', '[]', ?, ?)"
  ).run(deviceId, config.feedDefaultLocation, config.feedDefaultRadiusMiles, createdAt, createdAt);

  const row = db
    .prepare("SELECT * FROM feed_preferences WHERE device_id = ?")
    .get(deviceId) as FeedPreferencesRow;
  return preferencesResponse(row);
}

export function updateFeedPreferences(
  db: Database.Database,
  config: Config,
  deviceId: string,
  input: Partial<FeedPreferencesResponse>
): FeedPreferencesResponse {
  const current = getOrCreateFeedPreferences(db, config, deviceId);
  const next = {
    homeLocation: input.homeLocation?.trim() || current.homeLocation,
    radiusMiles: Number.isFinite(input.radiusMiles) && input.radiusMiles ? input.radiusMiles : current.radiusMiles,
    likedSignals: input.likedSignals ?? current.likedSignals,
    dislikedSignals: input.dislikedSignals ?? current.dislikedSignals,
    hiddenCategories: input.hiddenCategories ?? current.hiddenCategories
  };
  const updatedAt = nowIso();

  db.prepare(
    "UPDATE feed_preferences SET home_location = ?, radius_miles = ?, liked_signals_json = ?, disliked_signals_json = ?, hidden_categories_json = ?, updated_at = ? WHERE device_id = ?"
  ).run(
    next.homeLocation,
    next.radiusMiles,
    stringifyStringArray(next.likedSignals),
    stringifyStringArray(next.dislikedSignals),
    stringifyStringArray(next.hiddenCategories),
    updatedAt,
    deviceId
  );

  return getOrCreateFeedPreferences(db, config, deviceId);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function dedupeKey(item: HermesFeedItem): string {
  const normalizedUrl = normalizeUrl(item.sourceUrl);
  const titleDate = `${item.title.trim().toLowerCase()}:${item.startsAt.slice(0, 10)}`;
  if (normalizedUrl) {
    return `url:${normalizedUrl}:${titleDate}`;
  }
  return `fallback:${titleDate}`;
}

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Hermes did not return JSON.");
  }
}

function mockFeedItems(): HermesFeedItem[] {
  const base = new Date();
  base.setHours(10, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  return [
    {
      title: "Saline Farmers Market",
      summary: "Local produce, baked goods, flowers, and seasonal pantry finds downtown.",
      category: "market",
      startsAt: new Date(base.getTime() + day).toISOString(),
      endsAt: new Date(base.getTime() + day + 3 * 60 * 60 * 1000).toISOString(),
      venue: "Downtown Saline",
      area: "Saline",
      sourceUrl: "https://www.cityofsaline.org/",
      imageUrl: null,
      priceText: "Free",
      reason: "Easy nearby morning option with fresh local vendors.",
      score: 88,
      distanceMiles: 1
    },
    {
      title: "Live music night in Ann Arbor",
      summary: "A low-key evening show close enough for a spontaneous weeknight plan.",
      category: "music",
      startsAt: new Date(base.getTime() + 2 * day + 9 * 60 * 60 * 1000).toISOString(),
      endsAt: null,
      venue: "Downtown Ann Arbor",
      area: "Ann Arbor",
      sourceUrl: "https://www.annarbor.org/events/",
      imageUrl: null,
      priceText: "$",
      reason: "Farther than Saline but worthwhile if you want an evening out.",
      score: 78,
      distanceMiles: 11
    },
    {
      title: "Weekend trail walk at Curtiss Park",
      summary: "A simple outdoor reset with open green space and walking paths.",
      category: "outdoors",
      startsAt: new Date(base.getTime() + 3 * day).toISOString(),
      endsAt: null,
      venue: "Curtiss Park",
      area: "Saline",
      sourceUrl: "https://www.cityofsaline.org/",
      imageUrl: null,
      priceText: "Free",
      reason: "Close, low-friction, and good for a daily check-in feed.",
      score: 72,
      distanceMiles: 2
    }
  ];
}

export function seedSampleFeedForAllDevices(
  db: Database.Database,
  config: Config
): FeedRefreshAllResult[] {
  const devices = db.prepare("SELECT * FROM devices WHERE revoked_at IS NULL").all() as DeviceRow[];
  return devices.map((device) => {
    const runId = randomUUID();
    const startedAt = nowIso();
    const items = mockFeedItems();
    db.prepare(
      "INSERT INTO feed_refresh_runs (id, device_id, status, started_at, finished_at, item_count) VALUES (?, ?, 'done', ?, ?, ?)"
    ).run(runId, device.id, startedAt, startedAt, persistFeedItems(db, config, device.id, items));
    const run = db.prepare("SELECT * FROM feed_refresh_runs WHERE id = ?").get(runId) as FeedRefreshRunRow;
    return {
      deviceId: device.id,
      deviceName: device.name,
      result: {
        run: runResponse(run),
        items: listFeedItems(db, device.id)
      }
    };
  });
}

export function clearRunningFeedRuns(db: Database.Database): number {
  const result = db
    .prepare("UPDATE feed_refresh_runs SET status = 'error', finished_at = ?, error_message = ? WHERE status = 'running'")
    .run(nowIso(), "Manually cleared stale running feed refresh.");
  return result.changes;
}

function feedbackSummary(db: Database.Database, deviceId: string): string {
  const rows = db
    .prepare(
      "SELECT fi.title, fi.category, ff.value FROM feed_feedback ff JOIN feed_items fi ON fi.id = ff.item_id WHERE ff.device_id = ? ORDER BY ff.updated_at DESC LIMIT 20"
    )
    .all(deviceId) as Array<{ title: string; category: string; value: string }>;
  if (rows.length === 0) {
    return "No prior feedback yet.";
  }
  return rows.map((row) => `- ${row.value}: ${row.title} (${row.category})`).join("\n");
}

function buildFeedPrompt(preferences: FeedPreferencesResponse, config: Config, db: Database.Database, deviceId: string): string {
  const maxItems = Math.min(config.feedMaxItems, 20);
  const today = new Date().toISOString();
  const horizon = new Date(Date.now() + config.feedLookaheadDays * 24 * 60 * 60 * 1000).toISOString();
  return [
    "Research nearby things to do and return strict JSON only. Do not include markdown or commentary.",
    `Current date/time: ${today}. Use this when deciding what is in the future.`,
    `Research window: from now through ${horizon}, about the next ${config.feedLookaheadDays} days.`,
    `Location: ${preferences.homeLocation}. Radius: ${preferences.radiusMiles} miles.`,
    "Default location is Saline, MI. Prioritize Saline and nearby Ann Arbor/Ypsilanti options.",
    "Visible ordering will be chronological, not algorithmic. Use score only for acquisition quality.",
    "Find newly announced items anywhere inside the research window. Do not only append later events; items discovered between existing upcoming events should be returned too so the app can slot them chronologically.",
    "Distance rule: farther items need to be more special or worthwhile to score high enough to include.",
    `Return 8 to ${maxItems} future items with score 0-100 when enough good items exist. Stop as soon as you have enough good items.`,
    "Prefer specific upcoming events with dates from official venue, city, chamber, library, university, parks, or event calendar pages.",
    "Do not attempt exhaustive research. This is a quick daily digest acquisition job.",
    "Include events, music, restaurants, markets, classes, outdoor activities, pop-ups, community happenings, and worthwhile local options.",
    "JSON shape: {\"items\":[{\"title\":\"...\",\"summary\":\"...\",\"category\":\"...\",\"startsAt\":\"2026-05-24T19:00:00-04:00\",\"endsAt\":null,\"venue\":\"...\",\"area\":\"...\",\"sourceUrl\":\"https://...\",\"imageUrl\":null,\"priceText\":null,\"reason\":\"...\",\"score\":80,\"distanceMiles\":5}]}",
    "Use full ISO-8601 datetimes for startsAt and endsAt. Include a timezone offset, such as -04:00 for Michigan daylight time. If no exact time is published, use 12:00:00 local time and explain that uncertainty in summary.",
    "Prior feedback:",
    feedbackSummary(db, deviceId)
  ].join("\n");
}

function parseHermesFeed(reply: string, config: Config): HermesFeedItem[] {
  const parsed = hermesFeedSchema.parse(extractJsonObject(reply));
  const now = Date.now();
  const horizon = now + config.feedLookaheadDays * 24 * 60 * 60 * 1000;
  return parsed.items
    .map((item) => ({
      ...item,
      startsAt: parseEventDate(item.startsAt, "startsAt"),
      endsAt: item.endsAt ? parseEventDate(item.endsAt, "endsAt") : null
    }))
    .filter((item) => {
      const startsAt = Date.parse(item.startsAt);
      return startsAt >= now && startsAt <= horizon;
    });
}

function feedItemResponse(row: FeedItemRow, feedback: FeedFeedbackValue | null): FeedItemResponse {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    venue: row.venue,
    area: row.area,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    priceText: row.price_text,
    reason: row.reason,
    score: row.score,
    distanceMiles: row.distance_miles,
    feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listFeedItems(db: Database.Database, deviceId: string): FeedItemResponse[] {
  const rows = db
    .prepare(
      `SELECT fi.*, ff.value AS feedback
       FROM feed_items fi
       LEFT JOIN feed_feedback ff ON ff.device_id = fi.device_id AND ff.item_id = fi.id
       WHERE fi.device_id = ?
         AND fi.starts_at >= ?
         AND COALESCE(ff.value, '') != 'hide'
       ORDER BY fi.starts_at ASC, fi.created_at DESC`
    )
    .all(deviceId, nowIso()) as Array<FeedItemRow & { feedback: FeedFeedbackValue | null }>;

  return rows.map((row) => feedItemResponse(row, row.feedback ?? null));
}

export function createManualFeedItem(
  db: Database.Database,
  deviceId: string,
  input: ManualFeedItemInput
): FeedItemResponse {
  const id = randomUUID();
  const now = nowIso();
  const startsAt = parseManualEventDate(input.startsAt);
  const endsAt = parseOptionalManualEventDate(input.endsAt, startsAt);
  const text = input.text.trim();

  if (!text) {
    throw new Error("Enter event text.");
  }

  db.prepare(
    `INSERT INTO feed_items (
      id, device_id, dedupe_key, title, summary, category, starts_at, ends_at, venue, area,
      source_url, image_url, price_text, reason, score, distance_miles, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', 'personal', ?, ?, '', 'Personal', ?, NULL, NULL, 'Personal event', 100, NULL, ?, ?)`
  ).run(id, deviceId, `manual:${id}`, text, startsAt, endsAt, `compoota://personal-event/${id}`, now, now);

  const row = db.prepare("SELECT * FROM feed_items WHERE id = ?").get(id) as FeedItemRow;
  return feedItemResponse(row, null);
}

function persistFeedItems(
  db: Database.Database,
  config: Config,
  deviceId: string,
  items: HermesFeedItem[]
): number {
  const accepted = items
    .filter((item) => item.score >= config.feedInclusionThreshold)
    .slice(0, config.feedMaxItems);
  const now = nowIso();

  const upsert = db.prepare(
    `INSERT INTO feed_items (
      id, device_id, dedupe_key, title, summary, category, starts_at, ends_at, venue, area,
      source_url, image_url, price_text, reason, score, distance_miles, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, dedupe_key) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      category = excluded.category,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      venue = excluded.venue,
      area = excluded.area,
      source_url = excluded.source_url,
      image_url = excluded.image_url,
      price_text = excluded.price_text,
      reason = excluded.reason,
      score = excluded.score,
      distance_miles = excluded.distance_miles,
      updated_at = excluded.updated_at`
  );

  const transaction = db.transaction(() => {
    for (const item of accepted) {
      upsert.run(
        randomUUID(),
        deviceId,
        dedupeKey(item),
        item.title,
        item.summary,
        item.category,
        item.startsAt,
        item.endsAt ?? null,
        item.venue,
        item.area,
        item.sourceUrl,
        item.imageUrl ?? null,
        item.priceText ?? null,
        item.reason,
        item.score,
        item.distanceMiles ?? null,
        now,
        now
      );
    }
  });
  transaction();

  return accepted.length;
}

function runResponse(row: FeedRefreshRunRow): FeedRefreshResponse["run"] {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemCount: row.item_count,
    errorMessage: row.error_message
  };
}

export async function refreshFeedForDevice(
  db: Database.Database,
  config: Config,
  deviceId: string
): Promise<FeedRefreshResponse> {
  failStaleFeedRuns(db, config);
  if (schedulerRunning) {
    const run = latestFeedRun(db, deviceId) ?? runningFeedRuns(db)[0] ?? {
      id: "busy",
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      itemCount: 0,
      errorMessage: "A feed refresh is already running."
    };
    return {
      run,
      items: listFeedItems(db, deviceId)
    };
  }

  schedulerRunning = true;
  try {
    return await refreshFeedForDeviceUnlocked(db, config, deviceId);
  } finally {
    schedulerRunning = false;
  }
}

export function setFeedFeedback(
  db: Database.Database,
  deviceId: string,
  itemId: string,
  value: FeedFeedbackInput
): FeedItemResponse | null {
  const item = db
    .prepare("SELECT * FROM feed_items WHERE id = ? AND device_id = ?")
    .get(itemId, deviceId) as FeedItemRow | undefined;
  if (!item) {
    return null;
  }

  if (value === "clear") {
    db.prepare("DELETE FROM feed_feedback WHERE device_id = ? AND item_id = ?").run(deviceId, itemId);
    return feedItemResponse(item, null);
  }

  const now = nowIso();
  db.prepare(
    `INSERT INTO feed_feedback (device_id, item_id, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(device_id, item_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(deviceId, itemId, value, now, now);

  return feedItemResponse(item, value);
}

export function latestFeedRun(db: Database.Database, deviceId: string): FeedRefreshResponse["run"] | null {
  const run = db
    .prepare("SELECT * FROM feed_refresh_runs WHERE device_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(deviceId) as FeedRefreshRunRow | undefined;
  return run ? runResponse(run) : null;
}

let schedulerRunning = false;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

export function runningFeedRuns(db: Database.Database): FeedRefreshResponse["run"][] {
  const rows = db
    .prepare("SELECT * FROM feed_refresh_runs WHERE status = 'running' ORDER BY started_at DESC")
    .all() as FeedRefreshRunRow[];
  return rows.map(runResponse);
}

export function failStaleFeedRuns(db: Database.Database, config: Config): number {
  const staleBefore = new Date(Date.now() - (config.hermesTimeoutSeconds + 30) * 1000).toISOString();
  const result = db
    .prepare(
      "UPDATE feed_refresh_runs SET status = 'error', finished_at = ?, error_message = ? WHERE status = 'running' AND started_at < ?"
    )
    .run(nowIso(), `Feed refresh exceeded ${config.hermesTimeoutSeconds}s and was marked stale.`, staleBefore);
  return result.changes;
}

async function refreshFeedForDeviceUnlocked(
  db: Database.Database,
  config: Config,
  deviceId: string
): Promise<FeedRefreshResponse> {
  const runId = randomUUID();
  const startedAt = nowIso();
  db.prepare(
    "INSERT INTO feed_refresh_runs (id, device_id, status, started_at, item_count) VALUES (?, ?, 'running', ?, 0)"
  ).run(runId, deviceId, startedAt);

  try {
    const preferences = getOrCreateFeedPreferences(db, config, deviceId);
    const items =
      config.hermesCommandMode === "mock"
        ? mockFeedItems()
        : parseHermesFeed(
            (await runHermesCommand(buildFeedPrompt(preferences, config, db, deviceId), config, { runId })).reply,
            config
          );
    const itemCount = persistFeedItems(db, config, deviceId, items);
    const finishedAt = nowIso();
    db.prepare(
      "UPDATE feed_refresh_runs SET status = 'done', finished_at = ?, item_count = ? WHERE id = ?"
    ).run(finishedAt, itemCount, runId);
  } catch (error) {
    const finishedAt = nowIso();
    db.prepare(
      "UPDATE feed_refresh_runs SET status = 'error', finished_at = ?, error_message = ? WHERE id = ?"
    ).run(finishedAt, error instanceof Error ? error.message : "Feed refresh failed", runId);
  }

  const run = db.prepare("SELECT * FROM feed_refresh_runs WHERE id = ?").get(runId) as FeedRefreshRunRow;
  return {
    run: runResponse(run),
    items: listFeedItems(db, deviceId)
  };
}

export async function refreshFeedForAllDevices(
  db: Database.Database,
  config: Config
): Promise<FeedRefreshAllResult[] | FeedRefreshBusyResult> {
  failStaleFeedRuns(db, config);
  if (schedulerRunning) {
    return {
      busy: true,
      runningRuns: runningFeedRuns(db)
    };
  }
  schedulerRunning = true;
  try {
    const devices = db.prepare("SELECT * FROM devices WHERE revoked_at IS NULL").all() as DeviceRow[];
    const results: FeedRefreshAllResult[] = [];
    for (const device of devices) {
      results.push({
        deviceId: device.id,
        deviceName: device.name,
        result: await refreshFeedForDeviceUnlocked(db, config, device.id)
      });
    }
    return results;
  } finally {
    schedulerRunning = false;
  }
}

function msUntilNextRefresh(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startFeedScheduler(db: Database.Database, config: Config): void {
  if (!config.feedRefreshEnabled) {
    return;
  }

  refreshFeedForAllDevices(db, config).catch(() => undefined);

  const scheduleNext = () => {
    schedulerTimer = setTimeout(() => {
      refreshFeedForAllDevices(db, config)
        .catch(() => undefined)
        .finally(scheduleNext);
    }, msUntilNextRefresh(config.feedRefreshHour));
  };
  scheduleNext();
}

export function stopFeedScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
