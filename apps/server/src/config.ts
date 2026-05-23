export type Config = {
  port: number;
  databasePath: string;
  mediaStorageDirectory: string;
  r2AccountId: string | null;
  r2AccessKeyId: string | null;
  r2SecretAccessKey: string | null;
  r2Bucket: string | null;
  r2PublicBaseUrl: string | null;
  r2KeyPrefix: string;
  r2SignedUrlTtlSeconds: number;
  houseSetupSecret: string;
  pairingCodeTtlMinutes: number;
  tokenHashSecret: string;
  publicBaseUrl: string | null;
  allowedOrigins: string[];
  hermesCommandMode: "mock" | "oneshot";
  hermesHome: string;
  hermesWorkingDirectory: string;
  hermesPythonPath: string;
  hermesTimeoutSeconds: number;
  feedRefreshEnabled: boolean;
  feedRefreshHour: number;
  feedMaxItems: number;
  feedDefaultLocation: string;
  feedDefaultRadiusMiles: number;
  feedInclusionThreshold: number;
};

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function readString(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (!value.trim()) {
    throw new Error(`${name} must not be empty`);
  }

  return value;
}

function readOptionalString(name: string): string | null {
  const value = process.env[name];
  if (!value?.trim()) {
    return null;
  }

  return value.trim();
}

function readStringList(name: string): string[] {
  const value = process.env[name];
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function readHour(name: string, fallback: number): number {
  const value = readNumber(name, fallback);
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error(`${name} must be an integer from 0 to 23`);
  }
  return value;
}

export function loadConfig(): Config {
  const hermesCommandMode = readString("HERMES_COMMAND_MODE", "mock");
  if (hermesCommandMode !== "mock" && hermesCommandMode !== "oneshot") {
    throw new Error("HERMES_COMMAND_MODE must be mock or oneshot");
  }

  return {
    port: readNumber("PORT", 8787),
    databasePath: readString("DATABASE_PATH", "./house.db"),
    mediaStorageDirectory: readString("MEDIA_STORAGE_DIRECTORY", "./media"),
    r2AccountId: readOptionalString("CLOUDFLARE_R2_ACCOUNT_ID"),
    r2AccessKeyId: readOptionalString("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: readOptionalString("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    r2Bucket: readOptionalString("CLOUDFLARE_R2_BUCKET"),
    r2PublicBaseUrl: readOptionalString("CLOUDFLARE_R2_PUBLIC_BASE_URL"),
    r2KeyPrefix: process.env.CLOUDFLARE_R2_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "compoota",
    r2SignedUrlTtlSeconds: readNumber("CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS", 3600),
    houseSetupSecret: readString("HOUSE_SETUP_SECRET", "change-this-long-random-string"),
    pairingCodeTtlMinutes: readNumber("PAIRING_CODE_TTL_MINUTES", 10),
    tokenHashSecret: readString("TOKEN_HASH_SECRET", "change-this-too"),
    publicBaseUrl: readOptionalString("PUBLIC_BASE_URL"),
    allowedOrigins: readStringList("ALLOWED_ORIGINS"),
    hermesCommandMode,
    hermesHome: readString("HERMES_HOME", "/home/pi/.hermes"),
    hermesWorkingDirectory: readString("HERMES_WORKING_DIRECTORY", "/home/pi/.hermes/hermes-agent"),
    hermesPythonPath: readString(
      "HERMES_PYTHON_PATH",
      "/home/pi/.hermes/hermes-agent/venv/bin/python"
    ),
    hermesTimeoutSeconds: readNumber("HERMES_TIMEOUT_SECONDS", 120),
    feedRefreshEnabled: readBoolean("FEED_REFRESH_ENABLED", true),
    feedRefreshHour: readHour("FEED_REFRESH_HOUR", 5),
    feedMaxItems: readNumber("FEED_MAX_ITEMS", 30),
    feedDefaultLocation: readString("FEED_DEFAULT_LOCATION", "Saline, MI"),
    feedDefaultRadiusMiles: readNumber("FEED_DEFAULT_RADIUS_MILES", 30),
    feedInclusionThreshold: readNumber("FEED_INCLUSION_THRESHOLD", 60)
  };
}
