import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { type OauthConfig } from "../oauth/config.js";
import { verifyAccessToken } from "../oauth/jwt.js";

function extractBearerToken(authHeader?: string | null): string | null {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function wwwAuthenticateHeader(config: OauthConfig, reason: string): string {
  const escaped = reason.replace(/"/g, "'");
  return `Bearer realm="${config.resourceUri}", resource_metadata="${config.protectedResourceMetadataUrl}", error="invalid_token", error_description="${escaped}"`;
}

export function resolveAuth(
  authHeader: string | null | undefined,
  config: OauthConfig
): { ok: true; authInfo: AuthInfo } | { ok: false; reason: string } {
  const bearer = extractBearerToken(authHeader);
  if (!bearer) return { ok: false, reason: "missing Authorization: Bearer header" };

  const verified = verifyAccessToken(config, bearer);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  if (verified.payload.aud !== config.resourceUri) {
    return { ok: false, reason: "audience mismatch" };
  }

  return {
    ok: true,
    authInfo: {
      token: bearer,
      clientId: verified.payload.client_id,
      scopes: verified.payload.scope.split(/\s+/).filter(Boolean),
      expiresAt: verified.payload.exp,
      resource: new URL(verified.payload.aud),
      extra: {
        ...verified.payload,
        provider: verified.payload.provider,
        provider_user_id: verified.payload.provider_user_id,
        provider_tenant_id: verified.payload.provider_tenant_id,
        upstream_role: verified.payload.upstream_role,
        github_login: verified.payload.github_login,
        email: verified.payload.email,
        name: verified.payload.name,
      },
    },
  };
}
