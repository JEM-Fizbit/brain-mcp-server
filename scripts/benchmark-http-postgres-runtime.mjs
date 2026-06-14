import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Readable, Writable } from "node:stream";
import pg from "pg";
import { handleHttpRequest } from "../dist/http/server.js";
import { issueAccessToken } from "../dist/oauth/jwt.js";
import { assertHttpRuntimeConfig } from "../dist/services/runtime-config.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

process.env.TRANSPORT = "http";
process.env.BRAIN_REVISION_STORE = "postgres";

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const iterations = Number(process.env.BRAIN_HTTP_BENCH_ITERATIONS || 5);
const baseUrl = process.env.BRAIN_HTTP_BENCH_BASE_URL || "http://127.0.0.1:3000";
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
  signingSecret: process.env.MCP_OAUTH_SIGNING_SECRET || "bench-local-only",
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

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[index];
}

function summary(values) {
  return {
    min_ms: Number(Math.min(...values).toFixed(3)),
    median_ms: Number(percentile(values, 50).toFixed(3)),
    p95_ms: Number(percentile(values, 95).toFixed(3)),
    max_ms: Number(Math.max(...values).toFixed(3)),
  };
}

function firstSearchableToken(content) {
  const ignored = new Set(["file", "table", "with", "from", "this", "that"]);
  for (const match of content.matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g)) {
    const token = match[0];
    if (!ignored.has(token.toLowerCase())) return token;
  }
  throw new Error("Could not derive a search token from benchmark content");
}

const token = issueAccessToken(config, {
  sub: "system:hosted-runtime-benchmark",
  clientId: "hosted-runtime-benchmark",
  scope: "mcp:tools",
  provider: "system",
  providerUserId: "hosted-runtime-benchmark",
  name: "Hosted Runtime Benchmark",
}).token;

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
  const startedAt = performance.now();
  await handleHttpRequest(req, res, { config, state: memoryState() });
  const durationMs = performance.now() - startedAt;
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
  return { durationMs, text };
}

async function sourceSearchToken() {
  if (!process.env.BRAIN_REVISION_DATABASE_URL) return null;
  const pool = new pg.Pool({
    connectionString: process.env.BRAIN_REVISION_DATABASE_URL,
  });
  try {
    const result = await pool.query(
      `
        select t.content
        from brain.source_artifact_text t
        join brain.source_artifacts a on a.id = t.artifact_id
        join brain.sources s on s.id = a.source_id
        where s.brain_id = $1
          and length(t.content) > 20
        order by t.created_at desc
        limit 1
      `,
      [brainId]
    );
    return result.rows[0] ? firstSearchableToken(result.rows[0].content) : null;
  } finally {
    await pool.end();
  }
}

assertHttpRuntimeConfig();

const loader = await callTool("brain_read_file", {
  brain_id: brainId,
  filename: "00_loader.md",
});
const brainQuery = firstSearchableToken(loader.text);
const sourceQuery = await sourceSearchToken();

const scenarios = [
  {
    name: "list_files",
    tool: "brain_list_files",
    args: { brain_id: brainId },
  },
  {
    name: "read_loader",
    tool: "brain_read_file",
    args: { brain_id: brainId, filename: "00_loader.md" },
  },
  {
    name: "search_brain",
    tool: "brain_search",
    args: { brain_id: brainId, query: brainQuery, max_results: 5 },
  },
  {
    name: "list_sources",
    tool: "brain_list_sources",
    args: { brain_id: brainId },
  },
  ...(sourceQuery
    ? [
        {
          name: "search_source_text",
          tool: "brain_search",
          args: {
            brain_id: brainId,
            query: sourceQuery,
            scope: "sources",
            max_results: 5,
          },
        },
      ]
    : []),
];

const scenarioResults = {};
for (const scenario of scenarios) {
  scenarioResults[scenario.name] = [];
  for (let i = 0; i < iterations; i += 1) {
    const result = await callTool(scenario.tool, scenario.args);
    scenarioResults[scenario.name].push(result.durationMs);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      brainId,
      iterations,
      scenarios: Object.fromEntries(
        Object.entries(scenarioResults).map(([name, values]) => [
          name,
          summary(values),
        ])
      ),
    },
    null,
    2
  )
);
