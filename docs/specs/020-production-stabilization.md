# 020 — Structural production stabilization

**Status:** deployed v1.9.0; client acceptance remains open
**Date:** 2026-09-10
**Source:** production design review F1–F9; accepted backend capability requirement.
**Authority:** John authorized implementation after reviewing the audit. Existing access and permissions stay unchanged. Company-wide rollout remains held until structural fixes pass verification; behavioral coordination is not an acceptance substitute.

## Contract and implementation sequence

1. Use the existing two-Owner invariant for steady-state service startup and grant mutations. Initial provisioning may require a larger roster, but must not prevent an already provisioned service restarting with its permitted roster. Do not alter any current grants.
2. Preserve displaced local files before installing hosted replacements or applying tombstones. Use durable recovery intent and an exclusive install/restore so a newly created pathname is not overwritten. Retain displaced bytes even when a late write lands on an already-open file descriptor. Recover interrupted operations conservatively; expose conflicts/recovery locations rather than silently discarding bytes. No additional hash check is treated as atomic synchronization.
3. Expose exact revision/hash evidence on reads. Require reviewed revision preconditions for hosted replacement and conflict resolution, enforced by the revision transaction. Preserve exact-text patch and append semantics, with their own execution CAS. Reconcile a resolved conflict only when the local bytes still match the reviewed conflict hash and the resolution is the current hosted head.
4. Treat failed inventory scans as incomplete, suppress/reset deletion inference, and pair pulled bytes with their actual revision metadata.
5. Extend brain_describe with a versioned capability contract built by one resolver. Keep support/execution/custody, caller authorization, effects and observation state distinct. Reuse it for inbox/nudges, semantic operations, ingest preflight and execution refusal. Discovery is read-only; host approval behavior remains client controlled. Keep the manual inbox and owner isolation; no watcher/vector backend/shared credentials.
6. Bound public OAuth admission and clean expired transient state without revoking active clients/tokens. Retain existing DCR client compatibility.
7. Correct active-file metrics and propagate operational contracts to guidance; preserve approved maintenance and host/local boundaries.

## Acceptance

- Deterministic late-write and interrupted-operation fixtures retain recoverable local bytes on replacement/deletion; normal sync converges automatically without user edit coordination.
- Two readers of one version: the second stale replace/resolution fails without changing head or closing conflict; refreshed review succeeds.
- Keep-local, keep-hosted and merged resolutions converge; a later local save remains protected.
- Three-to-two Owner transition remains permitted and startup succeeds; two-to-one/concurrent reductions remain denied.
- Incomplete scans create no hosted deletion; exact revisions and hashes stay paired during concurrent head changes.
- One capability declaration covers all three reported cases on both backends, with clear unsupported/unobserved results and no recurring permanent warning.
- Registration limits and expiry cleanup are tested without modifying existing production identity state.
- Node22 full tests, relevant UI fixtures, owner-isolated release checks and post-release verification pass. Actual client/role and recovery proof gaps are recorded honestly; rollout is not reopened automatically.

## Boundaries

No permission/roster changes, new service, protocol migration, new paid dependency, new inbox authority or routine Git sync. Public code stays reusable; private ERS operational evidence stays private. Use guarded releases only. The deferred timed restore remains non-blocking resilience work, not an invented rollout gate.

## Progress

- Implementation started in an isolated worktree so the active operator stack is unaffected by builds.
- Audit fixtures and current source are the regression baseline; findings are closed only with implementation and acceptance evidence.

### Verified implementation evidence

- Node 22 full suite: 539 tests, 531 passed, eight explicitly skipped without their fixture environment; no failures.
- Disposable loopback PostgreSQL 17 with all migrations: six real database tests passed, including simultaneous Owner reductions, stale replacement/resolution, bounded registration and expiry retention. No production identities were changed.
- Chromium: all eight local browser fixtures passed (cockpit, access administration and Brain Library).
- Recovery fixtures cover a late save before displacement, a new pathname after displacement, an open descriptor saved after completion, interruption recovery, unsupported link primitives and capacity refusal before displacement.
- JEM and ERS guarded releases deployed v1.9.0 on 10 September 2026. Both postdeployment doctor profiles pass; local sync is healthy with zero conflicts. Seven hosted guidance patches were applied and exact readback/local hashes matched. Both loader budgets and internal-link checks pass; JEM retains five unrelated maintenance findings, ERS none.
- Existing OpenAI client metadata still omits `expected_revision` and `brain_prepare_ingest`. A replacement probe failed closed with the required-token error; it did not validate stale-token rejection through that client. The inspected installed-plugin controls offered no metadata Refresh action. Keep client-schema refresh and fresh client/role acceptance open; do not weaken the server precondition or infer acceptance from runtime tests. Company rollout remains held, with current grants unchanged.

### Additional acceptance evidence — 11 September 2026

Both live HTTP endpoints publish the preflight and reviewed-revision schema. Direct authenticated MCP calls using existing grants pass discovery, read-only preflight, revision/hash reads, explicit operator-custody refusals and stale-token rejection with unchanged heads. The installed OpenAI metadata snapshot remains stale; direct endpoint acceptance does not close that client gap.

`test/http-role-postgres.test.mjs` adds a real HTTP/MCP fixture backed by disposable PostgreSQL: Reader/member/Admin/Owner reads and mutation boundaries, protected-file writes, reviewed replacement, same-bearer downgrade/suspension/revocation, wrong-tenant denial and cross-Brain denial. No production grants are modified. Run the database fixture files with `node --test --test-concurrency=1`: the older revision-store fixture reapplies schema DDL, so parallel files can deadlock on schema locks. Concurrency inside the Owner/admission/CAS fixtures remains enabled.

The private owner release record contains image-label attestation, bounded database/security and artifact inventory checks, and the remaining client/provider/governance limitations. These are assurance improvements, not a new hosted release or permission change.

### Reviewed operation inventory

Whole-file replace and conflict resolution require the caller's reviewed revision. Append and exact-text patch keep their operation-specific checks and transaction CAS. Explicit delete/rename/restore keep their existing guarded revision-history contract and protected-file/role rules; this release does not claim they express a whole-document content review. Internal lint, task-intake and link updates now pass the snapshot used to compute their replacement. A stale internal result fails rather than replaying unreviewed content.
