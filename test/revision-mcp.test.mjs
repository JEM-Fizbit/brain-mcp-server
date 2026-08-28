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
    identityProviders: ["github"],
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

async function setupHarness(name, brainConfig = {}) {
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
          storage_backend: brainConfig.storage_backend || "filesystem",
          storage_config: brainConfig.storage_config || { brain_dir: brainDir },
          source_categories: brainConfig.source_categories,
        },
      ],
      principals: [
        {
          provider: "github",
          provider_user_id: "123",
          login: "johnemilad",
          roles: { "ai-brain-jem": brainConfig.role || "owner" },
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

async function setupScopedTenantHarness(name) {
  const root = path.join(tmpRoot, name);
  const registryFile = path.join(root, "registry.json");
  const storeFile = path.join(root, "revision-store.json");
  const tenantABrainDir = path.join(root, "tenant-a", "brain");
  const tenantBBrainDir = path.join(root, "tenant-b", "brain");
  await fs.mkdir(tenantABrainDir, { recursive: true });
  await fs.mkdir(tenantBBrainDir, { recursive: true });
  await fs.writeFile(
    registryFile,
    JSON.stringify({
      version: 1,
      default_brain_id: "tenant-a-brain",
      brains: [
        {
          id: "tenant-a-brain",
          type: "personal",
          template_used: "personal",
          integration_mode: "vertical",
          storage_backend: "filesystem",
          storage_config: { brain_dir: tenantABrainDir },
        },
        {
          id: "tenant-b-brain",
          type: "shared",
          template_used: "company",
          integration_mode: "vertical",
          storage_backend: "filesystem",
          storage_config: { brain_dir: tenantBBrainDir },
        },
      ],
      principals: [
        {
          provider: "github",
          provider_user_id: "tenant-b-user",
          roles: { "tenant-b-brain": "member" },
        },
      ],
    }),
    "utf-8"
  );

  process.env.BRAIN_DIR = tenantABrainDir;
  process.env.BRAIN_PLATFORM_CONFIG = registryFile;
  process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE = storeFile;

  const store = new FileRevisionStore(storeFile);
  for (const brainId of ["tenant-a-brain", "tenant-b-brain"]) {
    await store.proposeRevision({
      brainId,
      filename: "NOW.md",
      baseRevisionId: null,
      content: `${brainId} private content\n`,
      origin: "hosted_mcp",
    });
  }

  const baseUrl = "http://127.0.0.1:1234";
  const config = oauthConfig(baseUrl);
  const token = issueAccessToken(config, {
    sub: "github:tenant-b-user",
    clientId: "test-client",
    scope: "mcp:tools",
    provider: "github",
    providerUserId: "tenant-b-user",
    githubLogin: "tenant-b-user",
  }).token;

  return { baseUrl, token, config, storeFile };
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

async function listTools(harness) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
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
  const dataLine = res.text().split("\n").find((line) => line.startsWith("data: "));
  assert.ok(dataLine, res.text());
  const message = JSON.parse(dataLine.slice("data: ".length));
  assert.ifError(message.error);
  return message.result.tools;
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

test("HTTP MCP denies cross-tenant reads and writes for a Brain-scoped principal", async () => {
  const harness = await setupScopedTenantHarness("cross-tenant-isolation");

  const visible = await callTool(harness, "brain_list_brains");
  assert.match(visible, /tenant-b-brain/);
  assert.doesNotMatch(visible, /tenant-a-brain/);

  const deniedRead = await callTool(harness, "brain_read_file", {
    brain_id: "tenant-a-brain",
    filename: "NOW.md",
  });
  assert.match(deniedRead, /Brain not accessible: tenant-a-brain/i);
  assert.match(deniedRead, /Accessible Brains: tenant-b-brain/i);
  assert.doesNotMatch(deniedRead, /tenant-a-brain private content/);

  const deniedWrite = await callTool(harness, "brain_update_file", {
    brain_id: "tenant-a-brain",
    filename: "breach.md",
    mode: "replace",
    content: "cross-tenant write must not land\n",
  });
  assert.match(deniedWrite, /Brain not accessible: tenant-a-brain/i);

  const allowedRead = await callTool(harness, "brain_read_file", {
    brain_id: "tenant-b-brain",
    filename: "NOW.md",
  });
  assert.equal(allowedRead, "tenant-b-brain private content\n");

  const store = new FileRevisionStore(harness.storeFile);
  assert.equal(
    (await store.readFile("tenant-a-brain", "NOW.md")).content,
    "tenant-a-brain private content\n"
  );
  await assert.rejects(
    () => store.readFile("tenant-a-brain", "breach.md"),
    /File not found/i
  );
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

test("HTTP MCP update rejects external namespaces", async () => {
  const harness = await setupHarness("reserved-write");
  const result = await callTool(harness, "brain_update_file", {
    filename: "sources/brand/guidelines.md",
    mode: "replace",
    content: "Should not become a Brain head\n",
  });
  assert.match(result, /Reserved external Brain path/);

  const store = new FileRevisionStore(harness.storeFile);
  await assert.rejects(
    store.readFile("ai-brain-jem", "sources/brand/guidelines.md"),
    /File not found/
  );
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

test("HTTP MCP reads hosted LOG.md through revision store without local brain_dir", async () => {
  const harness = await setupHarness("hosted-read-log-no-brain-dir", {
    storage_backend: "postgres",
    storage_config: {},
  });

  await callTool(harness, "brain_log", {
    opType: "UPDATE",
    filesTouched: ["NOW.md"],
    summary: "Hosted read-log entry",
  });

  const result = await callTool(harness, "brain_read_log", {
    limit: 1,
    offset: 0,
  });

  assert.match(result, /Hosted read-log entry/);
  assert.doesNotMatch(result, /storage_config\.brain_dir/);
});

test("HTTP MCP capture item creates a hosted Brain triage queue in TASKS.md", async () => {
  const harness = await setupHarness("capture-item-hosted", {
    storage_backend: "postgres",
    storage_config: {},
  });

  const result = await callTool(harness, "brain_capture_item", {
    kind: "idea",
    title: "Browser-based Brain viewer",
    source: "ChatGPT mobile",
    route_hint: "brain-platform",
    details: "Explore a non-Markdown human surface.",
    urgency: "normal",
  });

  assert.match(result, /Captured idea in TASKS\.md Capture \/ Triage Queue/);

  const store = new FileRevisionStore(harness.storeFile);
  const hosted = await store.readFile("ai-brain-jem", "TASKS.md");
  assert.match(hosted.content, /## Capture \/ Triage Queue/);
  assert.match(hosted.content, /Not the document-ingestion inbox/);
  assert.match(hosted.content, /IDEA — Browser-based Brain viewer/);
  assert.match(hosted.content, /Source: ChatGPT mobile/);
  assert.match(hosted.content, /Route hint: brain-platform/);
});

test("HTTP MCP report item remains a compatibility alias for capture", async () => {
  const harness = await setupHarness("report-item-compat-hosted", {
    storage_backend: "postgres",
    storage_config: {},
  });

  const result = await callTool(harness, "brain_report_item", {
    kind: "bug",
    title: "Hosted log ordering",
    source: "ChatGPT mobile",
    target: "brain-mcp-server",
    details: "New hosted LOG.md entries should be newest-first.",
    urgency: "normal",
  });

  assert.match(result, /Captured bug in TASKS\.md Capture \/ Triage Queue/);

  const store = new FileRevisionStore(harness.storeFile);
  const hosted = await store.readFile("ai-brain-jem", "TASKS.md");
  assert.match(hosted.content, /## Capture \/ Triage Queue/);
  assert.match(hosted.content, /BUG — Hosted log ordering/);
  assert.match(hosted.content, /Route hint: brain-mcp-server/);
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

test("HTTP MCP hosted inbox scan does not require a server brain_dir", async () => {
  const harness = await setupHarness("hosted-inbox-no-brain-dir", {
    storage_backend: "postgres",
    storage_config: {},
  });

  const result = await callTool(harness, "brain_scan_inbox");
  assert.match(result, /Server-side inbox state/);
  assert.match(result, /backend capability result/);
  assert.match(result, /local Monitor\/operator workspace/);
  assert.doesNotMatch(result, /local stdio server|local sync mirror/);
  assert.match(result, /Postgres-backed Brain/);
});

test("HTTP MCP hosted ingestion preflight is read-only and backend-aware", async () => {
  const harness = await setupHarness("hosted-ingest-preflight", {
    storage_backend: "postgres",
    storage_config: {},
    source_categories: ["personal", "research"],
  });

  const tools = await listTools(harness);
  const prepareTool = tools.find((tool) => tool.name === "brain_prepare_ingest");
  assert.ok(prepareTool);
  assert.equal(prepareTool.annotations?.readOnlyHint, true);
  assert.equal(prepareTool.annotations?.destructiveHint, false);
  assert.equal(prepareTool.annotations?.idempotentHint, true);

  const preflight = await callTool(harness, "brain_prepare_ingest", {
    source_label: "Research note",
  });
  assert.match(preflight, /Backend: `postgres`/);
  assert.match(preflight, /`personal`, `research`/);
  assert.match(preflight, /Server source-path read\/write: not supported/);
  assert.match(preflight, /This preflight made no writes/);
  assert.match(preflight, /00_loader\.md/);
  assert.match(preflight, /NOW\.md/);
  assert.match(preflight, /Do not call `brain_ingest` with `dry_run=false`/);
  assert.match(preflight, /Fly cannot see either surface/);

  const dryRun = await callTool(harness, "brain_ingest", {
    source_label: "Research note",
    category: "research",
    dry_run: true,
  });
  assert.match(dryRun, /Ingest Analysis: Research note/);
  assert.match(dryRun, /Source categories \(for saving\): personal, research/);
  assert.match(dryRun, /Do not call `brain_ingest` with `dry_run=false`/);

  const unsupportedSave = await callTool(harness, "brain_ingest", {
    source_label: "Research note",
    category: "research",
    source_content: "Short source text",
    dry_run: false,
  });
  assert.match(unsupportedSave, /No writes occurred/);
  assert.match(unsupportedSave, /brain_prepare_ingest/);

  const unsupportedComplete = await callTool(harness, "brain_ingest_complete", {
    source_label: "Research note",
    category: "research",
    md_file: "sources/research/2026-08-24_research-note.md",
    files_touched: ["NOW.md"],
  });
  assert.match(unsupportedComplete, /No writes occurred/);
  assert.match(unsupportedComplete, /operator workflow/);
});

test("HTTP MCP ingestion rejects a category outside the selected Brain registry", async () => {
  const harness = await setupHarness("hosted-ingest-category", {
    storage_backend: "postgres",
    storage_config: {},
    source_categories: ["legal", "projects"],
  });
  const result = await callTool(harness, "brain_ingest", {
    source_label: "Biography",
    category: "bios",
    dry_run: true,
  });
  assert.match(result, /Unsupported source category/);
  assert.match(result, /legal, projects/);
});

test("HTTP MCP detection-only lint is read-only through revision store harness", async () => {
  const harness = await setupHarness("lint");
  const lint = await callTool(harness, "brain_lint");

  assert.match(lint, /# Brain Lint Report/);
  assert.doesNotMatch(lint, /ENOENT/);

  const store = new FileRevisionStore(harness.storeFile);
  await assert.rejects(
    () => store.readFile("ai-brain-jem", "LOG.md"),
    /not found/i
  );
});

test("reader can run read-only lint but cannot request fixes", async () => {
  const harness = await setupHarness("lint-reader", { role: "reader" });
  const lint = await callTool(harness, "brain_lint");
  assert.match(lint, /# Brain Lint Report/);

  const denied = await callTool(harness, "brain_lint", { fix: true });
  assert.match(denied, /requires member, current role is reader/);
  const store = new FileRevisionStore(harness.storeFile);
  await assert.rejects(
    () => store.readFile("ai-brain-jem", "LOG.md"),
    /not found/i
  );
});

test("hosted structural writes require owner or admin while ordinary member writes remain allowed", async () => {
  const member = await setupHarness("structural-member", { role: "member" });
  const denied = await callTool(member, "brain_update_file", {
    filename: "NOW.md",
    content: "member overwrite",
    mode: "replace",
  });
  assert.match(denied, /owner or admin role required/i);
  const ordinary = await callTool(member, "brain_update_file", {
    filename: "member-note.md",
    content: "member content",
    mode: "replace",
  });
  assert.match(ordinary, /Updated member-note\.md/);

  const admin = await setupHarness("structural-admin", { role: "admin" });
  const allowed = await callTool(admin, "brain_update_file", {
    filename: "NOW.md",
    content: "admin overwrite",
    mode: "replace",
  });
  assert.match(allowed, /Updated NOW\.md/);
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

test("HTTP MCP delete → read-fails → restore round-trips through the revision store", async () => {
  const harness = await setupHarness("delete-restore");
  await callTool(harness, "brain_update_file", {
    filename: "doomed.md",
    mode: "replace",
    content: "important body\n",
  });
  await callTool(harness, "brain_update_file", {
    filename: "linker.md",
    mode: "replace",
    content: "see [[doomed]] for details\n",
  });

  const del = await callTool(harness, "brain_delete_file", {
    filename: "doomed.md",
  });
  assert.match(del, /doomed\.md/);
  assert.match(del, /link/i, "dangling-link warning surfaced");
  assert.match(del, /linker\.md/, "names the linking file");

  const readDeleted = await callTool(harness, "brain_read_file", {
    filename: "doomed.md",
  });
  assert.match(readDeleted, /deleted/i, "a deleted file reads as deleted");

  const restore = await callTool(harness, "brain_restore_file", {
    filename: "doomed.md",
  });
  assert.match(restore, /doomed\.md/);

  const readBack = await callTool(harness, "brain_read_file", {
    filename: "doomed.md",
  });
  assert.equal(readBack, "important body\n", "restored to last content");
});

test("HTTP MCP rename moves the file and rewrites inbound [[wikilinks]]", async () => {
  const harness = await setupHarness("rename-links");
  await callTool(harness, "brain_update_file", {
    filename: "old.md",
    mode: "replace",
    content: "# old body\n",
  });
  await callTool(harness, "brain_update_file", {
    filename: "ref.md",
    mode: "replace",
    content: "context: [[old]] and [[old|Alias]]\n",
  });

  const rename = await callTool(harness, "brain_rename_file", {
    from: "old.md",
    to: "new.md",
  });
  assert.match(rename, /inbound link/i, "reports the link rewrite");

  const readOld = await callTool(harness, "brain_read_file", {
    filename: "old.md",
  });
  assert.match(readOld, /deleted/i, "old path reads as deleted after rename");
  assert.equal(
    await callTool(harness, "brain_read_file", { filename: "new.md" }),
    "# old body\n"
  );
  assert.equal(
    await callTool(harness, "brain_read_file", { filename: "ref.md" }),
    "context: [[new]] and [[new|Alias]]\n"
  );
});

test("HTTP MCP refuses to delete or rename a protected structural file", async () => {
  const harness = await setupHarness("protected-refusal");
  const del = await callTool(harness, "brain_delete_file", {
    filename: "NOW.md",
  });
  assert.match(del, /protected structural file NOW\.md/);

  const rename = await callTool(harness, "brain_rename_file", {
    from: "00_loader.md",
    to: "loader-renamed.md",
  });
  assert.match(rename, /protected structural file 00_loader\.md/);
});
