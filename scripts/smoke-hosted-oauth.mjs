import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  buildLatencySnapshot,
  filenameForLatencyOperation,
  HOSTED_MCP_LATENCY_EVENT_TYPE,
  metadataForLatencyOperation,
} from "./lib/latency-summary.mjs";

loadLocalEnv();
const exec = promisify(execFile);
const { Pool } = pg;

const baseUrl = (process.env.BRAIN_HOSTED_BASE_URL || "https://jem-brain-mcp.fly.dev")
  .replace(/\/$/, "");
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const resource = `${baseUrl}/mcp`;
const timeoutMs = Number(process.env.BRAIN_HOSTED_OAUTH_TIMEOUT_MS || 5 * 60 * 1000);
const shouldOpenBrowser = process.env.BRAIN_HOSTED_OAUTH_OPEN !== "0";
const args = new Set(process.argv.slice(2));
const shouldWrite =
  args.has("--write") || process.env.BRAIN_HOSTED_OAUTH_WRITE === "1";
const shouldVerifyLocal =
  args.has("--verify-local") || process.env.BRAIN_HOSTED_OAUTH_VERIFY_LOCAL === "1";
const shouldLocalWrite =
  args.has("--local-write") || process.env.BRAIN_HOSTED_OAUTH_LOCAL_WRITE === "1";
const shouldVerifyHosted =
  args.has("--verify-hosted") || process.env.BRAIN_HOSTED_OAUTH_VERIFY_HOSTED === "1";
const shouldConflict =
  args.has("--conflict") || process.env.BRAIN_HOSTED_OAUTH_CONFLICT === "1";
const shouldReauth =
  args.has("--reauth") || process.env.BRAIN_HOSTED_OAUTH_REAUTH === "1";
const smokeFilename = process.env.BRAIN_HOSTED_OAUTH_WRITE_FILE || "HOSTED_OAUTH_WRITE_SMOKE.md";
const localBrainDir =
  process.env.BRAIN_DIR || path.join(os.homedir(), "Projects", "ai-brain-jem", "brain");
const localSyncWaitMs = Number(process.env.BRAIN_HOSTED_OAUTH_LOCAL_WAIT_MS || 30000);
const hostedSyncWaitMs = Number(process.env.BRAIN_HOSTED_OAUTH_HOSTED_WAIT_MS || 30000);
const tokenCacheFile =
  process.env.BRAIN_HOSTED_OAUTH_TOKEN_CACHE ||
  path.resolve(localBrainDir, "..", ".brain-sync", "hosted-oauth-token.json");
const latencyFile =
  process.env.BRAIN_HOSTED_MCP_LATENCY_FILE ||
  path.resolve(localBrainDir, "..", ".brain-sync", "hosted-mcp-latency.json");
const latencyHistoryLimit = Number(process.env.BRAIN_HOSTED_MCP_LATENCY_HISTORY_LIMIT || 240);
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
const shouldWriteClientLatencyToPostgres =
  process.env.BRAIN_HOSTED_MCP_CLIENT_LATENCY_DB_WRITE !== "0";
const shouldWriteSyncWaitLatencyToPostgres =
  process.env.BRAIN_HOSTED_MCP_SYNC_WAIT_DB_WRITE !== "0";
const shouldWriteLatencyCache =
  process.env.BRAIN_HOSTED_MCP_LATENCY_CACHE === "1" || !databaseUrl;
