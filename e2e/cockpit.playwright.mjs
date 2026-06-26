import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

async function openPort() {
  const server = net.createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (!port) reject(new Error("Could not allocate a local port"));
        else resolve(port);
      });
    });
  });
}

async function writeDoctorStub(testInfo) {
  const doctorScript = testInfo.outputPath("doctor-stub.mjs");
  await fs.mkdir(path.dirname(doctorScript), { recursive: true });
  const payload = {
    ok: true,
    status: "pass",
    checkedAt: "2026-06-25T21:31:49.000Z",
    latencyMs: 42,
    profile: {
      brainId: "ai-brain-jem",
      profileName: "JEM",
      profileLabel: "JEM (ai-brain-jem)",
      switcherLabel: "JEM (ai-brain-jem) - current",
      profileCount: 2,
      isMultiProfile: true,
      stateFile: "/tmp/brain-cockpit/state.json",
      healthFile: "/tmp/brain-cockpit/state.json.health.json",
      logDir: "/tmp/brain-cockpit",
      cockpitUrl: "http://127.0.0.1:8787/",
      supervisor: "menubar",
      availableProfiles: [
        {
          brainId: "ai-brain-jem",
          profileName: "JEM",
          switcherLabel: "JEM (ai-brain-jem) - current",
          cockpitUrl: "http://127.0.0.1:8787/",
        },
        {
          brainId: "ers-brain",
          profileName: "ERS",
          switcherLabel: "ERS (ers-brain)",
          cockpitUrl: "http://127.0.0.1:8788/",
        },
      ],
    },
    actions: [
      {
        level: "pass",
        status: "pass",
        brain_id: "ai-brain-jem",
        reason: "none",
        urgency: "none",
        title: "No operator action required.",
        next_action: "Hosted health, local sync, conflicts, daemon, and Fly checks are acceptable.",
      },
    ],
    checks: [
      {
        name: "postgres_summary",
        status: "pass",
        details: {
          brainId: "ai-brain-jem",
          hostedFiles: 158,
          openConflicts: 0,
          latestHostedUpdate: "2026-06-25T21:31:40.000Z",
        },
      },
      {
        name: "local_sync_state",
        status: "pass",
        details: {
          trackedFiles: 158,
          stateFile: "/tmp/brain-cockpit/state.json",
        },
      },
      {
        name: "sync_health",
        status: "pass",
        details: {
          checkedAt: "2026-06-25T21:31:40.000Z",
          cycle: 12,
          pushed: 0,
          pulled: 0,
          unchanged: 158,
          conflicts: 0,
          totalMs: 1234,
          healthFile: "/tmp/brain-cockpit/state.json.health.json",
        },
      },
      {
        name: "launchd",
        status: "pass",
        details: {
          supervisor: "menubar",
          brainId: "ai-brain-jem",
          profileName: "JEM",
          cockpitUrl: "http://127.0.0.1:8787/",
        },
      },
      {
        name: "hosted_health",
        status: "pass",
        details: {
          latencyMs: 88,
        },
      },
      {
        name: "user_operation_latency",
        status: "pass",
        details: {
          usageStats: {
            windows: [
              { key: "24h", label: "24H", totalCount: 0, failedCount: 0, byKind: [] },
              { key: "7d", label: "7D", totalCount: 0, failedCount: 0, byKind: [] },
            ],
            allTime: { label: "All time", totalCount: 0, failedCount: 0, byKind: [] },
          },
          eventLog: [
            {
              name: "brain_read_file",
              kind: "read",
              timingLayer: "server_tool",
              ok: true,
              target: "09_tools_stack.md",
              source: "hosted_mcp_server",
              latencyMs: 3,
              at: "2026-06-25T21:30:55.000Z",
              db: {
                queryCount: 1,
                totalMs: 2,
                maxMs: 2,
                averageMs: 2,
                rowCount: 1,
                failedCount: 0,
              },
            },
          ],
        },
      },
    ],
  };
  await fs.writeFile(
    doctorScript,
    `console.log(${JSON.stringify(JSON.stringify(payload, null, 2))});\n`,
    "utf8"
  );
  return doctorScript;
}

