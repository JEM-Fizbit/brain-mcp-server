import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { handleAuthorizeGet, handleGitHubCallback } = await import(
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
  githubClientSecret: "github-client-secret",
  githubCallbackUrl: "https://brain.example.com/authorize/github/callback",
  oauthStateTtlSec: 600,
  authCodeTtlSec: 300,
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

function setEnv(updates) {
  const previous = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
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

test("github callback allows a registered principal with access to multiple brains", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-oauth-registry-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const registryFile = path.join(tempDir, "registry.json");
  await fs.writeFile(
    registryFile,
    JSON.stringify(
      {
        version: 1,
        default_brain_id: "ai-brain-jem",
        brains: [
          {
            id: "ai-brain-jem",
            type: "personal",
            template_used: "personal",
            integration_mode: "vertical",
            storage_backend: "postgres",
            storage_config: {},
          },
          {
            id: "ers-brain",
            type: "shared",
            template_used: "ers",
            integration_mode: "hybrid",
            storage_backend: "postgres",
            storage_config: {},
          },
        ],
        principals: [
          {
            provider: "github",
            provider_user_id: "220941196",
            login: "johnemilad",
            roles: {
              "ai-brain-jem": "owner",
              "ers-brain": "owner",
            },
          },
        ],
      },
      null,
      2
    )
  );

  const state = makeState();
  await state.put("oauth_states", "oauth-state", {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    resource: RESOURCE_URI,
    scope: "mcp:tools",
    state: "client-state",
  });

  const restoreEnv = setEnv({
    BRAIN_PLATFORM_CONFIG: registryFile,
    GITHUB_OAUTH_MOCK_ID: "220941196",
    GITHUB_OAUTH_MOCK_LOGIN: "JEM-Fizbit",
    GITHUB_OAUTH_MOCK_EMAIL: "johnemilad@hotmail.com",
  });

  try {
    const result = await handleGitHubCallback(
      new URLSearchParams({ code: "mock-code", state: "oauth-state" }),
      config,
      state
    );

    assert.equal(result.status, 302);
    const location = new URL(result.headers.Location);
    assert.equal(location.origin + location.pathname, REDIRECT_URI);
    assert.equal(location.searchParams.get("state"), "client-state");
    assert.ok(location.searchParams.get("code"));

    const authCodes = await state.listAll("auth_codes");
    const [authCode] = Object.values(authCodes);
    assert.equal(authCode.provider_user_id, "220941196");
    assert.equal(authCode.github_login, "JEM-Fizbit");
  } finally {
    restoreEnv();
  }
});
