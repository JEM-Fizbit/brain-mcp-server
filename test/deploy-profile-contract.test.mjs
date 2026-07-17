import assert from "node:assert/strict";
import test from "node:test";

import { assertUniversalLintProfile } from "./lib/deploy-profile-contract.mjs";

const lint = {
  graph_roots: ["00_loader.md", "NOW.md"],
  relative_parent_scope: "disabled",
  exempt_globs: ["archive/JOURNAL-*.md", "archive/LOG-*.md"],
};

test("deployment lint contract accepts a single-Brain profile", () => {
  assert.doesNotThrow(() =>
    assertUniversalLintProfile({
      brains: [{ id: "ers-brain", lint }],
    })
  );
});

test("deployment lint contract rejects missing graph roots without naming a tenant", () => {
  assert.throws(
    () =>
      assertUniversalLintProfile({
        brains: [{ id: "example-brain", lint: { ...lint, graph_roots: [] } }],
      }),
    /example-brain.*graph_roots/i
  );
});
