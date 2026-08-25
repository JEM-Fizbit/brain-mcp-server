import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { base64url, randomHex, sha256Base64url } from "./crypto.js";
import { generateAuthCode } from "./jwt.js";
import type { EntraProviderConfig, OauthConfig } from "./config.js";
import type { StateProvider } from "./state.js";
import {
  currentRolesForPrincipal,
} from "../services/access-grants.js";
import { runtimeBrainId } from "../services/runtime-env.js";
import type { BrainPrincipal, BrainRole } from "../services/registry.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const APP_ROLE_TO_BRAIN_ROLE: Record<string, BrainRole> = {
  "Brain.Reader": "reader",
  "Brain.Curator": "member",
  "Brain.Admin": "admin",
  "Brain.Owner": "owner",
};
export const BRAIN_ROLE_TO_APP_ROLE: Record<BrainRole, string> = {
  reader: "Brain.Reader",
  member: "Brain.Curator",
  admin: "Brain.Admin",
  owner: "Brain.Owner",
};

interface EntraDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface EntraAuthorizationContext {
  upstream_nonce: string;
  upstream_code_verifier: string;
  upstream_code_challenge: string;
}

export interface EntraIdentity extends BrainPrincipal {
  provider: "entra";
  providerTenantId: string;
  upstreamRole: string;
}

const discoveryCache = new Map<
  string,
  { promise: Promise<EntraDiscovery>; expiresAt: number }
>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function resetEntraCachesForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

function entraJwks(uri: string, forceRefresh = false): ReturnType<typeof createRemoteJWKSet> {
  if (forceRefresh) jwksCache.delete(uri);
  let jwks = jwksCache.get(uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(uri), {
      cooldownDuration: 30_000,
      cacheMaxAge: 60 * 60 * 1000,
      timeoutDuration: 8_000,
    });
    jwksCache.set(uri, jwks);
    while (jwksCache.size > 16) {
      jwksCache.delete(jwksCache.keys().next().value!);
    }
  }
  return jwks;
}

function htmlError(message: string): string {
  const safe = message.replace(/[<>&]/g, (value) =>
    value === "<" ? "&lt;" : value === ">" ? "&gt;" : "&amp;"
  );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Brain OAuth Error</title><body><h1>Authorization failed</h1><p>${safe}</p></body></html>`;
}

function requireEntra(config: OauthConfig): EntraProviderConfig {
  if (!config.identityProviders.includes("entra") || !config.entra) {
    throw new Error("Entra identity provider is not enabled");
  }
  return config.entra;
}

function safeUpstreamError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

export function createEntraAuthorizationContext(): EntraAuthorizationContext {
  const verifier = randomHex(32);
  return {
    upstream_nonce: randomHex(24),
    upstream_code_verifier: verifier,
    upstream_code_challenge: sha256Base64url(verifier),
  };
}

export async function discoverEntra(
  entra: EntraProviderConfig
): Promise<EntraDiscovery> {
  const authority = `https://login.microsoftonline.com/${entra.tenantId}/v2.0`;
  const cached = discoveryCache.get(entra.tenantId);
  let promise = cached && cached.expiresAt > Date.now() ? cached.promise : undefined;
  if (!promise) {
    promise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(
          `${authority}/.well-known/openid-configuration`,
          { signal: controller.signal, headers: { Accept: "application/json" } }
        );
        if (!response.ok) {
          throw new Error(`Entra discovery failed with HTTP ${response.status}`);
        }
        const document = (await response.json()) as Partial<EntraDiscovery>;
        if (
          document.issuer !== authority ||
          !document.authorization_endpoint?.startsWith(
            `https://login.microsoftonline.com/${entra.tenantId}/`
          ) ||
          !document.token_endpoint?.startsWith(
            `https://login.microsoftonline.com/${entra.tenantId}/`
          ) ||
          !document.jwks_uri?.startsWith(
            `https://login.microsoftonline.com/${entra.tenantId}/`
          )
        ) {
          throw new Error("Entra discovery returned an unexpected tenant authority");
        }
        return document as EntraDiscovery;
      } finally {
        clearTimeout(timeout);
      }
    })();
    discoveryCache.set(entra.tenantId, {
      promise,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    while (discoveryCache.size > 16) {
      discoveryCache.delete(discoveryCache.keys().next().value!);
    }
    promise.catch(() => {
      if (discoveryCache.get(entra.tenantId)?.promise === promise) {
        discoveryCache.delete(entra.tenantId);
      }
    });
  }
  return promise;
}

