import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import { AuthError, verifyDeviceToken, verifySetupSecret } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { createDeviceToken, createPairingCode, hashSecret } from "./crypto.js";
import { openDatabase, type PairingCodeRow } from "./db.js";
import { type CommandActivity, runHermesCommand } from "./hermes.js";
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

type CommandBody = z.infer<typeof commandSchema>;

type MediaRow = {
  id: string;
  device_id: string;
  file_path: string;
  mime_type: string;
  original_name: string | null;
  byte_size: number;
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
): Array<{ id: string; path: string; mimeType: string; originalName?: string; byteSize: number }> {
  if (!body.media?.length) {
    return [];
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

    const filePath = join(config.mediaStorageDirectory, `${id}.${mediaExtension(item.mimeType)}`);
    writeFileSync(filePath, buffer, { mode: 0o600 });
    db.prepare(
      "INSERT INTO media (id, device_id, file_path, mime_type, original_name, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, deviceId, filePath, item.mimeType, item.fileName ?? null, buffer.length, createdAt);

    return {
      id,
      path: filePath,
      mimeType: item.mimeType,
      originalName: item.fileName,
      byteSize: buffer.length
    };
  });
}

function mediaResponse(media: Array<{ id: string; mimeType: string; originalName?: string; byteSize: number }>) {
  return media.map((item) => ({
    id: item.id,
    mimeType: item.mimeType,
    fileName: item.originalName,
    byteSize: item.byteSize
  }));
}

function mediaRowsResponse(media: MediaRow[]) {
  return mediaResponse(
    media.map((item) => ({
      id: item.id,
      mimeType: item.mime_type,
      originalName: item.original_name ?? undefined,
      byteSize: item.byte_size
    }))
  );
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

  app.get("/media/:id", async (request, reply) => {
    const device = verifyDeviceToken(request, db, config);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const media = db
      .prepare("SELECT * FROM media WHERE id = ? AND device_id = ?")
      .get(params.id, device.id) as MediaRow | undefined;

    if (!media || !existsSync(media.file_path)) {
      reply.status(404).send({ error: "Media not found" });
      return;
    }

    reply
      .type(media.mime_type)
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .header("Content-Length", media.byte_size)
      .send(createReadStream(media.file_path));
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
    const fullActivity = [...activity, ...result.activity];
    const replyMedia = mediaReferencesFromReply(result.reply, device.id, db);
    const cleanedReply = stripRenderedMediaReferences(result.reply, replyMedia);

    db.prepare(
      "INSERT INTO audit_log (id, device_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      device.id,
      config.hermesCommandMode === "oneshot" ? "command.hermes" : "command.mock",
      JSON.stringify({ text: body.text, media, replyMedia: mediaRowsResponse(replyMedia), activity: fullActivity }),
      createdAt
    );

    return {
      reply: cleanedReply || result.reply,
      media: mediaResponse(media),
      replyMedia: mediaRowsResponse(replyMedia),
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
    if (media.length > 0) {
      sendSse(reply, "media", { media: mediaResponse(media) });
    }

    try {
      const result = await runHermesCommand(hermesText, config, {
        runId,
        imagePaths: media.map((item) => item.path),
        onActivity: emit
      });

      const replyMedia = mediaReferencesFromReply(result.reply, device.id, db);
      const cleanedReply = stripRenderedMediaReferences(result.reply, replyMedia);

      db.prepare(
        "INSERT INTO audit_log (id, device_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(
        randomUUID(),
        device.id,
        config.hermesCommandMode === "oneshot" ? "command.hermes" : "command.mock",
        JSON.stringify({ text: body.text, media, replyMedia: mediaRowsResponse(replyMedia), activity, streamed: true, runId }),
        createdAt
      );

      sendSse(reply, "reply", { reply: cleanedReply || result.reply, media: mediaRowsResponse(replyMedia), activity });
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

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
