import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-revision-mcp-test-"));

const { FileRevisionStore, LocalSyncAgent } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);
const { handleHttpRequest } = await import(
  path.join(__dirname, "..", "dist", "http", "server.js")
);
const { issueAccessToken } = await import(
  path.join(__dirname, "..", "dist", "oauth", "jwt.js")
);

const oldEnv = {
  BRAIN_DIR: process.env.BRAIN_DIR,
  BRAIN_PLATFORM_CONFIG: process.env.BRAIN_PLATFORM_CONFIG,
  BRAIN_EXPERIMENTAL_REVISION_STORE_FILE:
    process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE,
};

after(async () => {
  for (const [key, value] of Object.entries(oldEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function oauthConfig(baseUrl) {
  return {
    issuer: baseUrl,
    resourceUri: `${baseUrl}/mcp`,
    authorizationEndpoint: `${baseUrl}/authorize`,
    tokenEndpoint: `${baseUrl}/token`,
    registrationEndpoint: `${baseUrl}/register`,
    protectedResourceMetadataUrl:
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
    authorizationServerMetadataUrl:
      `${baseUrl}/.well-known/oauth-authorization-server`,
    scopes: ["mcp:tools"],
    signingSecret: "test",
    accessTokenTtlSec: 3600,
  };
}

class FakeResponse extends Writable {
  headersSent = false;
  status = null;
  statusCode = 200;
  headers = {};
  chunks = [];

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  writeHead(status, reasonOrHeaders = {}, maybeHeaders = {}) {
    this.status = status;
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

async function setupHarness(name) {
  const root = path.join(tmpRoot, name);
  const brainDir = path.join(root, "brain");
  const registryFile = path.join(root, "registry.json");
  const storeFile = path.join(root, "revision-store.json");
  await fs.mkdir(brainDir, { recursive: true });
  await fs.writeFile(
    registryFile,
    JSON.stringify({
      version: 1,
      default_brain_id: "ai-brain-jem",
      brains: [
        {
          id: "ai-brain-jem",
          type: "personal",
          template_used: "personal",
          integration_mode: "vertical",
          storage_backend: "filesystem",
          storage_config: { brain_dir: brainDir },
        },
      ],
      principals: [
        {
          provider: "github",
          provider_user_id: "123",
          login: "johnemilad",
          roles: { "ai-brain-jem": "owner" },
        },
      ],
    }),
    "utf-8"
  );

  process.env.BRAIN_DIR = brainDir;
  process.env.BRAIN_PLATFORM_CONFIG = registryFile;
  process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE = storeFile;

  const store = new FileRevisionStore(storeFile);
  await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "00_loader.md",
    baseRevisionId: null,
    content: "Loader table\n",
    origin: "hosted_mcp",
  });
  await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: null,
    content: "Hosted now\n",
    origin: "hosted_mcp",
  });

  const baseUrl = "http://127.0.0.1:1234";
  const config = oauthConfig(baseUrl);
  const token = issueAccessToken(config, {
    sub: "github:123",
    clientId: "test-client",
    scope: "mcp:tools",
    provider: "github",
    providerUserId: "123",
    githubLogin: "johnemilad",
  }).token;

  const stateFile = path.join(root, ".brain-sync", "state.json");
  return { baseUrl, token, config, storeFile, brainDir, stateFile };
}

async function writeBrainFile(brainDir, filename, content) {
  const fullPath = path.join(brainDir, filename);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function readBrainFile(brainDir, filename) {
  return fs.readFile(path.join(brainDir, filename), "utf-8");
}

async function callTool(harness, name, args = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const req = Readable.from([Buffer.from(body)]);
  req.method = "POST";
  req.url = "/mcp";
  req.headers = {
    host: "127.0.0.1:1234",
    authorization: `Bearer ${harness.token}`,
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    accept: "application/json, text/event-stream",
  };
  req.rawHeaders = Object.entries(req.headers).flat();

  const res = new FakeResponse();
  await handleHttpRequest(req, res, {
    config: harness.config,
    state: memoryState(),
  });

  const responseText = res.text();
  assert.equal(res.statusCode, 200, responseText);
  const dataLine = responseText
    .split("\n")
    .find((line) => line.startsWith("data: "));
  assert.ok(dataLine, responseText);
  const message = JSON.parse(dataLine.slice("data: ".length));
  if (message.error) {
    throw new Error(message.error.message);
  }
  return message.result.content.map((part) => part.text).join("\n");
}

test("HTTP MCP reads and loads context from revision store harness", async () => {
  const harness = await setupHarness("read-context");
  const now = await callTool(harness, "brain_read_file", {
    filename: "NOW.md",
  });
  assert.equal(now, "Hosted now\n");

  const context = await callTool(harness, "brain_load_context");
  assert.match(context, /--- FILE: 00_loader\.md ---/);
  assert.match(context, /Loader table/);
  assert.match(context, /--- FILE: NOW\.md ---/);
  assert.match(context, /Hosted now/);
});

test("HTTP MCP update writes to revision store harness", async () => {
  const harness = await setupHarness("write");
  const update = await callTool(harness, "brain_update_file", {
    filename: "NOW.md",
    mode: "replace",
    content: "Hosted update through MCP\n",
  });
  assert.match(update, /Updated NOW\.md:/);

  const store = new FileRevisionStore(harness.storeFile);
  const hosted = await store.readFile("ai-brain-jem", "NOW.md");
  assert.equal(hosted.content, "Hosted update through MCP\n");
  assert.deepEqual(hosted.actor, {
    provider: "github",
    id: "123",
    name: "johnemilad",
  });

  const readBack = await callTool(harness, "brain_read_file", {
    filename: "NOW.md",
  });
  assert.equal(readBack, "Hosted update through MCP\n");
});

test("HTTP MCP log writes through revision store with actor metadata", async () => {
  const harness = await setupHarness("log-write");
  const result = await callTool(harness, "brain_log", {
    opType: "UPDATE",
    filesTouched: ["NOW.md"],
    summary: "Hosted log entry",
  });
  assert.match(result, /Updated LOG\.md:/);

  const store = new FileRevisionStore(harness.storeFile);
  const hosted = await store.readFile("ai-brain-jem", "LOG.md");
  assert.match(hosted.content, /Hosted log entry/);
  assert.equal(hosted.origin, "hosted_mcp");
  assert.deepEqual(hosted.actor, {
    provider: "github",
    id: "123",
    name: "johnemilad",
  });
});

test("HTTP MCP list and search use revision store harness", async () => {
  const harness = await setupHarness("list-search");
  const files = await callTool(harness, "brain_list_files");
  assert.match(files, /NOW\.md/);
  assert.match(files, /00_loader\.md/);
  assert.match(files, /Revision store harness:/);

  const search = await callTool(harness, "brain_search", {
    query: "Hosted",
  });
  assert.match(search, /NOW\.md:1: Hosted now/);
});

test("HTTP MCP source list stays empty for file revision harness without source metadata", async () => {
  const harness = await setupHarness("source-list-empty");
  const sources = await callTool(harness, "brain_list_sources");
  assert.equal(sources, "No source files found.");
});

test("HTTP MCP source read reports missing source metadata without provider", async () => {
  const harness = await setupHarness("source-read-missing-provider");
  const result = await callTool(harness, "brain_read_file", {
    filename: "photos/headshot.jpg",
    scope: "sources",
  });
  assert.match(result, /Revision store has no source metadata provider/);
});

test("HTTP MCP exposes hosted sync status and conflict listing", async () => {
  const harness = await setupHarness("sync-status");

  const status = await callTool(harness, "brain_sync_status");
  assert.match(status, /Brain: ai-brain-jem/);
  assert.match(status, /Provider: revision/);
  assert.match(status, /Hosted files: 2/);
  assert.match(status, /Open conflicts: 0/);

  const emptyConflicts = await callTool(harness, "brain_list_conflicts");
  assert.equal(emptyConflicts, "No open sync conflicts for ai-brain-jem.");

  const store = new FileRevisionStore(harness.storeFile);
  const staleHead = await store.getHead("ai-brain-jem", "NOW.md");
  assert.ok(staleHead);
  await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: staleHead.revisionId,
    content: "Remote advance\n",
    origin: "hosted_mcp",
  });
  const staleResult = await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: staleHead.revisionId,
    content: "Stale local edit\n",
    origin: "local_agent",
  });
  assert.equal(staleResult.ok, false);

  const conflictStatus = await callTool(harness, "brain_sync_status");
  assert.match(conflictStatus, /Open conflicts: 1/);

  const conflicts = await callTool(harness, "brain_list_conflicts");
  assert.match(conflicts, /Sync conflicts for ai-brain-jem \(open\):/);
  assert.match(conflicts, /NOW\.md/);
  assert.match(conflicts, /local: local_agent/);
  assert.match(conflicts, /remote: hosted_mcp/);

  const conflictId = conflicts.match(/- (conflict_[^\s]+) NOW\.md/)?.[1];
  assert.ok(conflictId);
  const resolution = await callTool(harness, "brain_resolve_conflict", {
    conflict_id: conflictId,
    content: "Reviewed merged resolution\n",
  });
  assert.match(resolution, new RegExp(`Resolved conflict ${conflictId}`));
  assert.match(resolution, /Resolution revision: rev_/);

  const resolvedStatus = await callTool(harness, "brain_sync_status");
  assert.match(resolvedStatus, /Open conflicts: 0/);
  assert.equal(
    await callTool(harness, "brain_read_file", { filename: "NOW.md" }),
    "Reviewed merged resolution\n"
  );
  assert.match(
    await callTool(harness, "brain_list_conflicts", { status: "resolved" }),
    new RegExp(`${conflictId} NOW\\.md`)
  );
});