async function startCockpit(testInfo) {
  const port = await openPort();
  const doctorScript = await writeDoctorStub(testInfo);
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "hosted-cockpit.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BRAIN_COCKPIT_DOCTOR_SCRIPT: doctorScript,
      BRAIN_COCKPIT_HOST: "127.0.0.1",
      BRAIN_COCKPIT_PORT: String(port),
      BRAIN_COCKPIT_PORT_FALLBACK: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for cockpit server. Output:\n${output}`));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/Brain cockpit listening on (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Cockpit server exited with ${code}. Output:\n${output}`));
    });
  });

  return { child, url };
}

async function stopCockpit(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function expectCockpitReady(page) {
  await expect(page.locator("#active-brain-title")).toHaveText("JEM (ai-brain-jem)");
  await expect(page.locator("#action-summary-heading")).toHaveText("Needs Action");
  await expect(page.locator("#action-summary-count")).toHaveText("None");
  await expect(page.locator("#profile-switcher")).toBeVisible();
  await expect(page.locator("#profile-switcher option")).toHaveCount(2);
  await expect(page.locator("#last-sync")).toHaveText(
    /^\d{4}-[A-Z][a-z]{2}-\d{2}; \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/
  );
  await expect(page.locator("#last-updated")).toContainText(
    /\d{4}-[A-Z][a-z]{2}-\d{2}; \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}/
  );
  await expect(page.locator("#raw")).toContainText('"status": "pass"');
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
}

async function expectCockpitDashboardHierarchy(page) {
  await expect(page.locator("#panel-overview > .status-band > .summary")).toBeVisible();
  await expect(page.locator("#panel-overview > .status-band > .action-summary-panel")).toBeVisible();
  await expect(page.locator("#panel-overview > .status-band > .metrics")).toHaveCount(0);
  await expect(page.locator("#panel-overview > .metric-section")).toBeVisible();
  await expect(page.locator("main > .status-band")).toHaveCount(0);
  await expect(page.locator("main > .metric-section")).toHaveCount(0);
  await expect(page.locator("#metric-section-heading")).toHaveText("Operational Signals");
  await expect(page.locator(".metric-section .metrics .metric")).toHaveCount(14);

  const layout = await page.evaluate(() => {
    const summary = document.querySelector(".summary")?.getBoundingClientRect();
    const actions = document.querySelector(".action-summary-panel")?.getBoundingClientRect();
    const metricSection = document.querySelector(".metric-section")?.getBoundingClientRect();
    const firstMetric = document.querySelector(".metric-section .metric")?.getBoundingClientRect();
    const statusBand = document.querySelector(".status-band");
    return {
      statusBandChildren: statusBand ? Array.from(statusBand.children).map((child) => child.className) : [],
      metricsBelowPriority:
        Boolean(summary && actions && metricSection) &&
        metricSection.top >= Math.max(summary.bottom, actions.bottom) + 8,
      priorityPanelsTallerThanMetrics:
        Boolean(summary && actions && firstMetric) &&
        Math.min(summary.height, actions.height) > firstMetric.height,
    };
  });

  expect(layout.statusBandChildren).toEqual(["summary", "action-summary-panel"]);
  expect(layout.metricsBelowPriority).toBe(true);
  expect(layout.priorityPanelsTallerThanMetrics).toBe(true);
}

