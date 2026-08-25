import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { planLintFixes, applyLintFixSelection } from "../dist/services/lint-apply.js";
import { brainDate } from "../dist/services/date.js";
import { runLint, countLintIssues } from "../dist/services/lint.js";
import { activeBrainStore } from "../dist/services/active-brain-store.js";
import { scanInbox } from "../dist/services/inbox.js";
import { auditSourceLinks } from "../dist/source-references/index.js";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const doctorScriptPath =
  process.env.BRAIN_COCKPIT_DOCTOR_SCRIPT ||
  path.join(repoRoot, "scripts", "hosted-doctor.mjs");
const doctorOutputPath = process.env.BRAIN_COCKPIT_DOCTOR_OUTPUT || "";
const maintenanceLogDir =
  process.env.BRAIN_SYNC_LOG_DIR ||
  (doctorOutputPath
    ? path.dirname(doctorOutputPath)
    : process.env.BRAIN_DIR
      ? path.resolve(process.env.BRAIN_DIR, "..", ".brain-sync")
      : path.join(repoRoot, ".brain-sync"));
const lintReportPath =
  process.env.BRAIN_LINT_REPORT_FILE ||
  path.join(maintenanceLogDir, "hosted-lint-report.json");
const requestedPort = process.env.BRAIN_COCKPIT_PORT;
const port = Number(requestedPort || 8787);
const host = process.env.BRAIN_COCKPIT_HOST || "127.0.0.1";
const cockpitBrainId = process.env.BRAIN_ID || "ai-brain-jem";
const accessAdminUrl =
  cockpitBrainId === "ers-brain"
    ? process.env.BRAIN_COCKPIT_ACCESS_ADMIN_URL ||
      `${(process.env.BRAIN_HOSTED_BASE_URL || "https://brain.ersgenomics.online").replace(/\/+$/, "")}/admin/access`
    : "";
const localBrainDir = process.env.BRAIN_DIR ? path.resolve(process.env.BRAIN_DIR) : null;
const localBrainRoot = localBrainDir ? path.resolve(localBrainDir, "..") : null;
// Per-process CSRF nonce: embedded in the served page and required on the write
// endpoint. A cross-origin page cannot read it (no CORS headers are ever sent),
// so it cannot forge the POST. Rotates every cockpit restart.
const cockpitNonce = crypto.randomBytes(18).toString("hex");
const allowPortFallback =
  process.env.BRAIN_COCKPIT_PORT_FALLBACK === "1" ||
  (!requestedPort && process.env.BRAIN_COCKPIT_PORT_FALLBACK !== "0");
const maxPortAttempts = Math.max(
  1,
  Number(process.env.BRAIN_COCKPIT_PORT_ATTEMPTS || 10)
);
let lintRunPromise = null;

