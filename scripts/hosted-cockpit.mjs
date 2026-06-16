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
        grid-template-columns: repeat(4, minmax(120px, 1fr));
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

      .activity-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
        margin-bottom: 14px;
      }

      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
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
        </div>
      </div>

      <div class="activity-grid">
        <section>
          <h2>Recent Brain Activity</h2>
          <div class="activity-list" id="activity"></div>
        </section>

        <section>
          <h2>Watch Log</h2>
          <div class="activity-list" id="operation-log"></div>
        </section>
      </div>

      <div class="grid">
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

        <div class="stack">
          <section>
            <h2>Next Actions</h2>
            <div class="next-actions" id="actions"></div>
          </section>

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
        "checkedAt",
        "state",
        "cycle",
        "pushed",
        "pulled",
        "unchanged",
        "conflicts",
        "totalMs",
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
            const display = /At$|checkedAt|latestHostedUpdate/.test(key) ? localDateTime(value) : value;
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
        document.getElementById("operation-log").innerHTML = operationLog.length
          ? operationLog.map((event) =>
              "<div class=\"event\">" +
                "<div class=\"event-title\">" + escapeHtml(event.message) + "</div>" +
                "<div class=\"event-meta\">" + escapeHtml(localDateTime(event.at)) + "</div>" +
              "</div>"
            ).join("")
          : "<div class=\"event muted\">Waiting for first refresh.</div>";
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

        document.getElementById("hosted-files").textContent = postgres.hostedFiles ?? "-";
        document.getElementById("local-files").textContent = local.trackedFiles ?? "-";
        document.getElementById("open-conflicts").textContent = postgres.openConflicts ?? "-";
        document.getElementById("last-sync").textContent = sync.checkedAt ? ageLabel(sync.checkedAt) : "-";

        document.getElementById("checks").innerHTML = (payload.checks || [])
          .filter((check) => check.name !== "recent_activity")
          .map((check) => "<tr><td>" + escapeHtml(check.name) + "</td><td><span class=\"pill " + escapeHtml(check.status) + "\">" + escapeHtml(check.status) + "</span></td><td class=\"details\">" + (detailSummary(check.details) || "-") + "</td></tr>")
          .join("");

        document.getElementById("actions").innerHTML = actionItems(payload)
          .map((item) => "<div class=\"event\">" + escapeHtml(item) + "</div>")
          .join("");

        renderActivity(payload);
        renderOperationLog();
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

      document.getElementById("refresh").addEventListener("click", refresh);
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
