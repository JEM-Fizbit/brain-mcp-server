const LOOPBACK_REDIRECT_RE =
  /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}\/[A-Za-z0-9_\-./]*$/;

const CHATGPT_CONNECTOR_REDIRECT_RE = /^\/connector\/oauth\/[^/?#]+$/;
const CHATGPT_LEGACY_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

const DEFAULT_ALLOWED_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  CHATGPT_LEGACY_REDIRECT_URI,
  "http://localhost:3000/oauth/callback",
];

export interface OauthConfig {
  issuer: string;
  resourceUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  protectedResourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
  scopes: string[];
  signingSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  githubCallbackUrl: string;
  allowedRedirectUris: string[];
  authCodeTtlSec: number;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  refreshTokenReuseGraceSec: number;
  oauthStateTtlSec: number;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function buildOauthConfig(): OauthConfig {
  const port = process.env.PORT || "3000";
  const publicBase = stripTrailingSlash(
    process.env.MCP_OAUTH_PUBLIC_BASE || `http://127.0.0.1:${port}`
  );
  const redirectAllowlist = [
    ...DEFAULT_ALLOWED_REDIRECT_URIS,
    ...(process.env.MCP_OAUTH_ALLOWED_REDIRECT_URIS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  return {
    issuer: publicBase,
    resourceUri: `${publicBase}/mcp`,
    authorizationEndpoint: `${publicBase}/authorize`,
    tokenEndpoint: `${publicBase}/token`,
    registrationEndpoint: `${publicBase}/register`,
    protectedResourceMetadataUrl: `${publicBase}/.well-known/oauth-protected-resource/mcp`,
    authorizationServerMetadataUrl: `${publicBase}/.well-known/oauth-authorization-server`,
    scopes: ["mcp:tools"],
    signingSecret: requiredEnv("MCP_OAUTH_SIGNING_SECRET"),
    githubClientId: requiredEnv("GITHUB_OAUTH_CLIENT_ID"),
    githubClientSecret: requiredEnv("GITHUB_OAUTH_CLIENT_SECRET"),
    githubCallbackUrl: `${publicBase}${process.env.GITHUB_OAUTH_CALLBACK_PATH || "/authorize/github/callback"}`,
    allowedRedirectUris: redirectAllowlist,
    authCodeTtlSec: 10 * 60,
    accessTokenTtlSec: 60 * 60,
    refreshTokenTtlSec: 30 * 24 * 60 * 60,
    refreshTokenReuseGraceSec: Math.max(
      0,
      Number(process.env.MCP_OAUTH_REFRESH_REUSE_GRACE_SEC || 0)
    ),
    oauthStateTtlSec: 10 * 60,
  };
}

export function isAllowedRedirectUri(config: OauthConfig, uri: string): boolean {
  if (config.allowedRedirectUris.includes(uri)) return true;
  if (uri === CHATGPT_LEGACY_REDIRECT_URI) return true;
  try {
    const parsed = new URL(uri);
    if (
      parsed.protocol === "https:" &&
      parsed.hostname === "chatgpt.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      CHATGPT_CONNECTOR_REDIRECT_RE.test(parsed.pathname)
    ) {
      return true;
    }
  } catch {
    // Fall through to loopback matching.
  }
  return LOOPBACK_REDIRECT_RE.test(uri);
}

export function normalizeResource(uri?: string | null): string | null {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.hash) return null;
    let result = url.toString();
    if (result.endsWith("/") && url.pathname === "/") result = result.slice(0, -1);
    return result;
  } catch {
    return null;
  }
}

export function isResourceMatch(requested: string | null | undefined, canonical: string): boolean {
  return normalizeResource(requested) === normalizeResource(canonical);
}
