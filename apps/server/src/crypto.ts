import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function createPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
