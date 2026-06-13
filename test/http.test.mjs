import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { handleHttpRequest } = await import(
  path.join(__dirname, "..", "dist", "http", "server.js")
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
