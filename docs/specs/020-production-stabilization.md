# 020 — Structural production stabilization

**Status:** in-progress
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
- Protocol propagation and deployment/client acceptance remain in progress. Build/test evidence does not reopen company rollout.

### Reviewed operation inventory

Whole-file replace and conflict resolution require the caller's reviewed revision. Append and exact-text patch keep their operation-specific checks and transaction CAS. Explicit delete/rename/restore keep their existing guarded revision-history contract and protected-file/role rules; this release does not claim they express a whole-document content review. Internal lint, task-intake and link updates now pass the snapshot used to compute their replacement. A stale internal result fails rather than replaying unreviewed content.
