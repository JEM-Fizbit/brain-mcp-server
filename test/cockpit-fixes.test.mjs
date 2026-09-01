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

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-fixes-"));
const brainDir = path.join(tmpRoot, "brain");
const inboxDir = path.join(tmpRoot, "inbox");
const doctorOutputPath = path.join(tmpRoot, "hosted-doctor.out.json");
const freshDoctorScriptPath = path.join(tmpRoot, "fresh-doctor.mjs");
const lintReportPath = path.join(tmpRoot, "hosted-lint-report.json");
const recentCaptureDate = new Date(Date.now() - 86_400_000)
  .toISOString()
  .slice(0, 10);

const LOADER = [
  "# Loader",
  "",
  "## All Files",
  "",
  "### Core Context",
  "- [NOW](NOW.md) — now.",
  "- [Reviewed source](../sources/example.md) — source companion.",
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
  "## Capture / Triage Queue",
  "",
  "Temporary holding area for conversationally captured items that need later routing.",
  "",
  "- [ ] 2026-08-01 — FOLLOW-UP — stale captured item",
  "  - Triage: Route to canonical destination, then mark transferred/closed.",
  `- [ ] ${recentCaptureDate} — NOTE — recent captured item`,
  "  - Triage: Route to canonical destination, then mark transferred/closed.",
  "",
  "## Done",
  "- [x] old thing *(done 2026-05-01)*",
  "- [x] undated thing",
  "",
].join("\n");

async function seed() {
  await fs.mkdir(brainDir, { recursive: true });
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.mkdir(path.join(tmpRoot, "sources"), { recursive: true });
  await fs.writeFile(path.join(brainDir, "00_loader.md"), LOADER, "utf-8");
  await fs.writeFile(path.join(brainDir, "NOW.md"), "# NOW\n\n[[missing]]\n", "utf-8");
  await fs.writeFile(path.join(brainDir, "TASKS.md"), TASKS, "utf-8");
  await fs.writeFile(path.join(brainDir, "07_orphan.md"), "# Orphan\n", "utf-8");
  await fs.writeFile(
    path.join(tmpRoot, "sources", "example.md"),
    "# Example source\n\n[Back to loader](../brain/00_loader.md)\n",
    "utf-8"
  );
  await fs.writeFile(path.join(inboxDir, "pending-source.pdf"), "fixture", "utf-8");
  await fs.writeFile(
    lintReportPath,
    `${JSON.stringify({
      version: 1,
      brainId: "ai-brain-jem",
      checkedAt: "2026-08-19T10:00:00.000Z",
      issueCount: 279,
      diagnosticCount: 279,
    })}\n`,
    "utf-8"
  );
  await fs.writeFile(
    doctorOutputPath,
    `${JSON.stringify({
      ok: true,
      status: "pass",
      checkedAt: "2026-08-19T10:00:00.000Z",
      checks: [{ name: "cached_probe", status: "pass", details: {} }],
    })}\n`,
    "utf-8"
  );
  await fs.writeFile(
    freshDoctorScriptPath,
    `console.log(JSON.stringify({ok:true,status:"pass",checkedAt:"2026-08-19T10:01:00.000Z",checks:[{name:"fresh_probe",status:"pass",details:{}}],actions:[]}));\n`,
    "utf-8"
  );
}

let child;
let basePort;
let childStderr = "";

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
      BRAIN_DIR: brainDir,
      BRAIN_ID: "ai-brain-jem",
      BRAIN_REVISION_STORE: "filesystem",
      BRAIN_LINT_MODE_OVERRIDES: JSON.stringify({ "ai-brain-jem": "graph" }),
      BRAIN_COCKPIT_PORT: "8811",
      BRAIN_COCKPIT_PORT_FALLBACK: "1",
      BRAIN_COCKPIT_DOCTOR_OUTPUT: doctorOutputPath,
      BRAIN_COCKPIT_DOCTOR_SCRIPT: freshDoctorScriptPath,
      BRAIN_LINT_REPORT_FILE: lintReportPath,
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
    child.stderr.on("data", (buf) => {
      childStderr = (childStderr + String(buf)).slice(-4000);
    });
    child.on("exit", (code) =>
      reject(
        new Error(
          `cockpit exited early: ${code}${childStderr ? `\n${childStderr.trim()}` : ""}`
        )
      )
    );
  });
});

after(() => {
  if (child) child.kill("SIGKILL");
});

test("GET /api/doctor reads the Brain Monitor last-good report", async () => {
  const res = await request("GET", "/api/doctor");
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "pass");
  assert.equal(res.json.checks[0].name, "cached_probe");
  assert.equal(res.json.cockpitCache.source, "brain_monitor");
  assert.equal(res.json.cockpitCache.path, doctorOutputPath);
});

test("GET /api/doctor?fresh=1 bypasses the Monitor cache after maintenance", async () => {
  const res = await request("GET", "/api/doctor?fresh=1");
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "pass");
  assert.equal(res.json.checks[0].name, "fresh_probe");
  assert.equal(res.json.cockpitCache, undefined);
});

