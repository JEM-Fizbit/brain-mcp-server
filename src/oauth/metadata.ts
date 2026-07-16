import type { OauthConfig } from "./config.js";

export function protectedResourceMetadata(config: OauthConfig): Record<string, unknown> {
  return {
    resource: config.resourceUri,
    authorization_servers: [config.issuer],
    scopes_supported: config.scopes,
    bearer_methods_supported: ["header"],
    resource_documentation: config.documentationUrl,
  };
}

export function authorizationServerMetadata(config: OauthConfig): Record<string, unknown> {
  return {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    registration_endpoint: config.registrationEndpoint,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: config.scopes,
    service_documentation: config.documentationUrl,
  };
}