test("HTTP MCP and local sync agent complete hosted-local-hosted loop", async () => {
  const harness = await setupHarness("full-loop");
  const agent = new LocalSyncAgent({
    brainId: "ai-brain-jem",
    brainDir: harness.brainDir,
    stateFile: harness.stateFile,
    store: new FileRevisionStore(harness.storeFile),
    actor: { provider: "test", id: "local-agent" },
  });

  await callTool(harness, "brain_update_file", {
    filename: "NOW.md",
    mode: "replace",
    content: "Hosted-to-local through MCP\n",
  });

  const pullReport = await agent.pullHostedChanges();
  assert.deepEqual(pullReport.pulled, ["00_loader.md", "NOW.md"]);
  assert.equal(
    await readBrainFile(harness.brainDir, "NOW.md"),
    "Hosted-to-local through MCP\n"
  );

  await writeBrainFile(
    harness.brainDir,
    "NOW.md",
    "Local-to-hosted through sync\n"
  );
  const pushReport = await agent.pushLocalChanges();
  assert.deepEqual(pushReport.pushed, ["NOW.md"]);
  assert.equal(pushReport.conflicts.length, 0);

  const readBack = await callTool(harness, "brain_read_file", {
    filename: "NOW.md",
  });
  assert.equal(readBack, "Local-to-hosted through sync\n");
});
