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
      BRAIN_ID: "ai-brain-jem",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_OAUTH_STATE_STORE: undefined,
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
        oauthStateStore: "file",
        artifactByteAccess: "metadata_only",
        gitHotPath: "disabled",
        autoSyncEnabled: false,
      });
      assert.doesNotMatch(res.body, /test-secret|postgresql:\/\/example/);
    }
  );
});

test("health reports provider/admin posture and certificate warning without credential material", async () => {
  const res = new FakeResponse();
  await handleHttpRequest(
    { method: "GET", url: "/health", headers: {} },
    res,
    {
      ...ctx,
      config: {
        ...ctx.config,
        identityProviders: ["github", "entra"],
        identityDefaultProvider: "entra",
        entra: {
          clientCertificateExpiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        },
      },
      admin: {},
    }
  );
  const body = JSON.parse(res.body);
  assert.deepEqual(body.oauth.identity_providers, ["github", "entra"]);
  assert.equal(body.oauth.default_identity_provider, "entra");
  assert.equal(body.oauth.access_admin_enabled, true);
  assert.equal(body.oauth.entra_certificate.status, "warn");
  assert.doesNotMatch(res.body, /private.key|thumbprint|client.secret/i);
});

test("HTTP Postgres runtime requires Supabase artifact storage config", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ai-brain-jem",
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

test("HTTP Postgres OAuth state requires a database URL", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ai-brain-jem",
      BRAIN_OAUTH_STATE_STORE: "postgres",
      BRAIN_REVISION_STORE: undefined,
      BRAIN_REVISION_DATABASE_URL: undefined,
      BRAIN_ARTIFACT_STORE: undefined,
      BRAIN_SUPABASE_URL: undefined,
      BRAIN_SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      assert.throws(
        () => assertHttpRuntimeConfig(),
        /BRAIN_REVISION_DATABASE_URL/
      );
    }
  );
});

test("Entra HTTP identity requires Postgres revisions, OAuth state, and grant projection", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ers-brain",
      BRAIN_IDENTITY_PROVIDERS: "entra",
      BRAIN_REVISION_STORE: undefined,
      BRAIN_OAUTH_STATE_STORE: undefined,
      BRAIN_ACCESS_GRANT_STORE: undefined,
      BRAIN_REVISION_DATABASE_URL: undefined,
      BRAIN_ARTIFACT_STORE: undefined,
      ENTRA_ADMIN_GRAPH_ENABLED: undefined,
    },
    async () => {
      assert.throws(() => assertHttpRuntimeConfig(), /BRAIN_REVISION_STORE=postgres/);
    }
  );

  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ers-brain",
      BRAIN_IDENTITY_PROVIDERS: "entra",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_OAUTH_STATE_STORE: undefined,
      BRAIN_ACCESS_GRANT_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://example.invalid/postgres",
      BRAIN_ARTIFACT_STORE: "supabase",
      BRAIN_SUPABASE_URL: "https://example.supabase.co",
      ENTRA_ADMIN_GRAPH_ENABLED: undefined,
    },
    async () => {
      assert.throws(() => assertHttpRuntimeConfig(), /BRAIN_OAUTH_STATE_STORE=postgres/);
    }
  );
});

test("Graph access administration is deployment-bound to ERS", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ai-brain-jem",
      BRAIN_IDENTITY_PROVIDERS: "github",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_OAUTH_STATE_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://example.invalid/postgres",
      BRAIN_ARTIFACT_STORE: "supabase",
      BRAIN_SUPABASE_URL: "https://example.supabase.co",
      ENTRA_ADMIN_GRAPH_ENABLED: "1",
    },
    async () => {
      assert.throws(() => assertHttpRuntimeConfig(), /only for the ers-brain/);
    }
  );
});

test("HTTP Supabase artifact metadata runtime does not require service role key", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ai-brain-jem",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://example.invalid/postgres",
      BRAIN_ARTIFACT_STORE: "supabase",
      BRAIN_SUPABASE_URL: "https://example.supabase.co",
      BRAIN_SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      assert.doesNotThrow(() => assertHttpRuntimeConfig());
    }
  );
});

test("HTTP Supabase artifact admin byte access fails fast without service role key", async () => {
  await withEnv(
    {
      TRANSPORT: "http",
      BRAIN_ID: "ai-brain-jem",
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: undefined,
      BRAIN_ARTIFACT_STORE: "supabase",
      BRAIN_ARTIFACT_BYTE_ACCESS: "admin",
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

test("mcp timing logs omit request payloads when enabled", async () => {
  const messages = [];
  const oldLog = console.log;
  console.log = (...args) => {
    messages.push(args.join(" "));
  };
  try {
    await withEnv({ BRAIN_HTTP_TIMING_LOGS: "1" }, async () => {
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
      assert.equal(messages.length, 1);
      assert.match(messages[0], /mcp request completed/);
      assert.match(messages[0], /duration_ms/);
      assert.doesNotMatch(messages[0], /authorization|Bearer|jsonrpc|params/);
    });
  } finally {
    console.log = oldLog;
  }
});
