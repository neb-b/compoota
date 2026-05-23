import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import { AuthError, verifyDeviceToken, verifySetupSecret } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { createDeviceToken, createPairingCode, hashSecret } from "./crypto.js";
import { openDatabase, type PairingCodeRow } from "./db.js";
import {
  getOrCreateFeedPreferences,
  latestFeedRun,
  listFeedItems,
  refreshFeedForAllDevices,
  refreshFeedForDevice,
  setFeedFeedback,
  startFeedScheduler,
  updateFeedPreferences
} from "./feed.js";
import { type CommandActivity, runHermesCommand } from "./hermes.js";
import {
  deleteMediaFromR2,
  deleteMediaFromStoredValue,
  isR2Configured,
  mediaReadUrl,
  mediaReadUrlFromStoredValue,
  uploadMediaToR2
} from "./r2.js";
import { setupPageHtml } from "./setup-page.js";

const pairSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  deviceName: z.string().trim().min(1).max(80),
  expoPushToken: z.string().trim().max(512).optional()
});

const commandSchema = z.object({
  text: z.string().trim().max(2000),
  media: z
    .array(
      z.object({
        base64: z.string().min(1),
        mimeType: z.string().trim().regex(/^image\/(jpeg|jpg|png|webp|heic|heif)$/i),
        fileName: z.string().trim().max(160).optional()
      })
    )
    .max(1)
    .optional()
}).refine((body) => body.text.length > 0 || (body.media?.length ?? 0) > 0, {
  message: "Text or media is required"
});

const feedPreferencesSchema = z.object({
  homeLocation: z.string().trim().min(1).max(120).optional(),
  radiusMiles: z.number().int().positive().max(100).optional(),
  likedSignals: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  dislikedSignals: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  hiddenCategories: z.array(z.string().trim().min(1).max(80)).max(40).optional()
});

const feedFeedbackSchema = z.object({
  value: z.enum(["like", "dislike", "hide", "save", "clear"])
});

type CommandBody = z.infer<typeof commandSchema>;

type MediaRow = {
  id: string;
  device_id: string;
  file_path: string;
  mime_type: string;
  original_name: string | null;
  byte_size: number;
  r2_key: string | null;
  r2_bucket: string | null;
  remote_url: string | null;
  uploaded_at: string | null;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function commandActivity(id: string, label: string, detail?: string): CommandActivity {
  return {
    id,
    label,
    detail,
    status: "done",
    at: nowIso()
  };
}

function sendSse(reply: { raw: NodeJS.WritableStream }, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const error = new Error("Invalid request body");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }

  return parsed.data;
}

function httpError(message: string, statusCode: number): Error {
  const error = new Error(message);
  Object.assign(error, { statusCode });
  return error;
}

function errorStatusCode(error: unknown): number {
  if (error instanceof AuthError) {
    return error.statusCode;
  }

  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = Number((error as { statusCode: unknown }).statusCode);
    if (Number.isInteger(statusCode)) {
      return statusCode;
    }
  }

  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function mediaExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("heic")) {
    return "heic";
  }
  if (normalized.includes("heif")) {
    return "heif";
  }

  return "jpg";
}