const operationLatencies = [];

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomToken(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

function sha256Base64url(value) {
  return base64url(crypto.createHash("sha256").update(value).digest());
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${options.method || "GET"} ${url} returned non-JSON: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed ${response.status}: ${text}`);
  }
  return body;
}

function listenForCallback(expectedState) {
  let server;
  const callback = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found\n");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (error) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end("<p>Brain OAuth failed. You can close this tab.</p>");
        reject(new Error(`OAuth failed: ${error}`));
        return;
      }
      if (!code || state !== expectedState) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end("<p>Brain OAuth callback was invalid. You can close this tab.</p>");
        reject(new Error("OAuth callback missing code or state mismatch"));
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<p>Brain OAuth complete. You can close this tab and return to Codex.</p>");
      resolve({ code });
    });
    server.on("error", reject);
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address === "object");
      return `http://127.0.0.1:${address.port}/callback`;
    },
    async wait() {
      let timeout;
      try {
        return await Promise.race([
          callback,
          new Promise((_, reject) =>
            timeout = setTimeout(
              () => reject(new Error("Timed out waiting for OAuth callback")),
              timeoutMs
            )
          ),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        server.close();
      }
    },
  };
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
}

async function readTokenCache() {
  if (shouldReauth) return null;
  try {
    const cache = JSON.parse(await fs.readFile(tokenCacheFile, "utf-8"));
    if (
      cache?.version === 1 &&
      cache.baseUrl === baseUrl &&
      cache.resource === resource &&
      cache.clientId &&
      cache.refreshToken
    ) {
      return cache;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`[hosted-oauth] Ignoring unreadable OAuth token cache: ${error.message}`);
    }
  }
  return null;
}

async function writeTokenCache(clientId, token) {
  if (!token?.refresh_token) return;
  await fs.mkdir(path.dirname(tokenCacheFile), { recursive: true });
  const payload = {
    version: 1,
    baseUrl,
    resource,
    clientId,
    scope: token.scope || "mcp:tools",
    refreshToken: token.refresh_token,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(tokenCacheFile, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.chmod(tokenCacheFile, 0o600).catch(() => undefined);
  console.log(`[hosted-oauth] OAuth refresh token cache updated: ${tokenCacheFile}`);
}

async function refreshFromTokenCache() {
  const cache = await readTokenCache();
  if (!cache) return null;

  try {
    const token = await jsonFetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cache.clientId,
        refresh_token: cache.refreshToken,
        resource,
      }).toString(),
    });
    assert.equal(token.token_type, "Bearer");
    assert.ok(token.access_token);
    await writeTokenCache(cache.clientId, token);
    console.log("[hosted-oauth] Reused cached OAuth grant; browser approval not required.");
    return token;
  } catch (error) {
    console.warn(`[hosted-oauth] Cached OAuth grant could not be reused: ${error.message}`);
    console.warn("[hosted-oauth] Falling back to browser login.");
    return null;
  }
}

async function authorizeWithBrowser() {
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = sha256Base64url(verifier);
  const callbackServer = listenForCallback(state);
  const redirectUri = await callbackServer.start();

  const client = await jsonFetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "brain-hosted-oauth-smoke",
    }),
  });

  const authorizeUrl = new URL(`${baseUrl}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "mcp:tools");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", resource);

  console.log("[hosted-oauth] Complete the browser login to continue.");
  console.log(`[hosted-oauth] ${authorizeUrl.toString()}`);
  if (shouldOpenBrowser) openBrowser(authorizeUrl.toString());

  const { code } = await callbackServer.wait();
  const token = await jsonFetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  assert.equal(token.token_type, "Bearer");
  assert.ok(token.access_token);
  await writeTokenCache(client.client_id, token);
  return token;
}

async function getToken() {
  return (await refreshFromTokenCache()) || authorizeWithBrowser();
}

async function callTool(accessToken, name, args = {}) {
  const response = await fetch(resource, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP ${name} failed ${response.status}: ${text}`);
  }
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const message = JSON.parse((dataLine || text).replace(/^data: /, ""));
  if (message.error) throw new Error(`MCP ${name} error: ${message.error.message}`);
  const resultText = message.result?.content?.map((part) => part.text).join("\n") || "";
  if (message.result?.isError) throw new Error(`MCP ${name} tool error: ${resultText}`);
  return resultText;
}

function classifyTool(name) {
  if (/update|resolve/.test(name)) return "write";
  if (/read|load|list|search|status/.test(name)) return "read";
  return "operation";
}

function targetFor(name, args = {}) {
  if (args.filename) return args.filename;
  if (args.conflict_id) return args.conflict_id;
  if (args.query) return "query";
  if (args.source_label) return "source_label";
  if (args.brain_id) return args.brain_id;
  return name;
}

