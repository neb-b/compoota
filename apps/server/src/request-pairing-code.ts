import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function loadDotEnv(): void {
  let current = process.cwd();

  for (let depth = 0; depth < 4; depth += 1) {
    const envPath = join(current, ".env");
    if (existsSync(envPath)) {
      const contents = readFileSync(envPath, "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }

        const equals = trimmed.indexOf("=");
        if (equals === -1) {
          continue;
        }

        const key = trimmed.slice(0, equals).trim();
        const value = trimmed.slice(equals + 1).trim().replace(/^['"]|['"]$/g, "");
        process.env[key] ??= value;
      }
      return;
    }

    const next = dirname(current);
    if (next === current) {
      return;
    }
    current = next;
  }
}

function serverUrl(): string {
  const value =
    process.env.PAIRING_CODE_SERVER_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || "8787"}`;

  return value.replace(/\/+$/, "");
}

loadDotEnv();

const setupSecret = process.env.HOUSE_SETUP_SECRET;
if (!setupSecret) {
  throw new Error("HOUSE_SETUP_SECRET is required to request a pairing code");
}

const response = await fetch(`${serverUrl()}/setup/pairing-code`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${setupSecret}`,
    "Content-Type": "application/json"
  },
  body: "{}"
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Pairing code request failed with status ${response.status}: ${text}`);
}

console.log(JSON.stringify(await response.json(), null, 2));
