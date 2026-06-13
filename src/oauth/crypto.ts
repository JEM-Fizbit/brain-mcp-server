import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64urlJson(value: unknown): string {
  return base64url(JSON.stringify(value));
}

export function decodeBase64url(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function sha256Base64url(value: string): string {
  return base64url(createHash("sha256").update(value).digest());
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hmacSha256Base64url(secret: string, value: string): string {
  return base64url(createHmac("sha256", secret).update(value).digest());
}