async function timedOperation(name, kind, target, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    operationLatencies.push({
      name,
      kind,
      target,
      ok: true,
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    operationLatencies.push({
      name,
      kind,
      target,
      ok: false,
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  }
}

async function timedTool(accessToken, name, args = {}) {
  return timedOperation(name, classifyTool(name), targetFor(name, args), () =>
    callTool(accessToken, name, args)
  );
}

async function writeLatencySnapshot() {
  if (operationLatencies.length === 0) return;
  const wrotePostgres = await writeLatencyTelemetryToPostgres();
  if (wrotePostgres && !shouldWriteLatencyCache) return;
  await fs.mkdir(path.dirname(latencyFile), { recursive: true });
  let previousSnapshot = null;
  try {
    previousSnapshot = JSON.parse(await fs.readFile(latencyFile, "utf-8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`[hosted-oauth] Replacing unreadable latency history: ${error.message}`);
    }
  }
  const snapshot = buildLatencySnapshot({
    previousSnapshot,
    operationLatencies,
    baseUrl,
    brainId,
    smokeFilename,
    historyLimit: latencyHistoryLimit,
  });
  await fs.writeFile(latencyFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  console.log(`[hosted-oauth] User-facing latency fallback cache written: ${latencyFile}`);
}

async function writeLatencyTelemetryToPostgres() {
  if (!databaseUrl) return false;
  const telemetryOperations = operationLatencies.filter(
    (operation) =>
      shouldWriteClientLatencyToPostgres ||
      (shouldWriteSyncWaitLatencyToPostgres && operation.kind === "sync_wait")
  );
  if (telemetryOperations.length === 0) return false;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const operation of telemetryOperations) {
      const metadata = metadataForLatencyOperation(operation, {
        version: 3,
        source:
          operation.kind === "sync_wait"
            ? "hosted_mcp_sync_wait"
            : "hosted_mcp_client_e2e",
        timingLayer: operation.kind === "sync_wait" ? "sync_wait" : "client_e2e",
        durationType:
          operation.kind === "sync_wait"
            ? "sync_propagation_wait"
            : "client_observed_tool_call",
        baseUrl,
        smokeFilename,
      });
      if (!metadata) continue;
      await pool.query(
        `
          insert into brain.sync_events (
            brain_id,
            event_type,
            filename,
            duration_ms,
            metadata,
            created_at
          )
          values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
        `,
        [
          brainId,
          HOSTED_MCP_LATENCY_EVENT_TYPE,
          filenameForLatencyOperation(operation),
          operation.latencyMs,
          JSON.stringify(metadata),
          operation.at,
        ]
      );
    }
    console.log("[hosted-oauth] User-facing latency telemetry written to Postgres sync_events.");
    return true;
  } catch (error) {
    console.warn(`[hosted-oauth] Could not write latency telemetry to Postgres: ${error.message}`);
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLocalFile(expectedContent, brainDir = localBrainDir) {
  const localPath = path.join(brainDir, smokeFilename);
  const deadline = Date.now() + localSyncWaitMs;
  let lastContent = "";
  while (Date.now() < deadline) {
    try {
      lastContent = await fs.readFile(localPath, "utf-8");
      if (lastContent === expectedContent) return localPath;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for local sync of ${smokeFilename} under ${brainDir}` +
      (lastContent ? "; file exists but content did not match" : "")
  );
}

async function waitForHostedFile(accessToken, expectedContent) {
  const deadline = Date.now() + hostedSyncWaitMs;
  let lastContent = "";
  while (Date.now() < deadline) {
    try {
      lastContent = await callTool(accessToken, "brain_read_file", {
        brain_id: brainId,
        filename: smokeFilename,
      });
      if (lastContent === expectedContent) return;
    } catch {
      // The file may not exist yet in a fresh environment.
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for hosted sync of ${smokeFilename}` +
      (lastContent ? "; hosted file exists but content did not match" : "")
  );
}

async function runLocalSync(command = "once", env = {}) {
  try {
    await exec("npm", ["run", "sync", "--", command], {
      env: {
        ...process.env,
        BRAIN_SYNC_INCLUDE_FILES: smokeFilename,
        ...env,
      },
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    if (/Brain sync is already running/.test(output)) {
      return false;
    }
    throw error;
  }
  return true;
}

async function runLocalSyncOnce(env = {}) {
  return runLocalSync("once", env);
}

async function writeLocalSmokeFile(expectedContent) {
  const localPath = path.join(localBrainDir, smokeFilename);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, expectedContent, "utf-8");
  return localPath;
}

function extractConflictId(conflicts) {
  const escaped = smokeFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = conflicts.match(new RegExp(`- ([^\\s]+) ${escaped}`));
  return match?.[1];
}

async function runHostedConflictSmoke(accessToken, tool = timedTool) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-hosted-oauth-conflict-"));
  const tempBrainDir = path.join(root, "brain");
  const tempStateFile = path.join(root, ".brain-sync", "state.json");
  const tempLockFile = `${tempStateFile}.lock`;
  const syncEnv = {
    BRAIN_ID: brainId,
    BRAIN_DIR: tempBrainDir,
    BRAIN_SYNC_STATE_FILE: tempStateFile,
    BRAIN_SYNC_LOCK_FILE: tempLockFile,
    BRAIN_SYNC_INCLUDE_FILES: smokeFilename,
    BRAIN_REVISION_STORE: "postgres",
  };

  try {
    const stamp = new Date().toISOString();
    const baselineContent = [
      "# Hosted OAuth Conflict Smoke",
      "",
      `- brain_id: ${brainId}`,
      `- base_url: ${baseUrl}`,
      `- baseline_timestamp: ${stamp}`,
      "",
      "Baseline content for hosted OAuth conflict smoke.",
      "",
    ].join("\n");
    const baselineUpdate = await tool(accessToken, "brain_update_file", {
      brain_id: brainId,
      filename: smokeFilename,
      content: baselineContent,
      mode: "replace",
    });
    assert.match(baselineUpdate, new RegExp(`Updated ${smokeFilename}`));

    await runLocalSync("pull", syncEnv);
    await waitForLocalFile(baselineContent, tempBrainDir);

    const dirtyLocalContent = `${baselineContent}Local dirty edit before hosted update.\n`;
    await fs.writeFile(path.join(tempBrainDir, smokeFilename), dirtyLocalContent, "utf-8");

    const hostedConflictContent = [
      "# Hosted OAuth Conflict Smoke",
      "",
      `- brain_id: ${brainId}`,
      `- base_url: ${baseUrl}`,
      `- hosted_conflict_timestamp: ${new Date().toISOString()}`,
      "",
      "Hosted update while the temporary local mirror is dirty.",
      "",
    ].join("\n");
    const hostedUpdate = await tool(accessToken, "brain_update_file", {
      brain_id: brainId,
      filename: smokeFilename,
      content: hostedConflictContent,
      mode: "replace",
    });
    assert.match(hostedUpdate, new RegExp(`Updated ${smokeFilename}`));

    await runLocalSync("pull", syncEnv);
    assert.equal(
      await fs.readFile(path.join(tempBrainDir, smokeFilename), "utf-8"),
      dirtyLocalContent
    );

    const conflicts = await tool(accessToken, "brain_list_conflicts", {
      brain_id: brainId,
    });
    assert.match(conflicts, new RegExp(`${smokeFilename}`));
    const conflictId = extractConflictId(conflicts);
    assert.ok(conflictId, `Could not find conflict id for ${smokeFilename}`);

    const resolvedContent = [
      "# Hosted OAuth Conflict Smoke",
      "",
      `- brain_id: ${brainId}`,
      `- base_url: ${baseUrl}`,
      `- resolved_timestamp: ${new Date().toISOString()}`,
      "",
      "Reviewed resolution content for hosted OAuth conflict smoke.",
      "",
    ].join("\n");
    const resolution = await tool(accessToken, "brain_resolve_conflict", {
      brain_id: brainId,
      conflict_id: conflictId,
      content: resolvedContent,
    });
    assert.match(resolution, new RegExp(`Resolved conflict ${conflictId}`));

    const openConflicts = await tool(accessToken, "brain_list_conflicts", {
      brain_id: brainId,
    });
    assert.doesNotMatch(openConflicts, new RegExp(`${conflictId}\\s+${smokeFilename}`));
    const resolvedConflicts = await tool(accessToken, "brain_list_conflicts", {
      brain_id: brainId,
      status: "resolved",
    });
    assert.match(resolvedConflicts, new RegExp(`${conflictId}\\s+${smokeFilename}`));
    assert.equal(
      await tool(accessToken, "brain_read_file", {
        brain_id: brainId,
        filename: smokeFilename,
      }),
      resolvedContent
    );

    console.log(`[hosted-oauth] Conflict lifecycle verified: ${conflictId}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  console.log(`[hosted-oauth] Checking ${baseUrl}`);
  const health = await jsonFetch(`${baseUrl}/health`);
  assert.equal(health.runtime.revisionStore, "postgres");
  assert.equal(health.runtime.artifactStore, "supabase");
  assert.equal(health.runtime.gitHotPath, "disabled");
  assert.equal(health.runtime.autoSyncEnabled, false);

  const token = await getToken();

  try {
    const files = await timedTool(token.access_token, "brain_list_files", { brain_id: brainId });
    assert.match(files, /00_loader\.md/);
    const syncStatus = await timedTool(token.access_token, "brain_sync_status", {
      brain_id: brainId,
    });
    assert.match(syncStatus, /Provider: revision/);
    const context = await timedTool(token.access_token, "brain_load_context", {
      brain_id: brainId,
    });
    assert.match(context, /00_loader|NOW\.md|Brain/i);

    if (shouldWrite) {
      const stamp = new Date().toISOString();
      const expectedContent = [
        "# Hosted OAuth Write Smoke",
        "",
        `- brain_id: ${brainId}`,
        `- base_url: ${baseUrl}`,
        `- timestamp: ${stamp}`,
        "",
        "This file is generated by scripts/smoke-hosted-oauth.mjs to verify hosted write parity.",
        "",
      ].join("\n");
      const update = await timedTool(token.access_token, "brain_update_file", {
        brain_id: brainId,
        filename: smokeFilename,
        content: expectedContent,
        mode: "replace",
      });
      assert.match(update, new RegExp(`Updated ${smokeFilename}`));
      const hosted = await timedTool(token.access_token, "brain_read_file", {
        brain_id: brainId,
        filename: smokeFilename,
      });
      assert.equal(hosted, expectedContent);
      console.log(`[hosted-oauth] Hosted write verified: ${smokeFilename}`);

      if (shouldVerifyLocal) {
        await timedOperation("hosted_to_local_sync", "sync_wait", smokeFilename, async () => {
          try {
            await waitForLocalFile(expectedContent);
          } catch {
            await runLocalSyncOnce();
            await waitForLocalFile(expectedContent);
          }
        });
        console.log(`[hosted-oauth] Local sync verified: ${path.join(localBrainDir, smokeFilename)}`);
      }
    }

    if (shouldLocalWrite) {
      const stamp = new Date().toISOString();
      const expectedContent = [
        "# Local OAuth Write Smoke",
        "",
        `- brain_id: ${brainId}`,
        `- base_url: ${baseUrl}`,
        `- timestamp: ${stamp}`,
        "",
        "This file is generated by scripts/smoke-hosted-oauth.mjs to verify local-to-hosted sync parity.",
        "",
      ].join("\n");
      const localPath = await writeLocalSmokeFile(expectedContent);
      console.log(`[hosted-oauth] Local write created: ${localPath}`);

      if (shouldVerifyHosted) {
        await timedOperation("local_to_hosted_sync", "sync_wait", smokeFilename, async () => {
          try {
            await waitForHostedFile(token.access_token, expectedContent);
          } catch {
            await runLocalSyncOnce();
            await waitForHostedFile(token.access_token, expectedContent);
          }
        });
        console.log(`[hosted-oauth] Hosted sync verified: ${smokeFilename}`);
      }
    }

    if (shouldConflict) {
      await runHostedConflictSmoke(token.access_token);
    }
  } finally {
    await writeLatencySnapshot();
  }

  console.log("[hosted-oauth] PASS: OAuth enrollment and authenticated hosted MCP reads verified");
}

main().catch(async (error) => {
  await writeLatencySnapshot().catch(() => undefined);
  console.error(`[hosted-oauth] FAIL: ${error.message}`);
  process.exitCode = 1;
});
