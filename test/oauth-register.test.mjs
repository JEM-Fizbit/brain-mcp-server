import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { isAllowedRedirectUri } = await import(
  path.join(__dirname, "..", "dist", "oauth", "config.js")
);
const { handleRegister } = await import(
  path.join(__dirname, "..", "dist", "oauth", "register.js")
);

const config = {
  allowedRedirectUris: ["https://example.com/callback"],
  scopes: ["mcp:tools"],
};

function makeState() {
  const stores = new Map();
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

test("redirect allowlist accepts documented ChatGPT connector callback path", () => {
  assert.equal(
    isAllowedRedirectUri(config, "https://chatgpt.com/connector/oauth/callback-123"),
    true
  );
  assert.equal(
    isAllowedRedirectUri(config, "https://chatgpt.com/connector_platform_oauth_redirect"),
    true
  );
});

test("redirect allowlist keeps ChatGPT callback trust narrow", () => {
  assert.equal(
    isAllowedRedirectUri(config, "https://chatgpt.com.evil.example/connector/oauth/callback-123"),
    false
  );
  assert.equal(
    isAllowedRedirectUri(config, "https://chatgpt.com/connector/oauth/callback-123/extra"),
    false
  );
  assert.equal(
    isAllowedRedirectUri(config, "https://chatgpt.com/connector/oauth/callback-123?next=https://evil.example"),
    false
  );
  assert.equal(
    isAllowedRedirectUri(config, "http://chatgpt.com/connector/oauth/callback-123"),
    false
  );
});

test("dynamic client registration accepts ChatGPT connector callbacks", async () => {
  const state = makeState();
  const result = await handleRegister(
    JSON.stringify({
      redirect_uris: ["https://chatgpt.com/connector/oauth/callback-123"],
      client_name: "ChatGPT",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp:tools",
    }),
    config,
    state
  );

  assert.equal(result.status, 201);
  assert.match(result.body.client_id, /^mcp_client_/);
  assert.deepEqual(result.body.redirect_uris, [
    "https://chatgpt.com/connector/oauth/callback-123",
  ]);
  assert.equal(result.body.client_secret, undefined);

  const stored = await state.get("clients", result.body.client_id);
  assert.equal(stored.client_id, result.body.client_id);
  assert.equal(stored.token_endpoint_auth_method, "none");
});
