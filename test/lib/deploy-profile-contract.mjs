import assert from "node:assert/strict";

const GRAPH_ROOTS = ["00_loader.md", "NOW.md"];
const EXEMPT_GLOBS = ["archive/JOURNAL-*.md", "archive/LOG-*.md"];
const ENTRA_OBJECT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStableOwnerPrincipal(principal, brainId) {
  const providerUserId = principal?.provider_user_id || "";
  const stableProviderId =
    (principal?.provider === "github" && /^\d+$/.test(providerUserId)) ||
    (principal?.provider === "entra" && ENTRA_OBJECT_ID_RE.test(providerUserId));
  return stableProviderId && principal?.roles?.[brainId] === "owner";
}

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