async function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.next`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readLintReportCache() {
  try {
    const payload = JSON.parse(await fs.readFile(lintReportPath, "utf-8"));
    if (payload.version !== 2 || payload.brainId !== cockpitBrainId) {
      return null;
    }
    return payload;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readMarkdownFiles(root) {
  const files = new Map();
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
        files.set(relativePath, await fs.readFile(fullPath, "utf-8"));
      }
    }
  }
  await walk(root);
  return files;
}

async function readAllFiles(root) {
  const files = new Set();
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile()) files.add(path.relative(root, fullPath).split(path.sep).join("/"));
    }
  }
  await walk(root);
  return files;
}

async function runLocalSourceLinkAudit() {
  if (!localBrainDir || !localBrainRoot) {
    return { state: "unavailable", reason: "local Brain root is not configured" };
  }
  const sourceRoot = path.join(localBrainRoot, "sources");
  const [brainFiles, sourceFiles, sourceArtifactFiles] = await Promise.all([
    readMarkdownFiles(localBrainDir),
    readMarkdownFiles(sourceRoot),
    readAllFiles(sourceRoot),
  ]);
  if (sourceFiles.size === 0) {
    return { state: "unavailable", reason: "no local source companions were found" };
  }
  const report = auditSourceLinks({ brainFiles, sourceFiles, sourceArtifactFiles });
  const strictFailureCount =
    report.brokenLinks.length +
    report.nonClickableSourceReferences.length +
    report.companionsWithoutOriginalLinks.length +
    report.nonClickablePrimarySourceDeclarations.length;
  return {
    state: strictFailureCount === 0 ? "pass" : "fail",
    checkedAt: new Date().toISOString(),
    strictFailureCount,
    brainMarkdownFiles: report.brainMarkdownFiles,
    sourceCompanions: report.sourceCompanions,
    directlyLinkedCompanions: report.directlyLinkedCompanions.length,
    unlinkedCompanions: report.unlinkedCompanions.length,
    missingBacklinks: report.companionsWithoutBacklinks.length,
  };
}

function lintReviewFindings(report) {
  const findings = [];
  const add = (kind, summary, detail = "", metadata = {}) =>
    findings.push({
      kind,
      summary,
      detail,
      audience: "maintainer",
      owner: "Brain content maintainer",
      ...metadata,
    });
  for (const item of report.bloat || []) {
    add("bloat", `${item.file} is ${item.lines} lines`, "Review whether the file should be split; lint will not rewrite semantic content.");
  }
  for (const item of report.stale || []) {
    add("stale", `${item.file} is ${item.days} days stale`, "Review the claims and update or intentionally retain them.");
  }
  for (const filename of report.orphans || []) {
    add("orphan", `${filename} is not reachable`, `Reachability mode: ${report.orphanMode || "legacy"}. Structural files are never auto-edited.`);
  }
  for (const item of report.drift || []) add("drift", item, "Confirm the active-project and NOW.md relationship.");
  for (const item of report.largeDomainPacks || []) {
    add("large_domain_pack", `${item.dir}/ contains ${item.count} files`, "Review the pack's navigation and progressive disclosure.");
  }
  for (const filename of report.unindexedWorkingBinaries || []) {
    add("unindexed_binary", `${filename} is missing from working/INDEX.md`, "Add a reviewed INDEX entry; Cockpit will not fabricate the description.");
  }
  if (report.journalRotation) {
    add("journal_rotation", "Journal rotation is due", `Triggered by ${report.journalRotation.triggeredBy}; rotation remains a reviewed content move.`);
  }
  if (report.captureQueue) {
    add(
      "capture_queue",
      `Capture queue has ${report.captureQueue.openCount} open item(s)`,
      `${report.captureQueue.staleCount} stale item(s); this is one bounded content-triage decision, not ${report.captureQueue.openCount} lint diagnostics.`,
      {
        audience: "operator",
        owner: "John",
        statusLabel: "User decision",
        completion: "Complete when the capture queue is triaged into its canonical trackers or closed.",
        openCount: report.captureQueue.openCount,
        staleCount: report.captureQueue.staleCount,
        thresholdDays: report.captureQueue.thresholdDays,
      }
    );
  }
  if (report.bootstrapBudget?.exceeded) {
    add(
      "bootstrap_budget",
      `Bootstrap estimate ${report.bootstrapBudget.estimatedTokens} exceeds ${report.bootstrapBudget.limitTokens} tokens`,
      "Review progressive-disclosure moves; 00_loader.md and NOW.md are protected from automatic fixes."
    );
  }
  return findings;
}

function lintTechnicalDiagnostics(report, sourceLinkAudit) {
  const findings = [];
  const add = (kind, summary, detail, metadata = {}) =>
    findings.push({
      kind,
      summary,
      detail,
      audience: "maintainer",
      operatorAction: false,
      owner: "Brain content maintainer",
      ...metadata,
    });
  const graphDiagnostics = report.graphReachability?.diagnostics || [];
  if (graphDiagnostics.length > 0) {
    const byCode = new Map();
    for (const diagnostic of graphDiagnostics) {
      const group = byCode.get(diagnostic.code) || [];
      group.push(diagnostic);
      byCode.set(diagnostic.code, group);
    }
    const definitions = {
      unresolved_target: {
        label: "Broken internal-link candidates",
        status: "Maintainer repair required",
        detail:
          "A real Markdown link or wikilink does not resolve inside the Brain. Backtick project locators and source-boundary links have already been excluded from this class.",
        owner: "Brain content maintainer",
        completion: "Complete when the internal destination is repaired or the link is deliberately removed.",
      },
      missing_directory_index: {
        label: "Directory references without a Brain index",
        status: "Maintainer repair required",
        detail:
          "A real Brain link names a directory that has no README.md or INDEX.md inside the Brain.",
        owner: "Brain content maintainer",
        completion: "Complete when each route is either linked to its canonical external workspace or given a reviewed Brain index where one is genuinely useful.",
      },
      path_escape: {
        label: "Paths outside the Brain namespace",
        status: "Maintainer repair required",
        detail:
          "A real Markdown link escapes the Brain namespace. Machine locators are classified separately and do not enter this failure class.",
        owner: "Brain content maintainer",
        completion: "Complete when human-facing routes are portable hyperlinks or explicitly retained as machine-only locators.",
      },
    };
    for (const [code, diagnostics] of Array.from(byCode.entries()).sort(
      (left, right) => right[1].length - left[1].length
    )) {
      const definition = definitions[code] || {
        label: code,
        status: "Maintainer repair required",
        detail: "This internal graph failure is retained for maintainer repair and is never delegated to the operator.",
        owner: "Brain content maintainer",
        completion: "Complete when the maintainer has classified or repaired the affected references.",
      };
      add(
        "broken_internal_links",
        `${diagnostics.length} ${definition.label.toLowerCase()} diagnostic(s)`,
        definition.detail,
        {
          diagnosticCode: code,
          statusLabel: definition.status,
          owner: definition.owner,
          completion: definition.completion,
          examples: diagnostics.slice(0, 5).map((diagnostic) =>
            `${diagnostic.source} → ${diagnostic.target}`
          ),
        }
      );
    }
  }

  const externalReferences = report.graphReachability?.externalReferences || [];
  const byReason = new Map();
  for (const reference of externalReferences) {
    const group = byReason.get(reference.reason) || [];
    group.push(reference);
    byReason.set(reference.reason, group);
  }
  const definitions = {
    source_boundary: {
      label: "reviewed source links",
      status:
        sourceLinkAudit?.state === "pass"
          ? "Verified automatically"
          : sourceLinkAudit?.state === "fail"
            ? "Strict source audit failed"
            : "Verification unavailable",
      detail:
        sourceLinkAudit?.state === "pass"
          ? `The strict local source audit passes across ${sourceLinkAudit.sourceCompanions} companions, so these links are satisfied and closed automatically.`
          : "These links leave brain/ for sources/. They remain outside graph reachability and are owned by the strict repository-wide source audit.",
      owner: "Automated source-link audit",
      completion:
        sourceLinkAudit?.state === "pass"
          ? "Complete; no operator review required."
          : "Complete when the strict source-link audit passes.",
    },
    outside_brain: {
      label: "external workspace locators",
      status: "Classified informational",
      detail:
        "Absolute and parent-relative machine locators are retained for LLM traceability but are not Brain navigation links.",
      completion: "Complete by classification; no operator review required.",
    },
    unresolved_locator: {
      label: "project/file locators",
      status: "Classified informational",
      detail:
        "Backtick file references describe project-owned or templated locators. They are not clickable Brain links and do not imply a missing Brain node.",
      completion: "Complete by classification; no operator review required.",
    },
    directory_locator: {
      label: "project/directory locators",
      status: "Classified informational",
      detail:
        "Backtick directory references route agents to external workspaces. They do not require a Brain index page.",
      completion: "Complete by classification; no operator review required.",
    },
  };
  for (const [reason, references] of Array.from(byReason.entries()).sort(
    (left, right) => right[1].length - left[1].length
  )) {
    const definition = definitions[reason] || definitions.outside_brain;
    add(
      "classified_reference",
      `${references.length} ${definition.label}`,
      definition.detail,
      {
        diagnosticCode: reason,
        statusLabel: definition.status,
        owner: definition.owner || "Brain content maintainer",
        completion: definition.completion,
        examples: references.slice(0, 5).map((reference) =>
          `${reference.source} → ${reference.target}`
        ),
      }
    );
  }
  return findings;
}

async function executeMaintenanceLint({ recordReceipt = true } = {}) {
  const report = await runLint(cockpitBrainId);
  const plan = await planLintFixes(cockpitBrainId, brainDate());
  const sourceLinkAudit = await runLocalSourceLinkAudit().catch((error) => ({
    state: "unavailable",
    reason: String(error?.message || error).slice(0, 180),
  }));
  const checkedAt = new Date().toISOString();
  const issueCount = countLintIssues(report);
  const diagnosticCount = report.graphReachability?.diagnostics.length || 0;
  const externalReferenceCount = report.graphReachability?.externalReferences?.length || 0;
  const reviewFindings = lintReviewFindings(report);
  const technicalDiagnostics = lintTechnicalDiagnostics(report, sourceLinkAudit);
  const operatorDecisionCount = reviewFindings.filter(
    (finding) => finding.audience === "operator"
  ).length;
  const maintainerFindingCount = reviewFindings.length - operatorDecisionCount;
  const payload = {
    version: 2,
    brainId: cockpitBrainId,
    checkedAt,
    status:
      plan.items.length > 0 || operatorDecisionCount > 0
        ? "warn"
        : issueCount > 0 || diagnosticCount > 0 || sourceLinkAudit.state === "fail"
          ? "info"
          : "pass",
    issueCount,
    primaryIssueCount: issueCount,
    operatorDecisionCount,
    maintainerFindingCount,
    diagnosticCount,
    externalReferenceCount,
    automaticFixCount: plan.items.length,
    reviewFindings,
    technicalDiagnostics,
    sourceLinkAudit,
    warnings: report.warnings || [],
    report,
  };

  if (recordReceipt) {
    await activeBrainStore().appendLog(
      cockpitBrainId,
      "LINT",
      [],
      `Completed lint — ${issueCount} maintenance finding(s), ${diagnosticCount} broken internal-link diagnostic(s), ${externalReferenceCount} classified locator(s), ${plan.items.length} mechanical fix(es) available`
    );
  }
  await writeJsonAtomic(lintReportPath, payload);
  return payload;
}

function runMaintenanceLint(options) {
  if (lintRunPromise) return lintRunPromise;
  lintRunPromise = executeMaintenanceLint(options).finally(() => {
    lintRunPromise = null;
  });
  return lintRunPromise;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

// A request's Host must be a loopback literal on our port. This defeats DNS
// rebinding: a rebound hostname carries its own Host header, which fails here.
function isLoopbackHost(request) {
  const hostHeader = String(request.headers.host || "");
  const hostname = hostHeader.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

async function readJsonBody(request, limitBytes = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function runDoctor({ fresh = false } = {}) {
  if (doctorOutputPath && !fresh) {
    try {
      const payload = JSON.parse(await fs.readFile(doctorOutputPath, "utf-8"));
      const checkedAtMs = Date.parse(payload.checkedAt || "");
      return {
        ...payload,
        cockpitCache: {
          source: "brain_monitor",
          path: doctorOutputPath,
          checkedAt: payload.checkedAt || null,
          ageMs: Number.isFinite(checkedAtMs)
            ? Math.max(0, Date.now() - checkedAtMs)
            : null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        status: "warn",
        checkedAt: new Date().toISOString(),
        checks: [
          {
            name: "doctor_cache",
            status: "warn",
            details: {
              state: "unavailable",
              path: doctorOutputPath,
              error: String(error?.message || error),
            },
          },
        ],
      };
    }
  }

  // Standalone cockpit installs have no Monitor-owned report path. Preserve
  // their explicit on-demand doctor behavior without creating a second poller
  // in the consolidated Brain Monitor stack.
  try {
    const { stdout } = await exec(
      process.execPath,
      [doctorScriptPath],
      {
        cwd: repoRoot,
        timeout: 45000,
        maxBuffer: 1024 * 1024 * 4,
      }
    );
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = error.stdout?.trim();
    if (stdout?.startsWith("{")) {
      try {
        const payload = JSON.parse(stdout);
        return {
          ...payload,
          ok: false,
          status: payload.status === "pass" ? "warn" : payload.status,
          cockpitError: error.stderr?.trim() || error.message,
        };
      } catch {
        // Fall through to generic error response.
      }
    }
    return {
      ok: false,
      status: "fail",
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: "hosted_doctor",
          status: "fail",
          details: {
            error: error.stderr?.trim() || error.message,
          },
        },
      ],
    };
  }
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

const page = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Brain Cockpit</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f7f5;
        --panel: #ffffff;
        --ink: #1d1f21;
        --muted: #646a70;
        --line: #d8d9d4;
        --pass: #147d4f;
        --info: #356a8a;
        --warn: #a76100;
        --fail: #b42318;
        --unknown: #667085;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.45;
      }

      button {
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--ink);
        border-radius: 6px;
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
      }

      button:hover {
        border-color: #9ea3a8;
      }

      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 22px 0 36px;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      header > div {
        min-width: 0;
      }

      .header-main {
        display: grid;
        gap: 12px;
        flex: 1 1 auto;
      }

      h1 {
        margin: 0 0 4px;
        font-size: 24px;
        line-height: 1.1;
        font-weight: 650;
      }

      h2 {
        margin: 0 0 10px;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--muted);
      }

      .muted {
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .profile-switcher {
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--ink);
        border-radius: 6px;
        padding: 8px 10px;
        font: inherit;
        max-width: min(300px, 100%);
      }

      .active-brain-panel {
        display: grid;
        gap: 3px;
        min-width: 0;
      }

      .active-brain-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .active-brain-title {
        font-size: 32px;
        line-height: 1.05;
        font-weight: 750;
        overflow-wrap: anywhere;
      }

      .active-brain-subtitle {
        color: var(--muted);
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .status-band {
        display: grid;
        grid-template-columns: minmax(360px, 1.05fr) minmax(340px, 0.95fr);
        gap: 16px;
        align-items: stretch;
        margin-bottom: 22px;
      }

      .summary {
        background: var(--panel);
        border: 1px solid #c9cec8;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(29, 31, 33, 0.08);
        padding: 22px;
        min-height: 220px;
      }

      .summary-heading {
        margin-bottom: 14px;
      }

      .summary-state {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 26px;
        font-weight: 650;
        margin-bottom: 10px;
      }

      .dot {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: var(--unknown);
        flex: 0 0 auto;
      }

      .dot.pass { background: var(--pass); }
      .dot.warn { background: var(--warn); }
      .dot.fail { background: var(--fail); }

      .profile-meta {
        display: grid;
        gap: 6px;
        margin-top: 14px;
        font-size: 12px;
      }

      .profile-meta-primary {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .profile-meta-primary .profile-meta-row {
        display: block;
      }

      .profile-meta-primary .profile-meta-label {
        display: block;
        margin-bottom: 2px;
      }

      .profile-meta-row {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 8px;
        align-items: baseline;
        min-width: 0;
      }

      .profile-meta-label {
        color: var(--muted);
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .profile-meta code,
      .profile-meta a,
      .profile-meta-row > :last-child {
        display: block;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .profile-diagnostics {
        margin-top: 14px;
        border-top: 1px solid var(--line);
        padding-top: 10px;
      }

      .profile-diagnostics summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .profile-diagnostics[open] summary {
        margin-bottom: 8px;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }

      .metric {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
        min-height: 82px;
      }

      .metric-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .metric-value {
        margin-top: 6px;
        font-size: 24px;
        font-weight: 650;
        overflow-wrap: anywhere;
      }

      .timestamp-metric {
        grid-column: span 2;
      }

      .timestamp-value {
        font-size: 15px;
        line-height: 1.35;
      }

      .grid {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 14px;
      }

      .overview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr);
        gap: 16px;
        align-items: start;
      }

      .overview-primary {
        min-height: 210px;
      }

      .overview-side {
        display: grid;
        gap: 14px;
        min-width: 0;
      }

      .activity-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
      }

      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        min-width: 0;
      }

      .tabs {
        display: grid;
        gap: 16px;
      }

      .tab-list {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        align-items: center;
        background: #ecefeb;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 6px;
      }

      .tab-button {
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--muted);
        padding: 10px 14px;
        white-space: nowrap;
        font-weight: 600;
      }

      .tab-button[aria-selected="true"] {
        background: var(--panel);
        color: var(--ink);
        border-color: #9fcdb7;
        box-shadow: inset 0 0 0 1px rgba(20, 125, 79, 0.18), 0 1px 2px rgba(29, 31, 33, 0.08);
        font-weight: 650;
      }

      .tab-button:focus-visible {
        outline: 2px solid var(--pass);
        outline-offset: -2px;
      }

      .access-nav-link {
        border: 1px solid #9fcdb7;
        border-radius: 6px;
        background: var(--panel);
        color: var(--ink);
        padding: 9px 14px;
        white-space: nowrap;
        font-weight: 650;
        text-decoration: none;
      }

      .access-nav-link:focus-visible {
        outline: 2px solid var(--pass);
        outline-offset: -2px;
      }

      .tab-context-strip {
        display: grid;
        grid-template-columns: minmax(180px, 1.25fr) repeat(4, minmax(120px, 1fr));
        gap: 10px;
        align-items: center;
        background: #fafbf9;
        border: 1px solid var(--line);
        border-left: 4px solid #9fcdb7;
        border-radius: 8px;
        padding: 10px 12px;
      }

      .tab-context-strip[hidden] {
        display: none;
      }

      .tab-context-item {
        min-width: 0;
      }

      .tab-context-label {
        display: block;
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .tab-context-value {
        display: block;
        color: var(--ink);
        font-size: 13px;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .subtab-shell {
        background: #fafbf9;
        border: 1px solid var(--line);
        border-left: 4px solid #9fcdb7;
        border-radius: 8px;
        margin-bottom: 14px;
        padding: 10px 12px;
      }

      .subtab-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
      }

      .subtab-button {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        color: var(--muted);
        padding: 6px 10px;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 600;
      }

      .subtab-button[aria-selected="true"] {
        background: #eaf5ef;
        color: var(--ink);
        border-color: #9fcdb7;
        font-weight: 650;
      }

      .subtab-button:focus-visible {
        outline: 2px solid var(--pass);
        outline-offset: -2px;
      }

      .tab-panel[hidden] {
        display: none;
      }

      .subtab-panel[hidden],
      .activity-view[hidden] {
        display: none;
      }

      .tab-panel {
        min-width: 0;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      th,
      td {
        padding: 10px 8px;
        border-top: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      th:nth-child(1),
      td:nth-child(1) {
        width: 24%;
      }

      th:nth-child(2),
      td:nth-child(2) {
        width: 13%;
      }

      tr:first-child th {
        border-top: 0;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        min-width: 58px;
        justify-content: center;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 650;
        color: #ffffff;
        background: var(--unknown);
      }

      .pill.pass { background: var(--pass); }
      .pill.info { background: var(--info); }
      .pill.warn { background: var(--warn); }
      .pill.fail { background: var(--fail); }

      .details {
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .details code {
        color: var(--ink);
        background: #f0f1ee;
        border-radius: 4px;
        padding: 1px 4px;
      }

      .stack {
        display: grid;
        gap: 14px;
        min-width: 0;
      }

      .next-actions {
        display: grid;
        gap: 8px;
      }

      .action-item {
        border-top: 1px solid var(--line);
        padding: 9px 0;
        overflow-wrap: anywhere;
      }

      .action-item:first-child {
        border-top: 0;
        padding-top: 0;
      }

      .action-heading {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }

      .action-heading .event-title {
        display: block;
        flex: 1 1 180px;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .action-summary-panel {
        display: grid;
        align-content: start;
        gap: 10px;
        border-color: #c9cec8;
        box-shadow: 0 1px 3px rgba(29, 31, 33, 0.08);
        min-height: 220px;
        padding: 22px;
      }

      .section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }

      .section-heading h2 {
        margin: 0;
      }

      .metric-section {
        background: transparent;
        border: 0;
        border-top: 1px solid var(--line);
        border-radius: 0;
        margin-bottom: 18px;
        padding: 18px 0 0;
      }

      .metric-section-heading {
        align-items: flex-end;
        margin-bottom: 12px;
      }

      .metric-groups {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 18px;
      }

      .metric-group {
        display: grid;
        align-content: start;
        gap: 9px;
        min-width: 0;
      }

      .metric-group-title {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .metric-group .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
      }

      .action-count {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 3px 8px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
        white-space: nowrap;
      }

      .action-count.pass {
        color: var(--pass);
        border-color: #add8bf;
      }

      .action-count.warn {
        color: var(--warn);
        border-color: #e9c98c;
      }

      .action-count.fail {
        color: var(--fail);
        border-color: #eab5af;
      }

      .action-summary-list {
        display: grid;
        gap: 8px;
      }

      .activity-list {
        display: grid;
        gap: 0;
      }

      .event {
        border-top: 1px solid var(--line);
        padding: 9px 0;
        overflow-wrap: anywhere;
      }

      .event:first-child {
        border-top: 0;
        padding-top: 0;
      }

      .event-title {
        font-weight: 650;
      }

      .event-meta {
        color: var(--muted);
        font-size: 12px;
        margin-top: 2px;
      }

      .operation-table-wrap {
        max-width: 100%;
        overflow-x: auto;
      }

      .operation-log-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        min-width: 1080px;
      }

      .operation-log-table th,
      .operation-log-table td {
        padding: 6px 8px;
        font-size: 12px;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
      }

      .operation-log-table thead th {
        border-top: 0;
        border-bottom: 1px solid var(--line);
      }

      .operation-log-table tbody tr:hover {
        background: #fbfbf8;
      }

      .operation-log-table .tool-col {
        width: 18%;
        font-weight: 650;
      }

      .operation-log-table .duration-col {
        width: 7%;
        font-weight: 650;
        text-align: right;
      }

      .operation-log-table .kind-col {
        width: 7%;
      }

      .operation-log-table .timing-col {
        width: 9%;
      }

      .operation-log-table .status-col {
        width: 7%;
      }

      .operation-log-table .target-col {
        width: 14%;
      }

      .operation-log-table .source-col {
        width: 8%;
      }

      .operation-log-table .db-col {
        width: 14%;
      }

      .operation-log-table .operation-time-col {
        width: 16%;
      }

      .operation-log-table td.tool-col,
      .operation-log-table td.target-col,
      .operation-log-table td.db-col,
      .operation-log-table td.operation-time-col {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        overflow-wrap: anywhere;
      }

      .timestamp-stack {
        display: inline-grid;
        gap: 2px;
        min-width: 0;
      }

      .timestamp-date {
        color: var(--ink);
        font-weight: 650;
        white-space: nowrap;
      }

      .timestamp-time {
        color: var(--muted);
        font-size: 11px;
        white-space: nowrap;
      }

      .operation-log-table .status-pass {
        color: var(--pass);
        font-weight: 650;
      }

      .operation-log-table .status-fail {
        color: var(--fail);
        font-weight: 650;
      }

      .operation-db-detail-row td,
      .operation-db-detail-row td:nth-child(1),
      .operation-db-detail-row td:nth-child(2) {
        width: auto;
        padding: 0 8px 7px;
        border-top: 0;
        white-space: normal;
        overflow: visible;
      }

      .operation-db-detail-row details {
        display: block;
        max-width: 100%;
      }

      .operation-db-detail-row summary {
        cursor: pointer;
        white-space: nowrap;
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
        padding: 2px 0 6px;
      }

      .db-span-panel {
        max-width: 100%;
        overflow-x: auto;
        white-space: normal;
      }

      .db-span-table {
        width: 100%;
        min-width: 620px;
        border-collapse: collapse;
        table-layout: fixed;
        background: #fbfbf8;
        border: 1px solid var(--line);
        border-radius: 6px;
        overflow: hidden;
      }

      .db-span-table th,
      .db-span-table td {
        border-top: 1px solid var(--line);
        padding: 6px 8px;
        font-size: 12px;
        line-height: 1.35;
        vertical-align: top;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .db-span-table th {
        color: var(--muted);
        font-size: 11px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .db-span-table th:nth-child(1),
      .db-span-table td:nth-child(1) {
        width: 16%;
      }

      .db-span-table th:nth-child(2),
      .db-span-table td:nth-child(2) {
        width: 38%;
      }

      .db-span-table th:nth-child(3),
      .db-span-table td:nth-child(3) {
        width: 16%;
      }

      .db-span-table th:nth-child(4),
      .db-span-table td:nth-child(4) {
        width: 12%;
      }

      .db-span-table th:nth-child(5),
      .db-span-table td:nth-child(5) {
        width: 18%;
      }

      .latency-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
        margin-bottom: 12px;
      }

      .latency-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fbfbf8;
        padding: 12px;
        min-width: 0;
      }

      .latency-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .latency-latest {
        font-size: 20px;
        font-weight: 650;
        white-space: nowrap;
      }

      .sparkline {
        display: block;
        width: 100%;
        height: 38px;
        margin: 10px 0 8px;
      }

      .sparkline polyline {
        fill: none;
        stroke: var(--pass);
        stroke-width: 2.25;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .sparkline .sparkline-area {
        fill: #eef4f0;
      }

      .latency-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .latency-stat-label {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .latency-stat-value {
        font-weight: 650;
        overflow-wrap: anywhere;
      }

      .slo-table {
        margin: 8px 0 12px;
        min-width: 760px;
      }

      .slo-table th:nth-child(1),
      .slo-table td:nth-child(1) {
        width: 30%;
      }

      .slo-table th:nth-child(2),
      .slo-table td:nth-child(2) {
        width: 12%;
      }

      .slo-table th:nth-child(3),
      .slo-table td:nth-child(3),
      .slo-table th:nth-child(4),
      .slo-table td:nth-child(4),
      .slo-table th:nth-child(5),
      .slo-table td:nth-child(5) {
        width: 14%;
      }

      .slo-table th:nth-child(6),
      .slo-table td:nth-child(6) {
        width: 16%;
      }

      .finding {
        border-top: 1px solid var(--line);
        padding: 9px 0;
      }

      .finding:first-child {
        border-top: 0;
      }

      .finding-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 650;
      }

      .recent-heading {
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0;
        margin: 4px 0 2px;
      }

      .section-note {
        color: var(--muted);
        font-size: 12px;
        margin: -5px 0 8px;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      @media (max-width: 860px) {
        main {
          width: min(100vw - 20px, 1180px);
          padding-top: 14px;
        }

        header,
        .status-band,
        .overview-grid,
        .activity-grid,
        .grid,
        .metric-groups,
        .metrics {
          grid-template-columns: 1fr;
        }

        .profile-meta-primary,
        .metric-group .metrics {
          grid-template-columns: 1fr;
        }

        header {
          display: grid;
        }

        .toolbar {
          justify-content: flex-start;
        }

        .profile-switcher {
          max-width: 100%;
        }

        .tab-list {
          flex-wrap: wrap;
          overflow-x: visible;
        }

        .tab-button {
          flex: 1 1 118px;
        }

        .tab-context-strip {
          grid-template-columns: 1fr;
        }

        .timestamp-metric {
          grid-column: 1 / -1;
        }

        .operation-log-table {
          min-width: 900px;
        }

        .db-span-table {
          min-width: 0;
          table-layout: auto;
        }

        .db-span-table thead {
          display: none;
        }

        .db-span-table tbody,
        .db-span-table tr,
        .db-span-table td {
          display: block;
          width: 100%;
        }

        .db-span-table tr {
          border-top: 1px solid var(--line);
          padding: 5px 0;
        }

        .db-span-table tr:first-child {
          border-top: 0;
        }

        .db-span-table td,
        .db-span-table td:nth-child(1),
        .db-span-table td:nth-child(2),
        .db-span-table td:nth-child(3),
        .db-span-table td:nth-child(4),
        .db-span-table td:nth-child(5) {
          border-top: 0;
          min-height: 22px;
          padding: 3px 8px 3px 92px;
          position: relative;
          width: 100%;
        }

        .db-span-table td::before {
          content: attr(data-label);
          position: absolute;
          left: 8px;
          width: 74px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 650;
          text-transform: uppercase;
          letter-spacing: 0;
        }
      }
      .fixes-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin: 0.75rem 0 1rem;
      }
      .fixes-toolbar .fixes-apply {
        font-weight: 600;
      }
      .fixes-selection-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.5rem 1rem;
        align-items: center;
        margin-bottom: 0.5rem;
        padding: 0.55rem 0.5rem;
        border-bottom: 1px solid var(--line);
      }
      .fixes-select-all {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
        font-weight: 600;
      }
      .fixes-select-all input {
        margin: 0;
      }
      .fixes-group {
        margin-bottom: 1rem;
      }
      .fixes-group h3 {
        margin: 0 0 0.35rem;
        font-size: 0.9rem;
      }
      .fixes-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0.35rem 0.65rem;
        align-items: start;
        padding: 0.55rem 0.5rem;
        border-radius: 6px;
      }
      .fixes-item:hover {
        background: rgba(127, 127, 127, 0.1);
      }
      .fixes-item .fixes-checkbox {
        margin-top: 0.15rem;
        flex: 0 0 auto;
      }
      .fixes-item-main,
      .fixes-item-main span {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .fixes-item-label {
        display: block;
        cursor: pointer;
      }
      .fixes-item-detail {
        margin-top: 0.35rem;
      }
      .fixes-item-detail summary,
      .maintenance-diagnostic summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
      }
      .fixes-item-detail pre,
      .maintenance-diagnostic pre {
        margin: 0.45rem 0 0;
        padding: 0.65rem;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--bg);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
        font-size: 12px;
      }
      .maintenance-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .maintenance-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 1rem;
        background: var(--panel);
        min-width: 0;
      }
      .maintenance-card h2,
      .maintenance-card h3 {
        margin-top: 0;
      }
      .maintenance-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        margin: 0.65rem 0;
      }
      .maintenance-item {
        border-top: 1px solid var(--line);
        padding: 0.55rem 0;
      }
      .maintenance-item:first-child {
        border-top: 0;
      }
      .maintenance-item strong {
        display: block;
      }
      .maintenance-item .muted {
        font-size: 12px;
      }
      .maintenance-item-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 0.8rem;
        margin-top: 0.35rem;
        color: var(--muted);
        font-size: 12px;
      }
      .maintenance-diagnostic {
        margin-top: 0.35rem;
      }
      .maintenance-diagnostic-panel {
        margin-top: 0.8rem;
        border-top: 1px solid var(--line);
        padding-top: 0.75rem;
      }
      .maintenance-diagnostic-panel > summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 13px;
        font-weight: 650;
      }
      .inbox-handoff {
        margin-top: 0.55rem;
      }
      .inbox-handoff summary {
        cursor: pointer;
        font-weight: 600;
      }
      .inbox-handoff pre {
        margin: 0.55rem 0;
        padding: 0.65rem;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--bg);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
        font-size: 12px;
      }
      .capture-triage-guidance {
        margin-top: 0.7rem;
        padding: 0.75rem;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--bg);
      }
      .capture-triage-guidance > p:first-child {
        margin-top: 0;
      }
      .capture-triage-guidance ol {
        margin: 0.55rem 0 0;
        padding-left: 1.25rem;
      }
      .capture-prompt-panel {
        position: relative;
        margin-top: 0.55rem;
      }
      .capture-prompt-panel pre {
        margin: 0;
        padding-top: 2.9rem;
      }
      .capture-prompt-copy {
        position: absolute;
        top: 0.55rem;
        right: 0.55rem;
        z-index: 1;
        padding: 0.32rem 0.55rem;
        font-size: 12px;
      }
      .capture-copy-status {
        display: block;
        min-height: 1.1rem;
        margin-top: 0.35rem;
      }
      @media (max-width: 860px) {
        .maintenance-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="header-main">
          <h1>Brain Cockpit</h1>
          <div class="muted">Local operator view for hosted Brain, sync, conflicts, and daemon health.</div>
          <div class="active-brain-panel">
            <span class="active-brain-label">Active Brain</span>
            <span class="active-brain-title" id="active-brain-title">-</span>
            <span class="active-brain-subtitle" id="active-brain-subtitle">Checking profile.</span>
          </div>
        </div>
        <div class="toolbar">
          <span class="muted" id="last-updated">Checking...</span>
          <select class="profile-switcher" id="profile-switcher" title="Brain profile" hidden></select>
          <button id="refresh" type="button" title="Reload the Brain Monitor's last doctor report">Reload</button>
        </div>
      </header>

      <div class="tabs">
        <div class="tab-list" data-nav-level="primary" role="tablist" aria-label="Cockpit sections">
          <button class="tab-button" id="tab-overview" type="button" role="tab" aria-controls="panel-overview" aria-selected="true">Overview</button>
          <button class="tab-button" id="tab-activity" type="button" role="tab" aria-controls="panel-activity" aria-selected="false">Activity</button>
          <button class="tab-button" id="tab-latency" type="button" role="tab" aria-controls="panel-latency" aria-selected="false">Latency</button>
          <button class="tab-button" id="tab-checks" type="button" role="tab" aria-controls="panel-checks" aria-selected="false">Checks</button>
          <button class="tab-button" id="tab-fixes" type="button" role="tab" aria-controls="panel-fixes" aria-selected="false">Maintenance</button>
          ${accessAdminUrl ? `<a class="access-nav-link" id="access-roles-link" href="${escapeAttribute(accessAdminUrl)}">Access &amp; Roles ↗</a>` : ""}
        </div>

        <div class="tab-context-strip" id="tab-context-strip" hidden>
          <div class="tab-context-item">
            <span class="tab-context-label">Brain</span>
            <span class="tab-context-value" id="tab-context-brain">-</span>
          </div>
          <div class="tab-context-item">
            <span class="tab-context-label">Status</span>
            <span class="tab-context-value" id="tab-context-state">Checking</span>
          </div>
          <div class="tab-context-item">
            <span class="tab-context-label">Action Queue</span>
            <span class="tab-context-value" id="tab-context-actions">Actions: checking</span>
          </div>
          <div class="tab-context-item">
            <span class="tab-context-label">Sync</span>
            <span class="tab-context-value" id="tab-context-sync">Last sync: -</span>
          </div>
          <div class="tab-context-item">
            <span class="tab-context-label">Doctor</span>
            <span class="tab-context-value" id="tab-context-checked">Checked: -</span>
          </div>
        </div>

        <div class="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
          <div class="status-band">
            <section class="summary" aria-labelledby="health-summary-heading">
              <div class="section-heading summary-heading">
                <div>
                  <h2 id="health-summary-heading">Current Status</h2>
                  <div class="section-note">Selected Brain readiness and local supervision state.</div>
                </div>
              </div>
              <div class="summary-state"><span id="state-dot" class="dot"></span><span id="state-text">Checking</span></div>
              <div id="state-copy" class="muted">Running the hosted doctor.</div>
              <div class="profile-meta profile-meta-primary">
                <div class="profile-meta-row">
                  <span class="profile-meta-label">Active</span>
                  <span id="profile-current-label">-</span>
                </div>
                <div class="profile-meta-row">
                  <span class="profile-meta-label">Brain</span>
                  <code id="profile-brain-id">-</code>
                </div>
                <div class="profile-meta-row">
                  <span class="profile-meta-label">Profile</span>
                  <span id="profile-name">-</span>
                </div>
              </div>
              <details class="profile-diagnostics">
                <summary>Local Diagnostics</summary>
                <div class="profile-meta">
                  <div class="profile-meta-row">
                    <span class="profile-meta-label">Scope</span>
                    <span id="profile-scope">-</span>
                  </div>
                  <div class="profile-meta-row">
                    <span class="profile-meta-label">State</span>
                    <code id="profile-state-file">-</code>
                  </div>
                  <div class="profile-meta-row">
                    <span class="profile-meta-label">Cockpit</span>
                    <a id="profile-cockpit-url" href="#">-</a>
                  </div>
                </div>
              </details>
            </section>
            <section class="action-summary-panel" aria-labelledby="action-summary-heading">
              <div class="section-heading">
                <div>
                  <h2 id="action-summary-heading">Needs Action</h2>
                  <div class="section-note">Doctor actions requiring operator judgement.</div>
                </div>
                <span class="action-count" id="action-summary-count">Checking</span>
              </div>
              <div class="action-summary-list" id="action-summary-list"></div>
            </section>
          </div>

          <section class="metric-section" aria-labelledby="metric-section-heading">
            <div class="section-heading metric-section-heading">
              <div>
                <h2 id="metric-section-heading">Operational Signals</h2>
                <div class="section-note">Hosted/local state, activity volume, and latency for the selected Brain.</div>
              </div>
            </div>
            <div class="metric-groups">
              <div class="metric-group">
                <h3 class="metric-group-title">Content State</h3>
                <div class="metrics">
                  <div class="metric">
                    <div class="metric-label">Hosted files</div>
                    <div class="metric-value" id="hosted-files">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Local files</div>
                    <div class="metric-value" id="local-files">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Open conflicts</div>
                    <div class="metric-value" id="open-conflicts">-</div>
                  </div>
                  <div class="metric timestamp-metric">
                    <div class="metric-label">Last sync</div>
                    <div class="metric-value timestamp-value" id="last-sync">-</div>
                  </div>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-group-title">Activity</h3>
                <div class="metrics">
                  <div class="metric">
                    <div class="metric-label">Ops 24H</div>
                    <div class="metric-value" id="ops-24h">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Ops 7D</div>
                    <div class="metric-value" id="ops-7d">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Ops total</div>
                    <div class="metric-value" id="ops-total">-</div>
                  </div>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-group-title">Latency</h3>
                <div class="metrics">
                  <div class="metric">
                    <div class="metric-label">Read op</div>
                    <div class="metric-value" id="read-op-latency">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Write op</div>
                    <div class="metric-value" id="write-op-latency">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Sync wait</div>
                    <div class="metric-value" id="sync-wait-latency">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Hosted HTTP</div>
                    <div class="metric-value" id="hosted-latency">-</div>
                  </div>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-group-title">Runtime</h3>
                <div class="metrics">
                  <div class="metric">
                    <div class="metric-label">Postgres</div>
                    <div class="metric-value" id="postgres-latency">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Sync cycle</div>
                    <div class="metric-value" id="sync-latency">-</div>
                  </div>
                  <div class="metric">
                    <div class="metric-label">Doctor run</div>
                    <div class="metric-value" id="doctor-latency">-</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="overview-grid">
            <section class="overview-primary" aria-labelledby="overview-actions-heading">
              <div class="section-heading">
                <div>
                  <h2 id="overview-actions-heading">Operator Queue</h2>
                  <div class="section-note">Actionable doctor findings for the selected Brain.</div>
                </div>
              </div>
              <div class="next-actions" id="actions"></div>
            </section>

            <div class="overview-side">
              <section aria-labelledby="overview-usage-heading">
                <h2 id="overview-usage-heading">Usage Snapshot</h2>
                <div class="activity-list" id="operation-usage"></div>
              </section>
            </div>
          </div>
        </div>

        <div class="tab-panel" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden>
          <div class="subtab-shell">
            <div class="subtab-list" data-nav-level="secondary" role="tablist" aria-label="Activity sections">
              <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-operations" type="button" role="tab" aria-controls="activity-view-operations" aria-selected="true">Operation Log</button>
              <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-auth" type="button" role="tab" aria-controls="activity-view-auth" aria-selected="false">Auth</button>
              <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-brain" type="button" role="tab" aria-controls="activity-view-brain" aria-selected="false">Recent Brain Activity</button>
              <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-watch" type="button" role="tab" aria-controls="activity-view-watch" aria-selected="false">Cockpit Watch</button>
            </div>
          </div>

          <section class="subtab-panel activity-view" data-subtab-scope="activity" id="activity-view-operations" role="tabpanel" aria-labelledby="activity-subtab-operations">
            <h2>Operation Log</h2>
            <div class="section-note">The event log: hosted MCP tool-call and auth metadata, including operation type, timing layer, safe target, status, latency, DB summary, and timestamp. Auth failures usually indicate stale or disconnected client credentials and may require connector re-enrollment.</div>
            <div class="activity-list" id="operation-events"></div>
          </section>

          <section class="subtab-panel activity-view" data-subtab-scope="activity" id="activity-view-auth" role="tabpanel" aria-labelledby="activity-subtab-auth" hidden>
            <h2>Auth Failures</h2>
            <div class="section-note">Hosted MCP authorization telemetry: current-window failure counts, trend versus the prior window, safe reason/target metadata, and recent metadata-only auth events.</div>
            <div class="activity-list" id="auth-failure-summary"></div>
            <div class="activity-list" id="auth-failure-trend"></div>
            <div class="activity-list" id="auth-failure-breakdowns"></div>
            <div class="activity-list" id="auth-failure-recent"></div>
          </section>

          <section class="subtab-panel activity-view" data-subtab-scope="activity" id="activity-view-brain" role="tabpanel" aria-labelledby="activity-subtab-brain" hidden>
            <h2>Recent Brain Activity</h2>
            <div class="section-note">Brain content state changes: file revisions, conflict opens, and conflict resolutions.</div>
            <div class="activity-list" id="activity"></div>
          </section>

          <section class="subtab-panel activity-view" data-subtab-scope="activity" id="activity-view-watch" role="tabpanel" aria-labelledby="activity-subtab-watch" hidden>
            <h2>Cockpit Watch</h2>
            <div class="section-note">Local cockpit observations from this browser session, such as status, sync, and conflict-count changes.</div>
            <div class="activity-list" id="operation-log-activity"></div>
          </section>
        </div>

        <div class="tab-panel" id="panel-latency" role="tabpanel" aria-labelledby="tab-latency" hidden>
          <div class="subtab-shell">
            <div class="subtab-list" data-nav-level="secondary" role="tablist" aria-label="Latency sections">
              <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-slo" type="button" role="tab" aria-controls="latency-view-slo" aria-selected="true">SLOs & Findings</button>
              <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-trends" type="button" role="tab" aria-controls="latency-view-trends" aria-selected="false">Operation Trends</button>
              <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-slowest" type="button" role="tab" aria-controls="latency-view-slowest" aria-selected="false">Slowest Operations</button>
              <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-samples" type="button" role="tab" aria-controls="latency-view-samples" aria-selected="false">Recent Samples</button>
              <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-infra" type="button" role="tab" aria-controls="latency-view-infra" aria-selected="false">Infrastructure Checks</button>
            </div>
          </div>

          <section class="subtab-panel latency-view" data-subtab-scope="latency" id="latency-view-slo" role="tabpanel" aria-labelledby="latency-subtab-slo">
            <h2>SLOs & Findings</h2>
            <div class="section-note">Operational thresholds over the bounded telemetry window, plus DB-hotspot evidence when a latency breach points at Postgres work.</div>
            <div class="activity-list" id="latency-slo-findings"></div>
          </section>

          <section class="subtab-panel latency-view" data-subtab-scope="latency" id="latency-view-trends" role="tabpanel" aria-labelledby="latency-subtab-trends" hidden>
            <h2>User-Facing Operations</h2>
            <div class="section-note">Layered latency view: countable server tool calls, client-observed end-to-end samples, exact tool summaries, and bounded DB contribution.</div>
            <div class="activity-list" id="user-operation-latencies"></div>
          </section>

          <section class="subtab-panel latency-view" data-subtab-scope="latency" id="latency-view-slowest" role="tabpanel" aria-labelledby="latency-subtab-slowest" hidden>
            <h2>Slowest Operations</h2>
            <div class="section-note">The slowest individual operations in the current bounded telemetry window.</div>
            <div class="activity-list" id="slowest-operation-latencies"></div>
          </section>

          <section class="subtab-panel latency-view" data-subtab-scope="latency" id="latency-view-samples" role="tabpanel" aria-labelledby="latency-subtab-samples" hidden>
            <h2>Recent Samples</h2>
            <div class="section-note">Recent server-side and client-observed samples, separated so they are not double-counted.</div>
            <div class="activity-list" id="recent-operation-latencies"></div>
          </section>

          <section class="subtab-panel latency-view" data-subtab-scope="latency" id="latency-view-infra" role="tabpanel" aria-labelledby="latency-subtab-infra" hidden>
            <h2>Infrastructure Checks</h2>
            <div class="activity-list" id="latencies"></div>
          </section>
        </div>

        <div class="tab-panel" id="panel-checks" role="tabpanel" aria-labelledby="tab-checks" hidden>
          <section>
            <h2>Checks</h2>
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody id="checks"></tbody>
            </table>
          </section>
        </div>

        <div class="tab-panel" id="panel-fixes" role="tabpanel" aria-labelledby="tab-fixes" hidden>
          <div class="maintenance-grid">
            <section class="maintenance-card" aria-labelledby="maintenance-lint-heading">
              <h2 id="maintenance-lint-heading">Brain Lint</h2>
              <p class="muted">Refresh the canonical assessment here. This does not change Brain content. You only review explicitly labelled user decisions and mechanical fixes; you never need to review technical diagnostics individually.</p>
              <div class="fixes-toolbar">
                <button id="lint-run" type="button">Refresh lint assessment</button>
                <span id="lint-status" class="muted">Loading latest report…</span>
              </div>
              <div id="lint-summary"></div>
              <div id="lint-findings"></div>
              <details id="lint-maintainer-panel" class="maintenance-diagnostic-panel">
                <summary id="lint-maintainer-summary">Maintainer-only diagnostics and context</summary>
                <p class="muted">These entries are automatically classified for engineering/content maintenance. They are not an operator approval queue.</p>
                <div id="lint-maintainer-findings"></div>
                <div id="lint-technical-diagnostics"></div>
              </details>
            </section>

            <section class="maintenance-card" aria-labelledby="maintenance-inbox-heading">
              <h2 id="maintenance-inbox-heading">Inbox</h2>
              <p class="muted">Refresh the pending-file list without leaving Cockpit. This scan is detection-only: it cannot ingest or clear a file. Use the prepared handoff below in an interactive Claude session with access to this Brain.</p>
              <div class="fixes-toolbar">
                <button id="inbox-scan" type="button">Refresh inbox scan</button>
                <span id="inbox-status" class="muted"></span>
              </div>
              <div id="inbox-files"></div>
            </section>
          </div>

          <section>
            <h2>Actions You Can Approve</h2>
            <p class="muted">Only task relocation, Done-date stamping, and non-destructive archiving are available here. Open “Show full proposed change” to inspect the complete item before selecting it.</p>
            <div class="fixes-toolbar">
              <button id="fixes-reload" type="button">Reload maintenance</button>
              <button id="fixes-apply" type="button" class="fixes-apply" disabled>Apply selected</button>
              <span id="fixes-status" class="muted"></span>
            </div>
            <div class="fixes-selection-header">
              <label class="fixes-select-all" for="fixes-select-all">
                <input id="fixes-select-all" type="checkbox" aria-label="Select all fixes" disabled>
                <span>Select all</span>
              </label>
              <span id="fixes-selection-status" class="muted">0 of 0 selected.</span>
            </div>
            <div id="fixes-list">Loading…</div>
          </section>
        </div>
      </div>
    </main>

    <script>
      const COCKPIT_NONCE = ${JSON.stringify(cockpitNonce)};
      const COCKPIT_BRAIN_ID = ${JSON.stringify(cockpitBrainId)};
      const operationLog = [];
      let previousSnapshot = null;

      const statusCopy = {
        pass: ["Safe to use hosted", "Core hosted health, local sync, conflict count, and supervisor checks are currently acceptable."],
        warn: ["Action needed", "One or more current checks has a specific operator action below."],
        fail: ["Blocked", "A critical hosted Brain check failed. Fix this before relying on hosted Brain."],
      };

      const usefulDetailKeys = [
        "baseUrl",
        "brainId",
        "profileName",
        "supervisor",
        "stackBrainId",
        "brainIdMatches",
        "source",
        "telemetrySource",
        "postgresState",
        "hostedFiles",
        "trackedFiles",
        "openConflicts",
        "latestHostedUpdate",
        "latestOperationAt",
        "latestReadLatencyMs",
        "latestWriteLatencyMs",
        "latestSyncWaitLatencyMs",
        "operationCount",
        "historyCount",
        "clientHistoryCount",
        "performanceStatus",
        "lastLintAt",
        "ageDays",
        "maxAgeDays",
        "issueCount",
        "primaryIssueCount",
        "diagnosticCount",
        "externalReferenceCount",
        "automaticFixCount",
        "operatorDecisionCount",
        "maintainerFindingCount",
        "pendingFiles",
        "checkedAt",
        "state",
        "optional",
        "message",
        "resolution",
        "cycle",
        "pushed",
        "pulled",
        "unchanged",
        "conflicts",
        "totalMs",
        "latencyMs",
        "pid",
        "startedAt",
        "label",
        "activeCount",
        "lastExitCode",
        "stackStatusFile",
        "syncState",
        "syncPid",
        "syncPidAlive",
        "cockpitState",
        "cockpitPid",
        "cockpitPidAlive",
        "cockpitUrl",
        "app",
        "error",
        "postgresError",
      ];

      function byName(payload, name) {
        return payload.checks?.find((check) => check.name === name);
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function ageLabel(iso) {
        if (!iso) return "-";
        const ms = Date.now() - Date.parse(iso);
        if (!Number.isFinite(ms)) return "-";
        const seconds = Math.max(0, Math.round(ms / 1000));
        if (seconds < 60) return seconds + "s ago";
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return minutes + "m ago";
        const hours = Math.round(minutes / 60);
        return hours + "h ago";
      }

      function timeZoneOffsetLabel(date) {
        const offsetMinutes = -date.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? "+" : "-";
        const absoluteOffset = Math.abs(offsetMinutes);
        const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
        const minutes = String(absoluteOffset % 60).padStart(2, "0");
        return "UTC" + sign + hours + ":" + minutes;
      }

      function displayTimestamp(iso) {
        if (!iso) return "-";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "-";
        const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()];
        const year = String(date.getFullYear()).padStart(4, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        return year + "-" + month + "-" + day + "; " + hours + ":" + minutes + ":" + seconds + " " + timeZoneOffsetLabel(date);
      }

      function localTime(iso) {
        return displayTimestamp(iso);
      }

      function localDateTime(iso) {
        return displayTimestamp(iso);
      }

      function timestampParts(iso) {
        const timestamp = displayTimestamp(iso);
        if (timestamp === "-") return { date: "-", time: "" };
        const [date, time] = timestamp.split("; ");
        return {
          date: date || timestamp,
          time: time || "",
        };
      }

      function renderTimestampStack(iso) {
        const parts = timestampParts(iso);
        const time = parts.time
          ? "<span class=\"timestamp-time\">" + escapeHtml(parts.time) + "</span>"
          : "";
        return "<span class=\"timestamp-stack\">" +
          "<span class=\"timestamp-date\">" + escapeHtml(parts.date) + "</span>" +
          time +
        "</span>";
      }

      function compactHash(value) {
        return value ? String(value).slice(0, 10) : "-";
      }

      function formatCount(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        return new Intl.NumberFormat().format(number);
      }

      function formatPercent(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        return (number * 100).toFixed(number > 0 && number < 0.01 ? 2 : 1) + "%";
      }

      function formatSignedCount(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        if (number === 0) return "flat";
        return (number > 0 ? "+" : "") + formatCount(number);
      }

      function formatDuration(ms) {
        const value = Number(ms);
        if (!Number.isFinite(value)) return "-";
        if (value < 1000) return Math.round(value) + "ms";
        return (value / 1000).toFixed(value < 10000 ? 1 : 0) + "s";
      }

      function eventLabel(eventType) {
        if (eventType === "file_revision") return "File revision";
        if (eventType === "conflict_opened") return "Conflict opened";
        if (eventType === "conflict_resolved") return "Conflict resolved";
        return eventType || "Activity";
      }

      function readableOrigin(origin) {
        if (origin === "hosted_mcp") return "hosted MCP";
        if (origin === "local_agent") return "local sync";
        return origin || "unknown";
      }

      function detailSummary(details = {}) {
        return usefulDetailKeys
          .filter((key) => details[key] !== undefined && details[key] !== null && details[key] !== "")
          .map((key) => {
            const value = Array.isArray(details[key]) ? details[key].join(" | ") : details[key];
            const display = /At$|checkedAt|latestHostedUpdate/.test(key)
              ? localDateTime(value)
              : /Ms$/.test(key)
                ? formatDuration(value)
                : value;
            return "<code>" + escapeHtml(key) + "</code>: " + escapeHtml(display);
          })
          .join("<br>");
      }

      function profileFromPayload(payload) {
        const profile = payload.profile || {};
        const currentProfile = profile.currentProfile || {};
        const postgres = byName(payload, "postgres_summary")?.details || {};
        const local = byName(payload, "local_sync_state")?.details || {};
        const sync = byName(payload, "sync_health")?.details || {};
        const supervisor = byName(payload, "launchd")?.details || {};
        const profileBrainId =
          profile.brainId || currentProfile.brainId || postgres.brainId || supervisor.brainId || "-";
        const profileName =
          profile.profileName || currentProfile.profileName || supervisor.profileName || profileBrainId;
        const profileLabel =
          profile.profileLabel ||
          currentProfile.profileLabel ||
          (profileName && profileName !== profileBrainId
            ? profileName + " (" + profileBrainId + ")"
            : profileBrainId);
        const availableProfiles = Array.isArray(profile.availableProfiles) ? profile.availableProfiles : [];
        const profileCount =
          Number(profile.profileCount || availableProfiles.length || (profileBrainId === "-" ? 0 : 1));
        return {
          brainId: profileBrainId,
          profileName,
          profileLabel,
          switcherLabel: profile.switcherLabel || currentProfile.switcherLabel || profileLabel,
          profileCount,
          isMultiProfile: Boolean(profile.isMultiProfile || profileCount > 1),
          currentProfile,
          stateFile: profile.stateFile || local.stateFile || sync.healthFile || "-",
          healthFile: profile.healthFile || sync.healthFile || "-",
          logDir: profile.logDir || "-",
          cockpitUrl: profile.cockpitUrl || supervisor.cockpitUrl || window.location.href,
          supervisor: profile.supervisor || supervisor.supervisor || "-",
          availableProfiles,
        };
      }

      function profileOptionLabel(item) {
        if (item.switcherLabel) return item.switcherLabel;
        if (item.profileLabel) return item.profileLabel;
        const itemBrainId = item.brainId || item.id || "";
        const itemName = item.profileName || item.displayName || item.name || itemBrainId;
        if (itemName && itemBrainId && itemName !== itemBrainId) {
          return itemName + " (" + itemBrainId + ")";
        }
        return itemBrainId || item.cockpitUrl || "Unknown Brain";
      }

      function renderProfileSwitcher(profile) {
        const select = document.getElementById("profile-switcher");
        const profiles = profile.availableProfiles.filter((item) => item.cockpitUrl);
        if (profiles.length <= 1) {
          select.hidden = true;
          select.innerHTML = "";
          return;
        }

        select.hidden = false;
        select.title = profile.isMultiProfile ? "Switch Brain profile" : "Brain profile";
        select.innerHTML = profiles.map((item) => {
          const selected = item.brainId === profile.brainId ? " selected" : "";
          const label = profileOptionLabel(item);
          return "<option value=\"" + escapeHtml(item.cockpitUrl) + "\"" + selected + ">" + escapeHtml(label) + "</option>";
        }).join("");
        select.onchange = () => {
          const nextUrl = select.value;
          if (nextUrl && nextUrl !== window.location.href) {
            window.location.href = nextUrl;
          }
        };
      }

      function actionItems(payload) {
        if (Array.isArray(payload.actions) && payload.actions.length > 0) {
          return payload.actions.map((action) => ({
            status: action.status || action.level || "warn",
            brain_id: action.brain_id || payload.profile?.brainId || "",
            reason: action.reason || "check_review",
            urgency: action.urgency || "soon",
            title: action.title || "Review doctor action",
            next_action: action.next_action || action.detail || "",
          }));
        }

        const items = [];
        const openConflicts = byName(payload, "postgres_summary")?.details?.openConflicts || 0;
        const syncHealth = byName(payload, "sync_health");
        const launchd = byName(payload, "launchd");

        if (payload.status === "pass") {
          items.push({
            status: "pass",
            brain_id: payload.profile?.brainId || "",
            reason: "none",
            urgency: "none",
            title: "No operator action needed right now.",
            next_action: "This is the state we want before a real hosted test drive.",
          });
        }

        if (openConflicts > 0) {
          items.push({
            status: "fail",
            brain_id: payload.profile?.brainId || "",
            reason: "open_conflicts",
            urgency: "now",
            title: "Review open conflicts.",
            next_action: "Resolve through the documented conflict workflow before asking clients to trust hosted state.",
          });
        }

        if (syncHealth?.status === "warn") {
          const supervisor = launchd?.details?.supervisor;
          items.push({
            status: "warn",
            brain_id: payload.profile?.brainId || "",
            reason: "sync_health_stale",
            urgency: "soon",
            title: "Sync health is stale or incomplete.",
            next_action:
              supervisor === "menubar"
                ? "Check Brain Monitor and recent sync logs."
                : "Check the local launchd loop and recent sync logs.",
          });
        }

        if (syncHealth?.status === "fail") {
          items.push({
            status: "fail",
            brain_id: payload.profile?.brainId || "",
            reason: "sync_health_failed",
            urgency: "now",
            title: "Sync health is failing.",
            next_action: "Run npm run sync -- summary, then inspect the reported conflict or error.",
          });
        }

        if (launchd?.status === "warn") {
          const menubar = launchd.details?.supervisor === "menubar";
          items.push({
            status: "warn",
            brain_id: payload.profile?.brainId || "",
            reason: menubar ? "monitor_supervisor" : "sync_launchagent",
            urgency: "soon",
            title: menubar
              ? "Brain Monitor is not confidently supervising this Brain."
              : "Launchd is not confidently running.",
            next_action: menubar
              ? "Restart this local stack before a test drive."
              : "Restart the local sync agent before a test drive.",
          });
        }

        const seen = new Set();
        return items.filter((item) => {
          const key = [item.status, item.reason, item.title, item.next_action].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function renderActionItems(payload) {
        return actionItems(payload)
          .map((action) => {
            const status = action.status || "warn";
            const brainId = action.brain_id || payload.profile?.brainId || "";
            const urgency = action.urgency || "soon";
            const reason = action.reason || "check_review";
            const nextAction = action.next_action || "";
            const meta = [brainId, reason, "urgency " + urgency].filter(Boolean).join(" - ");
            const next = nextAction
              ? "<div class=\"details\">Next: " + escapeHtml(nextAction) + "</div>"
              : "";
            return "<div class=\"action-item\"><div class=\"action-heading\"><span class=\"pill " + escapeHtml(status) + "\">" + escapeHtml(status) + "</span><span class=\"event-title\">" + escapeHtml(action.title || "Review doctor action") + "</span></div><div class=\"event-meta\">" + escapeHtml(meta) + "</div>" + next + "</div>";
          })
          .join("");
      }

      function renderActionSummary(payload) {
        const items = actionItems(payload);
        const actionable = actionableItems(payload);
        const visible = actionable.length > 0 ? actionable.slice(0, 3) : items.slice(0, 1);
        const worstStatus = actionable.some((action) => (action.status || action.level) === "fail")
          ? "fail"
          : actionable.length > 0
            ? "warn"
            : "pass";
        const count = document.getElementById("action-summary-count");
        count.className = "action-count " + worstStatus;
        count.textContent = actionable.length > 0
          ? String(actionable.length) + " open"
          : "None";
        document.getElementById("action-summary-list").innerHTML = visible
          .map((action) => {
            const status = action.status || "warn";
            const urgency = action.urgency || "soon";
            const reason = action.reason || "check_review";
            const nextAction = action.next_action || "";
            const next = nextAction
              ? "<div class=\"details\">Next: " + escapeHtml(nextAction) + "</div>"
              : "";
            return "<div class=\"action-item\"><div class=\"action-heading\"><span class=\"pill " + escapeHtml(status) + "\">" + escapeHtml(status) + "</span><span class=\"event-title\">" + escapeHtml(action.title || "Review doctor action") + "</span></div><div class=\"event-meta\">" + escapeHtml(reason + " - urgency " + urgency) + "</div>" + next + "</div>";
          })
          .join("");
      }

      function actionableItems(payload) {
        return actionItems(payload).filter((action) => {
          const status = (action.status || action.level || "").toLowerCase();
          return (status === "warn" || status === "fail") && action.reason !== "none";
        });
      }

      function renderTabContext(payload, profile, statusTitle, sync) {
        const actionable = actionableItems(payload);
        document.getElementById("tab-context-brain").textContent = profile.profileLabel || profile.brainId || "-";
        document.getElementById("tab-context-state").textContent = statusTitle;
        document.getElementById("tab-context-actions").textContent = actionable.length > 0
          ? "Actions: " + String(actionable.length) + " open"
          : "Actions: none";
        document.getElementById("tab-context-sync").textContent = "Last sync: " + (sync.checkedAt ? displayTimestamp(sync.checkedAt) : "-");
        document.getElementById("tab-context-checked").textContent = payload.checkedAt
          ? "Checked: " + ageLabel(payload.checkedAt)
          : "Checked: just now";
      }

      function currentSnapshot(payload) {
        const postgres = byName(payload, "postgres_summary")?.details || {};
        const sync = byName(payload, "sync_health")?.details || {};
        return {
          status: payload.status || "unknown",
          latestHostedUpdate: postgres.latestHostedUpdate || null,
          openConflicts: postgres.openConflicts ?? null,
          syncCycle: sync.cycle ?? null,
          pushed: sync.pushed ?? null,
          pulled: sync.pulled ?? null,
          conflicts: sync.conflicts ?? null,
        };
      }

      function appendOperation(message, kind = "info") {
        operationLog.unshift({
          at: new Date().toISOString(),
          kind,
          message,
        });
        operationLog.splice(8);
      }

      function detectChanges(payload) {
        const next = currentSnapshot(payload);
        if (!previousSnapshot) {
          appendOperation("Cockpit connected; watching hosted Brain state.");
          previousSnapshot = next;
          return;
        }

        if (next.latestHostedUpdate && next.latestHostedUpdate !== previousSnapshot.latestHostedUpdate) {
          appendOperation("Hosted Brain updated at " + localTime(next.latestHostedUpdate) + ".");
        }

        if (next.openConflicts !== previousSnapshot.openConflicts) {
          appendOperation("Open conflicts changed from " + previousSnapshot.openConflicts + " to " + next.openConflicts + ".", next.openConflicts ? "warn" : "pass");
        }

        if (
          next.syncCycle !== previousSnapshot.syncCycle &&
          ((next.pushed || 0) > 0 || (next.pulled || 0) > 0 || (next.conflicts || 0) > 0)
        ) {
          appendOperation("Sync cycle " + next.syncCycle + ": pushed " + next.pushed + ", pulled " + next.pulled + ", conflicts " + next.conflicts + ".");
        }

        if (next.status !== previousSnapshot.status) {
          appendOperation("Overall status changed from " + previousSnapshot.status + " to " + next.status + ".", next.status);
        }

        previousSnapshot = next;
      }

      function renderActivity(payload) {
        const events = byName(payload, "recent_activity")?.details?.events || [];
        document.getElementById("activity").innerHTML = events.length
          ? events.map((event) => {
              const actor = event.actorName || event.actorEmail || readableOrigin(event.origin);
              return "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(eventLabel(event.eventType)) + ": " + escapeHtml(event.filename) + "</div>" +
                "<div class=\"event-meta\">" + escapeHtml(localDateTime(event.occurredAt)) + " · " + escapeHtml(readableOrigin(event.origin)) + " · " + escapeHtml(actor) + " · " +
                  "<span class=\"mono\">" + escapeHtml(compactHash(event.contentSha256 || event.referenceId)) + "</span></div>" +
              "</div>";
            }).join("")
          : "<div class=\"event muted\">No recent Brain activity reported.</div>";
      }

      function usageWindow(details, key) {
        const windows = details.usageStats?.windows || [];
        return windows.find((window) => window.key === key) || null;
      }

      function byKindSummary(byKind) {
        const rows = Array.isArray(byKind) ? byKind : [];
        return rows.length
          ? rows.map((row) => operationKindLabel(row.kind) + " " + formatCount(row.totalCount)).join(" · ")
          : "no operation types recorded";
      }

      function renderOperationUsage(payload) {
        const details = byName(payload, "user_operation_latency")?.details || {};
        const usage = details.usageStats || {};
        const rows = [usageWindow(details, "24h"), usageWindow(details, "7d"), usage.allTime]
          .filter(Boolean);

        document.getElementById("operation-usage").innerHTML = rows.length
          ? rows.map((row) => {
              const failed = Number(row.failedCount || 0);
              const meta = [
                byKindSummary(row.byKind),
                failed ? formatCount(failed) + " failed" : null,
                row.windowStartedAt ? "since " + localDateTime(row.windowStartedAt) : null,
              ].filter(Boolean).join(" · ");
              return "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(row.label || row.key) + ": " + escapeHtml(formatCount(row.totalCount)) + " operations</div>" +
                "<div class=\"event-meta\">" + escapeHtml(meta) + "</div>" +
              "</div>";
            }).join("")
          : "<div class=\"event muted\">No operation usage has been recorded yet.</div>";
      }

      function renderOperationEvents(payload) {
        const details = byName(payload, "user_operation_latency")?.details || {};
        const events = details.eventLog || [];
        const windowDays = details.eventLogWindowDays || 30;
        document.getElementById("operation-events").innerHTML = events.length
          ? renderOperationEventTable(events, details)
          : "<div class=\"event muted\">No operation metadata recorded in the last " + escapeHtml(windowDays) + " days.</div>";
      }

      function renderOperationEventTable(events, details) {
        return "<div class=\"operation-table-wrap\">" +
          "<table class=\"operation-log-table\">" +
            "<thead><tr>" +
              "<th class=\"tool-col\">Tool</th>" +
              "<th class=\"duration-col\">Latency</th>" +
              "<th class=\"kind-col\">Type</th>" +
              "<th class=\"timing-col\">Timing</th>" +
              "<th class=\"status-col\">Status</th>" +
              "<th class=\"target-col\">Target</th>" +
              "<th class=\"source-col\">Source</th>" +
              "<th class=\"db-col\">DB</th>" +
              "<th class=\"operation-time-col\">When</th>" +
            "</tr></thead>" +
            "<tbody>" +
              events.map((event) => renderOperationEventRows(event, details)).join("") +
            "</tbody>" +
          "</table>" +
        "</div>";
      }

      function renderOperationEventRows(event, details) {
        const tool = event.name || event.eventType || "operation";
        const target = event.target || event.filename || "-";
        const source = event.source || details.telemetrySource || details.source || "-";
        const status = event.ok ? "ok" : "failed";
        const statusClass = event.ok ? "status-pass" : "status-fail";
        const sourceDisplay = sourceLabel(source);
        const errorTitle = event.error ? " - " + event.error : "";

        return "<tr class=\"operation-event-row\">" +
          "<td class=\"tool-col\" title=\"" + escapeHtml(tool) + "\">" + escapeHtml(tool) + "</td>" +
          "<td class=\"duration-col\" title=\"" + escapeHtml(formatDuration(event.latencyMs)) + "\">" + escapeHtml(formatDuration(event.latencyMs)) + "</td>" +
          "<td class=\"kind-col\" title=\"" + escapeHtml(operationKindLabel(event.kind)) + "\">" + escapeHtml(operationKindLabel(event.kind)) + "</td>" +
          "<td class=\"timing-col\" title=\"" + escapeHtml(timingLayerLabel(event.timingLayer)) + "\">" + escapeHtml(timingLayerLabel(event.timingLayer)) + "</td>" +
          "<td class=\"status-col " + statusClass + "\" title=\"" + escapeHtml(status + errorTitle) + "\">" + escapeHtml(status) + "</td>" +
          "<td class=\"target-col\" title=\"" + escapeHtml(target) + "\">" + escapeHtml(target) + "</td>" +
          "<td class=\"source-col\" title=\"" + escapeHtml(source) + "\">" + escapeHtml(sourceDisplay) + "</td>" +
          "<td class=\"db-col\" title=\"" + escapeHtml(dbSummaryLabel(event.db) || "-") + "\">" + escapeHtml(dbSummaryCompact(event.db) || "-") + "</td>" +
          "<td class=\"operation-time-col\" title=\"" + escapeHtml(localDateTime(event.at)) + "\">" + renderTimestampStack(event.at) + "</td>" +
        "</tr>" +
        renderOperationDbDetailRow(event.db);
      }

      function sourceLabel(source) {
        if (source === "hosted_mcp_server") return "server";
        if (source === "hosted_mcp_client_e2e" || source === "smoke-hosted-oauth") return "client E2E";
        if (source === "hosted_mcp_sync_wait") return "sync wait";
        if (source === "local_json_cache") return "local cache";
        return source || "-";
      }

      function renderOperationDbDetailRow(db) {
        if (!Array.isArray(db?.spans) || db.spans.length === 0) return "";
        return "<tr class=\"operation-db-detail-row\"><td colspan=\"9\">" +
          "<details>" +
            "<summary>DB spans: " + escapeHtml(dbSummaryCompact(db)) + "</summary>" +
            renderDbSpanTable(db) +
          "</details>" +
        "</td></tr>";
      }

      function dbSummaryCompact(db) {
        if (!db || !Number(db.queryCount)) return null;
        return [
          formatCount(db.queryCount) + "q",
          formatDuration(db.totalMs),
          db.maxMs !== undefined && db.maxMs !== null ? "max " + formatDuration(db.maxMs) : null,
          db.failedCount ? formatCount(db.failedCount) + " fail" : null,
        ].filter(Boolean).join("/");
      }

      function renderDbSpanTable(db) {
        const allSpans = Array.isArray(db?.spans) ? db.spans : [];
        const spans = allSpans.slice(0, 4);
        if (spans.length === 0) return "";
        const hidden = Math.max(0, allSpans.length - spans.length);
        const truncated = Math.max(0, Number(db.truncatedCount || 0)) + hidden;
        return "<div class=\"db-span-panel\">" +
          "<table class=\"db-span-table\">" +
            "<thead><tr><th>Operation</th><th>Target</th><th>Duration</th><th>Rows</th><th>Status</th></tr></thead>" +
            "<tbody>" +
              spans.map((span) =>
                "<tr>" +
                  "<td data-label=\"Operation\">" + escapeHtml(span.operation || "query") + "</td>" +
                  "<td data-label=\"Target\">" + escapeHtml(span.target || span.name || "-") + "</td>" +
                  "<td data-label=\"Duration\">" + escapeHtml(formatDuration(span.durationMs)) + "</td>" +
                  "<td data-label=\"Rows\">" + escapeHtml(formatCount(span.rowCount)) + "</td>" +
                  "<td data-label=\"Status\">" + escapeHtml(span.ok ? "ok" : (span.error || "failed")) + "</td>" +
                "</tr>"
              ).join("") +
            "</tbody>" +
          "</table>" +
          (truncated ? "<div class=\"event-meta\">" + escapeHtml(formatCount(truncated)) + " more DB spans truncated.</div>" : "") +
        "</div>";
      }

      function renderOperationLog() {
        const markup = operationLog.length
          ? operationLog.map((event) =>
              "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(event.message) + "</div>" +
                "<div class=\"event-meta\">" + escapeHtml(localDateTime(event.at)) + "</div>" +
              "</div>"
            ).join("")
          : "<div class=\"event muted\">Waiting for first refresh.</div>";
        for (const targetId of ["operation-log", "operation-log-activity"]) {
          const target = document.getElementById(targetId);
          if (target) target.innerHTML = markup;
        }
      }

      function renderLatencies(payload) {
        const checks = payload.checks || [];
        const rows = [
          {
            label: "Doctor run",
            value: payload.latencyMs,
            note: "Total time for the cockpit API refresh to collect all checks.",
          },
          ...checks
            .map((check) => ({
              label: check.name,
              value: check.details?.latencyMs,
              note: check.status + " check runtime",
            })),
          {
            label: "Sync cycle",
            value: byName(payload, "sync_health")?.details?.totalMs,
            note: "Most recent local sync loop duration reported by the sync agent.",
          },
        ].filter((row) => row.value !== undefined && row.value !== null);

        document.getElementById("latencies").innerHTML = rows.length
          ? rows.map((row) =>
              "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(row.label) + ": " + escapeHtml(formatDuration(row.value)) + "</div>" +
                "<div class=\"event-meta\">" + escapeHtml(row.note) + "</div>" +
              "</div>"
            ).join("")
          : "<div class=\"event muted\">No latency measures reported yet.</div>";
      }

      function operationKindLabel(kind) {
        if (kind === "read") return "read";
        if (kind === "write") return "write";
        if (kind === "sync_wait") return "sync wait";
        if (kind === "auth") return "auth";
        return kind || "operation";
      }

      function timingLayerLabel(layer) {
        if (layer === "server_tool") return "server tool";
        if (layer === "client_e2e") return "client E2E";
        if (layer === "sync_wait") return "sync wait";
        if (layer === "auth") return "auth";
        return layer || "unknown layer";
      }

      function dbSummaryLabel(db) {
        if (!db || !Number(db.queryCount)) return null;
        const parts = [
          "db " + formatCount(db.queryCount) + "q",
          formatDuration(db.totalMs),
          db.maxMs !== undefined && db.maxMs !== null ? "max " + formatDuration(db.maxMs) : null,
          db.failedCount ? formatCount(db.failedCount) + " db failed" : null,
        ].filter(Boolean);
        return parts.join("/");
      }

      function formatDelta(ms) {
        const value = Number(ms);
        if (!Number.isFinite(value)) return "-";
        if (value === 0) return "flat";
        return (value > 0 ? "+" : "-") + formatDuration(Math.abs(value));
      }

      function trendDelta(summary) {
        const points = Array.isArray(summary?.trend) ? summary.trend : [];
        if (points.length < 2) return null;
        const first = Number(points[0]?.latencyMs);
        const last = Number(points[points.length - 1]?.latencyMs);
        if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
        return last - first;
      }

      function renderSparkline(points) {
        const values = (Array.isArray(points) ? points : [])
          .map((point) => Number(point.latencyMs))
          .filter(Number.isFinite);
        if (values.length < 2) {
          return "<div class=\"sparkline event-meta\">Need at least two samples for trend.</div>";
        }

        const width = 180;
        const height = 38;
        const pad = 3;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const step = (width - pad * 2) / Math.max(1, values.length - 1);
        const coords = values.map((value, index) => {
          const x = pad + index * step;
          const y = height - pad - ((value - min) / range) * (height - pad * 2);
          return x.toFixed(1) + "," + y.toFixed(1);
        }).join(" ");

        return "<svg class=\"sparkline\" viewBox=\"0 0 " + width + " " + height + "\" preserveAspectRatio=\"none\" aria-hidden=\"true\">" +
          "<rect class=\"sparkline-area\" x=\"0\" y=\"0\" width=\"" + width + "\" height=\"" + height + "\" rx=\"6\"></rect>" +
          "<polyline points=\"" + escapeHtml(coords) + "\"></polyline>" +
        "</svg>";
      }

      function renderCountSparkline(points, key) {
        const values = (Array.isArray(points) ? points : [])
          .map((point) => Number(point[key]))
          .filter(Number.isFinite);
        if (values.length < 2) {
          return "<div class=\"sparkline event-meta\">Need at least two buckets for trend.</div>";
        }

        const width = 180;
        const height = 38;
        const pad = 3;
        const min = Math.min(0, ...values);
        const max = Math.max(1, ...values);
        const range = max - min || 1;
        const step = (width - pad * 2) / Math.max(1, values.length - 1);
        const coords = values.map((value, index) => {
          const x = pad + index * step;
          const y = height - pad - ((value - min) / range) * (height - pad * 2);
          return x.toFixed(1) + "," + y.toFixed(1);
        }).join(" ");

        return "<svg class=\"sparkline\" viewBox=\"0 0 " + width + " " + height + "\" preserveAspectRatio=\"none\" aria-hidden=\"true\">" +
          "<rect class=\"sparkline-area\" x=\"0\" y=\"0\" width=\"" + width + "\" height=\"" + height + "\" rx=\"6\"></rect>" +
          "<polyline points=\"" + escapeHtml(coords) + "\"></polyline>" +
        "</svg>";
      }

      function renderLatencySummaryCards(summaries) {
        if (!Array.isArray(summaries) || summaries.length === 0) return "";
        return "<div class=\"latency-summary-grid\">" + summaries.map((summary) => {
          const failed = Number(summary.failedCount || 0);
          const delta = trendDelta(summary);
          const trendCopy = delta === null ? "trend pending" : "recent trend " + formatDelta(delta);
          const dbMeta = dbSummaryLabel(summary.db);
          const meta = [
            "n=" + (summary.sampleCount ?? 0),
            summary.timingLayer ? timingLayerLabel(summary.timingLayer) : null,
            trendCopy,
            dbMeta,
            summary.latestAt ? "latest " + ageLabel(summary.latestAt) : null,
            failed ? failed + " failed" : null,
          ].filter(Boolean).join(" · ");

          return "<div class=\"latency-card\">" +
            "<div class=\"latency-card-header\">" +
              "<div>" +
                "<div class=\"event-title\">" + escapeHtml(summary.label || operationKindLabel(summary.kind)) + "</div>" +
                "<div class=\"event-meta\">" + escapeHtml(meta) + "</div>" +
              "</div>" +
              "<div class=\"latency-latest\">" + escapeHtml(formatDuration(summary.latestLatencyMs)) + "</div>" +
            "</div>" +
            renderSparkline(summary.trend) +
            "<div class=\"latency-stats\">" +
              "<div><div class=\"latency-stat-label\">Avg</div><div class=\"latency-stat-value\">" + escapeHtml(formatDuration(summary.averageLatencyMs)) + "</div></div>" +
              "<div><div class=\"latency-stat-label\">P50</div><div class=\"latency-stat-value\">" + escapeHtml(formatDuration(summary.p50LatencyMs)) + "</div></div>" +
              "<div><div class=\"latency-stat-label\">P95</div><div class=\"latency-stat-value\">" + escapeHtml(formatDuration(summary.p95LatencyMs)) + "</div></div>" +
              "<div><div class=\"latency-stat-label\">Range</div><div class=\"latency-stat-value\">" + escapeHtml(formatDuration(summary.minLatencyMs) + "-" + formatDuration(summary.maxLatencyMs)) + "</div></div>" +
            "</div>" +
          "</div>";
        }).join("") + "</div>";
      }

      function statusPill(status) {
        const value = status || "unknown";
        const css = ["pass", "warn", "fail"].includes(value) ? value : "";
        return "<span class=\"pill " + escapeHtml(css) + "\">" + escapeHtml(value) + "</span>";
      }

      function formatSloObserved(evaluation) {
        if (evaluation?.metric === "count") return formatCount(evaluation.value);
        return formatDuration(evaluation?.valueMs);
      }

      function formatSloThreshold(evaluation, threshold) {
        if (evaluation?.metric === "count") {
          return threshold === "warn" ? formatCount(evaluation.warnCount) : "-";
        }
        return threshold === "warn"
          ? formatDuration(evaluation?.warnMs)
          : formatDuration(evaluation?.failMs);
      }

      function renderSloEvaluations(slo) {
        const evaluations = Array.isArray(slo?.evaluations) ? slo.evaluations : [];
        if (evaluations.length === 0) return "";
        return "<div class=\"operation-table-wrap\">" +
          "<table class=\"slo-table\">" +
            "<thead><tr>" +
              "<th>Measure</th>" +
              "<th>Status</th>" +
              "<th>Observed</th>" +
              "<th>Warn</th>" +
              "<th>Fail</th>" +
              "<th>Samples</th>" +
            "</tr></thead>" +
            "<tbody>" +
              evaluations.map((evaluation) =>
                "<tr>" +
                  "<td title=\"" + escapeHtml(evaluation.detail || evaluation.label || "") + "\">" + escapeHtml(evaluation.label || evaluation.id) + "</td>" +
                  "<td>" + statusPill(evaluation.status) + "</td>" +
                  "<td>" + escapeHtml(formatSloObserved(evaluation)) + "</td>" +
                  "<td>" + escapeHtml(formatSloThreshold(evaluation, "warn")) + "</td>" +
                  "<td>" + escapeHtml(formatSloThreshold(evaluation, "fail")) + "</td>" +
                  "<td>" + escapeHtml(evaluation.sampleCount === null || evaluation.sampleCount === undefined ? "-" : formatCount(evaluation.sampleCount)) + "</td>" +
                "</tr>"
              ).join("") +
            "</tbody>" +
          "</table>" +
        "</div>";
      }

      function renderPerformanceFindings(findings) {
        const rows = Array.isArray(findings) ? findings : [];
        if (rows.length === 0) {
          return "<div class=\"event\">" +
            "<div class=\"event-title\">No SLO breaches detected in the current bounded telemetry window.</div>" +
            "<div class=\"event-meta\">Keep an eye on this while the baseline fills out; low sample counts can still hide real-world variance.</div>" +
          "</div>";
        }
        return "<div class=\"recent-heading\">Findings</div>" + rows.map((finding) =>
          "<div class=\"finding\">" +
            "<div class=\"finding-title\">" + statusPill(finding.level) + "<span>" + escapeHtml(finding.title || "Finding") + "</span></div>" +
            "<div class=\"event-meta\">" + escapeHtml(finding.detail || "") + "</div>" +
          "</div>"
        ).join("");
      }

      function renderDbSpanTargets(targets) {
        const rows = Array.isArray(targets) ? targets.slice(0, 6) : [];
        if (rows.length === 0) return "";
        return "<div class=\"recent-heading\">DB Span Hotspots</div>" +
          "<div class=\"db-span-panel\">" +
            "<table class=\"db-span-table\">" +
              "<thead><tr><th>Operation</th><th>Target</th><th>Max</th><th>Avg/Total</th><th>Samples</th></tr></thead>" +
              "<tbody>" +
                rows.map((target) => {
                  const examples = Array.isArray(target.examples)
                    ? target.examples.map((example) => (example.name || "operation") + " " + formatDuration(example.durationMs)).join(" · ")
                    : "";
                  const samples = [
                    formatCount(target.spanCount) + " spans",
                    formatCount(target.rowCount) + " rows",
                    target.failedCount ? formatCount(target.failedCount) + " failed" : null,
                    examples || null,
                  ].filter(Boolean).join(" · ");
                  return "<tr>" +
                    "<td data-label=\"Operation\">" + escapeHtml(target.operation || "query") + "</td>" +
                    "<td data-label=\"Target\">" + escapeHtml(target.target || "-") + "</td>" +
                    "<td data-label=\"Max\">" + escapeHtml(formatDuration(target.maxMs)) + "</td>" +
                    "<td data-label=\"Avg/Total\">" + escapeHtml(formatDuration(target.averageMs) + " / " + formatDuration(target.totalMs)) + "</td>" +
                    "<td data-label=\"Samples\">" + escapeHtml(samples) + "</td>" +
                  "</tr>";
                }).join("") +
              "</tbody>" +
            "</table>" +
          "</div>";
      }

      function renderLatencySlo(details) {
        const slo = details.slo || {};
        const evaluations = Array.isArray(slo.evaluations) ? slo.evaluations : [];
        const findings = details.performanceFindings || [];
        const dbTargets = details.dbSpanTargets || [];
        if (evaluations.length === 0 && findings.length === 0 && dbTargets.length === 0) {
          return "<div class=\"event muted\">No latency SLO data has been recorded yet.</div>";
        }

        const status = details.performanceStatus || slo.status || "pass";
        const summary = "<div class=\"event\">" +
          "<div class=\"event-title\">" + statusPill(status) + " Latency SLO status over the current bounded telemetry window.</div>" +
          "<div class=\"event-meta\">" +
            escapeHtml(formatCount(evaluations.length) + " measures · " +
              formatCount(slo.warningCount || 0) + " warnings · " +
              formatCount(slo.failedCount || 0) + " failures") +
          "</div>" +
        "</div>";

        return summary +
          renderSloEvaluations(slo) +
          renderPerformanceFindings(findings) +
          renderDbSpanTargets(dbTargets);
      }

      function authFailureCheckSummary(check) {
        const details = check?.details || {};
        if (!details.windowMinutes) return detailSummary(details) || "-";
        const topReason = Array.isArray(details.reasons) ? details.reasons[0] : null;
        const parts = [
          formatCount(details.failureCount || 0) + " failures / " + formatCount(details.windowMinutes) + "m",
          formatPercent(details.failureRate) + " fail rate",
          formatSignedCount(details.failureDelta || 0) + " vs prior window",
          details.lastFailureAt ? "last " + ageLabel(details.lastFailureAt) : "no recent failure",
          topReason ? "top: " + topReason.reason + " x" + formatCount(topReason.count || topReason.n) : null,
          "Activity > Auth",
        ].filter(Boolean);
        return escapeHtml(parts.join(" · "));
      }

      function renderAuthFailureSummaryCard(label, value, meta, valueHtml) {
        return "<div class=\"latency-card\">" +
          "<div class=\"latency-card-header\">" +
            "<div>" +
              "<div class=\"event-title\">" + escapeHtml(label) + "</div>" +
              "<div class=\"event-meta\">" + escapeHtml(meta || "") + "</div>" +
            "</div>" +
            "<div class=\"latency-latest\">" + (valueHtml ? value : escapeHtml(value)) + "</div>" +
          "</div>" +
        "</div>";
      }

      function renderAuthFailureTrend(details) {
        const trend = Array.isArray(details.trend) ? details.trend : [];
        if (trend.length === 0) return "<div class=\"event muted\">No auth trend buckets have been reported yet.</div>";
        const rows = trend.map((bucket) =>
          "<tr>" +
            "<td title=\"" + escapeHtml(localDateTime(bucket.bucketStartAt) + " to " + localDateTime(bucket.bucketEndAt)) + "\">" + escapeHtml(localTime(bucket.bucketStartAt)) + "</td>" +
            "<td>" + escapeHtml(formatCount(bucket.failureCount || 0)) + "</td>" +
            "<td>" + escapeHtml(formatCount(bucket.successCount || 0)) + "</td>" +
            "<td>" + escapeHtml(formatCount(bucket.totalAuthEvents || 0)) + "</td>" +
          "</tr>"
        ).join("");
        return "<div class=\"recent-heading\">Failure Trend</div>" +
          "<div class=\"latency-card\">" +
            "<div class=\"event-title\">" + escapeHtml(formatCount(details.failureCount || 0) + " failures in the last " + formatCount(details.windowMinutes || 0) + "m") + "</div>" +
            "<div class=\"event-meta\">" + escapeHtml(formatSignedCount(details.failureDelta || 0) + " versus previous window · " + (details.activityState || "unknown")) + "</div>" +
            renderCountSparkline(trend, "failureCount") +
          "</div>" +
          "<div class=\"operation-table-wrap\">" +
            "<table class=\"operation-log-table\">" +
              "<thead><tr><th style=\"width: 40%\">Bucket Start</th><th style=\"width: 20%\">Failures</th><th style=\"width: 20%\">Successes</th><th style=\"width: 20%\">Total</th></tr></thead>" +
              "<tbody>" + rows + "</tbody>" +
            "</table>" +
          "</div>";
      }

      function authBreakdownRows(label, rows, key) {
        return (Array.isArray(rows) ? rows : []).map((row) =>
          "<tr>" +
            "<td>" + escapeHtml(label) + "</td>" +
            "<td title=\"" + escapeHtml(row[key] || "-") + "\">" + escapeHtml(row[key] || "-") + "</td>" +
            "<td>" + escapeHtml(formatCount(row.count || row.n || 0)) + "</td>" +
            "<td>" + escapeHtml(formatPercent(row.share)) + "</td>" +
          "</tr>"
        ).join("");
      }

      function renderAuthFailureBreakdowns(details) {
        const rows =
          authBreakdownRows("Reason", details.reasons, "reason") +
          authBreakdownRows("Client", details.clients, "clientId") +
          authBreakdownRows("Grant", details.grantTypes, "grantType") +
          authBreakdownRows("Target", details.targets, "target") +
          authBreakdownRows("Name", details.names, "name") +
          authBreakdownRows("HTTP", details.httpStatuses, "httpStatus");
        if (!rows) return "<div class=\"event muted\">No auth failure breakdowns have been reported yet.</div>";
        return "<div class=\"recent-heading\">Reasons And Targets</div>" +
          "<div class=\"operation-table-wrap\">" +
            "<table class=\"operation-log-table\">" +
              "<thead><tr><th style=\"width: 18%\">Group</th><th style=\"width: 44%\">Value</th><th style=\"width: 18%\">Count</th><th style=\"width: 20%\">Share</th></tr></thead>" +
              "<tbody>" + rows + "</tbody>" +
            "</table>" +
          "</div>";
      }

      function renderAuthFailureRecent(details) {
        const rows = Array.isArray(details.recentFailures) ? details.recentFailures : [];
        if (rows.length === 0) return "<div class=\"event muted\">No auth failures recorded in the current window.</div>";
        return "<div class=\"recent-heading\">Recent Auth Events</div>" +
          "<div class=\"operation-table-wrap\">" +
            "<table class=\"operation-log-table\">" +
              "<thead><tr>" +
                "<th style=\"width: 14%\">When</th>" +
                "<th style=\"width: 22%\">Reason</th>" +
                "<th style=\"width: 16%\">Name</th>" +
                "<th style=\"width: 18%\">Target</th>" +
                "<th style=\"width: 10%\">HTTP</th>" +
                "<th style=\"width: 10%\">Latency</th>" +
                "<th style=\"width: 10%\">Source</th>" +
              "</tr></thead>" +
              "<tbody>" +
                rows.map((event) =>
                  "<tr>" +
                    "<td title=\"" + escapeHtml(localDateTime(event.at)) + "\">" + escapeHtml(localTime(event.at)) + "</td>" +
                    "<td title=\"" + escapeHtml(event.reason || "-") + "\">" + escapeHtml(event.reason || "-") + "</td>" +
                    "<td title=\"" + escapeHtml(event.name || "-") + "\">" + escapeHtml(event.name || "-") + "</td>" +
                    "<td title=\"" + escapeHtml(event.target || "-") + "\">" + escapeHtml(event.target || "-") + "</td>" +
                    "<td>" + escapeHtml(event.httpStatus || "-") + "</td>" +
                    "<td>" + escapeHtml(formatDuration(event.durationMs)) + "</td>" +
                    "<td title=\"" + escapeHtml(event.source || "-") + "\">" + escapeHtml(sourceLabel(event.source)) + "</td>" +
                  "</tr>"
                ).join("") +
              "</tbody>" +
            "</table>" +
          "</div>";
      }

      function renderAuthFailures(payload) {
        const check = byName(payload, "hosted_mcp_auth_failures");
        const details = check?.details || {};
        if (!check) {
          document.getElementById("auth-failure-summary").innerHTML = "<div class=\"event muted\">Auth failure telemetry has not been reported by the doctor.</div>";
          document.getElementById("auth-failure-trend").innerHTML = "";
          document.getElementById("auth-failure-breakdowns").innerHTML = "";
          document.getElementById("auth-failure-recent").innerHTML = "";
          return;
        }

        const topReason = Array.isArray(details.reasons) ? details.reasons[0] : null;
        const activityCopy = details.activityState === "active"
          ? "still arriving"
          : details.activityState === "stale"
            ? "aging out"
            : "clear";
        const summaryCards = [
          renderAuthFailureSummaryCard("Status", statusPill(check.status), activityCopy, true),
          renderAuthFailureSummaryCard("Failures", formatCount(details.failureCount || 0), "current " + formatCount(details.windowMinutes || 0) + "m window"),
          renderAuthFailureSummaryCard("Trend", formatSignedCount(details.failureDelta || 0), "versus previous window"),
          renderAuthFailureSummaryCard("Last Failure", details.lastFailureAt ? ageLabel(details.lastFailureAt) : "-", details.lastFailureAt ? localDateTime(details.lastFailureAt) : "none in current window"),
          renderAuthFailureSummaryCard("Top Reason", topReason ? topReason.reason : "-", topReason ? "x" + formatCount(topReason.count || topReason.n) + " · " + formatPercent(topReason.share) : "none"),
          renderAuthFailureSummaryCard("Failure Rate", formatPercent(details.failureRate), formatCount(details.totalAuthEvents || 0) + " auth events"),
        ].join("");

        const staleBanner = details.connectorState === "stale_connector"
          ? "<div class=\"event-meta\">Classified as a stale connector: a single unregistered client" +
            (details.staleClientId ? " (" + escapeHtml(details.staleClientId) + ")" : "") +
            " is looping unknown_client_id on a refresh-token grant. This is expected post-migration noise (a connector that needs full removal, not a re-auth) and is downgraded from fail to warn — see DECISIONS.md.</div>"
          : "";
        document.getElementById("auth-failure-summary").innerHTML =
          "<div class=\"latency-summary-grid auth-summary-grid\">" + summaryCards + "</div>" +
          staleBanner +
          (details.eventLimitReached ? "<div class=\"event-meta\">Auth event limit reached; counts may be clipped at " + escapeHtml(formatCount(details.eventLimit)) + " rows.</div>" : "");
        document.getElementById("auth-failure-trend").innerHTML = renderAuthFailureTrend(details);
        document.getElementById("auth-failure-breakdowns").innerHTML = renderAuthFailureBreakdowns(details);
        document.getElementById("auth-failure-recent").innerHTML = renderAuthFailureRecent(details);
      }

      function renderSlowestOperations(operations) {
        const rows = Array.isArray(operations) ? operations : [];
        if (rows.length === 0) return "";
        return rows.map((operation) => {
          const meta = [
            operationKindLabel(operation.kind),
            timingLayerLabel(operation.timingLayer),
            operation.target || "-",
            dbSummaryLabel(operation.db),
            localDateTime(operation.at),
          ].filter(Boolean).join(" · ");
          return "<div class=\"event\">" +
            "<div class=\"event-title\">" + escapeHtml(operation.name || "operation") + ": " + escapeHtml(formatDuration(operation.latencyMs)) + "</div>" +
            "<div class=\"event-meta\">" + escapeHtml(meta) + "</div>" +
          "</div>";
        }).join("");
      }

      function renderRecentSamples(title, operations) {
        const rows = Array.isArray(operations) ? operations : [];
        if (rows.length === 0) return "";
        return "<div class=\"recent-heading\">" + escapeHtml(title) + "</div>" + rows.map((operation) => {
          const meta = [
            operationKindLabel(operation.kind),
            timingLayerLabel(operation.timingLayer),
            operation.target || "-",
            operation.ok ? "ok" : "failed",
            dbSummaryLabel(operation.db),
            localDateTime(operation.at),
            operation.error || null,
          ].filter(Boolean).join(" · ");
          return "<div class=\"event\">" +
            "<div class=\"event-title\">" + escapeHtml(operation.name) + ": " + escapeHtml(formatDuration(operation.latencyMs)) + "</div>" +
            "<div class=\"event-meta\">" + escapeHtml(meta) + "</div>" +
          "</div>";
        }).join("");
      }

      function latencySummaryByKind(details, kind) {
        return (details.operationSummaries || []).find((summary) => summary.kind === kind) || null;
      }

      function latestLatencyByKind(details, kind, fallback) {
        return latencySummaryByKind(details, kind)?.latestLatencyMs ?? fallback;
      }

      function renderUserOperationLatencies(payload) {
        const details = byName(payload, "user_operation_latency")?.details || {};
        const operations = details.operations || [];
        const clientOperations = details.clientOperations || [];
        const summaries = details.operationSummaries || [];
        const clientSummaries = details.clientOperationSummaries || [];
        const layerSummaries = details.timingLayerSummaries || [];
        const toolSummaries = details.toolSummaries || [];
        const slowestOperations = details.slowestOperations || [];
        const recordedAt = details.latestOperationAt || details.checkedAt;
        const historySource = details.source === "postgres"
          ? (String(details.telemetrySource || "").includes("hosted_mcp_server")
              ? "hosted MCP server telemetry"
              : "Postgres telemetry history")
          : "fallback latency cache";
        const clientCopy = details.clientHistoryCount
          ? " Client-observed samples are shown separately because they include network and client parsing overhead."
          : "";
        const intro = details.state === "recorded"
          ? "Latest recorded hosted MCP operation: " + localDateTime(recordedAt) + ". Counted operations use bounded " + historySource + "." + clientCopy
          : "No hosted MCP operation timing has been recorded yet. Run the hosted OAuth smoke or a measured client operation.";

        const summaryRows = [
          ["Latest read", details.latestReadLatencyMs],
          ["Latest write", details.latestWriteLatencyMs],
          ["Latest sync wait", details.latestSyncWaitLatencyMs],
        ].filter((row) => row[1] !== undefined && row[1] !== null);

        const summary = summaryRows.length
          ? "<div class=\"event\">" +
              "<div class=\"event-title\">" + escapeHtml(intro) + "</div>" +
              "<div class=\"event-meta\">" + summaryRows.map((row) => escapeHtml(row[0] + ": " + formatDuration(row[1]))).join(" · ") + "</div>" +
            "</div>"
          : "<div class=\"event muted\">" + escapeHtml(intro) + "</div>";

        const layerCards = layerSummaries.length
          ? "<div class=\"recent-heading\">Timing Layers</div>" + renderLatencySummaryCards(layerSummaries)
          : "";
        const kindCards = summaries.length
          ? "<div class=\"recent-heading\">Operation Kinds</div>" + renderLatencySummaryCards(summaries)
          : "";
        const clientCards = clientSummaries.length
          ? "<div class=\"recent-heading\">Client-Observed E2E</div>" + renderLatencySummaryCards(clientSummaries)
          : "";
        const toolCards = toolSummaries.length
          ? "<div class=\"recent-heading\">By Tool</div>" + renderLatencySummaryCards(toolSummaries)
          : "";
        const rows = renderRecentSamples("Recent Server Samples", operations) +
          renderRecentSamples("Recent Client E2E Samples", clientOperations);

        document.getElementById("user-operation-latencies").innerHTML =
          summary +
          layerCards +
          kindCards +
          clientCards +
          toolCards;

        document.getElementById("latency-slo-findings").innerHTML =
          renderLatencySlo(details);

        document.getElementById("slowest-operation-latencies").innerHTML =
          renderSlowestOperations(slowestOperations) ||
          "<div class=\"event muted\">No slowest-operation samples have been recorded yet.</div>";

        document.getElementById("recent-operation-latencies").innerHTML =
          rows ||
          "<div class=\"event muted\">No recent operation samples have been recorded yet.</div>";
      }

      function render(payload) {
        detectChanges(payload);
        const state = payload.status || "fail";
        const [title, copy] = statusCopy[state] || statusCopy.fail;
        document.getElementById("state-dot").className = "dot " + state;
        document.getElementById("state-text").textContent = title;
        document.getElementById("state-copy").textContent = copy;
        document.getElementById("last-updated").textContent = payload.checkedAt ? "Checked " + ageLabel(payload.checkedAt) + " (" + displayTimestamp(payload.checkedAt) + ")" : "Checked just now";

        const postgres = byName(payload, "postgres_summary")?.details || {};
        const local = byName(payload, "local_sync_state")?.details || {};
        const sync = byName(payload, "sync_health")?.details || {};
        const userOps = byName(payload, "user_operation_latency")?.details || {};
        const usage24h = usageWindow(userOps, "24h");
        const usage7d = usageWindow(userOps, "7d");
        const profile = profileFromPayload(payload);

        document.getElementById("active-brain-title").textContent = profile.profileLabel || profile.brainId || "-";
        document.getElementById("active-brain-subtitle").textContent =
          (profile.isMultiProfile ? String(profile.profileCount) + " configured profiles. " : "") +
          "Profile " + (profile.profileName || "-") + " on " + (profile.supervisor || "unknown supervisor") + ".";
        document.getElementById("profile-current-label").textContent = profile.profileLabel || "-";
        document.getElementById("profile-brain-id").textContent = profile.brainId || "-";
        document.getElementById("profile-name").textContent = profile.profileName || "-";
        document.getElementById("profile-state-file").textContent = profile.stateFile || "-";
        const cockpitLink = document.getElementById("profile-cockpit-url");
        cockpitLink.textContent = profile.cockpitUrl || "-";
        cockpitLink.href = profile.cockpitUrl || "#";
        document.getElementById("profile-scope").textContent =
          "Per-Brain: hosted/local/sync/conflicts. Hosted-level: auth/usage/latency.";
        renderProfileSwitcher(profile);
        renderTabContext(payload, profile, title, sync);

        document.getElementById("hosted-files").textContent = postgres.hostedFiles ?? "-";
        document.getElementById("local-files").textContent = local.trackedFiles ?? "-";
        document.getElementById("open-conflicts").textContent = postgres.openConflicts ?? "-";
        document.getElementById("last-sync").textContent = sync.checkedAt ? displayTimestamp(sync.checkedAt) : "-";
        document.getElementById("ops-24h").textContent = formatCount(usage24h?.totalCount);
        document.getElementById("ops-7d").textContent = formatCount(usage7d?.totalCount);
        document.getElementById("ops-total").textContent = formatCount(userOps.usageStats?.allTime?.totalCount);
        document.getElementById("read-op-latency").textContent = formatDuration(
          latestLatencyByKind(userOps, "read", userOps.latestReadLatencyMs)
        );
        document.getElementById("write-op-latency").textContent = formatDuration(
          latestLatencyByKind(userOps, "write", userOps.latestWriteLatencyMs)
        );
        document.getElementById("sync-wait-latency").textContent = formatDuration(
          latestLatencyByKind(userOps, "sync_wait", userOps.latestSyncWaitLatencyMs)
        );
        document.getElementById("hosted-latency").textContent = formatDuration(byName(payload, "hosted_health")?.details?.latencyMs);
        document.getElementById("postgres-latency").textContent = formatDuration(postgres.latencyMs);
        document.getElementById("sync-latency").textContent = formatDuration(sync.totalMs);
        document.getElementById("doctor-latency").textContent = formatDuration(payload.latencyMs);

        document.getElementById("checks").innerHTML = (payload.checks || [])
          .filter((check) => check.name !== "recent_activity")
          .map((check) => {
            const details = check.name === "hosted_mcp_auth_failures"
              ? authFailureCheckSummary(check)
              : detailSummary(check.details);
            return "<tr><td>" + escapeHtml(check.name) + "</td><td><span class=\"pill " + escapeHtml(check.status) + "\">" + escapeHtml(check.status) + "</span></td><td class=\"details\">" + (details || "-") + "</td></tr>";
          })
          .join("");

        renderActionSummary(payload);
        document.getElementById("actions").innerHTML = renderActionItems(payload);

        renderActivity(payload);
        renderOperationUsage(payload);
        renderOperationEvents(payload);
        renderAuthFailures(payload);
        renderOperationLog();
        renderUserOperationLatencies(payload);
        renderLatencies(payload);
      }

      async function refresh(options = {}) {
        const button = document.getElementById("refresh");
        button.disabled = true;
        button.textContent = "Reloading";
        try {
          const doctorPath = options && options.fresh ? "/api/doctor?fresh=1" : "/api/doctor";
          const response = await fetch(doctorPath, { cache: "no-store" });
          render(await response.json());
        } catch (error) {
          render({
            ok: false,
            status: "fail",
            checkedAt: new Date().toISOString(),
            checks: [{ name: "cockpit", status: "fail", details: { error: error.message } }],
          });
        } finally {
          button.disabled = false;
          button.textContent = "Reload";
        }
      }

      function activateTab(tabId) {
        for (const button of document.querySelectorAll(".tab-button")) {
          const selected = button.id === tabId;
          button.setAttribute("aria-selected", String(selected));
          document.getElementById(button.getAttribute("aria-controls")).hidden = !selected;
        }
        document.getElementById("tab-context-strip").hidden = tabId === "tab-overview";
        if (tabId === "tab-fixes" && !maintenanceLoadedOnce) {
          loadMaintenance();
        }
      }

      // ---- Maintenance: lint, inbox visibility, and mechanical fixes --------
      let maintenanceLoadedOnce = false;
      let latestLint = null;
      const FIX_KIND_LABELS = {
        task_relocate: "Move completed tasks into Done",
        done_stamp: "Stamp undated Done items with today's date",
        done_archive: "Archive Done items older than 30 days",
      };

      function fixesStatus(text) {
        document.getElementById("fixes-status").textContent = text || "";
      }

      function renderLint(lint) {
        latestLint = lint || null;
        const summary = document.getElementById("lint-summary");
        const findings = document.getElementById("lint-findings");
        const maintainerPanel = document.getElementById("lint-maintainer-panel");
        const maintainerSummary = document.getElementById("lint-maintainer-summary");
        const maintainerFindings = document.getElementById("lint-maintainer-findings");
        const technicalDiagnostics = document.getElementById("lint-technical-diagnostics");
        summary.innerHTML = "";
        findings.innerHTML = "";
        maintainerFindings.innerHTML = "";
        technicalDiagnostics.innerHTML = "";
        maintainerPanel.open = false;
        if (!lint) {
          document.getElementById("lint-status").textContent = "No Cockpit lint report yet.";
          summary.innerHTML = "<p class='muted'>Run lint to create a current assessment and durable receipt.</p>";
          maintainerPanel.hidden = true;
          return;
        }

        const issueCount = Number(lint.issueCount || 0);
        const diagnosticCount = Number(
          lint.diagnosticCount ?? lint.report?.graphReachability?.diagnostics?.length ?? 0
        );
        const automaticFixCount = Number(lint.automaticFixCount || 0);
        const operatorDecisionCount = Number(lint.operatorDecisionCount || 0);
        const maintainerFindingCount = Number(
          lint.maintainerFindingCount ?? Math.max(0, issueCount - operatorDecisionCount)
        );
        const externalReferenceCount = Number(lint.externalReferenceCount || 0);
        const sourceAudit = lint.sourceLinkAudit || null;
        const checkedAt = lint.checkedAt ? new Date(lint.checkedAt).toLocaleString() : "unknown time";
        document.getElementById("lint-status").textContent = "Last refreshed " + checkedAt + ".";
        summary.innerHTML =
          "<div class='maintenance-summary'>" +
          "<strong>" + escapeHtml(String(automaticFixCount)) + " action(s) you can approve</strong>" +
          "<strong>" + escapeHtml(String(operatorDecisionCount)) + " bounded content decision(s)</strong>" +
          "<span class='muted'>" + escapeHtml(String(maintainerFindingCount)) + " maintainer note(s)</span>" +
          (diagnosticCount > 0
            ? "<span class='muted'>" + escapeHtml(String(diagnosticCount)) + " broken internal link(s), maintainer-owned</span>"
            : "") +
          (externalReferenceCount > 0
            ? "<span class='muted'>" + escapeHtml(String(externalReferenceCount)) + " locator/source reference(s) classified automatically</span>"
            : "") +
          (sourceAudit?.state === "pass"
            ? "<span class='pill pass'>source links verified</span>"
            : sourceAudit?.state === "fail"
              ? "<span class='pill info'>source audit: maintainer</span>"
              : "") +
          "</div>";

        const reviewFindings = Array.isArray(lint.reviewFindings) ? lint.reviewFindings : [];
        const operatorFindings = reviewFindings.filter((finding) => finding.audience === "operator");
        const maintainerOnlyFindings = reviewFindings.filter((finding) => finding.audience !== "operator");
        const technicalFindings = Array.isArray(lint.technicalDiagnostics)
          ? lint.technicalDiagnostics
          : [];
        const warnings = Array.isArray(lint.warnings) ? lint.warnings : [];

        function appendLintFinding(container, finding) {
          const item = document.createElement("div");
          item.className = "maintenance-item";
          const title = document.createElement("strong");
          title.textContent = finding.summary || finding.kind || "Lint finding";
          const detail = document.createElement("p");
          detail.className = "muted";
          const isCaptureQueue = finding.kind === "capture_queue";
          const openCount = Number(finding.openCount ?? lint.report?.captureQueue?.openCount ?? 0);
          const staleCount = Number(finding.staleCount ?? lint.report?.captureQueue?.staleCount ?? 0);
          const thresholdDays = Number(finding.thresholdDays ?? lint.report?.captureQueue?.thresholdDays ?? 7);
          const recentCount = Math.max(0, openCount - staleCount);
          detail.textContent = isCaptureQueue
            ? String(openCount) + " total open item(s) need a disposition. " +
              String(staleCount) + (staleCount === 1 ? " is" : " are") +
              " stale because " + (staleCount === 1 ? "it is" : "they are") +
              " at least " + String(thresholdDays) + " days old; " + String(recentCount) +
              (recentCount === 1 ? " is" : " are") +
              " newer but still open. Stale is a subset of open, not a second queue."
            : finding.detail || "Review required.";
          item.appendChild(title);
          item.appendChild(detail);
          const metaValues = [
            finding.statusLabel ? "Status: " + finding.statusLabel : null,
            finding.owner ? "Owner: " + finding.owner : null,
            finding.completion ? "Completion: " + finding.completion : null,
          ].filter(Boolean);
          if (metaValues.length) {
            const meta = document.createElement("div");
            meta.className = "maintenance-item-meta";
            for (const value of metaValues) {
              const span = document.createElement("span");
              span.textContent = value;
              meta.appendChild(span);
            }
            item.appendChild(meta);
          }
          if (isCaptureQueue) {
            const guidance = document.createElement("div");
            guidance.className = "capture-triage-guidance";

            const recommendation = document.createElement("p");
            recommendation.innerHTML = "<strong>Recommended:</strong> ask an LLM with access to this Brain and its canonical trackers to prepare a disposition table. It must stop for your approval before moving or closing anything.";
            guidance.appendChild(recommendation);

            const llmDetails = document.createElement("details");
            llmDetails.className = "inbox-handoff";
            const llmSummary = document.createElement("summary");
            llmSummary.textContent = "LLM-assisted triage (recommended)";
            const prompt = captureQueueTriageHandoff(openCount, staleCount, thresholdDays);
            const promptPanel = document.createElement("div");
            promptPanel.className = "capture-prompt-panel";
            const promptText = document.createElement("pre");
            promptText.textContent = prompt;
            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.className = "capture-prompt-copy";
            copyButton.textContent = "Copy";
            copyButton.setAttribute("aria-label", "Copy LLM triage prompt");
            const copyStatus = document.createElement("span");
            copyStatus.className = "muted capture-copy-status";
            copyStatus.setAttribute("role", "status");
            copyStatus.setAttribute("aria-live", "polite");
            copyButton.addEventListener("click", async () => {
              try {
                await copyText(prompt);
                copyStatus.textContent = "Copied. Paste it into Codex, Claude, or ChatGPT with JEM Brain access.";
              } catch (error) {
                copyStatus.textContent = "Copy failed: " + error.message;
              }
            });
            promptPanel.appendChild(promptText);
            promptPanel.appendChild(copyButton);
            llmDetails.appendChild(llmSummary);
            llmDetails.appendChild(promptPanel);
            llmDetails.appendChild(copyStatus);
            guidance.appendChild(llmDetails);

            const manualDetails = document.createElement("details");
            manualDetails.className = "inbox-handoff";
            const manualSummary = document.createElement("summary");
            manualSummary.textContent = "Manual triage in Obsidian";
            const manualIntro = document.createElement("p");
            manualIntro.className = "muted";
            manualIntro.textContent = "Open TASKS.md, find Capture / Triage Queue, and process every unchecked item:";
            const manualSteps = document.createElement("ol");
            const manualRoutingSteps = COCKPIT_BRAIN_ID === "ai-brain-jem"
              ? [
                  "Move personal non-project work to TASKS Active.",
                  "Copy project work to the owning project BACKLOG or tracker; copy ERS work to Asana; keep audit findings in their audit backlog.",
                ]
              : [
                  "Move work to TASKS Active only when this Brain's work-tracking guidance says TASKS is its canonical owner.",
                  "Transfer project, organizational, and audit work to the canonical destinations named by this Brain; do not reuse JEM routing assumptions.",
                ];
            for (const step of [
              ...manualRoutingSteps,
              "Only after the destination is updated, mark the Capture item checked as transferred. Mark it closed only when completion, obsolescence, or duplication is clear.",
              "Refresh the lint assessment. Editing a date or leaving an item unchecked in Capture does not clear it.",
            ]) {
              const li = document.createElement("li");
              li.textContent = step;
              manualSteps.appendChild(li);
            }
            manualDetails.appendChild(manualSummary);
            manualDetails.appendChild(manualIntro);
            manualDetails.appendChild(manualSteps);
            guidance.appendChild(manualDetails);
            item.appendChild(guidance);
          }
          if (Array.isArray(finding.examples) && finding.examples.length) {
            const examples = document.createElement("details");
            examples.className = "maintenance-diagnostic";
            const examplesSummary = document.createElement("summary");
            examplesSummary.textContent = "Show representative paths";
            const examplesText = document.createElement("pre");
            examplesText.textContent = finding.examples.join("\n");
            examples.appendChild(examplesSummary);
            examples.appendChild(examplesText);
            item.appendChild(examples);
          }
          container.appendChild(item);
        }

        if (operatorFindings.length === 0) {
          findings.innerHTML = "<p class='muted'>No Brain content decisions need your review.</p>";
        } else {
          for (const finding of operatorFindings) appendLintFinding(findings, finding);
        }

        for (const finding of maintainerOnlyFindings) {
          appendLintFinding(maintainerFindings, finding);
        }
        for (const finding of technicalFindings) {
          appendLintFinding(technicalDiagnostics, finding);
        }
        for (const warning of warnings) {
          const item = document.createElement("div");
          item.className = "maintenance-item";
          const title = document.createElement("strong");
          title.textContent = "Coverage note";
          const detail = document.createElement("p");
          detail.className = "muted";
          detail.textContent = String(warning);
          item.appendChild(title);
          item.appendChild(detail);
          maintainerFindings.appendChild(item);
        }
        const maintainerTotal = maintainerOnlyFindings.length + technicalFindings.length + warnings.length;
        maintainerPanel.hidden = maintainerTotal === 0;
        maintainerSummary.textContent =
          "Maintainer-only diagnostics and context (" + String(maintainerTotal) + ")";
      }

      async function loadLintReport() {
        document.getElementById("lint-status").textContent = "Loading latest report…";
        try {
          const response = await fetch("/api/lint/report", { cache: "no-store" });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "report failed");
          renderLint(data.lint || null);
        } catch (error) {
          document.getElementById("lint-summary").textContent = "Failed to load lint report: " + error.message;
          document.getElementById("lint-findings").innerHTML = "";
          document.getElementById("lint-status").textContent = "";
        }
      }

      async function runLintNow() {
        const button = document.getElementById("lint-run");
        button.disabled = true;
        document.getElementById("lint-status").textContent = "Refreshing canonical lint assessment…";
        try {
          const response = await fetch("/api/lint/run", {
            method: "POST",
            cache: "no-store",
            headers: { "content-type": "application/json", "x-cockpit-nonce": COCKPIT_NONCE },
            body: JSON.stringify({}),
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "lint failed");
          renderLint(data.lint);
          await loadFixes();
          await refresh({ fresh: true });
        } catch (error) {
          document.getElementById("lint-status").textContent = "Lint failed: " + error.message;
        } finally {
          button.disabled = false;
        }
      }

      function formatFileSize(bytes) {
        const value = Number(bytes || 0);
        if (value < 1024) return value + " B";
        if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
        return (value / (1024 * 1024)).toFixed(1) + " MB";
      }

      function inboxClaudeHandoff(filename) {
        return [
          "In an interactive Claude session with access to the " + COCKPIT_BRAIN_ID + " workspace and ingestion-capable Brain tools, process the pending inbox file \"" + filename + "\".",
          "Load the Brain context, then call brain_prepare_ingest before changing anything. Review the file; preserve the original source and provenance; update only justified durable Brain content.",
          "If preflight reports a filesystem backend, complete the ingestion with inbox_file set to \"" + filename + "\" and verify it no longer appears in brain_scan_inbox.",
          "If preflight reports a Postgres backend, do not call the filesystem ingest mutation tools. Use this Brain's local Monitor/operator source workflow to persist provenance and clear exactly \"" + filename + "\" only after the source receipt exists; refresh the Monitor inbox scan for verification. Hosted brain_log may record the reviewed Brain-revision receipt.",
          "If this session cannot access that operator workspace, stop with an explicit handoff. Never delete the inbox file merely to clear the warning.",
        ].join("\n\n");
      }

      function captureQueueTriageHandoff(openCount, staleCount, thresholdDays) {
        const jemBrain = COCKPIT_BRAIN_ID === "ai-brain-jem";
        const brainLabel = jemBrain ? "JEM Brain" : "the selected Brain";
        const routingRules = jemBrain
          ? [
              "Allowed dispositions:",
              "- Keep or move to TASKS Active only if it is personal/professional non-ERS and non-project work.",
              "- Transfer project work to the owning project's BACKLOG or tracker.",
              "- Transfer ERS work to Asana.",
              "- Retain audit findings in their audit backlog.",
              "- Close as completed, obsolete, or duplicate only with evidence and my approval.",
              "Do not duplicate tasks. Do not use NOW.md, JOURNAL.md, LOG.md, BUSINESS_IDEAS.md, or working notes as task repositories.",
            ]
          : [
              "Use only the canonical owners and destinations declared by this Brain's work-tracking guidance. Do not reuse JEM routing assumptions.",
              "Close as completed, obsolete, or duplicate only with evidence and my approval. Do not duplicate tasks or use orientation, journal, log, or working-note files as task repositories.",
            ];
        return [
          "Help me triage the Capture / Triage Queue in " + brainLabel + " (" + COCKPIT_BRAIN_ID + ").",
          "Load Brain context first, then read its work-tracking guidance and TASKS.md. There are currently " + String(openCount) + " open items; " + String(staleCount) + (staleCount === 1 ? " is" : " are") + " stale because " + (staleCount === 1 ? "it is" : "they are") + " at least " + String(thresholdDays) + " days old. Review all " + String(openCount) + ".",
          "Phase 1 — proposal only. Do not write, move, delete, or close anything yet.",
          "For every item, give me a compact table with: item, recommended disposition, canonical owner/destination, rationale, and any access blocker.",
          routingRules.join("\n"),
          "Stop and wait for my approval of the complete proposal. After approval, use hosted writes for the selected Brain's TASKS.md and update the canonical project or tracker surfaces available to you. If a destination is inaccessible, leave that item open in Capture / Triage and state the exact handoff needed; do not claim it was transferred.",
          "Finally, re-read TASKS.md and run brain_lint. Success means the queue is smaller or clear, with only genuinely unresolved items retained.",
        ].join("\n\n");
      }

      async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return;
        }
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("clipboard unavailable");
      }

      function renderInbox(files) {
        const container = document.getElementById("inbox-files");
        container.innerHTML = "";
        if (!files.length) {
          container.innerHTML = "<p class='muted'>Inbox is clear. No pending source files were found.</p>";
          return;
        }
        for (const file of files) {
          const item = document.createElement("div");
          item.className = "maintenance-item";
          const title = document.createElement("strong");
          title.textContent = file.name;
          const detail = document.createElement("p");
          detail.className = "muted";
          const modified = file.modifiedAt ? new Date(file.modifiedAt).toLocaleString() : "unknown time";
          detail.textContent = formatFileSize(file.size) + " · modified " + modified + " · pending reviewed ingestion";
          const next = document.createElement("p");
          next.className = "muted";
          next.textContent = "Not stuck: refreshing this scan only rechecks the inbox. Complete the reviewed ingestion in an interactive Claude session to clear this item.";
          const handoff = document.createElement("details");
          handoff.className = "inbox-handoff";
          const handoffSummary = document.createElement("summary");
          handoffSummary.textContent = "Claude ingestion handoff";
          const prompt = document.createElement("pre");
          prompt.textContent = inboxClaudeHandoff(file.name);
          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.textContent = "Copy Claude ingestion prompt";
          copyButton.addEventListener("click", async () => {
            copyButton.disabled = true;
            try {
              await copyText(prompt.textContent);
              copyButton.textContent = "Copied";
              document.getElementById("inbox-status").textContent =
                "Claude ingestion prompt copied. Paste it into an interactive Claude session with access to this Brain.";
            } catch (error) {
              copyButton.textContent = "Copy failed";
              document.getElementById("inbox-status").textContent =
                "Clipboard unavailable. Open Claude ingestion handoff and copy the prompt manually.";
            } finally {
              copyButton.disabled = false;
            }
          });
          handoff.appendChild(handoffSummary);
          handoff.appendChild(prompt);
          handoff.appendChild(copyButton);
          item.appendChild(title);
          item.appendChild(detail);
          item.appendChild(next);
          item.appendChild(handoff);
          container.appendChild(item);
        }
      }

      async function scanMaintenanceInbox() {
        const button = document.getElementById("inbox-scan");
        button.disabled = true;
        document.getElementById("inbox-status").textContent = "Scanning…";
        try {
          const response = await fetch("/api/inbox/scan", { cache: "no-store" });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "scan failed");
          const files = data.files || [];
          renderInbox(files);
          document.getElementById("inbox-status").textContent = files.length + " pending file(s).";
        } catch (error) {
          document.getElementById("inbox-files").textContent = "Inbox scan failed: " + error.message;
          document.getElementById("inbox-status").textContent = "";
        } finally {
          button.disabled = false;
        }
      }

      function renderFixes(items) {
        const container = document.getElementById("fixes-list");
        container.innerHTML = "";
        if (!items.length) {
          if (!latestLint) {
            container.innerHTML = "<p class='muted'>No safe mechanical fixes detected. Run lint for the complete assessment.</p>";
          } else if (Number(latestLint.issueCount || 0) > 0) {
            container.innerHTML = "<p class='muted'>No automatic action is required. Informational review notes remain visible above.</p>";
          } else {
            container.innerHTML = "<p class='muted'>No safe mechanical fixes are needed; the latest lint report found no issues.</p>";
          }
          updateFixSelectionState();
          return;
        }
        const byKind = new Map();
        for (const item of items) {
          if (!byKind.has(item.kind)) byKind.set(item.kind, []);
          byKind.get(item.kind).push(item);
        }
        for (const [kind, group] of byKind) {
          const section = document.createElement("div");
          section.className = "fixes-group";
          const heading = document.createElement("h3");
          heading.textContent = (FIX_KIND_LABELS[kind] || kind) + " (" + group.length + ")";
          section.appendChild(heading);
          for (const item of group) {
            const row = document.createElement("div");
            row.className = "fixes-item";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.className = "fixes-checkbox";
            box.checked = false;
            box.value = item.id;
            box.addEventListener("change", updateFixSelectionState);
            const main = document.createElement("div");
            main.className = "fixes-item-main";
            const text = document.createElement("label");
            text.className = "fixes-item-label";
            text.htmlFor = "fix-" + item.id.replace(/[^a-zA-Z0-9_-]/g, "-");
            box.id = text.htmlFor;
            text.textContent = item.summary;
            const detail = document.createElement("details");
            detail.className = "fixes-item-detail";
            const detailSummary = document.createElement("summary");
            detailSummary.textContent = "Show full proposed change";
            const detailText = document.createElement("pre");
            detailText.textContent = item.detail || item.summary;
            detail.appendChild(detailSummary);
            detail.appendChild(detailText);
            main.appendChild(text);
            main.appendChild(detail);
            row.appendChild(box);
            row.appendChild(main);
            section.appendChild(row);
          }
          container.appendChild(section);
        }
        updateFixSelectionState();
      }

      async function loadFixes() {
        fixesStatus("Loading plan…");
        try {
          const response = await fetch("/api/fixes/plan", { cache: "no-store" });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "plan failed");
          if (data.lint) renderLint(data.lint);
          renderFixes(data.items || []);
          fixesStatus((data.items || []).length + " proposed fix(es).");
        } catch (error) {
          document.getElementById("fixes-list").textContent = "Failed to load plan: " + error.message;
          fixesStatus("");
        }
      }

      function setAllFixesSelected(checked) {
        for (const box of document.querySelectorAll(".fixes-checkbox")) box.checked = checked;
        updateFixSelectionState();
      }

      function updateFixSelectionState() {
        const boxes = Array.from(document.querySelectorAll(".fixes-checkbox"));
        const selected = boxes.filter((box) => box.checked).length;
        const selectAll = document.getElementById("fixes-select-all");
        selectAll.disabled = boxes.length === 0;
        selectAll.checked = boxes.length > 0 && selected === boxes.length;
        selectAll.indeterminate = selected > 0 && selected < boxes.length;
        document.getElementById("fixes-selection-status").textContent =
          selected + " of " + boxes.length + " selected.";
        const applyButton = document.getElementById("fixes-apply");
        applyButton.disabled = selected === 0 || applyButton.dataset.busy === "true";
      }

      async function applyFixes() {
        const ids = Array.from(document.querySelectorAll(".fixes-checkbox"))
          .filter((box) => box.checked)
          .map((box) => box.value);
        if (!ids.length) {
          fixesStatus("No items selected.");
          return;
        }
        const button = document.getElementById("fixes-apply");
        button.dataset.busy = "true";
        button.disabled = true;
        fixesStatus("Applying " + ids.length + " fix(es)…");
        try {
          const response = await fetch("/api/fixes/apply", {
            method: "POST",
            cache: "no-store",
            headers: { "content-type": "application/json", "x-cockpit-nonce": COCKPIT_NONCE },
            body: JSON.stringify({ ids }),
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "apply failed");
          const applied = (data.appliedIds || []).length;
          const wrote = (data.filesWritten || []).join(", ");
          const stale = (data.staleIds || []).length;
          if (!data.applied || applied === 0) {
            fixesStatus("No changes applied" + (stale ? " (" + stale + " stale skipped)" : "") + ".");
          } else {
            fixesStatus("Applied " + applied + " fix(es) → " + wrote + (stale ? " (" + stale + " stale skipped)" : "") + ".");
          }
          if (data.lint) renderLint(data.lint);
          if (data.lintRefreshError) {
            fixesStatus(document.getElementById("fixes-status").textContent + " Lint refresh failed: " + data.lintRefreshError);
          }
          await loadFixes();
          await refresh({ fresh: true });
        } catch (error) {
          fixesStatus("Apply failed: " + error.message);
        } finally {
          button.dataset.busy = "false";
          updateFixSelectionState();
        }
      }

      async function loadMaintenance() {
        maintenanceLoadedOnce = true;
        await Promise.all([loadLintReport(), loadFixes(), scanMaintenanceInbox()]);
      }

      function setupFixes() {
        document.getElementById("lint-run").addEventListener("click", runLintNow);
        document.getElementById("inbox-scan").addEventListener("click", scanMaintenanceInbox);
        document.getElementById("fixes-reload").addEventListener("click", loadMaintenance);
        document.getElementById("fixes-select-all").addEventListener("change", (event) =>
          setAllFixesSelected(event.currentTarget.checked)
        );
        document.getElementById("fixes-apply").addEventListener("click", applyFixes);
      }

      function setupTabs() {
        for (const button of document.querySelectorAll(".tab-button")) {
          button.addEventListener("click", () => activateTab(button.id));
          button.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(document.querySelectorAll(".tab-button"));
            const currentIndex = buttons.indexOf(button);
            let nextIndex = currentIndex;
            if (event.key === "ArrowLeft") nextIndex = (currentIndex + buttons.length - 1) % buttons.length;
            if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = buttons.length - 1;
            buttons[nextIndex].focus();
            activateTab(buttons[nextIndex].id);
          });
        }
      }

      function activateSubtab(tabId, scope) {
        for (const button of document.querySelectorAll(".subtab-button[data-subtab-scope='" + scope + "']")) {
          const selected = button.id === tabId;
          button.setAttribute("aria-selected", String(selected));
        }
        for (const panel of document.querySelectorAll(".subtab-panel[data-subtab-scope='" + scope + "']")) {
          panel.hidden = panel.id !== document.getElementById(tabId).getAttribute("aria-controls");
        }
      }

      function setupSubtabGroup(scope) {
        for (const button of document.querySelectorAll(".subtab-button[data-subtab-scope='" + scope + "']")) {
          button.addEventListener("click", () => activateSubtab(button.id, scope));
          button.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(document.querySelectorAll(".subtab-button[data-subtab-scope='" + scope + "']"));
            const currentIndex = buttons.indexOf(button);
            let nextIndex = currentIndex;
            if (event.key === "ArrowLeft") nextIndex = (currentIndex + buttons.length - 1) % buttons.length;
            if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = buttons.length - 1;
            buttons[nextIndex].focus();
            activateSubtab(buttons[nextIndex].id, scope);
          });
        }
      }

      function setupActivityViews() {
        setupSubtabGroup("activity");
        setupSubtabGroup("latency");
      }

      document.getElementById("refresh").addEventListener("click", refresh);
      setupTabs();
      setupActivityViews();
      setupFixes();
      refresh();
      setInterval(refresh, 60000);
    </script>
  </body>
</html>`;

function createCockpitServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(response, page);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/doctor") {
      sendJson(response, 200, await runDoctor({ fresh: url.searchParams.get("fresh") === "1" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/lint/report") {
      if (!isLoopbackHost(request)) {
        sendJson(response, 403, { ok: false, error: "forbidden_host" });
        return;
      }
      try {
        const lint = await readLintReportCache();
        sendJson(response, 200, {
          ok: true,
          brainId: cockpitBrainId,
          state: lint ? "recorded" : "never_run",
          lint,
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    // Explicit lint is a confirmable local maintenance action because a
    // successful run records a narrow LINT receipt in Brain LOG.md. It uses the
    // same loopback/nonce/JSON guards as mechanical fix application.
    if (request.method === "POST" && url.pathname === "/api/lint/run") {
      if (!isLoopbackHost(request)) {
        sendJson(response, 403, { ok: false, error: "forbidden_host" });
        return;
      }
      if (request.headers["x-cockpit-nonce"] !== cockpitNonce) {
        sendJson(response, 403, { ok: false, error: "bad_nonce" });
        return;
      }
      if (!/^application\/json/.test(String(request.headers["content-type"] || ""))) {
        sendJson(response, 415, { ok: false, error: "json_required" });
        return;
      }
      try {
        await readJsonBody(request);
        sendJson(response, 200, {
          ok: true,
          brainId: cockpitBrainId,
          lint: await runMaintenanceLint({ recordReceipt: true }),
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/inbox/scan") {
      if (!isLoopbackHost(request)) {
        sendJson(response, 403, { ok: false, error: "forbidden_host" });
        return;
      }
      try {
        const files = await scanInbox(cockpitBrainId);
        sendJson(response, 200, {
          ok: true,
          brainId: cockpitBrainId,
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            modifiedAt: file.modified.toISOString(),
          })),
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    // Read-only per-item fix plan. Loopback-only, like the write endpoint.
    if (request.method === "GET" && url.pathname === "/api/fixes/plan") {
      if (!isLoopbackHost(request)) {
        sendJson(response, 403, { ok: false, error: "forbidden_host" });
        return;
      }
      try {
        const plan = await planLintFixes(cockpitBrainId, brainDate());
        sendJson(response, 200, {
          ok: true,
          brainId: cockpitBrainId,
          items: plan.items,
          lint: await readLintReportCache(),
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    // The mechanical-fix write endpoint applies only approved item ids. Like
    // explicit lint, it is guarded by loopback Host + per-process nonce + JSON
    // content-type (no CORS is ever sent, so a cross-origin page can neither
    // read the nonce nor preflight).
    if (request.method === "POST" && url.pathname === "/api/fixes/apply") {
      if (!isLoopbackHost(request)) {
        sendJson(response, 403, { ok: false, error: "forbidden_host" });
        return;
      }
      if (request.headers["x-cockpit-nonce"] !== cockpitNonce) {
        sendJson(response, 403, { ok: false, error: "bad_nonce" });
        return;
      }
      if (!/^application\/json/.test(String(request.headers["content-type"] || ""))) {
        sendJson(response, 415, { ok: false, error: "json_required" });
        return;
      }
      try {
        const body = await readJsonBody(request);
        const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
        const result = await applyLintFixSelection(cockpitBrainId, brainDate(), ids);
        let lint = null;
        let lintRefreshError = null;
        if (result.applied) {
          try {
            // The apply path already wrote a LINT log entry. Refresh only the
            // structured cache so the tab immediately reflects what remains.
            lint = await runMaintenanceLint({ recordReceipt: false });
          } catch (error) {
            lintRefreshError = String(error?.message || error);
          }
        }
        sendJson(response, 200, {
          ok: true,
          brainId: cockpitBrainId,
          ...result,
          lint,
          lintRefreshError,
        });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    sendJson(response, 404, { ok: false, error: "not_found" });
  });
}

function listen(portToTry, attempt = 1) {
  const server = createCockpitServer();
  const onError = (error) => {
    if (
      error.code === "EADDRINUSE" &&
      allowPortFallback &&
      attempt < maxPortAttempts
    ) {
      console.warn(
        `Brain cockpit port ${portToTry} is in use; trying ${portToTry + 1}.`
      );
      listen(portToTry + 1, attempt + 1);
      return;
    }

    console.error(
      `Brain cockpit failed to listen on http://${host}:${portToTry}: ${error.message}`
    );
    process.exit(1);
  };

  server.once("error", onError);
  server.listen(portToTry, host, () => {
    console.log(`Brain cockpit listening on http://${host}:${portToTry}`);
  });
}

listen(port);
