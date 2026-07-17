import assert from "node:assert/strict";

const GRAPH_ROOTS = ["00_loader.md", "NOW.md"];
const EXEMPT_GLOBS = ["archive/JOURNAL-*.md", "archive/LOG-*.md"];

export function assertUniversalLintProfile(registry) {
  assert.ok(registry?.brains?.length, "deployment registry must define at least one Brain");
  for (const brain of registry.brains) {
    assert.deepEqual(
      brain.lint?.graph_roots,
      GRAPH_ROOTS,
      `${brain.id} lint.graph_roots must preserve the hosted graph roots`
    );
    assert.deepEqual(
      brain.lint?.exempt_globs,
      EXEMPT_GLOBS,
      `${brain.id} lint.exempt_globs must preserve rotated-history exemptions`
    );
    assert.equal(
      brain.lint?.reachability_mode,
      undefined,
      `${brain.id} lint.reachability_mode must remain environment-promotable`
    );
  }
}
