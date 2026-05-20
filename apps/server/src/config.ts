export type Config = {
  port: number;
  databasePath: string;
  mediaStorageDirectory: string;
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

export function loadConfig(): Config {
  const hermesCommandMode = readString("HERMES_COMMAND_MODE", "mock");
  if (hermesCommandMode !== "mock" && hermesCommandMode !== "oneshot") {
    throw new Error("HERMES_COMMAND_MODE must be mock or oneshot");
  }

  return {
    port: readNumber("PORT", 8787),
    databasePath: readString("DATABASE_PATH", "./house.db"),
    mediaStorageDirectory: readString("MEDIA_STORAGE_DIRECTORY", "./media"),
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
    hermesTimeoutSeconds: readNumber("HERMES_TIMEOUT_SECONDS", 120)
  };
}
