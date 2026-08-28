import assert from "node:assert/strict";
import test from "node:test";

import {
  assertUniversalLintProfile,
  isStableOwnerPrincipal,
} from "./lib/deploy-profile-contract.mjs";

test("stable deployment Owners use provider-appropriate immutable IDs", () => {
  assert.equal(
    isStableOwnerPrincipal(
      { provider: "github", provider_user_id: "259372947", roles: { brain: "owner" } },
      "brain"
    ),
    true
  );
  assert.equal(
    isStableOwnerPrincipal(
      {
        provider: "entra",
        provider_user_id: "3de174b1-a84d-4d81-b403-f0e7d411a340",
        roles: { brain: "owner" },
      },
      "brain"
    ),
    true
  );
  assert.equal(
    isStableOwnerPrincipal(
      { provider: "entra", provider_user_id: "259372947", roles: { brain: "owner" } },
      "brain"
    ),
    false
  );
});

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
