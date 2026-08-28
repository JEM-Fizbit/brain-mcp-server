import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveAuth } = await import(
  path.join(__dirname, "..", "dist", "http", "mcp-auth.js")
);
const { issueAccessToken } = await import(
  path.join(__dirname, "..", "dist", "oauth", "jwt.js")
);

const config = {
  issuer: "https://brain.example.com",
  resourceUri: "https://brain.example.com/mcp",
  signingSecret: "test-signing-secret",
  identityProviders: ["entra"],
  accessTokenTtlSec: 3600,
};

function bearerFor(provider) {
  return issueAccessToken(config, {
    sub: `${provider}:123`,
    clientId: "mcp_client_test",
    scope: "mcp:tools",
    provider,
    providerUserId: "123",
  }).token;
}

test("Entra-only switch rejects an existing GitHub bearer token", () => {
  const result = resolveAuth(`Bearer ${bearerFor("github")}`, config);

  assert.deepEqual(result, {
    ok: false,
    reason: "identity provider is not enabled",
  });
});

test("enabled-provider bearer token remains valid", () => {
  const result = resolveAuth(`Bearer ${bearerFor("entra")}`, config);

  assert.equal(result.ok, true);
  assert.equal(result.authInfo.extra.provider, "entra");
});
