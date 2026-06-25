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
  await expect(page.locator(".status-band > .summary")).toBeVisible();
  await expect(page.locator(".status-band > .action-summary-panel")).toBeVisible();
  await expect(page.locator(".status-band > .metrics")).toHaveCount(0);
  await expect(page.locator(".metric-section")).toBeVisible();
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

test("cockpit renders deterministic status on desktop and narrow viewports", async ({ page }, testInfo) => {
  const { child, url } = await startCockpit(testInfo);
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(url);
    await expectCockpitReady(page);
    await expectCockpitDashboardHierarchy(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expectCockpitReady(page);
    await expectCockpitDashboardHierarchy(page);
  } finally {
    await stopCockpit(child);
  }
});
