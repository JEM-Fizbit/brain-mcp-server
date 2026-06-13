import {
  base64urlJson,
  constantTimeEqual,
  decodeBase64url,
  hmacSha256Base64url,
  randomHex,
  sha256Hex,
} from "./crypto.js";
import type { OauthConfig } from "./config.js";

export interface AccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
  provider?: string;
  provider_user_id?: string;
  github_login?: string;
  email?: string;
  name?: string;
}

export function generateClientId(): string {
  return `mcp_client_${randomHex(12)}`;
}

export function generateClientSecret(): string {
  return randomHex(32);
}

export function generateAuthCode(): string {
  return randomHex(32);
}

export function generateRefreshToken(): string {
  return randomHex(32);
}

export function generateOauthState(): string {
  return randomHex(24);
}

export function hashRefreshToken(token: string): string {
  return sha256Hex(token);
}

export function issueAccessToken(
  config: OauthConfig,
  args: {
    sub: string;
    clientId: string;
    scope: string;
    provider?: string;
    providerUserId?: string;
    githubLogin?: string;
    email?: string;
    name?: string;
  }
): { token: string; payload: AccessTokenClaims } {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenClaims = {
    iss: config.issuer,
    aud: config.resourceUri,
    sub: args.sub,
    client_id: args.clientId,
    scope: args.scope,
    iat: now,
    exp: now + config.accessTokenTtlSec,
    jti: randomHex(12),
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.providerUserId ? { provider_user_id: args.providerUserId } : {}),
    ...(args.githubLogin ? { github_login: args.githubLogin } : {}),
    ...(args.email ? { email: args.email } : {}),
    ...(args.name ? { name: args.name } : {}),
  };

  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const body = base64urlJson(payload);
  const data = `${header}.${body}`;
  return {
    token: `${data}.${hmacSha256Base64url(config.signingSecret, data)}`,
    payload,
  };
}

export function verifyAccessToken(
  config: OauthConfig,
  token: string
): { ok: true; payload: AccessTokenClaims } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed JWT" };

  const [headerB64, payloadB64, signature] = parts;
  let header: any;
  let payload: AccessTokenClaims;
  try {
    header = JSON.parse(decodeBase64url(headerB64).toString("utf-8"));
    payload = JSON.parse(decodeBase64url(payloadB64).toString("utf-8"));
  } catch {
    return { ok: false, reason: "invalid JWT JSON" };
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return { ok: false, reason: "unsupported JWT header" };
  }

  const data = `${headerB64}.${payloadB64}`;
  const expected = hmacSha256Base64url(config.signingSecret, data);
  if (!constantTimeEqual(signature, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { ok: false, reason: "token expired" };
  }
  if (payload.iss !== config.issuer) {
    return { ok: false, reason: "issuer mismatch" };
  }

  return { ok: true, payload };
}
