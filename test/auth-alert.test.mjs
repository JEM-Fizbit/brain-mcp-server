import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  severityForCount,
  decideAuthAlert,
  computeStaleConnector,
  readAuthAlertConfig,
  readAuthAlertThresholds,
  formatReasonSummary,
  buildAuthAlertMessage,
  maybeAlertOnAuthFailure,
} = await import(path.join(__dirname, "..", "dist", "services", "auth-alert.js"));

const THRESHOLDS = { warnThreshold: 3, failThreshold: 10 };

// --- severityForCount (pure) ---------------------------------------------

test("severityForCount returns null below the warn threshold", () => {
  assert.equal(severityForCount(0, THRESHOLDS), null);
  assert.equal(severityForCount(2, THRESHOLDS), null);
});

test("severityForCount returns warn from warn threshold up to fail threshold", () => {
  assert.equal(severityForCount(3, THRESHOLDS), "warn");
  assert.equal(severityForCount(9, THRESHOLDS), "warn");
});

test("severityForCount returns fail at and above the fail threshold", () => {
  assert.equal(severityForCount(10, THRESHOLDS), "fail");
  assert.equal(severityForCount(11, THRESHOLDS), "fail");
});

// --- decideAuthAlert (pure, cooldown) ------------------------------------

const NOW = new Date("2026-06-23T12:00:00Z");
const base = {
  warnThreshold: 3,
  failThreshold: 10,
  cooldownMinutes: 30,
  lastWarnAt: null,
  lastFailAt: null,
  now: NOW,
};
function minutesAgo(min) {
  return new Date(NOW.getTime() - min * 60 * 1000);
}

test("decideAuthAlert does not fire below the warn threshold", () => {
  assert.deepEqual(decideAuthAlert({ ...base, failureCount: 2 }), {
    fire: false,
    reason: "below_threshold",
  });
});

test("decideAuthAlert fires warn at the warn threshold with no recent alerts", () => {
  assert.deepEqual(decideAuthAlert({ ...base, failureCount: 3 }), {
    fire: true,
    severity: "warn",
  });
});

test("decideAuthAlert fires fail at the fail threshold", () => {
  assert.deepEqual(decideAuthAlert({ ...base, failureCount: 10 }), {
    fire: true,
    severity: "fail",
  });
});

test("decideAuthAlert caps a stale-connector loop at warn instead of paging fail", () => {
  // Above the fail threshold, but a benign stale connector -> warn, not fail.
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 50, staleConnector: true }),
    { fire: true, severity: "warn" }
  );
  // A real incident at the same count still pages fail.
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 50, staleConnector: false }),
    { fire: true, severity: "fail" }
  );
});

// --- computeStaleConnector (pure) ----------------------------------------

const STALE_BASE = {
  failingClientIds: ["mcp_client_zombie"],
  allUnknownClientRefresh: true,
  registeredClientIds: ["mcp_client_real"],
  firstFailureAt: minutesAgo(40),
  lastFailureAt: minutesAgo(1),
  now: NOW,
  graceMinutes: 10,
};

test("computeStaleConnector flags a single sustained unregistered client", () => {
  assert.equal(computeStaleConnector(STALE_BASE), true);
});

test("computeStaleConnector is conservative under ambiguity", () => {
  // unknown registered set
  assert.equal(
    computeStaleConnector({ ...STALE_BASE, registeredClientIds: null }),
    false
  );
  // multiple distinct failing clients
  assert.equal(
    computeStaleConnector({ ...STALE_BASE, failingClientIds: ["a", "b"] }),
    false
  );
  // not all unknown_client_id-on-refresh
  assert.equal(
    computeStaleConnector({ ...STALE_BASE, allUnknownClientRefresh: false }),
    false
  );
  // the failing client is actually registered
  assert.equal(
    computeStaleConnector({
      ...STALE_BASE,
      registeredClientIds: ["mcp_client_zombie"],
    }),
    false
  );
  // short burst within the grace window
  assert.equal(
    computeStaleConnector({
      ...STALE_BASE,
      firstFailureAt: new Date(NOW.getTime() - 90 * 1000),
      lastFailureAt: new Date(NOW.getTime() - 5 * 1000),
    }),
    false
  );
});

test("decideAuthAlert suppresses warn when a warn fired within the cooldown", () => {
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 4, lastWarnAt: minutesAgo(10) }),
    { fire: false, reason: "cooldown" }
  );
});

test("decideAuthAlert suppresses warn when a fail fired within the cooldown", () => {
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 4, lastFailAt: minutesAgo(10) }),
    { fire: false, reason: "cooldown" }
  );
});

