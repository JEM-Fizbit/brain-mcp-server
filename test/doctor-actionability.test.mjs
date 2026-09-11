import test from "node:test";
import assert from "node:assert/strict";

import {
  enforceOperatorAlarmContract,
  classifyFlyStatusError,
  classifyFlyStatusOutput,
  classifyLintFindings,
  classifyPostgresError,
  consecutiveFailureStreak,
  postgresFailureDetail,
  postgresFailureStatus,
  evaluateSyncHealth,
  syncHealthAction,
  OPERATOR_ALARM_CHECKS,
  TRANSIENT_FAILURE_ESCALATION_CYCLES,
} from "../scripts/lib/doctor-actionability.mjs";

test("lint alarms distinguish operator actions from maintainer-only findings", () => {
  assert.deepEqual(
    classifyLintFindings({ issueCount: 0, automaticFixCount: 0 }),
    { status: "pass", state: "clear" }
  );
  assert.deepEqual(
    classifyLintFindings({ issueCount: 685, automaticFixCount: 0 }),
    { status: "info", state: "maintainer_only" }
  );
  assert.deepEqual(
    classifyLintFindings({ issueCount: 685, automaticFixCount: 34 }),
    { status: "warn", state: "actionable_fixes" }
  );
  assert.deepEqual(
    classifyLintFindings({
      issueCount: 4,
      automaticFixCount: 0,
      operatorDecisionCount: 1,
      diagnosticCount: 0,
    }),
    { status: "warn", state: "operator_decisions" }
  );
  assert.deepEqual(
    classifyLintFindings({
      issueCount: 0,
      automaticFixCount: 0,
      operatorDecisionCount: 0,
      diagnosticCount: 9,
    }),
    { status: "info", state: "maintainer_only" }
  );
});

test("missing Fly authentication is informational and directly resolvable", () => {
  const result = classifyFlyStatusError(
    new Error("Error: no access token available. Please login with 'flyctl auth login'"),
    "jem-brain-mcp"
  );

  assert.equal(result.status, "info");
  assert.equal(result.details.state, "auth_required");
  assert.equal(result.details.optional, true);
  assert.match(result.details.message, /Hosted health and sync are checked separately/);
  assert.match(result.details.resolution, /fly auth login/);
});

test("missing flyctl is informational rather than an operator alarm", () => {
  const error = Object.assign(new Error("spawn flyctl ENOENT"), { code: "ENOENT" });
  const result = classifyFlyStatusError(error, "jem-brain-mcp");

  assert.equal(result.status, "info");
  assert.equal(result.details.state, "cli_unavailable");
  assert.equal(result.details.optional, true);
});

test("unexpected Fly control-plane errors remain actionable warnings", () => {
  const result = classifyFlyStatusError(
    new Error("request failed: control plane unavailable"),
    "jem-brain-mcp"
  );

  assert.equal(result.status, "warn");
  assert.equal(result.details.state, "check_failed");
  assert.match(result.details.resolution, /flyctl status --app jem-brain-mcp/);
});

test("Fly output distinguishes passing Machines from actionable failures", () => {
  const passing = classifyFlyStatusOutput(
    "App jem-brain-mcp\n1 machines have been retrieved\n1 passing",
    "jem-brain-mcp"
  );
  const failing = classifyFlyStatusOutput(
    "App jem-brain-mcp\n0 passing",
    "jem-brain-mcp"
  );

  assert.equal(passing.status, "pass");
  assert.equal(passing.details.state, "healthy");
  assert.equal(failing.status, "warn");
  assert.equal(failing.details.state, "no_passing_machines");
  assert.match(failing.details.resolution, /restore a passing Machine/);
});

test("the explicit operator alarm registry covers Fly status", () => {
  assert.equal(OPERATOR_ALARM_CHECKS.has("fly_status"), true);
});

test("diagnostics without an operator action contract cannot become alarms", () => {
  const checks = [
    { name: "future_optional_probe", status: "warn", details: { error: "unavailable" } },
    { name: "hosted_health", status: "fail", details: { httpStatus: 500 } },
  ];

  enforceOperatorAlarmContract(checks);

  assert.equal(checks[0].status, "info");
  assert.equal(checks[0].details.originalStatus, "warn");
  assert.equal(checks[0].details.state, "action_contract_missing");
  assert.equal(checks[1].status, "fail");
});

