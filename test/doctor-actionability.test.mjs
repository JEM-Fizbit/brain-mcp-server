import test from "node:test";
import assert from "node:assert/strict";

import {
  enforceOperatorAlarmContract,
  classifyFlyStatusError,
  classifyFlyStatusOutput,
  classifyLintFindings,
  OPERATOR_ALARM_CHECKS,
} from "../scripts/lib/doctor-actionability.mjs";

test("lint alarms distinguish actionable fixes from review-only findings", () => {
  assert.deepEqual(
    classifyLintFindings({ issueCount: 0, automaticFixCount: 0 }),
    { status: "pass", state: "clear" }
  );
  assert.deepEqual(
    classifyLintFindings({ issueCount: 685, automaticFixCount: 0 }),
    { status: "info", state: "review_only" }
  );
  assert.deepEqual(
    classifyLintFindings({ issueCount: 685, automaticFixCount: 34 }),
    { status: "warn", state: "actionable_fixes" }
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