test("decideAuthAlert fires warn again once the cooldown has elapsed", () => {
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 4, lastWarnAt: minutesAgo(31) }),
    { fire: true, severity: "warn" }
  );
});

test("decideAuthAlert lets a fail break through a recent warn (escalation)", () => {
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 12, lastWarnAt: minutesAgo(1) }),
    { fire: true, severity: "fail" }
  );
});

test("decideAuthAlert suppresses fail when a fail fired within the cooldown", () => {
  assert.deepEqual(
    decideAuthAlert({ ...base, failureCount: 12, lastFailAt: minutesAgo(5) }),
    { fire: false, reason: "cooldown" }
  );
});

// --- readAuthAlertThresholds (pure env) ----------------------------------

test("readAuthAlertThresholds returns documented defaults for an empty env", () => {
  assert.deepEqual(readAuthAlertThresholds({}), {
    windowMinutes: 60,
    warnThreshold: 3,
    failThreshold: 10,
    cooldownMinutes: 30,
    staleGraceMinutes: 10,
  });
});

test("readAuthAlertThresholds honors env overrides", () => {
  assert.deepEqual(
    readAuthAlertThresholds({
      BRAIN_AUTH_ALERT_WINDOW_MINUTES: "120",
      BRAIN_AUTH_ALERT_WARN_THRESHOLD: "5",
      BRAIN_AUTH_ALERT_FAIL_THRESHOLD: "20",
      BRAIN_AUTH_ALERT_COOLDOWN_MINUTES: "15",
      BRAIN_HOSTED_MCP_AUTH_STALE_GRACE_MINUTES: "25",
    }),
    {
      windowMinutes: 120,
      warnThreshold: 5,
      failThreshold: 20,
      cooldownMinutes: 15,
      staleGraceMinutes: 25,
    }
  );
});

test("Slack alerting requires explicit channel and DM targets when token is set", () => {
  const missingTargets = readAuthAlertConfig({
    BRAIN_SLACK_BOT_TOKEN: "xoxb-test",
    BRAIN_ID: "ai-brain-jem",
  });
  assert.equal(missingTargets.enabled, false);
  assert.equal(missingTargets.channel, "");
  assert.equal(missingTargets.dm, "");

  const configured = readAuthAlertConfig({
    BRAIN_SLACK_BOT_TOKEN: "xoxb-test",
    BRAIN_SLACK_ALERT_CHANNEL: "C-OPS",
    BRAIN_SLACK_ALERT_DM: "U-OPERATOR",
    BRAIN_ID: "ai-brain-jem",
  });
  assert.equal(configured.enabled, true);
  assert.equal(configured.channel, "C-OPS");
  assert.equal(configured.dm, "U-OPERATOR");
});

// --- formatReasonSummary + buildAuthAlertMessage (pure) -------------------

test("formatReasonSummary renders reason codes with counts", () => {
  assert.equal(
    formatReasonSummary([
      { reason: "invalid_client", n: 3 },
      { reason: "token_expired", n: 1 },
    ]),
    "invalid_client ×3, token_expired ×1"
  );
});

test("buildAuthAlertMessage builds a warn line for #claude-ops", () => {
  assert.equal(
    buildAuthAlertMessage({
      severity: "warn",
      failureCount: 4,
      windowMinutes: 60,
      reasonSummary: "invalid_client ×3, token_expired ×1",
      httpStatus: "401",
      isoDate: "2026-06-23",
      cockpitUrl: "http://127.0.0.1:8787/",
    }),
    "[brain-auth-alert] 2026-06-23 — ⚠️ 4 hosted MCP auth failures in last 60m (invalid_client ×3, token_expired ×1; HTTP 401). Cockpit: http://127.0.0.1:8787/"
  );
});

test("buildAuthAlertMessage adds the [Action needed] prefix for fail DMs", () => {
  const text = buildAuthAlertMessage({
    severity: "fail",
    failureCount: 12,
    windowMinutes: 60,
    reasonSummary: "invalid_client ×12",
    httpStatus: "401",
    isoDate: "2026-06-23",
    cockpitUrl: "http://127.0.0.1:8787/",
  });
  assert.match(text, /^\[brain-auth-alert\] \[Action needed\] 2026-06-23 — 🚨 12 /);
});

// --- maybeAlertOnAuthFailure (orchestrator, injected fakes) ---------------

