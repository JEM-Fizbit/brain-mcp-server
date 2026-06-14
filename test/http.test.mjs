import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { handleHttpRequest } = await import(
  path.join(__dirname, "..", "dist", "http", "server.js")
);
const { assertHttpRuntimeConfig } = await import(
  path.join(__dirname, "..", "dist", "services", "runtime-config.js")
);

function memoryState() {
  return {
    async get() {
      return null;
    },
    async put(_store, _key, value) {
      return value;
    },
    async del() {
      return false;
    },
    async consumeOnce() {
      return null;
    },
    async listAll() {
      return {};
    },
  };
}

const ctx = {
  config: {
    issuer: "http://127.0.0.1",
    resourceUri: "http://127.0.0.1/mcp",
    authorizationEndpoint: "http://127.0.0.1/authorize",
    tokenEndpoint: "http://127.0.0.1/token",
    registrationEndpoint: "http://127.0.0.1/register",
    protectedResourceMetadataUrl:
      "http://127.0.0.1/.well-known/oauth-protected-resource/mcp",
    authorizationServerMetadataUrl:
      "http://127.0.0.1/.well-known/oauth-authorization-server",
    scopes: ["mcp:tools"],
    signingSecret: "test",
  },
  state: memoryState(),
};

class FakeResponse {
  headersSent = false;
  status = null;
  headers = {};
  body = "";

  writeHead(status, headers = {}) {
    this.status = status;
    this.headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    );
    this.headersSent = true;
  }

  end(body = "") {
    this.body = String(body);
  }
}

function withEnv(overrides, callback) {
  const old = {};
  for (const key of Object.keys(overrides)) old[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

test("health reports non-secret runtime store modes", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://example.invalid/postgres",
      BRAIN_ARTIFACT_STORE: "supabase",
      BRAIN_SUPABASE_URL: "https://example.supabase.co",
      BRAIN_SUPABASE_SERVICE_ROLE_KEY: "test-secret",
    },
    async () => {
      const res = new FakeResponse();
      await handleHttpRequest(
        {
          method: "GET",
          url: "/health",
          headers: {},
        },
        res,
        ctx
      );

      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.deepEqual(body.runtime, {
        transport: "http",
        revisionStore: "postgres",
        artifactStore: "supabase",
        gitHotPath: "disabled",
        autoSyncEnabled: false,
      });
      assert.doesNotMatch(res.body, /test-secret|postgresql:\/\/example/);
    }
  );
});

test("HTTP Postgres runtime requires Supabase artifact storage config", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://example.invalid/postgres",
      BRAIN_ARTIFACT_STORE: undefined,
      BRAIN_SUPABASE_URL: undefined,
      BRAIN_SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      assert.throws(
        () => assertHttpRuntimeConfig(),
        /BRAIN_ARTIFACT_STORE=supabase/
      );
    }
  );
});

test("HTTP Supabase artifact runtime fails fast on missing server-side secrets", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: undefined,
      BRAIN_ARTIFACT_STORE: "supabase",
      BRAIN_SUPABASE_URL: "https://example.supabase.co",
      BRAIN_SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      assert.throws(
        () => assertHttpRuntimeConfig(),
        /BRAIN_REVISION_DATABASE_URL, BRAIN_SUPABASE_SERVICE_ROLE_KEY/
      );
    }
  );
});

test("well-known protected resource metadata advertises OAuth server", async () => {
  const res = new FakeResponse();
  await handleHttpRequest(
    {
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp",
      headers: {},
    },
    res,
    ctx
  );

  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.resource, "http://127.0.0.1/mcp");
  assert.deepEqual(body.authorization_servers, ["http://127.0.0.1"]);
});

test("unauthenticated mcp request returns bearer challenge", async () => {
  const res = new FakeResponse();
  await handleHttpRequest(
    {
      method: "POST",
      url: "/mcp",
      headers: {},
    },
    res,
    ctx
  );

  assert.equal(res.status, 401);
  assert.match(
    res.headers["www-authenticate"] || "",
    /resource_metadata="http:\/\/127\.0\.0\.1\/\.well-known\/oauth-protected-resource\/mcp"/
  );
});