function saveCommandMedia(
  body: CommandBody,
  deviceId: string,
  db: Database.Database,
  config: Config,
  createdAt: string
): Array<{ id: string; deviceId: string; path: string; mimeType: string; originalName?: string; byteSize: number; extension: string }> {
  if (!body.media?.length) {
    return [];
  }
  if (!isR2Configured(config)) {
    throw httpError(
      "Cloudflare R2 is required for image uploads. Set CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET, and CLOUDFLARE_R2_PUBLIC_BASE_URL.",
      500
    );
  }

  mkdirSync(config.mediaStorageDirectory, { recursive: true });

  return body.media.map((item) => {
    const id = randomUUID();
    const buffer = Buffer.from(item.base64, "base64");
    if (buffer.length === 0) {
      throw httpError("Uploaded image was empty", 400);
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw httpError("Uploaded image is too large", 413);
    }

    const extension = mediaExtension(item.mimeType);
    const filePath = join(config.mediaStorageDirectory, `${id}.${extension}`);
    writeFileSync(filePath, buffer, { mode: 0o600 });
    db.prepare(
      "INSERT INTO media (id, device_id, file_path, mime_type, original_name, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, deviceId, filePath, item.mimeType, item.fileName ?? null, buffer.length, createdAt);

    return {
      id,
      deviceId,
      path: filePath,
      mimeType: item.mimeType,
      originalName: item.fileName,
      byteSize: buffer.length,
      extension
    };
  });
}

function mediaResponse(
  media: Array<{
    id: string;
    mimeType: string;
    originalName?: string;
    byteSize: number;
    remoteUrl?: string | null;
    createdAt?: string;
  }>
) {
  return media.map((item) => ({
    id: item.id,
    mimeType: item.mimeType,
    fileName: item.originalName,
    byteSize: item.byteSize,
    remoteUrl: item.remoteUrl ?? null,
    createdAt: item.createdAt
  }));
}

async function mediaRowsResponse(media: MediaRow[], config: Config) {
  const items = await Promise.all(
    media.map(async (item) => ({
      id: item.id,
      mimeType: item.mime_type,
      originalName: item.original_name ?? undefined,
      byteSize: item.byte_size,
      createdAt: item.created_at,
      remoteUrl: item.r2_bucket && item.r2_key
        ? await mediaReadUrl(config, item.r2_bucket, item.r2_key)
        : await mediaReadUrlFromStoredValue(config, item.remote_url)
    }))
  );
  return mediaResponse(items);
}

async function uploadCommandMediaToR2(
  media: Array<{ id: string; deviceId: string; path: string; mimeType: string; originalName?: string; byteSize: number; extension: string }>,
  config: Config,
  db: Database.Database,
  onUploaded?: (mediaId: string, remoteUrl: string | null) => void,
  onError?: (mediaId: string, error: unknown) => void
): Promise<MediaRow[]> {
  const rows: MediaRow[] = [];

  for (const item of media) {
    const existing = db.prepare("SELECT * FROM media WHERE id = ?").get(item.id) as MediaRow | undefined;
    if (existing?.uploaded_at) {
      rows.push(existing);
      continue;
    }

    try {
      const uploaded = await uploadMediaToR2(config, item);
      if (uploaded) {
        db.prepare(
          "UPDATE media SET r2_key = ?, r2_bucket = ?, remote_url = ?, uploaded_at = ? WHERE id = ?"
        ).run(uploaded.key, uploaded.bucket, uploaded.remoteUrl, uploaded.uploadedAt, item.id);
        onUploaded?.(item.id, uploaded.remoteUrl);
      }
    } catch (error) {
      onError?.(item.id, error);
      throw error;
    }

    const row = db.prepare("SELECT * FROM media WHERE id = ?").get(item.id) as MediaRow | undefined;
    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

function uniqueMediaRows(rows: MediaRow[]): MediaRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }
    seen.add(row.id);
    return true;
  });
}

function imageFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function mediaReferencesFromReply(reply: string, deviceId: string, db: Database.Database): MediaRow[] {
  const rows: MediaRow[] = [];
  const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
  const imagePathPattern = /(?:\/|file:\/\/)[^\s`'"<>)]+?\.(?:jpe?g|png|webp|heic|heif)\b/gi;

  for (const match of reply.matchAll(uuidPattern)) {
    const row = db
      .prepare("SELECT * FROM media WHERE id = ? AND device_id = ?")
      .get(match[0], deviceId) as MediaRow | undefined;
    if (row) {
      rows.push(row);
    }
  }

  for (const match of reply.matchAll(imagePathPattern)) {
    const path = match[0].replace(/^file:\/\//, "");
    const fileName = imageFileName(path);
    const row = db
      .prepare("SELECT * FROM media WHERE device_id = ? AND (file_path = ? OR file_path LIKE ?)")
      .get(deviceId, path, `%/${fileName}`) as MediaRow | undefined;
    if (row) {
      rows.push(row);
    }
  }

  return uniqueMediaRows(rows);
}

function stripRenderedMediaReferences(reply: string, media: MediaRow[]): string {
  if (media.length === 0) {
    return reply;
  }

  let cleaned = reply;
  for (const item of media) {
    const fileName = imageFileName(item.file_path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`(?:file://)?[^\\s\`'"<>)]+/${fileName}`, "g"), "the image below");
    cleaned = cleaned.replace(new RegExp(`\\bmedia_id=${item.id}\\b`, "g"), "");
    cleaned = cleaned.replace(new RegExp(`\\b${item.id}\\b`, "g"), "");
  }

  return cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+([.,:;!?])/g, "$1").replace(/\s{2,}/g, " ").trim())
    .filter((line) => line && !/^the image below[.:]?$/i.test(line))
    .join("\n")
    .trim();
}

