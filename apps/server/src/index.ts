import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type Database from "better-sqlite3";
import { AuthError, verifyDeviceToken, verifySetupSecret } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { createDeviceToken, createPairingCode, hashSecret } from "./crypto.js";
import { openDatabase, type PairingCodeRow } from "./db.js";
import { setupPageHtml } from "./setup-page.js";

const pairSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  deviceName: z.string().trim().min(1).max(80),
  expoPushToken: z.string().trim().max(512).optional()
});

const commandSchema = z.object({
  text: z.string().trim().min(1).max(2000)
});

function nowIso(): string {
  return new Date().toISOString();
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

function createServer(config: Config, db: Database.Database) {
  const app = Fastify({
    logger: true
  });

  app.register(cors, { origin: true });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const statusCode = errorStatusCode(error);

    if (statusCode >= 500) {
      app.log.error(error);
      reply.status(500).send({ error: "Internal server error" });
      return;
    }

    reply.status(statusCode).send({ error: errorMessage(error) });
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/setup", async (_request, reply) => {
    reply.type("text/html").send(setupPageHtml());
  });

  app.post("/setup/pairing-code", async (request) => {
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

  app.post("/pair", async (request, reply) => {
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

  app.post("/command", async (request) => {
    const device = verifyDeviceToken(request, db, config);
    const body = validateBody(commandSchema, request.body);
    const createdAt = nowIso();

    db.prepare(
      "INSERT INTO audit_log (id, device_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(randomUUID(), device.id, "command.mock", JSON.stringify({ text: body.text }), createdAt);

    return {
      reply: `Mock Hermes heard: ${body.text}`
    };
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
