import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { handleHttpRequest } from "../dist/http/server.js";
import { issueAccessToken } from "../dist/oauth/jwt.js";
import { assertHttpRuntimeConfig } from "../dist/services/runtime-config.js";

process.env.TRANSPORT = "http";
process.env.BRAIN_REVISION_STORE = "postgres";

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const baseUrl = process.env.BRAIN_HTTP_SMOKE_BASE_URL || "http://127.0.0.1:3000";
const resourceUri = `${baseUrl}/mcp`;
const config = {
  issuer: baseUrl,
  resourceUri,
  authorizationEndpoint: `${baseUrl}/authorize`,
  tokenEndpoint: `${baseUrl}/token`,
  registrationEndpoint: `${baseUrl}/register`,
  protectedResourceMetadataUrl:
    `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
  authorizationServerMetadataUrl:
    `${baseUrl}/.well-known/oauth-authorization-server`,
  scopes: ["mcp:tools"],
  signingSecret: process.env.MCP_OAUTH_SIGNING_SECRET || "smoke-local-only",
  accessTokenTtlSec: 600,
};

class FakeResponse extends Writable {
  headersSent = false;
  statusCode = 200;
  headers = {};
  chunks = [];

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  writeHead(status, reasonOrHeaders = {}, maybeHeaders = {}) {
    this.statusCode = status;
    const headers =
      typeof reasonOrHeaders === "string" ? maybeHeaders : reasonOrHeaders;
    for (const [key, value] of Object.entries(headers || {})) {
      this.setHeader(key, value);
    }
    this.headersSent = true;
    return this;
  }

  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  }

  getHeader(key) {
    return this.headers[key.toLowerCase()];
  }

  getHeaders() {
    return this.headers;
  }

  hasHeader(key) {
    return key.toLowerCase() in this.headers;
  }

  removeHeader(key) {
    delete this.headers[key.toLowerCase()];
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf-8");
  }
}

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

const token = issueAccessToken(config, {
  sub: "system:hosted-runtime-smoke",
  clientId: "hosted-runtime-smoke",
  scope: "mcp:tools",
  provider: "system",
  providerUserId: "hosted-runtime-smoke",
  name: "Hosted Runtime Smoke",
}).token;

async function request(method, url, body) {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    host: new URL(baseUrl).host,
    ...(rawBody
      ? {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(rawBody)),
          accept: "application/json, text/event-stream",
        }
      : {}),
  };
  req.rawHeaders = Object.entries(req.headers).flat();

  const res = new FakeResponse();
  await handleHttpRequest(req, res, { config, state: memoryState() });
  return res;
}

async function callTool(name, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const rawBody = JSON.stringify(body);
  const req = Readable.from([Buffer.from(rawBody)]);
  req.method = "POST";
  req.url = "/mcp";
  req.headers = {
    host: new URL(baseUrl).host,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(rawBody)),
    accept: "application/json, text/event-stream",
  };
  req.rawHeaders = Object.entries(req.headers).flat();

  const res = new FakeResponse();
  await handleHttpRequest(req, res, { config, state: memoryState() });
  const responseText = res.text();
  assert.equal(res.statusCode, 200, responseText);
  const dataLine = responseText
    .split("\n")
    .find((line) => line.startsWith("data: "));
  assert.ok(dataLine, responseText);
  const message = JSON.parse(dataLine.slice("data: ".length));
  if (message.error) throw new Error(message.error.message);
  const text = message.result.content.map((part) => part.text).join("\n");
  if (message.result.isError) throw new Error(text);
  return text;
}

function firstSearchableToken(content) {
  const ignored = new Set(["file", "table", "with", "from", "this", "that"]);
  for (const match of content.matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g)) {
    const token = match[0];
    if (!ignored.has(token.toLowerCase())) return token;
  }
  throw new Error("Could not derive a search token from 00_loader.md");
}

assertHttpRuntimeConfig();

const health = await request("GET", "/health");
assert.equal(health.statusCode, 200, health.text());
const healthBody = JSON.parse(health.text());
assert.equal(healthBody.runtime.revisionStore, "postgres");
assert.equal(healthBody.runtime.artifactStore, "supabase");
assert.equal(healthBody.runtime.gitHotPath, "disabled");
assert.doesNotMatch(health.text(), /postgresql:\/\/|sb_secret_|service_role/i);

const files = await callTool("brain_list_files", { brain_id: brainId });
assert.match(files, /Revision store: Postgres/);
assert.match(files, /00_loader\.md/);

const loader = await callTool("brain_read_file", {
  brain_id: brainId,
  filename: "00_loader.md",
});
const query = process.env.BRAIN_HTTP_SMOKE_QUERY || firstSearchableToken(loader);
const search = await callTool("brain_search", {
  brain_id: brainId,
  query,
  max_results: 5,
});
assert.doesNotEqual(search, "No matches found.");

const sources = await callTool("brain_list_sources", { brain_id: brainId });
if (process.env.BRAIN_HTTP_SMOKE_EXPECT_SOURCES !== "0") {
  assert.match(sources, /All sources:/);
}

let writeStatus = "skipped";
if (process.env.BRAIN_HTTP_SMOKE_WRITE === "1") {
  const filename = process.env.BRAIN_HTTP_SMOKE_WRITE_FILE || "HOSTED_RUNTIME_SMOKE.md";
  const content = [
    "# Hosted Runtime Smoke",
    "",
    `Checked: ${new Date().toISOString()}`,
    "Origin: scripts/smoke-http-postgres-runtime.mjs",
    "",
  ].join("\n");
  const update = await callTool("brain_update_file", {
    brain_id: brainId,
    filename,
    mode: "replace",
    content,
  });
  assert.match(update, new RegExp(`Updated ${filename.replace(".", "\\.")}:`));
  writeStatus = filename;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      brainId,
      runtime: healthBody.runtime,
      filesListed: true,
      searchQuery: query,
      sourcesListed: !sources.includes("No source files found."),
      write: writeStatus,
    },
    null,
    2
  )
);
console.log("[http-runtime-smoke] PASS");