test("GET /api/fixes/plan returns per-item plan and writes nothing", async () => {
  const before = await fs.readFile(path.join(brainDir, "TASKS.md"), "utf-8");
  const res = await request("GET", "/api/fixes/plan");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  const kinds = new Set(res.json.items.map((i) => i.kind));
  assert.ok(kinds.has("done_archive"));
  assert.ok(kinds.has("done_stamp"));
  assert.ok(!kinds.has("orphan_index"));
  assert.ok(!kinds.has("reviewed_date"));
  // read-only
  assert.equal(await fs.readFile(path.join(brainDir, "TASKS.md"), "utf-8"), before);
});

test("Maintenance page exposes lint and inbox actions without claiming the Brain is clean", async () => {
  const page = await request("GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.text, />Maintenance</);
  assert.match(page.text, /Refresh lint assessment/);
  assert.match(page.text, /Refresh inbox scan/);
  assert.match(page.text, /Copy Claude ingestion prompt/);
  assert.match(page.text, /Copy LLM triage prompt/);
  assert.match(page.text, /capture-prompt-copy/);
  assert.match(page.text, /position: absolute/);
  assert.match(page.text, /LLM-assisted triage \(recommended\)/);
  assert.match(page.text, /Manual triage in Obsidian/);
  assert.match(page.text, /Phase 1 — proposal only/);
  assert.match(page.text, /inbox_file set to/);
  assert.match(page.text, /id="fixes-select-all"[^>]*aria-label="Select all fixes"[^>]*disabled/);
  assert.match(page.text, /id="fixes-apply"[^>]*disabled>Apply selected</);
  assert.match(page.text, /Actions You Can Approve/);
  assert.match(page.text, /Show full proposed change/);
  assert.match(page.text, /you never need to review technical diagnostics individually/i);
  assert.match(page.text, /Maintainer-only diagnostics and context/);
  assert.match(page.text, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(page.text, /Approve all/);
  assert.doesNotMatch(page.text, /Nothing to fix — the Brain is clean/);
});

test("GET /api/lint/report ignores the legacy cache format", async () => {
  const res = await request("GET", "/api/lint/report");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.state, "never_run");
  assert.equal(res.json.lint, null);
});

test("POST /api/lint/run requires a valid nonce", async () => {
  const res = await request("POST", "/api/lint/run", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "bad_nonce");
});

test("POST /api/lint/run records a receipt and structured report", async () => {
  const page = await request("GET", "/");
  const nonce = page.text.match(/COCKPIT_NONCE = "([a-f0-9]+)"/)[1];
  const res = await request("POST", "/api/lint/run", {
    headers: { "content-type": "application/json", "x-cockpit-nonce": nonce },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.lint.issueCount >= 1);
  assert.equal(res.json.lint.report.orphanMode, "graph");
  assert.equal(res.json.lint.diagnosticCount, 1);
  assert.equal(res.json.lint.primaryIssueCount, res.json.lint.issueCount);
  assert.equal(res.json.lint.brainId, "ai-brain-jem");
  assert.equal(res.json.lint.operatorDecisionCount, 1);
  const captureFinding = res.json.lint.reviewFindings.find(
    (finding) => finding.kind === "capture_queue"
  );
  assert.equal(captureFinding.openCount, 2);
  assert.equal(captureFinding.staleCount, 1);
  assert.equal(captureFinding.thresholdDays, 7);
  assert.ok(res.json.lint.reviewFindings.some((finding) => finding.kind === "orphan"));
  assert.equal(
    res.json.lint.technicalDiagnostics.filter(
      (finding) => finding.kind === "broken_internal_links"
    ).length,
    1
  );
  const graphFinding = res.json.lint.technicalDiagnostics.find(
    (finding) => finding.kind === "broken_internal_links"
  );
  assert.equal(graphFinding.diagnosticCode, "unresolved_target");
  assert.equal(graphFinding.owner, "Brain content maintainer");
  assert.match(graphFinding.statusLabel, /maintainer repair required/i);
  assert.ok(graphFinding.examples[0].includes("NOW.md"));
  assert.equal(res.json.lint.sourceLinkAudit.state, "pass");
  assert.ok(res.json.lint.externalReferenceCount >= 1);
  const sourceBoundary = res.json.lint.technicalDiagnostics.find(
    (finding) => finding.diagnosticCode === "source_boundary"
  );
  assert.equal(sourceBoundary.statusLabel, "Verified automatically");
  assert.match(sourceBoundary.completion, /no operator review required/i);

  const cache = JSON.parse(await fs.readFile(lintReportPath, "utf-8"));
  assert.equal(cache.version, 2);
  assert.equal(cache.brainId, "ai-brain-jem");
  assert.match(await fs.readFile(path.join(brainDir, "LOG.md"), "utf-8"), /\] LINT/);

  const report = await request("GET", "/api/lint/report");
  assert.equal(report.json.state, "recorded");
  assert.equal(report.json.lint.checkedAt, cache.checkedAt);
});

test("GET /api/inbox/scan returns pending source metadata", async () => {
  const res = await request("GET", "/api/inbox/scan");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.deepEqual(res.json.files.map((file) => file.name), ["pending-source.pdf"]);
  assert.equal(res.json.files[0].size, 7);
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

  const tasks = await fs.readFile(path.join(brainDir, "TASKS.md"), "utf-8");
  assert.doesNotMatch(tasks, /old thing/); // approved archive applied
  assert.doesNotMatch(tasks, /undated thing \(done/); // stamp NOT approved -> untouched
});
