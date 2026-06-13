import { isAllowedRedirectUri, type OauthConfig } from "./config.js";
import {
  generateClientId,
  generateClientSecret,
} from "./jwt.js";
import type { StateProvider } from "./state.js";

const ALLOWED_GRANT_TYPES = ["authorization_code", "refresh_token"];
const ALLOWED_RESPONSE_TYPES = ["code"];
const ALLOWED_AUTH_METHODS = ["client_secret_basic", "client_secret_post", "none"];

function error(error: string, error_description: string): { status: number; body: any } {
  return { status: 400, body: { error, error_description } };
}

export async function handleRegister(
  body: string,
  config: OauthConfig,
  state: StateProvider
): Promise<{ status: number; body: any }> {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch (err: any) {
    return error("invalid_client_metadata", `body is not valid JSON: ${err.message}`);
  }

  const redirectUris = parsed.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return error("invalid_redirect_uri", "redirect_uris must be a non-empty array");
  }
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(config, uri)) {
      return error("invalid_redirect_uri", `redirect_uri not in server allowlist: ${uri}`);
    }
  }

  const grantTypes = parsed.grant_types || ["authorization_code"];
  for (const grant of grantTypes) {
    if (!ALLOWED_GRANT_TYPES.includes(grant)) {
      return error("invalid_client_metadata", `grant_type not supported: ${grant}`);
    }
  }

  const responseTypes = parsed.response_types || ["code"];
  for (const response of responseTypes) {
    if (!ALLOWED_RESPONSE_TYPES.includes(response)) {
      return error("invalid_client_metadata", `response_type not supported: ${response}`);
    }
  }

  const authMethod = parsed.token_endpoint_auth_method || "client_secret_basic";
  if (!ALLOWED_AUTH_METHODS.includes(authMethod)) {
    return error(
      "invalid_client_metadata",
      `token_endpoint_auth_method not supported: ${authMethod}`
    );
  }

  const clientId = generateClientId();
  const isConfidential = authMethod !== "none";
  const record = {
    client_id: clientId,
    client_secret: isConfidential ? generateClientSecret() : null,
    redirect_uris: redirectUris,
    client_name: parsed.client_name || null,
    token_endpoint_auth_method: authMethod,
    grant_types: grantTypes,
    response_types: responseTypes,
    scope: parsed.scope || config.scopes.join(" "),
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };

  await state.put("clients", clientId, record);
  const response: any = { ...record };
  if (!isConfidential) delete response.client_secret;
  return { status: 201, body: response };
}
