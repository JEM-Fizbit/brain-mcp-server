import { isResourceMatch, type OauthConfig } from "./config.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  issueAccessToken,
} from "./jwt.js";
import { verifyChallenge } from "./pkce.js";
import type { StateProvider } from "./state.js";
import { constantTimeEqual } from "./crypto.js";

function error(
  error: string,
  error_description: string,
  status = 400
): { status: number; body: any } {
  return { status, body: { error, error_description } };
}

function parseBasicAuth(header?: string | null): { client_id: string; client_secret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    return {
      client_id: decoded.slice(0, colon),
      client_secret: decoded.slice(colon + 1),
    };
  } catch {
    return null;
  }
}

async function authenticateClient(
  form: URLSearchParams,
  authHeader: string | null | undefined,
  state: StateProvider
): Promise<{ client: any } | { response: { status: number; body: any } }> {
  const basic = parseBasicAuth(authHeader);
  const clientId = basic?.client_id || form.get("client_id") || "";
  if (!clientId) return { response: error("invalid_client", "missing client_id", 401) };

  const client = await state.get("clients", clientId);
  if (!client) return { response: error("invalid_client", "unknown client_id", 401) };
  if (client.token_endpoint_auth_method === "none") return { client };

  const submitted = basic?.client_secret || form.get("client_secret") || "";
  if (!constantTimeEqual(submitted, client.client_secret || "")) {
    return { response: error("invalid_client", "client authentication failed", 401) };
  }
  return { client };
}

async function authorizationCodeGrant(
  form: URLSearchParams,
  client: any,
  config: OauthConfig,
  state: StateProvider
): Promise<{ status: number; body: any }> {
  const code = form.get("code") || "";
  const redirectUri = form.get("redirect_uri") || "";
  const verifier = form.get("code_verifier") || "";
  const requestedResource = form.get("resource") || "";

  if (!code) return error("invalid_request", "code is required");
  if (!redirectUri) return error("invalid_request", "redirect_uri is required");
  if (!verifier) return error("invalid_request", "code_verifier is required");

  const record = await state.consumeOnce("auth_codes", code);
  if (!record) return error("invalid_grant", "authorization code expired or unknown");
  if (record.client_id !== client.client_id) {
    return error("invalid_grant", "authorization code was not issued to this client");
  }
  if (record.redirect_uri !== redirectUri) {
    return error("invalid_grant", "redirect_uri mismatch");
  }
  if (
    !verifyChallenge({
      verifier,
      challenge: record.code_challenge,
      method: record.code_challenge_method,
    })
  ) {
    return error("invalid_grant", "PKCE verification failed");
  }

  const effectiveResource = requestedResource || record.resource || "";
  if (!effectiveResource) return error("invalid_target", "resource is required");
  if (requestedResource && !isResourceMatch(requestedResource, record.resource)) {
    return error("invalid_target", "resource does not match the audience bound at /authorize");
  }
  if (!isResourceMatch(effectiveResource, config.resourceUri)) {
    return error("invalid_target", "resource does not match this server's canonical URI");
  }

  const { token } = issueAccessToken(config, {
    sub: `${record.provider}:${record.provider_user_id}`,
    clientId: client.client_id,
    scope: record.scope,
    provider: record.provider,
    providerUserId: record.provider_user_id,
    githubLogin: record.github_login,
    email: record.email || undefined,
    name: record.name || undefined,
  });

  const refreshToken = generateRefreshToken();
  const now = Math.floor(Date.now() / 1000);
  await state.put("refresh_tokens", hashRefreshToken(refreshToken), {
    client_id: client.client_id,
    provider: record.provider,
    provider_user_id: record.provider_user_id,
    github_login: record.github_login,
    email: record.email || null,
    name: record.name || null,
    scope: record.scope,
    resource: record.resource,
    created_at: now,
    expires_at: now + config.refreshTokenTtlSec,
    last_used_at: now,
  });

  return {
    status: 200,
    body: {
      access_token: token,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSec,
      refresh_token: refreshToken,
      scope: record.scope,
    },
  };
}

async function refreshTokenGrant(
  form: URLSearchParams,
  client: any,
  config: OauthConfig,
  state: StateProvider
): Promise<{ status: number; body: any }> {
  const submitted = form.get("refresh_token") || "";
  if (!submitted) return error("invalid_request", "refresh_token is required");

  const hash = hashRefreshToken(submitted);
  const record = await state.consumeOnce("refresh_tokens", hash);
  if (!record) return error("invalid_grant", "refresh_token expired or unknown");
  if (record.client_id !== client.client_id) {
    return error("invalid_grant", "refresh_token was not issued to this client");
  }
  const resource = form.get("resource") || "";
  if (resource && !isResourceMatch(resource, record.resource)) {
    return error("invalid_target", "resource does not match original grant");
  }

  const { token } = issueAccessToken(config, {
    sub: `${record.provider}:${record.provider_user_id}`,
    clientId: client.client_id,
    scope: record.scope,
    provider: record.provider,
    providerUserId: record.provider_user_id,
    githubLogin: record.github_login,
    email: record.email || undefined,
    name: record.name || undefined,
  });

  const newRefresh = generateRefreshToken();
  const now = Math.floor(Date.now() / 1000);
  await state.put("refresh_tokens", hashRefreshToken(newRefresh), {
    ...record,
    expires_at: now + config.refreshTokenTtlSec,
    last_used_at: now,
    rotated_from: hash.slice(0, 8),
  });

  return {
    status: 200,
    body: {
      access_token: token,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSec,
      refresh_token: newRefresh,
      scope: record.scope,
    },
  };
}

export async function handleToken(
  form: URLSearchParams,
  authHeader: string | null | undefined,
  config: OauthConfig,
  state: StateProvider
): Promise<{ status: number; body: any }> {
  const auth = await authenticateClient(form, authHeader, state);
  if ("response" in auth) return auth.response;

  const grantType = form.get("grant_type") || "";
  if (grantType === "authorization_code") {
    return authorizationCodeGrant(form, auth.client, config, state);
  }
  if (grantType === "refresh_token") {
    return refreshTokenGrant(form, auth.client, config, state);
  }
  return error("unsupported_grant_type", `grant_type '${grantType}' is not supported`);
}