export async function buildEntraAuthorizationUrl(
  oauthState: string,
  context: EntraAuthorizationContext,
  config: OauthConfig,
  args?: { admin?: boolean }
): Promise<string> {
  const entra = requireEntra(config);
  const discovery = await discoverEntra(entra);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", entra.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("redirect_uri", args?.admin ? entra.adminCallbackUrl : entra.callbackUrl);
  url.searchParams.set(
    "scope",
    args?.admin
      ? "openid profile email User.ReadBasic.All GroupMember.ReadWrite.All"
      : "openid profile email"
  );
  url.searchParams.set("state", oauthState);
  url.searchParams.set("nonce", context.upstream_nonce);
  url.searchParams.set("code_challenge", context.upstream_code_challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function certificateThumbprint(value: string): string {
  const normalized = value.replace(/:/g, "").trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    return base64url(Buffer.from(normalized, "hex"));
  }
  if (/^[A-Za-z0-9_-]{20,100}$/.test(normalized)) return normalized;
  throw new Error("Entra certificate thumbprint must be SHA-256 hex or base64url");
}

async function createClientAssertion(
  entra: EntraProviderConfig,
  audience: string
): Promise<string | null> {
  if (!entra.clientPrivateKeyPem || !entra.clientCertificateThumbprint) return null;
  const key = await importPKCS8(entra.clientPrivateKeyPem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({
      alg: "RS256",
      typ: "JWT",
      "x5t#S256": certificateThumbprint(entra.clientCertificateThumbprint),
    })
    .setIssuer(entra.clientId)
    .setSubject(entra.clientId)
    .setAudience(audience)
    .setJti(randomHex(16))
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + 5 * 60)
    .sign(key);
}

async function exchangeEntraCode(args: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  config: OauthConfig;
  admin?: boolean;
}): Promise<{ idToken: string; graphAccessToken?: string; expiresIn?: number }> {
  const entra = requireEntra(args.config);
  const discovery = await discoverEntra(entra);
  const assertion = await createClientAssertion(entra, discovery.token_endpoint);
  const form = new URLSearchParams({
    client_id: entra.clientId,
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
    scope: args.admin
      ? "openid profile email User.ReadBasic.All GroupMember.ReadWrite.All"
      : "openid profile email",
  });
  if (assertion) {
    form.set(
      "client_assertion_type",
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
    );
    form.set("client_assertion", assertion);
  } else if (entra.localClientSecret) {
    form.set("client_secret", entra.localClientSecret);
  } else {
    throw new Error("Entra confidential-client credential is unavailable");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: controller.signal,
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof json.id_token !== "string") {
      throw new Error(
        typeof json.error === "string"
          ? `Entra token exchange failed: ${json.error}`
          : `Entra token exchange failed with HTTP ${response.status}`
      );
    }
    return {
      idToken: json.id_token,
      graphAccessToken:
        args.admin && typeof json.access_token === "string"
          ? json.access_token
          : undefined,
      expiresIn:
        typeof json.expires_in === "number" ? json.expires_in : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function exactlyOneRecognizedRole(value: unknown): { appRole: string; role: BrainRole } {
  const recognized = Array.isArray(value)
    ? value.filter(
        (role): role is string =>
          typeof role === "string" && Boolean(APP_ROLE_TO_BRAIN_ROLE[role])
      )
    : [];
  if (recognized.length !== 1) {
    throw new Error("Entra identity must have exactly one recognized Brain app role");
  }
  return { appRole: recognized[0], role: APP_ROLE_TO_BRAIN_ROLE[recognized[0]] };
}

async function validateEntraIdToken(args: {
  idToken: string;
  nonce: string;
  config: OauthConfig;
}): Promise<EntraIdentity> {
  const entra = requireEntra(args.config);
  const discovery = await discoverEntra(entra);
  const verify = (forceRefresh = false) =>
    jwtVerify(args.idToken, entraJwks(discovery.jwks_uri, forceRefresh), {
      issuer: discovery.issuer,
      audience: entra.clientId,
      algorithms: ["RS256"],
      clockTolerance: 60,
    });
  let verified;
  try {
    verified = await verify();
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
    verified = await verify(true);
  }
  if (!verified.protectedHeader.kid) throw new Error("Entra signing key ID is missing");
  const claims = verified.payload;
  if (
    typeof claims.iat !== "number" ||
    typeof claims.nbf !== "number" ||
    typeof claims.exp !== "number"
  ) {
    throw new Error("Entra token time claims are incomplete");
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iat > now + 60) throw new Error("Entra token issued-at time is in the future");
  if (claims.nonce !== args.nonce) throw new Error("Entra nonce mismatch");
  const tenantId = typeof claims.tid === "string" ? claims.tid.toLowerCase() : "";
  const objectId = typeof claims.oid === "string" ? claims.oid.toLowerCase() : "";
  if (!GUID_RE.test(tenantId) || tenantId !== entra.tenantId) {
    throw new Error("Entra tenant mismatch");
  }
  if (!GUID_RE.test(objectId)) throw new Error("Entra object ID is missing or invalid");
  const { appRole } = exactlyOneRecognizedRole(claims.roles);
  return {
    provider: "entra",
    providerTenantId: tenantId,
    providerUserId: objectId,
    login:
      typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : undefined,
    email: typeof claims.email === "string" ? claims.email : undefined,
    name: typeof claims.name === "string" ? claims.name : undefined,
    upstreamRole: appRole,
  };
}

export async function beginEntraAdminAuthorization(
  config: OauthConfig,
  state: StateProvider
): Promise<string> {
  const entra = requireEntra(config);
  if (!entra.adminGraphEnabled) {
    throw new Error("ERS access administration is not enabled");
  }
  const oauthState = randomHex(32);
  const context = createEntraAuthorizationContext();
  const now = Math.floor(Date.now() / 1000);
  await state.put("oauth_states", oauthState, {
    flow: "entra_admin",
    upstream_provider: "entra",
    ...context,
    created_at: now,
    expires_at: now + config.oauthStateTtlSec,
  });
  return buildEntraAuthorizationUrl(oauthState, context, config, { admin: true });
}

export async function exchangeEntraAdminCode(args: {
  searchParams: URLSearchParams;
  config: OauthConfig;
  state: StateProvider;
  rolesForPrincipal?: typeof currentRolesForPrincipal;
}): Promise<{
  identity: EntraIdentity;
  graphAccessToken: string;
  expiresIn: number;
}> {
  const entra = requireEntra(args.config);
  if (!entra.adminGraphEnabled) {
    throw new Error("ERS access administration is not enabled");
  }
  const code = args.searchParams.get("code") || "";
  const oauthState = args.searchParams.get("state") || "";
  if (!code || !oauthState) throw new Error("Missing Entra admin code or state");
  const session = await args.state.consumeOnce("oauth_states", oauthState);
  if (
    !session ||
    session.flow !== "entra_admin" ||
    session.upstream_provider !== "entra" ||
    typeof session.upstream_nonce !== "string" ||
    typeof session.upstream_code_verifier !== "string"
  ) {
    throw new Error("Admin authorization session expired");
  }
  const tokens = await exchangeEntraCode({
    code,
    redirectUri: entra.adminCallbackUrl,
    codeVerifier: session.upstream_code_verifier,
    config: args.config,
    admin: true,
  });
  if (!tokens.graphAccessToken) {
    throw new Error("Microsoft Graph did not return a delegated access token");
  }
  const identity = await validateEntraIdToken({
    idToken: tokens.idToken,
    nonce: session.upstream_nonce,
    config: args.config,
  });
  const roles = await (args.rolesForPrincipal || currentRolesForPrincipal)(identity);
  if (
    roles[runtimeBrainId()] !== "owner" ||
    identity.upstreamRole !== BRAIN_ROLE_TO_APP_ROLE.owner
  ) {
    throw new Error("A current Brain Owner grant is required");
  }
  return {
    identity,
    graphAccessToken: tokens.graphAccessToken,
    expiresIn: Math.max(60, Number(tokens.expiresIn || 60 * 60)),
  };
}

async function resolveEntraIdentity(args: {
  code: string;
  nonce: string;
  codeVerifier: string;
  config: OauthConfig;
}): Promise<EntraIdentity> {
  if (process.env.ENTRA_OAUTH_MOCK_OID) {
    const entra = requireEntra(args.config);
    const tenantId = (
      process.env.ENTRA_OAUTH_MOCK_TID || entra.tenantId
    ).toLowerCase();
    const objectId = process.env.ENTRA_OAUTH_MOCK_OID.toLowerCase();
    if (tenantId !== entra.tenantId || !GUID_RE.test(objectId)) {
      throw new Error("Mock Entra identity has an invalid tenant or object ID");
    }
    const appRole = process.env.ENTRA_OAUTH_MOCK_ROLE || "Brain.Reader";
    exactlyOneRecognizedRole([appRole]);
    return {
      provider: "entra",
      providerTenantId: tenantId,
      providerUserId: objectId,
      login: process.env.ENTRA_OAUTH_MOCK_LOGIN,
      email: process.env.ENTRA_OAUTH_MOCK_EMAIL,
      name: process.env.ENTRA_OAUTH_MOCK_NAME,
      upstreamRole: appRole,
    };
  }
  const entra = requireEntra(args.config);
  const tokens = await exchangeEntraCode({
    code: args.code,
    redirectUri: entra.callbackUrl,
    codeVerifier: args.codeVerifier,
    config: args.config,
  });
  return validateEntraIdToken({
    idToken: tokens.idToken,
    nonce: args.nonce,
    config: args.config,
  });
}

export async function handleEntraCallback(
  searchParams: URLSearchParams,
  config: OauthConfig,
  state: StateProvider,
  dependencies: {
    rolesForPrincipal?: typeof currentRolesForPrincipal;
  } = {}
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const code = searchParams.get("code") || "";
  const oauthState = searchParams.get("state") || "";
  if (!code || !oauthState) {
    return {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError("Missing Entra code or state."),
    };
  }
  const session = await state.consumeOnce("oauth_states", oauthState);
  if (
    !session ||
    session.upstream_provider !== "entra" ||
    session.flow === "entra_admin" ||
    typeof session.upstream_nonce !== "string" ||
    typeof session.upstream_code_verifier !== "string"
  ) {
    return {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError("OAuth session expired. Retry from your MCP client."),
    };
  }

  let identity: EntraIdentity;
  try {
    identity = await resolveEntraIdentity({
      code,
      nonce: session.upstream_nonce,
      codeVerifier: session.upstream_code_verifier,
      config,
    });
    const roles = await (dependencies.rolesForPrincipal || currentRolesForPrincipal)(
      identity
    );
    const brainRole = roles[runtimeBrainId()];
    if (!brainRole || BRAIN_ROLE_TO_APP_ROLE[brainRole] !== identity.upstreamRole) {
      throw new Error("Entra role is unassigned or inconsistent with the active Brain grant");
    }
  } catch (error) {
    return {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError(safeUpstreamError(error)),
    };
  }

  const authCode = generateAuthCode();
  const now = Math.floor(Date.now() / 1000);
  await state.put("auth_codes", authCode, {
    code: authCode,
    client_id: session.client_id,
    redirect_uri: session.redirect_uri,
    code_challenge: session.code_challenge,
    code_challenge_method: session.code_challenge_method,
    resource: session.resource,
    scope: session.scope,
    provider: "entra",
    provider_tenant_id: identity.providerTenantId,
    provider_user_id: identity.providerUserId,
    entra_role: identity.upstreamRole,
    login: identity.login || null,
    email: identity.email || null,
    name: identity.name || identity.login || null,
    created_at: now,
    expires_at: now + config.authCodeTtlSec,
  });

  const callback = new URL(session.redirect_uri);
  callback.searchParams.set("code", authCode);
  if (session.state) callback.searchParams.set("state", session.state);
  return { status: 302, headers: { Location: callback.toString() }, body: "" };
}

export function entraRoleForBrainRole(role: BrainRole): string {
  return BRAIN_ROLE_TO_APP_ROLE[role];
}
