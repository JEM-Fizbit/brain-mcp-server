const LOOPBACK_REDIRECT_RE =
  /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}\/[A-Za-z0-9_\-./]*$/;

const CHATGPT_CONNECTOR_REDIRECT_RE = /^\/connector\/oauth\/[^/?#]+$/;
const CHATGPT_LEGACY_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

const DEFAULT_ALLOWED_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  CHATGPT_LEGACY_REDIRECT_URI,
  "http://localhost:3000/oauth/callback",
];

export type IdentityProvider = "github" | "entra";

export interface EntraProviderConfig {
  tenantId: string;
  clientId: string;
  callbackUrl: string;
  adminCallbackUrl: string;
  clientPrivateKeyPem?: string;
  clientCertificateThumbprint?: string;
  clientCertificateExpiresAt?: string;
  localClientSecret?: string;
  adminGraphEnabled: boolean;
  roleGroupIds: Partial<Record<"reader" | "member" | "admin" | "owner", string>>;
}

export interface OauthConfig {
  issuer: string;
  resourceUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  protectedResourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
  documentationUrl: string;
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
  identityProviders: IdentityProvider[];
  identityDefaultProvider: IdentityProvider;
  entra?: EntraProviderConfig;
  adminSessionSecret?: string;
  adminSessionTtlSec: number;
  enforceCurrentGrants: boolean;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function callbackUrl(publicBase: string, name: string, fallback: string): string {
  const value = (process.env[name] || fallback).trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must be an absolute path on MCP_OAUTH_PUBLIC_BASE`);
  }
  return `${publicBase}${value}`;
}

function boundedInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIdentityProviders(raw: string | undefined): IdentityProvider[] {
  const values = (raw || "github")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const providers: IdentityProvider[] = [];
  for (const value of values) {
    if (value !== "github" && value !== "entra") {
      throw new Error(`Unsupported BRAIN_IDENTITY_PROVIDERS value: ${value}`);
    }
    if (!providers.includes(value)) providers.push(value);
  }
  if (providers.length === 0) {
    throw new Error("BRAIN_IDENTITY_PROVIDERS must enable at least one provider");
  }
  return providers;
}

function requireGuid(name: string, value: string | undefined): string {
  const normalized = value?.trim() || "";
  if (!GUID_RE.test(normalized)) {
    throw new Error(`${name} must be an exact GUID`);
  }
  return normalized.toLowerCase();
}

function parseRoleGroupIds(raw: string | undefined): EntraProviderConfig["roleGroupIds"] {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `ENTRA_BRAIN_ROLE_GROUP_IDS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ENTRA_BRAIN_ROLE_GROUP_IDS must be a JSON object");
  }
  const allowed = new Set(["reader", "member", "admin", "owner"]);
  const result: EntraProviderConfig["roleGroupIds"] = {};
  for (const [role, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!allowed.has(role)) {
      throw new Error(`ENTRA_BRAIN_ROLE_GROUP_IDS contains unknown role: ${role}`);
    }
    result[role as keyof EntraProviderConfig["roleGroupIds"]] = requireGuid(
      `ENTRA_BRAIN_ROLE_GROUP_IDS.${role}`,
      typeof value === "string" ? value : undefined
    );
  }
  return result;
}

