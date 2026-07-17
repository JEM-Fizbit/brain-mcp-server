import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-fixes-"));

const LOADER = [
  "# Loader",
  "",
  "## All Files",
  "",
  "### Core Context",
  "- `NOW.md` — now.",
  "",
  "### Operations",
  "- `TASKS.md` — tasks.",
  "",
  "## Maintenance",
  "",
  "- **Last reviewed:** 2026-06-01",
  "",
].join("\n");

const TASKS = [
  "# TASKS",
  "",
  "## Done",
  "- [x] old thing *(done 2026-05-01)*",
  "- [x] undated thing",
  "",
].join("\n");

async function seed() {
  await fs.writeFile(path.join(tmpDir, "00_loader.md"), LOADER, "utf-8");
  await fs.writeFile(path.join(tmpDir, "NOW.md"), "# NOW\n", "utf-8");
  await fs.writeFile(path.join(tmpDir, "TASKS.md"), TASKS, "utf-8");
  await fs.writeFile(path.join(tmpDir, "07_orphan.md"), "# Orphan\n", "utf-8");
}

let child;
let basePort;

function request(method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: basePort, method, path: pathname, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* html or non-json */
          }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

before(async () => {
  await seed();
  child = spawn(process.execPath, [path.join(repoRoot, "scripts", "hosted-cockpit.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BRAIN_DIR: tmpDir,
      BRAIN_ID: "ai-brain-jem",
      BRAIN_COCKPIT_PORT: "8811",
      BRAIN_COCKPIT_PORT_FALLBACK: "1",
    },
  });
  basePort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cockpit did not start")), 15000);
    child.stdout.on("data", (buf) => {
      const m = String(buf).match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.stderr.on("data", () => {});
    child.on("exit", (code) => reject(new Error("cockpit exited early: " + code)));
  });
});

after(() => {
  if (child) child.kill("SIGKILL");
});

test("GET /api/fixes/plan returns per-item plan and writes nothing", async () => {
  const before = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  const res = await request("GET", "/api/fixes/plan");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  const kinds = new Set(res.json.items.map((i) => i.kind));
  assert.ok(kinds.has("done_archive"));
  assert.ok(kinds.has("done_stamp"));
  assert.ok(!kinds.has("orphan_index"));
  assert.ok(!kinds.has("reviewed_date"));
  // read-only
  assert.equal(await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8"), before);
});

test("POST /api/fixes/apply is rejected without a valid nonce", async () => {
  const res = await request("POST", "/api/fixes/apply", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [] }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "bad_nonce");
});

test("POST /api/fixes/apply is rejected for a non-loopback Host", async () => {
  const res = await request("POST", "/api/fixes/apply", {
    headers: { host: "evil.example.com", "content-type": "application/json", "x-cockpit-nonce": "x" },
    body: JSON.stringify({ ids: [] }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "forbidden_host");
});

test("POST /api/fixes/apply requires JSON content-type", async () => {
  // Fetch the nonce from the served page first.
  const page = await request("GET", "/");
  const nonce = page.text.match(/COCKPIT_NONCE = "([a-f0-9]+)"/)[1];
  const res = await request("POST", "/api/fixes/apply", {
    headers: { "content-type": "text/plain", "x-cockpit-nonce": nonce },
    body: "ids=1",
  });
  assert.equal(res.status, 415);
  assert.equal(res.json.error, "json_required");
});

test("POST /api/fixes/apply applies only the approved id with a valid nonce", async () => {
  const page = await request("GET", "/");
  const nonce = page.text.match(/COCKPIT_NONCE = "([a-f0-9]+)"/)[1];

  const plan = await request("GET", "/api/fixes/plan");
  const archiveId = plan.json.items.find((i) => i.kind === "done_archive").id;

  const res = await request("POST", "/api/fixes/apply", {
    headers: { "content-type": "application/json", "x-cockpit-nonce": nonce },
    body: JSON.stringify({ ids: [archiveId] }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.appliedIds.includes(archiveId));

  const tasks = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  assert.doesNotMatch(tasks, /old thing/); // approved archive applied
  assert.doesNotMatch(tasks, /undated thing \(done/); // stamp NOT approved -> untouched
});