// --- Spec 019 phase 1: Postgres transient tolerance ---

test("transient Postgres conditions are classified apart from durable faults", () => {
  // The ers-brain 2026-08-20 case: a resolver blip during a laptop darkwake.
  const dns = classifyPostgresError(
    Object.assign(new Error("getaddrinfo ENOTFOUND aws-1-eu-west-2.pooler.supabase.com"), {
      code: "ENOTFOUND",
    })
  );
  assert.equal(dns.class, "resolution");
  assert.equal(dns.durable, false);

  const refused = classifyPostgresError(
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
  );
  assert.equal(refused.durable, false);

  const timeout = classifyPostgresError(
    new Error("timeout exceeded when trying to connect")
  );
  assert.equal(timeout.class, "timeout");
  assert.equal(timeout.durable, false);
});

test("durable Postgres faults keep full severity", () => {
  const auth = classifyPostgresError(
    Object.assign(new Error("password authentication failed for user"), { code: "28P01" })
  );
  assert.equal(auth.class, "authentication");
  assert.equal(auth.durable, true);

  const schema = classifyPostgresError(
    Object.assign(new Error('relation "brain.brain_files" does not exist'), { code: "42P01" })
  );
  assert.equal(schema.class, "schema");
  assert.equal(schema.durable, true);

  const permission = classifyPostgresError(
    Object.assign(new Error("permission denied for schema brain"), { code: "42501" })
  );
  assert.equal(permission.durable, true);
});

test("an unrecognised Postgres error is treated as durable", () => {
  const unknown = classifyPostgresError(new Error("something entirely new"));
  assert.equal(unknown.class, "unknown");
  assert.equal(unknown.durable, true);
});

test("a transient condition degrades to warn until it persists across cycles", () => {
  const transient = classifyPostgresError(
    Object.assign(new Error("getaddrinfo ENOTFOUND host"), { code: "ENOTFOUND" })
  );
  assert.equal(postgresFailureStatus(transient, 1), "warn");
  assert.equal(postgresFailureStatus(transient, 2), "warn");
  // Persisting this long is no longer plausibly momentary.
  assert.equal(
    postgresFailureStatus(transient, TRANSIENT_FAILURE_ESCALATION_CYCLES),
    "fail"
  );

  const durable = classifyPostgresError(
    Object.assign(new Error("password authentication failed"), { code: "28P01" })
  );
  assert.equal(postgresFailureStatus(durable, 1), "fail");
});

test("the consecutive-failure streak counts the current run only", () => {
  const entries = [
    { checks: { postgres_summary: "warn" } },
    { checks: { postgres_summary: "pass" } },
    { checks: { postgres_summary: "warn" } },
    { checks: { postgres_summary: "warn" } },
  ];
  // Two since the last pass — not three across the whole history.
  assert.equal(consecutiveFailureStreak(entries, "postgres_summary"), 2);
  assert.equal(consecutiveFailureStreak([], "postgres_summary"), 0);
  assert.equal(
    consecutiveFailureStreak(
      [{ checks: { postgres_summary: "pass" } }],
      "postgres_summary"
    ),
    0
  );
});

test("cycles that never recorded a check do not reset its streak", () => {
  // A newly added check leaves older entries without the key; treating that as
  // a pass would silently restart every other check's streak.
  const entries = [
    { checks: { postgres_summary: "warn" } },
    { checks: { fly_status: "pass" } },
    { checks: { postgres_summary: "warn" } },
  ];
  assert.equal(consecutiveFailureStreak(entries, "postgres_summary"), 2);
});