function buildEntraConfig(publicBase: string): EntraProviderConfig {
  const tenantId = requireGuid("ENTRA_TENANT_ID", process.env.ENTRA_TENANT_ID);
  const clientId = requireGuid("ENTRA_OAUTH_CLIENT_ID", process.env.ENTRA_OAUTH_CLIENT_ID);
  const privateKey = process.env.ENTRA_OAUTH_CLIENT_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  const thumbprint = process.env.ENTRA_OAUTH_CLIENT_CERT_THUMBPRINT?.trim();
  const localClientSecret = process.env.ENTRA_OAUTH_CLIENT_SECRET?.trim();
  const allowLocalSecret = process.env.ENTRA_OAUTH_ALLOW_CLIENT_SECRET_LOCAL === "1";
  if (localClientSecret && !allowLocalSecret) {
    throw new Error(
      "ENTRA_OAUTH_CLIENT_SECRET is local-test-only and requires ENTRA_OAUTH_ALLOW_CLIENT_SECRET_LOCAL=1"
    );
  }
  if ((!privateKey || !thumbprint) && !localClientSecret) {
    throw new Error(
      "Entra requires ENTRA_OAUTH_CLIENT_PRIVATE_KEY_PEM and ENTRA_OAUTH_CLIENT_CERT_THUMBPRINT"
    );
  }
  if (privateKey && !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(privateKey)) {
    throw new Error("ENTRA_OAUTH_CLIENT_PRIVATE_KEY_PEM must be an unencrypted PKCS#8 private key");
  }
  if (
    thumbprint &&
    !/^[0-9a-f]{64}$/i.test(thumbprint.replace(/:/g, "")) &&
    !/^[A-Za-z0-9_-]{43}$/.test(thumbprint)
  ) {
    throw new Error("ENTRA_OAUTH_CLIENT_CERT_THUMBPRINT must be a SHA-256 thumbprint");
  }
  if (localClientSecret && publicBase.startsWith("https://")) {
    throw new Error("ENTRA_OAUTH_CLIENT_SECRET cannot be used by a hosted HTTPS profile");
  }
  const adminGraphEnabled = process.env.ENTRA_ADMIN_GRAPH_ENABLED === "1";
  const roleGroupIds = parseRoleGroupIds(process.env.ENTRA_BRAIN_ROLE_GROUP_IDS);
  if (
    adminGraphEnabled &&
    ["reader", "member", "admin", "owner"].some(
      (role) => !roleGroupIds[role as keyof typeof roleGroupIds]
    )
  ) {
    throw new Error(
      "ENTRA_ADMIN_GRAPH_ENABLED=1 requires reader/member/admin/owner group IDs"
    );
  }
  const groupValues = Object.values(roleGroupIds);
  if (new Set(groupValues).size !== groupValues.length) {
    throw new Error("ENTRA_BRAIN_ROLE_GROUP_IDS must use four distinct managed groups");
  }
  if (process.env.ENTRA_OAUTH_CLIENT_CERT_EXPIRES_AT) {
    const expiresAt = Date.parse(process.env.ENTRA_OAUTH_CLIENT_CERT_EXPIRES_AT);
    if (!Number.isFinite(expiresAt)) {
      throw new Error("ENTRA_OAUTH_CLIENT_CERT_EXPIRES_AT must be an ISO date/time");
    }
  }
  return {
    tenantId,
    clientId,
    callbackUrl: callbackUrl(publicBase, "ENTRA_OAUTH_CALLBACK_PATH", "/authorize/entra/callback"),
    adminCallbackUrl: callbackUrl(publicBase, "ENTRA_ADMIN_CALLBACK_PATH", "/admin/oauth/callback"),
    clientPrivateKeyPem: privateKey,
    clientCertificateThumbprint: thumbprint,
    clientCertificateExpiresAt: process.env.ENTRA_OAUTH_CLIENT_CERT_EXPIRES_AT?.trim(),
    localClientSecret,
    adminGraphEnabled,
    roleGroupIds,
  };
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

  const identityProviders = parseIdentityProviders(
    process.env.BRAIN_IDENTITY_PROVIDERS
  );
  const defaultProvider = (
    process.env.BRAIN_IDENTITY_DEFAULT_PROVIDER || identityProviders[0]
  ).trim().toLowerCase();
  const githubEnabled = identityProviders.includes("github");
  const entraEnabled = identityProviders.includes("entra");
  if (
    (defaultProvider !== "github" && defaultProvider !== "entra") ||
    !identityProviders.includes(defaultProvider as IdentityProvider)
  ) {
    throw new Error(
      "BRAIN_IDENTITY_DEFAULT_PROVIDER must name an enabled identity provider"
    );
  }
  if (
    entraEnabled &&
    (process.env.ENTRA_ALLOWED_EMAILS?.trim() ||
      process.env.ENTRA_ALLOWED_EMAIL_DOMAINS?.trim() ||
      process.env.ENTRA_SELF_ENROLLMENT === "1")
  ) {
    throw new Error("Entra mode refuses email, domain, and self-enrolment authorization shortcuts");
  }
  if (
    publicBase.startsWith("https://") &&
    (process.env.GITHUB_OAUTH_MOCK_LOGIN || process.env.ENTRA_OAUTH_MOCK_OID)
  ) {
    throw new Error("OAuth mock identities are forbidden on hosted HTTPS profiles");
  }
  if (
    !githubEnabled &&
    (process.env.GITHUB_ALLOWED_LOGINS?.trim() ||
      process.env.GITHUB_ALLOWED_EMAILS?.trim() ||
      process.env.BRAIN_GITHUB_ALLOWED_FALLBACK === "1")
  ) {
    throw new Error("Entra-only mode refuses GitHub allowlist fallback variables");
  }
  const entra = entraEnabled ? buildEntraConfig(publicBase) : undefined;
  const adminSessionSecret = entra?.adminGraphEnabled
    ? requiredEnv("ENTRA_ADMIN_SESSION_SECRET")
    : undefined;
  if (adminSessionSecret && adminSessionSecret.length < 32) {
    throw new Error("ENTRA_ADMIN_SESSION_SECRET must be at least 32 characters");
  }

  return {
    issuer: publicBase,
    resourceUri: `${publicBase}/mcp`,
    authorizationEndpoint: `${publicBase}/authorize`,
    tokenEndpoint: `${publicBase}/token`,
    registrationEndpoint: `${publicBase}/register`,
    protectedResourceMetadataUrl: `${publicBase}/.well-known/oauth-protected-resource/mcp`,
    authorizationServerMetadataUrl: `${publicBase}/.well-known/oauth-authorization-server`,
    documentationUrl: requiredEnv("MCP_OAUTH_DOCUMENTATION_URL"),
    scopes: ["mcp:tools"],
    signingSecret: requiredEnv("MCP_OAUTH_SIGNING_SECRET"),
    githubClientId: githubEnabled ? requiredEnv("GITHUB_OAUTH_CLIENT_ID") : "",
    githubClientSecret: githubEnabled ? requiredEnv("GITHUB_OAUTH_CLIENT_SECRET") : "",
    githubCallbackUrl: githubEnabled
      ? callbackUrl(publicBase, "GITHUB_OAUTH_CALLBACK_PATH", "/authorize/github/callback")
      : "",
    allowedRedirectUris: redirectAllowlist,
    authCodeTtlSec: 10 * 60,
    accessTokenTtlSec: 60 * 60,
    refreshTokenTtlSec: 30 * 24 * 60 * 60,
    refreshTokenReuseGraceSec: Math.max(
      0,
      Number(process.env.MCP_OAUTH_REFRESH_REUSE_GRACE_SEC || 0)
    ),
    oauthStateTtlSec: 10 * 60,
    identityProviders,
    identityDefaultProvider: defaultProvider as IdentityProvider,
    entra,
    adminSessionSecret,
    adminSessionTtlSec: boundedInteger(
      "ENTRA_ADMIN_SESSION_TTL_SEC",
      process.env.ENTRA_ADMIN_SESSION_TTL_SEC,
      30 * 60,
      5 * 60,
      60 * 60
    ),
    enforceCurrentGrants:
      entraEnabled || process.env.BRAIN_ACCESS_GRANT_STORE === "postgres",
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
