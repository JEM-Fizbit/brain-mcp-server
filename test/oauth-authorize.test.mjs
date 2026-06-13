import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { handleAuthorizeGet } = await import(
  path.join(__dirname, "..", "dist", "oauth", "github.js")
);

const RESOURCE_URI = "https://brain.example.com/mcp";
const REDIRECT_URI = "http://127.0.0.1:58844/callback/test";
const CLIENT_ID = "mcp_client_test";
const CODE_CHALLENGE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

const config = {
  issuer: "https://brain.example.com",
  resourceUri: RESOURCE_URI,
  scopes: ["mcp:tools"],
  githubClientId: "github-client-id",
  githubCallbackUrl: "https://brain.example.com/authorize/github/callback",
  oauthStateTtlSec: 600,
};

function makeState() {
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
    ["auth_codes", new Map()],
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

function authorizeParams(overrides = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "mcp:tools",
    state: "client-state",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    ...overrides,
  });
}

test("authorize defaults omitted resource to the canonical MCP resource", async () => {
  const state = makeState();
  const result = await handleAuthorizeGet(authorizeParams(), config, state);

  assert.equal(result.status, 302);
  const location = new URL(result.headers.Location);
  assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "github-client-id");
  assert.equal(
    location.searchParams.get("redirect_uri"),
    "https://brain.example.com/authorize/github/callback"
  );

  const oauthState = location.searchParams.get("state");
  assert.ok(oauthState);
  const session = await state.get("oauth_states", oauthState);
  assert.equal(session.resource, RESOURCE_URI);
  assert.equal(session.client_id, CLIENT_ID);
});

test("authorize still rejects an explicit resource mismatch", async () => {
  const state = makeState();
  const result = await handleAuthorizeGet(
    authorizeParams({ resource: "https://wrong.example.com/mcp" }),
    config,
    state
  );

  assert.equal(result.status, 302);
  const location = new URL(result.headers.Location);
  assert.equal(location.searchParams.get("error"), "invalid_target");
});
