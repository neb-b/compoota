export type Config = {
  port: number;
  databasePath: string;
  houseSetupSecret: string;
  pairingCodeTtlMinutes: number;
  tokenHashSecret: string;
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

export function loadConfig(): Config {
  return {
    port: readNumber("PORT", 8787),
    databasePath: readString("DATABASE_PATH", "./house.db"),
    houseSetupSecret: readString("HOUSE_SETUP_SECRET", "change-this-long-random-string"),
    pairingCodeTtlMinutes: readNumber("PAIRING_CODE_TTL_MINUTES", 10),
    tokenHashSecret: readString("TOKEN_HASH_SECRET", "change-this-too")
  };
}
