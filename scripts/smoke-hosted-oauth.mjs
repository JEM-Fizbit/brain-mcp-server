import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

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
const smokeFilename = process.env.BRAIN_HOSTED_OAUTH_WRITE_FILE || "HOSTED_OAUTH_WRITE_SMOKE.md";
const localBrainDir =
  process.env.BRAIN_DIR || path.join(os.homedir(), "Projects", "ai-brain-jem", "brain");
const localSyncWaitMs = Number(process.env.BRAIN_HOSTED_OAUTH_LOCAL_WAIT_MS || 30000);

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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLocalFile(expectedContent) {
  const localPath = path.join(localBrainDir, smokeFilename);
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
    `Timed out waiting for local sync of ${smokeFilename} under ${localBrainDir}` +
      (lastContent ? "; file exists but content did not match" : "")
  );
}

async function runLocalSyncOnce() {
  try {
    await exec("npm", ["run", "sync", "--", "once"], {
      env: {
        ...process.env,
        BRAIN_SYNC_INCLUDE_FILES: smokeFilename,
      },
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    if (/Brain sync is already running or a stale lock exists/.test(output)) {
      return false;
    }
    throw error;
  }
  return true;
}

async function main() {
  console.log(`[hosted-oauth] Checking ${baseUrl}`);
  const health = await jsonFetch(`${baseUrl}/health`);
  assert.equal(health.runtime.revisionStore, "postgres");
  assert.equal(health.runtime.artifactStore, "supabase");
  assert.equal(health.runtime.gitHotPath, "disabled");
  assert.equal(health.runtime.autoSyncEnabled, false);

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

  const files = await callTool(token.access_token, "brain_list_files", { brain_id: brainId });
  assert.match(files, /00_loader\.md/);
  const syncStatus = await callTool(token.access_token, "brain_sync_status", {
    brain_id: brainId,
  });
  assert.match(syncStatus, /Provider: revision/);
  const context = await callTool(token.access_token, "brain_load_context", {
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
    const update = await callTool(token.access_token, "brain_update_file", {
      brain_id: brainId,
      filename: smokeFilename,
      content: expectedContent,
      mode: "replace",
    });
    assert.match(update, new RegExp(`Updated ${smokeFilename}`));
    const hosted = await callTool(token.access_token, "brain_read_file", {
      brain_id: brainId,
      filename: smokeFilename,
    });
    assert.equal(hosted, expectedContent);
    console.log(`[hosted-oauth] Hosted write verified: ${smokeFilename}`);

    if (shouldVerifyLocal) {
      try {
        await waitForLocalFile(expectedContent);
      } catch {
        await runLocalSyncOnce();
        await waitForLocalFile(expectedContent);
      }
      console.log(`[hosted-oauth] Local sync verified: ${path.join(localBrainDir, smokeFilename)}`);
    }
  }

  console.log("[hosted-oauth] PASS: OAuth enrollment and authenticated hosted MCP reads verified");
}

main().catch((error) => {
  console.error(`[hosted-oauth] FAIL: ${error.message}`);
  process.exitCode = 1;
});
