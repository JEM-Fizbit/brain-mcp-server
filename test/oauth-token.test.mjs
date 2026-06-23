import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { handleToken } = await import(
  path.join(__dirname, "..", "dist", "oauth", "token.js")
);
const { sha256Base64url } = await import(
  path.join(__dirname, "..", "dist", "oauth", "crypto.js")
);
const { verifyAccessToken } = await import(
  path.join(__dirname, "..", "dist", "oauth", "jwt.js")
);

const RESOURCE_URI = "https://brain.example.com/mcp";
const REDIRECT_URI = "http://127.0.0.1:55574/callback/test";
const CLIENT_ID = "mcp_client_test";
const VERIFIER = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

const config = {
  issuer: "https://brain.example.com",
  resourceUri: RESOURCE_URI,
  accessTokenTtlSec: 3600,
  refreshTokenTtlSec: 30 * 24 * 60 * 60,
  refreshTokenReuseGraceSec: 0,
  signingSecret: "test-signing-secret",
};

function makeState(authCodeRecord) {
  const stores = new Map([
    [
      "clients",
      new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            token_endpoint_auth_method: "none",
            redirect_uris: [REDIRECT_URI],
          },
        ],
      ]),
    ],
    ["auth_codes", new Map([["auth-code-1", authCodeRecord]])],
    ["refresh_tokens", new Map()],
    ["oauth_states", new Map()],
  ]);

  const mapFor = (store) => {
    if (!stores.has(store)) stores.set(store, new Map());
    return stores.get(store);
  };

  return {
    async get(store, key) {
      return mapFor(store).get(key) || null;
    },
    async put(store, key, value) {
      mapFor(store).set(key, value);
      return value;
    },
    async del(store, key) {
      return mapFor(store).delete(key);
    },
    async consumeOnce(store, key) {
      const map = mapFor(store);
      const value = map.get(key) || null;
      if (value) map.delete(key);
      return value;
    },
    async listAll(store) {
      return Object.fromEntries(mapFor(store));
    },
  };
}

async function exchange({ tokenResource, recordResource = RESOURCE_URI } = {}) {
  const record = {
    code: "auth-code-1",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: sha256Base64url(VERIFIER),
    code_challenge_method: "S256",
    resource: recordResource,
    scope: "mcp:tools",
    provider: "github",
    provider_user_id: "123",
    github_login: "johnemilad",
    email: "johnemilad@hotmail.com",
    name: "John Milad",
    created_at: 0,
    expires_at: Math.floor(Date.now() / 1000) + 600,
  };
  const state = makeState(record);
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", CLIENT_ID);
  form.set("code", "auth-code-1");
  form.set("redirect_uri", REDIRECT_URI);
  form.set("code_verifier", VERIFIER);
  if (tokenResource !== undefined) form.set("resource", tokenResource);

  return {
    result: await handleToken(form, null, config, state),
    state,
  };
}

test("authorization_code exchange accepts auth-code-bound resource when token resource is omitted", async () => {
  const { result } = await exchange();

  assert.equal(result.status, 200);
  assert.equal(result.body.token_type, "Bearer");

  const verified = verifyAccessToken(config, result.body.access_token);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.aud, RESOURCE_URI);
  assert.equal(verified.payload.github_login, "johnemilad");
  assert.equal(verified.payload.email, "johnemilad@hotmail.com");
});

test("authorization_code exchange rejects explicit resource mismatch", async () => {
  const { result } = await exchange({ tokenResource: "https://example.com/mcp" });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_target");
});

test("refresh token rotates and cannot be reused", async () => {
  const { result, state } = await exchange();
  const refresh = result.body.refresh_token;

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", CLIENT_ID);
  form.set("refresh_token", refresh);

  const first = await handleToken(form, null, config, state);
  assert.equal(first.status, 200);
  assert.notEqual(first.body.refresh_token, refresh);

  const second = await handleToken(form, null, config, state);
  assert.equal(second.status, 400);
  assert.equal(second.body.error, "invalid_grant");
});

test("refresh token can be retried inside configured reuse grace", async () => {
  const { result, state } = await exchange();
  const refresh = result.body.refresh_token;
  const graceConfig = { ...config, refreshTokenReuseGraceSec: 15 };

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", CLIENT_ID);
  form.set("refresh_token", refresh);

  const first = await handleToken(form, null, graceConfig, state);
  assert.equal(first.status, 200);
  assert.notEqual(first.body.refresh_token, refresh);

  const second = await handleToken(form, null, graceConfig, state);
  assert.equal(second.status, 200);
  assert.notEqual(second.body.refresh_token, refresh);
  assert.notEqual(second.body.refresh_token, first.body.refresh_token);
});