function buildHermesText(text: string, media: Array<{ id: string; path: string; mimeType: string }>): string {
  const trimmed = text.trim();
  if (media.length === 0) {
    return trimmed;
  }

  const mediaContext = media
    .map((item, index) => `Image ${index + 1}: media_id=${item.id}, mime_type=${item.mimeType}, stored_path=${item.path}`)
    .join("\n");

  return [
    trimmed || "Please analyze this uploaded photo.",
    "",
    "The user attached photo media. Use the attached image directly if your current model supports vision. If anything is worth remembering, attach the memory to the media_id and stored_path below so the memory can point back to its source.",
    mediaContext
  ].join("\n");
}

function createServer(config: Config, db: Database.Database) {
  const app = Fastify({
    logger: true,
    bodyLimit: 12 * 1024 * 1024
  });

  app.register(cors, { origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true });
  app.register(rateLimit, { global: false });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const statusCode = errorStatusCode(error);

    if (statusCode >= 500) {
      app.log.error(error);
      reply.status(500).send({ error: "Internal server error" });
      return;
    }

    reply.status(statusCode).send({ error: errorMessage(error) });
  });

  app.get("/health", async () => ({ ok: true, mode: "house-server" }));

  app.get("/setup", async (_request, reply) => {
    reply.type("text/html").send(setupPageHtml(config.publicBaseUrl));
  });

  app.post("/setup/pairing-code", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "10 minutes"
      }
    }
  }, async (request) => {
    verifySetupSecret(request, config);

    const pairingCode = createPairingCode();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + config.pairingCodeTtlMinutes * 60_000).toISOString();

    db.prepare(
      "INSERT INTO pairing_codes (id, code_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)"
    ).run(randomUUID(), hashSecret(pairingCode, config.tokenHashSecret), expiresAt, createdAt);

    return { pairingCode, expiresAt };
  });

  app.get("/setup/feed/status", async (request) => {
    verifySetupSecret(request, config);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'feed_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const devices = db
      .prepare("SELECT id, name, created_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at DESC")
      .all() as Array<{ id: string; name: string; created_at: string }>;
    const runs = db
      .prepare("SELECT * FROM feed_refresh_runs ORDER BY started_at DESC LIMIT 10")
      .all() as Array<Record<string, unknown>>;
    const items = db
      .prepare("SELECT title, starts_at, area, score, created_at FROM feed_items ORDER BY starts_at ASC LIMIT 10")
      .all() as Array<Record<string, unknown>>;

    return {
      config: {
        mode: config.hermesCommandMode,
        enabled: config.feedRefreshEnabled,
        refreshHour: config.feedRefreshHour,
        location: config.feedDefaultLocation,
        radiusMiles: config.feedDefaultRadiusMiles,
        maxItems: config.feedMaxItems,
        inclusionThreshold: config.feedInclusionThreshold
      },
      tables: tables.map((table) => table.name),
      devices,
      runs,
      items
    };
  });

  app.post("/setup/feed/refresh", async (request) => {
    verifySetupSecret(request, config);
    const results = await refreshFeedForAllDevices(db, config);
    return {
      results,
      status: {
        runs: db.prepare("SELECT * FROM feed_refresh_runs ORDER BY started_at DESC LIMIT 10").all(),
        items: db.prepare("SELECT title, starts_at, area, score, created_at FROM feed_items ORDER BY starts_at ASC LIMIT 10").all()
      }
    };
  });

  app.get("/devices", async (request) => {
    verifySetupSecret(request, config);

    return db
      .prepare("SELECT id, name, created_at, revoked_at FROM devices ORDER BY created_at DESC")
      .all()
      .map((device) => {
        const row = device as { id: string; name: string; created_at: string; revoked_at: string | null };
        return {
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          revokedAt: row.revoked_at
        };
      });
  });

  app.post("/devices/:id/revoke", async (request, reply) => {
    verifySetupSecret(request, config);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const revokedAt = nowIso();

    const result = db
      .prepare("UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .run(revokedAt, params.id);

    if (result.changes === 0) {
      reply.status(404).send({ error: "Device not found" });
      return;
    }

    return { ok: true };
  });

  app.get("/media", async (request) => {
    const device = verifyDeviceToken(request, db, config);
    const media = db
      .prepare("SELECT * FROM media WHERE device_id = ? ORDER BY created_at DESC")
      .all(device.id) as MediaRow[];

    return { media: await mediaRowsResponse(media, config) };
  });

  app.get("/feed/preferences", async (request) => {
    const device = verifyDeviceToken(request, db, config);
    return getOrCreateFeedPreferences(db, config, device.id);
  });

  app.put("/feed/preferences", async (request) => {
    const device = verifyDeviceToken(request, db, config);
    const body = validateBody(feedPreferencesSchema, request.body);
    return updateFeedPreferences(db, config, device.id, body);
  });

  app.get("/feed", async (request) => {
    const device = verifyDeviceToken(request, db, config);
    const preferences = getOrCreateFeedPreferences(db, config, device.id);
    return {
      preferences,
      run: latestFeedRun(db, device.id),
      items: listFeedItems(db, device.id)
    };
  });

  app.post("/feed/refresh", async (request) => {
    const device = verifyDeviceToken(request, db, config);
    return refreshFeedForDevice(db, config, device.id);
  });

  app.post("/feed/items/:id/feedback", async (request, reply) => {
    const device = verifyDeviceToken(request, db, config);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = validateBody(feedFeedbackSchema, request.body);
    const item = setFeedFeedback(db, device.id, params.id, body.value);
    if (!item) {
      reply.status(404).send({ error: "Feed item not found" });
      return;
    }

    return { item };
  });

  app.get("/media/:id", async (request, reply) => {
    const device = verifyDeviceToken(request, db, config);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const media = db
      .prepare("SELECT * FROM media WHERE id = ? AND device_id = ?")
      .get(params.id, device.id) as MediaRow | undefined;

    const remoteUrl = media?.r2_bucket && media.r2_key
      ? await mediaReadUrl(config, media.r2_bucket, media.r2_key)
      : await mediaReadUrlFromStoredValue(config, media?.remote_url ?? null);

    if (!remoteUrl) {
      reply.status(404).send({ error: "Remote media not found" });
      return;
    }

    reply.redirect(remoteUrl);
  });

  app.delete("/media/:id", async (request, reply) => {
    const device = verifyDeviceToken(request, db, config);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const media = db
      .prepare("SELECT * FROM media WHERE id = ? AND device_id = ?")
      .get(params.id, device.id) as MediaRow | undefined;

    if (!media) {
      reply.status(404).send({ error: "Media not found" });
      return;
    }

    if (media.r2_bucket && media.r2_key) {
      await deleteMediaFromR2(config, media.r2_bucket, media.r2_key);
    } else {
      await deleteMediaFromStoredValue(config, media.remote_url);
    }

    db.prepare("DELETE FROM media WHERE id = ? AND device_id = ?").run(params.id, device.id);

    try {
      unlinkSync(media.file_path);
    } catch {
      // Local upload staging files are best-effort cleanup only.
    }

    return { ok: true };
  });

  app.post("/pair", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "10 minutes"
      }
    }
  }, async (request, reply) => {
    const body = validateBody(pairSchema, request.body);
    const codeHash = hashSecret(body.pairingCode, config.tokenHashSecret);
    const pairingCode = db
      .prepare("SELECT * FROM pairing_codes WHERE code_hash = ?")
      .get(codeHash) as PairingCodeRow | undefined;

    if (!pairingCode || pairingCode.used_at || Date.parse(pairingCode.expires_at) <= Date.now()) {
      reply.status(400).send({ error: "Invalid or expired pairing code" });
      return;
    }

    const deviceId = randomUUID();
    const deviceToken = createDeviceToken();
    const createdAt = nowIso();
    const tokenHash = hashSecret(deviceToken, config.tokenHashSecret);

    const createDevice = db.transaction(() => {
      const result = db.prepare("UPDATE pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(
        createdAt,
        pairingCode.id
      );

      if (result.changes !== 1) {
        throw httpError("Invalid or expired pairing code", 400);
      }

      db.prepare(
        "INSERT INTO devices (id, name, token_hash, expo_push_token, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
      ).run(deviceId, body.deviceName.trim(), tokenHash, body.expoPushToken ?? null, createdAt);
      db.prepare(
        "INSERT INTO audit_log (id, device_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(randomUUID(), deviceId, "device.paired", JSON.stringify({ deviceName: body.deviceName.trim() }), createdAt);
    });

    createDevice();

    return {
      deviceId,
      deviceToken,
      serverTime: nowIso()
    };
  });

  app.post("/command", {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: "1 minute"
      }
    }
  }, async (request) => {
    const device = verifyDeviceToken(request, db, config);
    const body = validateBody(commandSchema, request.body);
    const createdAt = nowIso();
    const media = saveCommandMedia(body, device.id, db, config, createdAt);
    const hermesText = buildHermesText(body.text, media);
    const activity: CommandActivity[] = [
      commandActivity("compoota.server.received", "House-server received the message"),
      commandActivity("compoota.server.auth", "Device token checked out", `Device: ${device.name}`)
    ];
    if (media.length > 0) {
      activity.push(commandActivity("compoota.server.media", "Stored attached photo", media[0].path));
    }
    const result = await runHermesCommand(hermesText, config, { imagePaths: media.map((item) => item.path) });
    const uploadedMedia = await uploadCommandMediaToR2(media, config, db, (mediaId, remoteUrl) => {
      activity.push(commandActivity("compoota.server.r2", "Uploaded photo to Cloudflare R2", remoteUrl ?? mediaId));
    }, (mediaId, error) => {
      activity.push(
        commandActivity(
          "compoota.server.r2.error",
          "Cloudflare R2 upload failed",
          error instanceof Error ? error.message : mediaId
        )
      );
      activity[activity.length - 1].status = "error";
    });
    const fullActivity = [...activity, ...result.activity];
    const replyMedia = mediaReferencesFromReply(result.reply, device.id, db);
    const cleanedReply = stripRenderedMediaReferences(result.reply, replyMedia);
    const replyMediaResponse = await mediaRowsResponse(replyMedia, config);
    const uploadedMediaResponse = await mediaRowsResponse(uploadedMedia, config);

    db.prepare(
      "INSERT INTO audit_log (id, device_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      device.id,
      config.hermesCommandMode === "oneshot" ? "command.hermes" : "command.mock",
      JSON.stringify({ text: body.text, media, replyMedia: replyMediaResponse, activity: fullActivity }),
      createdAt
    );

    return {
      reply: cleanedReply || result.reply,
      media: uploadedMediaResponse,
      replyMedia: replyMediaResponse,
      activity: fullActivity
    };
  });

  app.post("/command/stream", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      }
    }
  }, async (request, reply) => {
    const device = verifyDeviceToken(request, db, config);
    const body = validateBody(commandSchema, request.body);
    const createdAt = nowIso();
    const runId = randomUUID();
    const media = saveCommandMedia(body, device.id, db, config, createdAt);
    const hermesText = buildHermesText(body.text, media);
    const activity: CommandActivity[] = [];

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    function emit(next: CommandActivity): void {
      const existingIndex = activity.findIndex((item) => item.id === next.id);
      if (existingIndex >= 0) {
        activity.splice(existingIndex, 1);
      }
      activity.push(next);
      sendSse(reply, "activity", next);
    }

    emit(commandActivity("compoota.server.received", "House-server received the message"));
    emit(commandActivity("compoota.server.auth", "Device token checked out", `Device: ${device.name}`));
    for (const item of media) {
      emit(commandActivity("compoota.server.media", "Stored attached photo", item.path));
    }
    try {
      const result = await runHermesCommand(hermesText, config, {
        runId,
        imagePaths: media.map((item) => item.path),
        onActivity: emit
      });
      const uploadedMedia = await uploadCommandMediaToR2(media, config, db, (mediaId, remoteUrl) => {
        emit(commandActivity("compoota.server.r2", "Uploaded photo to Cloudflare R2", remoteUrl ?? mediaId));
      }, (mediaId, error) => {
        const failed = commandActivity(
          "compoota.server.r2.error",
          "Cloudflare R2 upload failed",
          error instanceof Error ? error.message : mediaId
        );
        failed.status = "error";
        emit(failed);
      });
      if (uploadedMedia.length > 0) {
        sendSse(reply, "media", { media: await mediaRowsResponse(uploadedMedia, config) });
      }

      const replyMedia = mediaReferencesFromReply(result.reply, device.id, db);
      const cleanedReply = stripRenderedMediaReferences(result.reply, replyMedia);
      const replyMediaResponse = await mediaRowsResponse(replyMedia, config);

      db.prepare(
        "INSERT INTO audit_log (id, device_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(
        randomUUID(),
        device.id,
        config.hermesCommandMode === "oneshot" ? "command.hermes" : "command.mock",
        JSON.stringify({ text: body.text, media, replyMedia: replyMediaResponse, activity, streamed: true, runId }),
        createdAt
      );

      sendSse(reply, "reply", { reply: cleanedReply || result.reply, media: replyMediaResponse, activity });
      sendSse(reply, "done", { ok: true });
    } catch (error) {
      app.log.error(error);
      const failed = commandActivity("compoota.server.error", "compoota hit a snag", undefined);
      failed.status = "error";
      emit(failed);
      sendSse(reply, "error", { error: "Command failed" });
    } finally {
      reply.raw.end();
    }
  });

  return app;
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = createServer(config, db);

startFeedScheduler(db, config);

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
