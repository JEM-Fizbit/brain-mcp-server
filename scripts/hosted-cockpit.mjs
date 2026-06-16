import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const port = Number(process.env.BRAIN_COCKPIT_PORT || 8787);
const host = process.env.BRAIN_COCKPIT_HOST || "127.0.0.1";

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

async function runDoctor() {
  try {
    const { stdout } = await exec(
      process.execPath,
      [path.join(repoRoot, "scripts", "hosted-doctor.mjs")],
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
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .status-band {
        display: grid;
        grid-template-columns: minmax(220px, 0.9fr) minmax(0, 2fr);
        gap: 14px;
        margin-bottom: 14px;
      }

      .summary {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 18px;
        min-height: 142px;
      }

      .summary-state {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 22px;
        font-weight: 650;
        margin-bottom: 8px;
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

      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 10px;
      }

      .metric {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
        min-height: 72px;
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

      .grid {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        gap: 14px;
      }

      .overview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
      }

      .activity-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
        gap: 14px;
      }

      .tab-list {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        border-bottom: 1px solid var(--line);
      }

      .tab-button {
        border: 0;
        border-bottom: 3px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--muted);
        padding: 10px 12px 9px;
        white-space: nowrap;
      }

      .tab-button[aria-selected="true"] {
        color: var(--ink);
        border-bottom-color: var(--pass);
        font-weight: 650;
      }

      .tab-button:focus-visible {
        outline: 2px solid var(--pass);
        outline-offset: -2px;
      }

      .tab-panel[hidden] {
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

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      pre {
        margin: 0;
        width: 100%;
        max-width: 100%;
        max-height: 280px;
        overflow: auto;
        background: #202124;
        color: #f5f5f2;
        border-radius: 6px;
        padding: 12px;
        font-size: 12px;
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
        .metrics {
          grid-template-columns: 1fr;
        }

        header {
          display: grid;
        }

        .toolbar {
          justify-content: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Brain Cockpit</h1>
          <div class="muted">Local operator view for hosted Brain, sync, conflicts, and daemon health.</div>
        </div>
        <div class="toolbar">
          <span class="muted" id="last-updated">Checking...</span>
          <button id="refresh" type="button" title="Refresh status">Refresh</button>
        </div>
      </header>

      <div class="status-band">
        <section class="summary">
          <div class="summary-state"><span id="state-dot" class="dot"></span><span id="state-text">Checking</span></div>
          <div id="state-copy" class="muted">Running the hosted doctor.</div>
        </section>
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
          <div class="metric">
            <div class="metric-label">Last sync</div>
            <div class="metric-value" id="last-sync">-</div>
          </div>
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

      <div class="tabs">
        <div class="tab-list" role="tablist" aria-label="Cockpit sections">
          <button class="tab-button" id="tab-overview" type="button" role="tab" aria-controls="panel-overview" aria-selected="true">Overview</button>
          <button class="tab-button" id="tab-activity" type="button" role="tab" aria-controls="panel-activity" aria-selected="false">Activity</button>
          <button class="tab-button" id="tab-latency" type="button" role="tab" aria-controls="panel-latency" aria-selected="false">Latency</button>
          <button class="tab-button" id="tab-checks" type="button" role="tab" aria-controls="panel-checks" aria-selected="false">Checks</button>
          <button class="tab-button" id="tab-raw" type="button" role="tab" aria-controls="panel-raw" aria-selected="false">Raw Output</button>
        </div>

        <div class="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
          <div class="overview-grid">
            <section>
              <h2>Next Actions</h2>
              <div class="next-actions" id="actions"></div>
            </section>

            <section>
              <h2>Watch Log</h2>
              <div class="activity-list" id="operation-log"></div>
            </section>
          </div>
        </div>

        <div class="tab-panel" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden>
          <div class="activity-grid">
            <section>
              <h2>Recent Brain Activity</h2>
              <div class="activity-list" id="activity"></div>
            </section>

            <section>
              <h2>Watch Log</h2>
              <div class="activity-list" id="operation-log-activity"></div>
            </section>
          </div>
        </div>

        <div class="tab-panel" id="panel-latency" role="tabpanel" aria-labelledby="tab-latency" hidden>
          <div class="activity-grid">
            <section>
              <h2>User-Facing Operations</h2>
              <div class="activity-list" id="user-operation-latencies"></div>
            </section>

            <section>
              <h2>Infrastructure Checks</h2>
              <div class="activity-list" id="latencies"></div>
            </section>
          </div>
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

        <div class="tab-panel" id="panel-raw" role="tabpanel" aria-labelledby="tab-raw" hidden>
          <section>
            <h2>Raw Doctor Output</h2>
            <pre id="raw">{}</pre>
          </section>
        </div>
      </div>
    </main>

    <script>
      const operationLog = [];
      let previousSnapshot = null;

      const statusCopy = {
        pass: ["Safe to use hosted", "Hosted health, local sync, conflict count, daemon, and Fly checks are currently passing."],
        warn: ["Needs attention", "Nothing is hard-failing, but one or more checks needs review before this is boring."],
        fail: ["Blocked", "A critical hosted Brain check failed. Fix this before relying on hosted Brain."],
      };

      const usefulDetailKeys = [
        "baseUrl",
        "brainId",
        "hostedFiles",
        "trackedFiles",
        "openConflicts",
        "latestHostedUpdate",
        "latestOperationAt",
        "latestReadLatencyMs",
        "latestWriteLatencyMs",
        "latestSyncWaitLatencyMs",
        "operationCount",
        "checkedAt",
        "state",
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
        "app",
        "error",
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

      function localTime(iso) {
        if (!iso) return "-";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "-";
        return new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(date);
      }

      function localDateTime(iso) {
        if (!iso) return "-";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "-";
        return new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(date);
      }

      function compactHash(value) {
        return value ? String(value).slice(0, 10) : "-";
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

      function actionItems(payload) {
        const items = [];
        const checks = payload.checks || [];
        const openConflicts = byName(payload, "postgres_summary")?.details?.openConflicts || 0;
        const syncHealth = byName(payload, "sync_health");
        const launchd = byName(payload, "launchd");

        if (payload.status === "pass") {
          items.push("No operator action needed right now. This is the state we want before a real hosted test drive.");
        }

        if (openConflicts > 0) {
          items.push("Review open conflicts and resolve through the documented conflict workflow before asking clients to trust hosted state.");
        }

        if (syncHealth?.status === "warn") {
          items.push("Sync health is stale or incomplete. Check the local launchd loop and recent sync logs.");
        }

        if (syncHealth?.status === "fail") {
          items.push("Sync health is failing. Run npm run sync -- summary, then inspect the reported conflict or error.");
        }

        if (launchd?.status === "warn") {
          items.push("Launchd is not confidently running. Restart the local sync agent before a test drive.");
        }

        for (const check of checks.filter((check) => check.status === "fail")) {
          if (check.name !== "sync_health") {
            items.push(check.name + " failed. Inspect the details in the checks table and raw doctor output.");
          }
        }

        return [...new Set(items)];
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

      function renderOperationLog() {
        const markup = operationLog.length
          ? operationLog.map((event) =>
              "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(event.message) + "</div>" +
                "<div class=\"event-meta\">" + escapeHtml(localDateTime(event.at)) + "</div>" +
              "</div>"
            ).join("")
          : "<div class=\"event muted\">Waiting for first refresh.</div>";
        document.getElementById("operation-log").innerHTML = markup;
        document.getElementById("operation-log-activity").innerHTML = markup;
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
        return kind || "operation";
      }

      function renderUserOperationLatencies(payload) {
        const details = byName(payload, "user_operation_latency")?.details || {};
        const operations = details.operations || [];
        const recordedAt = details.latestOperationAt || details.checkedAt;
        const intro = details.state === "recorded"
          ? "Latest recorded hosted MCP operation: " + localDateTime(recordedAt)
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

        const rows = operations.length
          ? operations.map((operation) =>
              "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(operation.name) + ": " + escapeHtml(formatDuration(operation.latencyMs)) + "</div>" +
                "<div class=\"event-meta\">" +
                  escapeHtml(operationKindLabel(operation.kind)) + " · " +
                  escapeHtml(operation.target || "-") + " · " +
                  escapeHtml(operation.ok ? "ok" : "failed") + " · " +
                  escapeHtml(localDateTime(operation.at)) +
                  (operation.error ? " · " + escapeHtml(operation.error) : "") +
                "</div>" +
              "</div>"
            ).join("")
          : "";

        document.getElementById("user-operation-latencies").innerHTML = summary + rows;
      }

      function render(payload) {
        detectChanges(payload);
        const state = payload.status || "fail";
        const [title, copy] = statusCopy[state] || statusCopy.fail;
        document.getElementById("state-dot").className = "dot " + state;
        document.getElementById("state-text").textContent = title;
        document.getElementById("state-copy").textContent = copy;
        document.getElementById("last-updated").textContent = payload.checkedAt ? "Checked " + ageLabel(payload.checkedAt) + " (" + localTime(payload.checkedAt) + ")" : "Checked just now";

        const postgres = byName(payload, "postgres_summary")?.details || {};
        const local = byName(payload, "local_sync_state")?.details || {};
        const sync = byName(payload, "sync_health")?.details || {};
        const userOps = byName(payload, "user_operation_latency")?.details || {};

        document.getElementById("hosted-files").textContent = postgres.hostedFiles ?? "-";
        document.getElementById("local-files").textContent = local.trackedFiles ?? "-";
        document.getElementById("open-conflicts").textContent = postgres.openConflicts ?? "-";
        document.getElementById("last-sync").textContent = sync.checkedAt ? ageLabel(sync.checkedAt) : "-";
        document.getElementById("read-op-latency").textContent = formatDuration(userOps.latestReadLatencyMs);
        document.getElementById("write-op-latency").textContent = formatDuration(userOps.latestWriteLatencyMs);
        document.getElementById("sync-wait-latency").textContent = formatDuration(userOps.latestSyncWaitLatencyMs);
        document.getElementById("hosted-latency").textContent = formatDuration(byName(payload, "hosted_health")?.details?.latencyMs);
        document.getElementById("postgres-latency").textContent = formatDuration(postgres.latencyMs);
        document.getElementById("sync-latency").textContent = formatDuration(sync.totalMs);
        document.getElementById("doctor-latency").textContent = formatDuration(payload.latencyMs);

        document.getElementById("checks").innerHTML = (payload.checks || [])
          .filter((check) => check.name !== "recent_activity")
          .map((check) => "<tr><td>" + escapeHtml(check.name) + "</td><td><span class=\"pill " + escapeHtml(check.status) + "\">" + escapeHtml(check.status) + "</span></td><td class=\"details\">" + (detailSummary(check.details) || "-") + "</td></tr>")
          .join("");

        document.getElementById("actions").innerHTML = actionItems(payload)
          .map((item) => "<div class=\"event\">" + escapeHtml(item) + "</div>")
          .join("");

        renderActivity(payload);
        renderOperationLog();
        renderUserOperationLatencies(payload);
        renderLatencies(payload);
        document.getElementById("raw").textContent = JSON.stringify(payload, null, 2);
      }

      async function refresh() {
        const button = document.getElementById("refresh");
        button.disabled = true;
        button.textContent = "Refreshing";
        try {
          const response = await fetch("/api/doctor", { cache: "no-store" });
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
          button.textContent = "Refresh";
        }
      }

      function activateTab(tabId) {
        for (const button of document.querySelectorAll("[role='tab']")) {
          const selected = button.id === tabId;
          button.setAttribute("aria-selected", String(selected));
          document.getElementById(button.getAttribute("aria-controls")).hidden = !selected;
        }
      }

      function setupTabs() {
        for (const button of document.querySelectorAll("[role='tab']")) {
          button.addEventListener("click", () => activateTab(button.id));
          button.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(document.querySelectorAll("[role='tab']"));
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

      document.getElementById("refresh").addEventListener("click", refresh);
      setupTabs();
      refresh();
      setInterval(refresh, 60000);
    </script>
  </body>
</html>`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, page);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/doctor") {
    sendJson(response, 200, await runDoctor());
    return;
  }
  sendJson(response, 404, { ok: false, error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Brain cockpit listening on http://${host}:${port}`);
});
