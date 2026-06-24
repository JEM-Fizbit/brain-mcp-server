import { isResourceMatch, normalizeResource, type OauthConfig } from "./config.js";
import { generateAuthCode, generateOauthState } from "./jwt.js";
import type { StateProvider } from "./state.js";
import { accessibleRoles, loadRegistry, type BrainPrincipal } from "../services/registry.js";

interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
}

interface GitHubIdentity {
  provider: "github";
  providerUserId: string;
  login: string;
  email?: string;
  name?: string;
}

function htmlError(message: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Brain OAuth Error</title><body><h1>Authorization failed</h1><p>${message.replace(/</g, "&lt;")}</p></body></html>`;
}

function redirectError(redirectUri: string, state: string, error: string, description: string): string {
  const callback = new URL(redirectUri);
  callback.searchParams.set("error", error);
  callback.searchParams.set("error_description", description);
  if (state) callback.searchParams.set("state", state);
  return callback.toString();
}

async function validateAuthorizeParams(
  params: AuthorizeParams,
  config: OauthConfig,
  state: StateProvider
): Promise<
  | { ok: true; client: any; scopes: string[]; resource: string }
  | { ok: false; fatal?: boolean; error: string; description: string }
> {
  if (!params.client_id) {
    return { ok: false, fatal: true, error: "invalid_request", description: "client_id is required" };
  }
  const client = await state.get("clients", params.client_id);
  if (!client) {
    return { ok: false, fatal: true, error: "invalid_client", description: "unknown client_id" };
  }
  if (!params.redirect_uri || !client.redirect_uris.includes(params.redirect_uri)) {
    return { ok: false, fatal: true, error: "invalid_request", description: "redirect_uri is not registered for this client" };
  }
  if (params.response_type !== "code") {
    return { ok: false, error: "unsupported_response_type", description: "response_type must be code" };
  }
  if (params.code_challenge_method !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(params.code_challenge)) {
    return { ok: false, error: "invalid_request", description: "PKCE S256 code_challenge is required" };
  }
  const effectiveResource = params.resource || config.resourceUri;
  const normalizedResource = normalizeResource(effectiveResource);
  if (!normalizedResource || !isResourceMatch(effectiveResource, config.resourceUri)) {
    return { ok: false, error: "invalid_target", description: "resource does not match this server" };
  }

  const scopes = params.scope.split(/\s+/).filter(Boolean);
  for (const scope of scopes) {
    if (!config.scopes.includes(scope)) {
      return { ok: false, error: "invalid_scope", description: `unsupported scope: ${scope}` };
    }
  }
  return { ok: true, client, scopes, resource: normalizedResource };
}

export async function handleAuthorizeGet(
  searchParams: URLSearchParams,
  config: OauthConfig,
  state: StateProvider
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const params: AuthorizeParams = {
    response_type: searchParams.get("response_type") || "",
    client_id: searchParams.get("client_id") || "",
    redirect_uri: searchParams.get("redirect_uri") || "",
    scope: searchParams.get("scope") || config.scopes.join(" "),
    state: searchParams.get("state") || "",
    code_challenge: searchParams.get("code_challenge") || "",
    code_challenge_method: searchParams.get("code_challenge_method") || "",
    resource: searchParams.get("resource") || "",
  };

  const validation = await validateAuthorizeParams(params, config, state);
  if (!validation.ok) {
    if (validation.fatal) {
      return {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: htmlError(`${validation.error}: ${validation.description}`),
      };
    }
    return {
      status: 302,
      headers: {
        Location: redirectError(params.redirect_uri, params.state, validation.error, validation.description),
      },
      body: "",
    };
  }

  const oauthState = generateOauthState();
  const now = Math.floor(Date.now() / 1000);
  await state.put("oauth_states", oauthState, {
    ...params,
    resource: validation.resource,
    created_at: now,
    expires_at: now + config.oauthStateTtlSec,
  });

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", config.githubClientId);
  githubUrl.searchParams.set("redirect_uri", config.githubCallbackUrl);
  githubUrl.searchParams.set("scope", "read:user user:email");
  githubUrl.searchParams.set("state", oauthState);
  githubUrl.searchParams.set("allow_signup", "false");

  return {
    status: 302,
    headers: { Location: githubUrl.toString() },
    body: "",
  };
}

async function exchangeGitHubCode(code: string, config: OauthConfig): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "brain-mcp-server",
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: config.githubCallbackUrl,
    }),
  });
  const json = await response.json() as any;
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "GitHub token exchange failed");
  }
  return json.access_token;
}

async function fetchGitHubJson(url: string, token: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "brain-mcp-server",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status}`);
  }
  return response.json();
}

async function resolveGitHubIdentity(code: string, config: OauthConfig): Promise<GitHubIdentity> {
  if (process.env.GITHUB_OAUTH_MOCK_LOGIN) {
    return {
      provider: "github",
      providerUserId: process.env.GITHUB_OAUTH_MOCK_ID || "1",
      login: process.env.GITHUB_OAUTH_MOCK_LOGIN,
      email: process.env.GITHUB_OAUTH_MOCK_EMAIL,
      name: process.env.GITHUB_OAUTH_MOCK_NAME || process.env.GITHUB_OAUTH_MOCK_LOGIN,
    };
  }

  const token = await exchangeGitHubCode(code, config);
  const user = await fetchGitHubJson("https://api.github.com/user", token);
  const emails = await fetchGitHubJson("https://api.github.com/user/emails", token);
  const bestEmail = Array.isArray(emails)
    ? emails.find((email) => email.primary && email.verified)?.email ||
      emails.find((email) => email.verified)?.email
    : undefined;

  return {
    provider: "github",
    providerUserId: String(user.id),
    login: user.login,
    email: bestEmail || user.email || undefined,
    name: user.name || user.login,
  };
}

export async function handleGitHubCallback(
  searchParams: URLSearchParams,
  config: OauthConfig,
  state: StateProvider
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const code = searchParams.get("code") || "";
  const oauthState = searchParams.get("state") || "";
  if (!code || !oauthState) {
    return {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError("Missing GitHub code or state."),
    };
  }

  const session = await state.consumeOnce("oauth_states", oauthState);
  if (!session) {
    return {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError("OAuth session expired. Retry from your MCP client."),
    };
  }

  let identity: GitHubIdentity;
  try {
    identity = await resolveGitHubIdentity(code, config);
  } catch (error: any) {
    return {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError(error.message),
    };
  }

  const principal: BrainPrincipal = {
    provider: "github",
    providerUserId: identity.providerUserId,
    login: identity.login,
    email: identity.email,
    name: identity.name,
  };

  const registry = await loadRegistry();
  const roles = accessibleRoles(registry, principal);
  if (Object.keys(roles).length === 0) {
    return {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: htmlError(`GitHub user ${identity.login} is not allowed to access this Brain server.`),
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
    provider: "github",
    provider_user_id: identity.providerUserId,
    github_login: identity.login,
    email: identity.email || null,
    name: identity.name || identity.login,
    created_at: now,
    expires_at: now + config.authCodeTtlSec,
  });

  const callback = new URL(session.redirect_uri);
  callback.searchParams.set("code", authCode);
  if (session.state) callback.searchParams.set("state", session.state);

  return {
    status: 302,
    headers: { Location: callback.toString() },
    body: "",
  };
}
