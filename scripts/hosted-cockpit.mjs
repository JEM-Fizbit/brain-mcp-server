import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const requestedPort = process.env.BRAIN_COCKPIT_PORT;
const port = Number(requestedPort || 8787);
const host = process.env.BRAIN_COCKPIT_HOST || "127.0.0.1";
const allowPortFallback =
  process.env.BRAIN_COCKPIT_PORT_FALLBACK === "1" ||
  (!requestedPort && process.env.BRAIN_COCKPIT_PORT_FALLBACK !== "0");
const maxPortAttempts = Math.max(
  1,
  Number(process.env.BRAIN_COCKPIT_PORT_ATTEMPTS || 10)
);

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

      .subtab-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--line);
      }

      .subtab-button {
        border: 0;
        border-bottom: 3px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--muted);
        padding: 8px 10px 7px;
        white-space: nowrap;
      }

      .subtab-button[aria-selected="true"] {
        color: var(--ink);
        border-bottom-color: var(--pass);
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

      .operation-table-wrap {
        max-width: 100%;
        overflow-x: auto;
      }

      .operation-log-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        min-width: 980px;
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
        font-weight: 650;
      }

      .operation-log-table .duration-col {
        font-weight: 650;
        text-align: right;
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
              <h2>Usage</h2>
              <div class="activity-list" id="operation-usage"></div>
            </section>
          </div>
        </div>

        <div class="tab-panel" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden>
          <div class="subtab-list" role="tablist" aria-label="Activity sections">
            <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-operations" type="button" role="tab" aria-controls="activity-view-operations" aria-selected="true">Operation Log</button>
            <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-brain" type="button" role="tab" aria-controls="activity-view-brain" aria-selected="false">Recent Brain Activity</button>
            <button class="subtab-button" data-subtab-scope="activity" id="activity-subtab-watch" type="button" role="tab" aria-controls="activity-view-watch" aria-selected="false">Cockpit Watch</button>
          </div>

          <section class="subtab-panel activity-view" data-subtab-scope="activity" id="activity-view-operations" role="tabpanel" aria-labelledby="activity-subtab-operations">
            <h2>Operation Log</h2>
            <div class="section-note">The event log: hosted MCP tool-call and auth metadata, including operation type, timing layer, safe target, status, latency, DB summary, and timestamp. Auth failures usually indicate stale or disconnected client credentials and may require connector re-enrollment.</div>
            <div class="activity-list" id="operation-events"></div>
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
          <div class="subtab-list" role="tablist" aria-label="Latency sections">
            <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-slo" type="button" role="tab" aria-controls="latency-view-slo" aria-selected="true">SLOs & Findings</button>
            <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-trends" type="button" role="tab" aria-controls="latency-view-trends" aria-selected="false">Operation Trends</button>
            <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-slowest" type="button" role="tab" aria-controls="latency-view-slowest" aria-selected="false">Slowest Operations</button>
            <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-samples" type="button" role="tab" aria-controls="latency-view-samples" aria-selected="false">Recent Samples</button>
            <button class="subtab-button" data-subtab-scope="latency" id="latency-subtab-infra" type="button" role="tab" aria-controls="latency-view-infra" aria-selected="false">Infrastructure Checks</button>
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
        "pendingFiles",
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

      function formatCount(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        return new Intl.NumberFormat().format(number);
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
        if (Array.isArray(payload.actions) && payload.actions.length > 0) {
          return payload.actions.map((action) =>
            action.title + (action.detail ? " " + action.detail : "")
          );
        }

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
              "<th style=\"width: 18%\">Tool</th>" +
              "<th style=\"width: 8%\">Latency</th>" +
              "<th style=\"width: 8%\">Type</th>" +
              "<th style=\"width: 10%\">Timing</th>" +
              "<th style=\"width: 8%\">Status</th>" +
              "<th style=\"width: 14%\">Target</th>" +
              "<th style=\"width: 10%\">Source</th>" +
              "<th style=\"width: 14%\">DB</th>" +
              "<th style=\"width: 10%\">When</th>" +
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

        return "<tr>" +
          "<td class=\"tool-col\" title=\"" + escapeHtml(tool) + "\">" + escapeHtml(tool) + "</td>" +
          "<td class=\"duration-col\" title=\"" + escapeHtml(formatDuration(event.latencyMs)) + "\">" + escapeHtml(formatDuration(event.latencyMs)) + "</td>" +
          "<td title=\"" + escapeHtml(operationKindLabel(event.kind)) + "\">" + escapeHtml(operationKindLabel(event.kind)) + "</td>" +
          "<td title=\"" + escapeHtml(timingLayerLabel(event.timingLayer)) + "\">" + escapeHtml(timingLayerLabel(event.timingLayer)) + "</td>" +
          "<td class=\"" + statusClass + "\" title=\"" + escapeHtml(status + errorTitle) + "\">" + escapeHtml(status) + "</td>" +
          "<td title=\"" + escapeHtml(target) + "\">" + escapeHtml(target) + "</td>" +
          "<td title=\"" + escapeHtml(source) + "\">" + escapeHtml(sourceDisplay) + "</td>" +
          "<td title=\"" + escapeHtml(dbSummaryLabel(event.db) || "-") + "\">" + escapeHtml(dbSummaryCompact(event.db) || "-") + "</td>" +
          "<td title=\"" + escapeHtml(localDateTime(event.at)) + "\">" + escapeHtml(localTime(event.at)) + "</td>" +
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
        document.getElementById("last-updated").textContent = payload.checkedAt ? "Checked " + ageLabel(payload.checkedAt) + " (" + localTime(payload.checkedAt) + ")" : "Checked just now";

        const postgres = byName(payload, "postgres_summary")?.details || {};
        const local = byName(payload, "local_sync_state")?.details || {};
        const sync = byName(payload, "sync_health")?.details || {};
        const userOps = byName(payload, "user_operation_latency")?.details || {};
        const usage24h = usageWindow(userOps, "24h");
        const usage7d = usageWindow(userOps, "7d");

        document.getElementById("hosted-files").textContent = postgres.hostedFiles ?? "-";
        document.getElementById("local-files").textContent = local.trackedFiles ?? "-";
        document.getElementById("open-conflicts").textContent = postgres.openConflicts ?? "-";
        document.getElementById("last-sync").textContent = sync.checkedAt ? ageLabel(sync.checkedAt) : "-";
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
          .map((check) => "<tr><td>" + escapeHtml(check.name) + "</td><td><span class=\"pill " + escapeHtml(check.status) + "\">" + escapeHtml(check.status) + "</span></td><td class=\"details\">" + (detailSummary(check.details) || "-") + "</td></tr>")
          .join("");

        document.getElementById("actions").innerHTML = actionItems(payload)
          .map((item) => "<div class=\"event\">" + escapeHtml(item) + "</div>")
          .join("");

        renderActivity(payload);
        renderOperationUsage(payload);
        renderOperationEvents(payload);
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
        for (const button of document.querySelectorAll(".tab-button")) {
          const selected = button.id === tabId;
          button.setAttribute("aria-selected", String(selected));
          document.getElementById(button.getAttribute("aria-controls")).hidden = !selected;
        }
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
      sendJson(response, 200, await runDoctor());
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