test("a failed Postgres check explains class, age and persistence", () => {
  const detail = postgresFailureDetail({
    summary: "The database hostname did not resolve.",
    error: "getaddrinfo ENOTFOUND aws-1-eu-west-2.pooler.supabase.com",
    observedAt: "2026-09-07T16:44:23.585Z",
    attempts: 3,
    transient: true,
    consecutiveFailures: 1,
    resolution: "Usually a transient local network or DNS condition.",
  });
  assert.match(detail, /did not resolve/);
  assert.match(detail, /Observed 2026-09-07T16:44:23.585Z/);
  assert.match(detail, /after 3 attempts/);
  assert.match(detail, /first cycle/);

  const persistent = postgresFailureDetail({
    summary: "The database hostname did not resolve.",
    observedAt: "2026-09-07T16:44:23.585Z",
    transient: true,
    consecutiveFailures: 4,
  });
  assert.match(persistent, /4 consecutive cycles/);
  assert.doesNotMatch(persistent, /first cycle/);
});

const syncTime = Date.parse('2026-09-11T12:00:00Z');
function syncSample(seconds, previous, extra = {}, now = syncTime + seconds * 1000) {
  return evaluateSyncHealth({ command: 'watch', cycle: 1, status: 'error',
    checkedAt: new Date(syncTime + seconds * 1000).toISOString(),
    error: 'Connection terminated due to connection timeout', ...extra }, previous,
    { now, maxAgeMs: 60_000 });
}

test('sync escalates distinct failed attempts, including cycle-one supervisor restarts, but never polls', () => {
  let result = syncSample(0);
  assert.equal(result.status, 'warn');
  for (let i = 0; i < 50; i++) result = syncSample(0, result.observation);
  assert.equal(result.details.failedObservations, 1);
  result = syncSample(5, result.observation);
  assert.equal(result.status, 'warn');
  result = syncSample(10, result.observation);
  assert.equal(result.status, 'fail');
  assert.equal(result.details.failedObservations, 3);
  const action = syncHealthAction(result);
  assert.equal(action.level, 'fail');
  assert.match(action.detail, /3 distinct failed/);
  assert.match(action.detail, /2026-09-11T12:00:10/);
});

test('sync observed success, missed in-process recovery, old history and clock rollback reset recurrence', () => {
  const failed = syncSample(5, syncSample(0).observation);
  const recovered = syncSample(10, failed.observation, {status: 'ok'});
  assert.equal(recovered.status, 'pass');
  for (const result of [syncSample(15, recovered.observation),
    syncSample(15, failed.observation, {cycle: 2}),
    syncSample(100, failed.observation), syncSample(0, failed.observation),
    syncSample(15, undefined)]) {
    assert.equal(result.status, 'warn');
    assert.equal(result.details.failedObservations, 1);
  }
});

test('stale transient observations report unknown current health, not a fresh recurring failure', () => {
  const prior = syncSample(5, syncSample(0).observation);
  const failed = syncSample(10, prior.observation);
  const stale = syncSample(10, failed.observation, {}, syncTime + 100_000);
  assert.equal(stale.status, 'warn');
  assert.equal(stale.details.state, 'stale');
  assert.match(syncHealthAction(stale).detail, /current sync health is unknown/);
  for (const checkedAt of [null, 'invalid', new Date(syncTime + 200_000).toISOString()]) {
    assert.equal(syncSample(0, undefined, {checkedAt}).details.state, 'stale');
  }
});

test('durable sync errors and guards retain actionability, missing health is not healthy', () => {
  for (const error of ['permission denied for table files', 'password authentication failed',
    'relation brain.files does not exist', 'unexpected local filesystem failure']) {
    const result = syncSample(0, undefined, {error});
    assert.equal(result.status, 'fail');
    assert.equal(result.details.transient, false);
  }
  const guard = syncSample(0, undefined, {status: 'ok', report: {guardTripped: 'incomplete_scan'}});
  assert.equal(guard.status, 'warn');
  assert.equal(syncHealthAction({...guard, details: {...guard.details, guardTripped: 'incomplete_scan'}}).reason, 'sync_guard');
  assert.equal(evaluateSyncHealth({}, null, {now: syncTime, maxAgeMs: 60_000}).status, 'warn');
  assert.equal(syncHealthAction(syncSample(0, undefined, {status: 'ok'})), null);
});