async function expectCockpitLandingRedesign(page, { desktop }) {
  await expect(page.locator("#health-summary-heading")).toHaveText("Current Status");
  await expect(page.locator(".profile-diagnostics summary")).toHaveText("Local Diagnostics");
  const diagnosticsOpen = await page.locator(".profile-diagnostics").evaluate((element) => element.open);
  expect(diagnosticsOpen).toBe(false);

  await expect(page.locator(".metric-group")).toHaveCount(4);
  await expect(page.locator(".metric-group-title")).toHaveText([
    "Content State",
    "Activity",
    "Latency",
    "Runtime",
  ]);
  await expect(page.locator("#overview-actions-heading")).toHaveText("Operator Queue");
  await expect(page.locator("#overview-usage-heading")).toHaveText("Usage Snapshot");

  const layout = await page.evaluate(() => {
    const summary = document.querySelector(".summary")?.getBoundingClientRect();
    const actions = document.querySelector(".action-summary-panel")?.getBoundingClientRect();
    const firstMetricGroup = document.querySelector(".metric-group")?.getBoundingClientRect();
    const overviewPrimary = document.querySelector(".overview-primary")?.getBoundingClientRect();
    const overviewSide = document.querySelector(".overview-side")?.getBoundingClientRect();
    return {
      statusPanelsShareRow:
        Boolean(summary && actions) &&
        Math.abs(summary.top - actions.top) < 4 &&
        Math.abs(summary.height - actions.height) < 36,
      statusPanelsStackOnNarrow:
        Boolean(summary && actions) &&
        actions.top >= summary.bottom + 8,
      metricGroupsStartBelowPriority:
        Boolean(summary && actions && firstMetricGroup) &&
        firstMetricGroup.top >= Math.max(summary.bottom, actions.bottom) + 16,
      overviewPrimaryWider:
        Boolean(overviewPrimary && overviewSide) &&
        overviewPrimary.width > overviewSide.width,
      overviewStacksOnNarrow:
        Boolean(overviewPrimary && overviewSide) &&
        overviewSide.top >= overviewPrimary.bottom + 8,
    };
  });

  expect(layout.metricGroupsStartBelowPriority).toBe(true);
  if (desktop) {
    expect(layout.statusPanelsShareRow).toBe(true);
    expect(layout.overviewPrimaryWider).toBe(true);
  } else {
    expect(layout.statusPanelsStackOnNarrow).toBe(true);
    expect(layout.overviewStacksOnNarrow).toBe(true);
  }
}

async function expectCockpitNavigationHierarchy(page, { desktop }) {
  await expect(page.locator(".tab-list")).toHaveAttribute("data-nav-level", "primary");
  await expect(page.locator(".tab-button[aria-selected='true']")).toHaveText("Overview");

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.locator("#panel-activity")).toBeVisible();
  await expect(page.locator("#panel-overview")).toBeHidden();
  await expect(page.locator("#tab-context-strip")).toBeVisible();
  await expect(page.locator("#tab-context-brain")).toHaveText("JEM (ai-brain-jem)");
  await expect(page.locator("#tab-context-state")).toHaveText("Safe to use hosted");
  await expect(page.locator("#tab-context-actions")).toHaveText("Actions: none");
  await expect(page.locator("#tab-context-sync")).toContainText("Last sync");
  await expect(page.locator(".status-band")).toBeHidden();
  await expect(page.locator(".metric-section")).toBeHidden();
  await expect(page.locator("#panel-activity .subtab-list")).toHaveAttribute("data-nav-level", "secondary");
  await expect(page.locator("#activity-subtab-operations")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#activity-view-operations")).toBeVisible();

  const hierarchy = await page.evaluate(() => {
    const primaryNav = document.querySelector(".tab-list");
    const activePrimary = document.querySelector(".tab-button[aria-selected='true']");
    const activityPanel = document.querySelector("#panel-activity");
    const secondaryNav = document.querySelector("#panel-activity .subtab-list");
    const activeSecondary = document.querySelector("#panel-activity .subtab-button[aria-selected='true']");
    const primaryRect = activePrimary?.getBoundingClientRect();
    const secondaryRect = activeSecondary?.getBoundingClientRect();
    const panelRect = activityPanel?.getBoundingClientRect();
    const secondaryNavRect = secondaryNav?.getBoundingClientRect();
    const primaryStyle = activePrimary ? getComputedStyle(activePrimary) : null;
    const secondaryStyle = activeSecondary ? getComputedStyle(activeSecondary) : null;
    const primaryNavStyle = primaryNav ? getComputedStyle(primaryNav) : null;
    return {
      primaryNavHasContainer:
        Boolean(primaryNavStyle) &&
        primaryNavStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        parseFloat(primaryNavStyle.borderTopWidth) >= 1,
      activePrimaryHasFilledState:
        Boolean(primaryStyle) &&
        primaryStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        parseFloat(primaryStyle.borderTopWidth) >= 1,
      secondaryContainedInPanel:
        Boolean(panelRect && secondaryNavRect) &&
        secondaryNavRect.left >= panelRect.left + 12 &&
        secondaryNavRect.right <= panelRect.right - 12,
      primaryVisuallyDominant:
        Boolean(primaryRect && secondaryRect && primaryStyle && secondaryStyle) &&
        primaryRect.height > secondaryRect.height &&
        parseFloat(primaryStyle.fontSize) >= parseFloat(secondaryStyle.fontSize),
      navsDoNotShareOneRow:
        Boolean(primaryRect && secondaryRect) &&
        secondaryRect.top >= primaryRect.bottom + 12,
      primaryTabsFitViewport:
        Array.from(document.querySelectorAll(".tab-button")).every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
        }),
      bodyHasNoOverflow:
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  });

  expect(hierarchy.primaryNavHasContainer).toBe(true);
  expect(hierarchy.activePrimaryHasFilledState).toBe(true);
  expect(hierarchy.primaryVisuallyDominant).toBe(true);
  expect(hierarchy.navsDoNotShareOneRow).toBe(true);
  expect(hierarchy.bodyHasNoOverflow).toBe(true);
  if (desktop) {
    expect(hierarchy.secondaryContainedInPanel).toBe(true);
  } else {
    expect(hierarchy.primaryTabsFitViewport).toBe(true);
  }

  await page.getByRole("tab", { name: "Auth" }).click();
  await expect(page.locator("#activity-subtab-auth")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#activity-view-auth")).toBeVisible();
}

