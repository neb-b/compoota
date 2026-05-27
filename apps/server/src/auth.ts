import type { FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import type { DeviceRow } from "./db.js";
import { hashSecret, safeEqual } from "./crypto.js";
import { getDefaultHouseholdId } from "./db.js";

export class AuthError extends Error {
  statusCode = 401;

  constructor(message = "Unauthorized") {
    super(message);
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function queryToken(request: FastifyRequest): string | null {
  const query = request.query;
  if (!query || typeof query !== "object" || !("token" in query)) {
    return null;
  }

  const token = (query as { token?: unknown }).token;
  return typeof token === "string" && token ? token : null;
}

export function verifySetupSecret(request: FastifyRequest, config: Config): void {
  const token = bearerToken(request) ?? queryToken(request);
  if (!token || !safeEqual(token, config.houseSetupSecret)) {
    throw new AuthError();
  }
}

export function verifyDeviceToken(
  request: FastifyRequest,
  db: Database.Database,
  config: Config
): DeviceRow {
  const token = bearerToken(request);
  if (!token) {
    throw new AuthError();
  }

  const tokenHash = hashSecret(token, config.tokenHashSecret);
  const device = db
    .prepare("SELECT * FROM devices WHERE token_hash = ?")
    .get(tokenHash) as DeviceRow | undefined;

  if (!device || device.revoked_at) {
    throw new AuthError();
  }

  if (!device.household_id) {
    const householdId = getDefaultHouseholdId(db);
    db.prepare("UPDATE devices SET household_id = ? WHERE id = ?").run(householdId, device.id);
    device.household_id = householdId;
  }

  return device;
}