function fakeDeps(overrides = {}) {
  const posts = [];
  const dispatches = [];
  const deps = {
    now: () => NOW,
    isoDate: () => "2026-06-23",
    config: {
      enabled: true,
      botToken: "xoxb-test",
      channel: "C-OPS",
      dm: "U-JOHN",
      thresholds: {
        windowMinutes: 60,
        warnThreshold: 3,
        failThreshold: 10,
        cooldownMinutes: 30,
      },
      brainId: "ai-brain-jem",
      cockpitUrl: "http://127.0.0.1:8787/",
    },
    loadState: async () => ({
      failureCount: 4,
      reasons: [{ reason: "invalid_client", n: 4 }],
      httpStatus: "401",
      lastWarnAt: null,
      lastFailAt: null,
    }),
    postMessage: async (channel, text) => {
      posts.push({ channel, text });
      return { ok: true };
    },
    recordDispatch: async (row) => {
      dispatches.push(row);
    },
    ...overrides,
  };
  return { deps, posts, dispatches };
}

test("maybeAlertOnAuthFailure no-ops when the bot token is unset", async () => {
  const { deps, posts } = fakeDeps({ config: { ...fakeDeps().deps.config, botToken: null } });
  const outcome = await maybeAlertOnAuthFailure(deps);
  assert.equal(outcome.fired, false);
  assert.equal(outcome.reason, "disabled");
  assert.equal(posts.length, 0);
});

test("maybeAlertOnAuthFailure posts a warn to the channel and records the dispatch", async () => {
  const { deps, posts, dispatches } = fakeDeps();
  const outcome = await maybeAlertOnAuthFailure(deps);
  assert.equal(outcome.fired, true);
  assert.equal(outcome.severity, "warn");
  assert.equal(outcome.posted, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channel, "C-OPS");
  assert.match(posts[0].text, /⚠️ 4 hosted MCP auth failures/);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].severity, "warn");
  assert.equal(dispatches[0].channel, "C-OPS");
  assert.equal(dispatches[0].ok, true);
});

test("maybeAlertOnAuthFailure routes a fail to the operator DM", async () => {
  const { deps, posts } = fakeDeps({
    loadState: async () => ({
      failureCount: 12,
      reasons: [{ reason: "invalid_client", n: 12 }],
      httpStatus: "401",
      lastWarnAt: null,
      lastFailAt: null,
    }),
  });
  const outcome = await maybeAlertOnAuthFailure(deps);
  assert.equal(outcome.severity, "fail");
  assert.equal(posts[0].channel, "U-JOHN");
  assert.match(posts[0].text, /\[Action needed\]/);
});

test("maybeAlertOnAuthFailure records ok:false when the post fails and still does not throw", async () => {
  const { deps, dispatches } = fakeDeps({
    postMessage: async () => ({ ok: false, error: "channel_not_found" }),
  });
  const outcome = await maybeAlertOnAuthFailure(deps);
  assert.equal(outcome.fired, true);
  assert.equal(outcome.posted, false);
  assert.equal(dispatches[0].ok, false);
});

test("maybeAlertOnAuthFailure fires once for a concurrent burst (cooldown race)", async () => {
  const NOW2 = new Date("2026-06-23T12:00:00Z");
  const posts = [];
  const dispatches = [];
  const config = { ...fakeDeps().deps.config };
  function burstDeps() {
    return {
      now: () => NOW2,
      isoDate: () => "2026-06-23",
      config,
      // Reflects dispatches recorded so far, like the DB cooldown read.
      loadState: async () => ({
        failureCount: 5,
        reasons: [{ reason: "missing_bearer", n: 5 }],
        httpStatus: "401",
        lastWarnAt:
          dispatches.filter((d) => d.severity === "warn").map((d) => d.at).sort().at(-1) ||
          null,
        lastFailAt: null,
      }),
      postMessage: async (channel) => {
        posts.push({ channel });
        return { ok: true };
      },
      recordDispatch: async (row) => {
        dispatches.push({ severity: row.severity, at: NOW2 });
      },
    };
  }
  // Four concurrent evaluations, as happens for a burst of auth failures.
  await Promise.all([burstDeps(), burstDeps(), burstDeps(), burstDeps()].map((d) =>
    maybeAlertOnAuthFailure(d)
  ));
  assert.equal(posts.length, 1, `expected exactly one post for the burst, got ${posts.length}`);
  assert.equal(dispatches.length, 1);
});

test("maybeAlertOnAuthFailure stays silent below the threshold", async () => {
  const { deps, posts } = fakeDeps({
    loadState: async () => ({
      failureCount: 1,
      reasons: [{ reason: "missing_bearer", n: 1 }],
      httpStatus: "401",
      lastWarnAt: null,
      lastFailAt: null,
    }),
  });
  const outcome = await maybeAlertOnAuthFailure(deps);
  assert.equal(outcome.fired, false);
  assert.equal(outcome.reason, "below_threshold");
  assert.equal(posts.length, 0);
});