async function expectOperationLogTablePolish(page) {
  await page.locator("#tab-activity").click();
  await page.getByRole("tab", { name: "Operation Log" }).click();
  const firstRow = page.locator(".operation-log-table tbody tr.operation-event-row").first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow.locator(".operation-time-col .timestamp-date")).toHaveText(
    /^\d{4}-[A-Z][a-z]{2}-\d{2}$/
  );
  await expect(firstRow.locator(".operation-time-col .timestamp-time")).toHaveText(
    /^\d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/
  );

  const tableLayout = await page.evaluate(() => {
    const table = document.querySelector(".operation-log-table");
    const row = document.querySelector(".operation-log-table tbody tr.operation-event-row");
    const timeCell = row?.querySelector(".operation-time-col");
    const targetCell = row?.querySelector(".target-col");
    const timestampStack = timeCell?.querySelector(".timestamp-stack");
    const timeStyle = timeCell ? getComputedStyle(timeCell) : null;
    const targetStyle = targetCell ? getComputedStyle(targetCell) : null;
    const timeRect = timeCell?.getBoundingClientRect();
    const targetRect = targetCell?.getBoundingClientRect();
    return {
      hasReadableMinWidth: Boolean(timeRect) && timeRect.width >= 140,
      timestampStacksVertically: Boolean(timestampStack) && timestampStack.children.length === 2,
      timeAllowsFullContent:
        Boolean(timeStyle) &&
        timeStyle.whiteSpace !== "nowrap" &&
        timeStyle.overflow !== "hidden" &&
        timeStyle.textOverflow !== "ellipsis",
      targetCanWrap:
        Boolean(targetStyle) &&
        targetStyle.whiteSpace !== "nowrap" &&
        targetStyle.overflow !== "hidden",
      whenColumnWiderThanTarget:
        Boolean(timeRect && targetRect) &&
        timeRect.width >= targetRect.width * 0.85,
      noPageOverflow:
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      tableKeepsHorizontalScroll:
        Boolean(table) &&
        table.scrollWidth >= table.clientWidth,
    };
  });

  expect(tableLayout.hasReadableMinWidth).toBe(true);
  expect(tableLayout.timestampStacksVertically).toBe(true);
  expect(tableLayout.timeAllowsFullContent).toBe(true);
  expect(tableLayout.targetCanWrap).toBe(true);
  expect(tableLayout.whenColumnWiderThanTarget).toBe(true);
  expect(tableLayout.noPageOverflow).toBe(true);
}

test("cockpit renders deterministic status on desktop and narrow viewports", async ({ page }, testInfo) => {
  const { child, url } = await startCockpit(testInfo);
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(url);
    await expectCockpitReady(page);
    await expectCockpitDashboardHierarchy(page);
    await expectCockpitLandingRedesign(page, { desktop: true });
    await expectCockpitNavigationHierarchy(page, { desktop: true });
    await expectOperationLogTablePolish(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expectCockpitReady(page);
    await expectCockpitDashboardHierarchy(page);
    await expectCockpitLandingRedesign(page, { desktop: false });
    await expectCockpitNavigationHierarchy(page, { desktop: false });
  } finally {
    await stopCockpit(child);
  }
});
