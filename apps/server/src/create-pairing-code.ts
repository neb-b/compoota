import { randomUUID } from "node:crypto";
import { createPairingCode, hashSecret } from "./crypto.js";
import { openDatabase } from "./db.js";
import { loadConfig } from "./config.js";

function nowIso(): string {
  return new Date().toISOString();
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
const pairingCode = createPairingCode();
const createdAt = nowIso();
const expiresAt = new Date(Date.now() + config.pairingCodeTtlMinutes * 60_000).toISOString();

db.prepare(
  "INSERT INTO pairing_codes (id, code_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)"
).run(randomUUID(), hashSecret(pairingCode, config.tokenHashSecret), expiresAt, createdAt);

console.log(JSON.stringify({ pairingCode, expiresAt }, null, 2));
