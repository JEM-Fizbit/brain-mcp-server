# Brain write admission and monitor parity — session closeout

**Date:** 23 October 2026 (Europe/London)  
**Status:** complete and deployed for both JEM and ERS; no blocker in the approved scope  
**Application release:** annotated `v1.13.3`, source `548b1150311c85b78603b3eb8b58bd002f30d811`  
**Source baseline before this documentation checkpoint:** public `main` at `566fee9`; the checkpoint is the commit containing this file, not a new application build.

Read this after `AGENTS.md` when resuming. This is a completed-effort handoff,
not a new task list or authority to start the wider backlog. Current product work
remains in [BACKLOG.md](../../BACKLOG.md). Durable release evidence is in the
[deployment runbook](../deploy-fly.md) and the private ERS operations runbook.

## Completed work

- JEM warning investigation and narrow repair: preserved the retired queue
  item's original in Personal Capture with verified receipt; retained substantive
  content-review reminders without claiming that their facts were revalidated.
- [Spec 023](../specs/023-brain-write-admission-and-routing.md): both independently
  approved private-schema migrations and policy activations completed; automatic
  source-backed corrections, reviewed-revision checks, retry deduplication,
  routing/evidence refusals and readable audit records are live.
- Both loaders and operations guides state the stable-knowledge/Capture
  boundary. Transient status, drafts and handoffs stay with Capture or their
  existing project owner. Reading Brain is not write authority. Ordinary
  evidenced corrections do not need per-fact approval or a prior log review.
- Authenticated history defaults to automatic updates and supports All entries,
  search and pagination. Revision readers show Git-style diffs, exact snapshots,
  source evidence and verification scope. Back to cockpit preserves the actual
  local return root through navigation; direct links have owner-specific defaults.
- Both cloud services run v1.13.3. Both configured local operator profiles run
  the updated cockpit/sync code and healthy menu-bar supervision. ERS protected
  runtime/source/package/migration files match the annotated upstream release.

## Final evidence and its limits

JEM deployed at **22 October 23:28:13.388 UTC**; ERS independently at
**23:29:11.208 UTC**. Exact per-owner build provenance is retained in each
deployment runbook. Newer source commits contain documentation only and do not
require redeployment.

At closeout on **23 October 12:47 UTC / 13:47 Europe/London**, both fresh Doctors
passed: hosted v1.13.3, healthy local sync, zero conflicts and no admission holds.
Both running loopback cockpits expose the history link and actual return-origin
handling. The earlier live owner/browser journeys verified status → history →
diff → Back to cockpit independently for JEM (8787) and ERS (8788).

The 23 October read-only schema audit found both policy rows, both enabled queue
triggers, valid/ready/unique operation indexes, runtime SELECT-only policy access
and zero public/anonymous/authenticated Brain-table grants. All private tables
have RLS (19 JEM, 20 ERS; ERS additionally has company access-audit events).
Both hosted connectors advertise 27 operations with their intended policies.

Final release gates passed **656 tests: 644 passed, 12 optional skips, zero
failures**. **13 Chromium checks** passed. Spec 023's separate disposable
Postgres acceptance passed 46/46 in the implementation phase. Those are retained
release results; a full suite was not rerun for this documentation-only closeout.
Live owner journeys do not certify every colleague/client combination or perfect
semantic classification of transient versus durable material. Historical receipts
without linked revisions remain readable receipts rather than invented diffs.

## Parity and distribution

Feature and operational parity is complete for this scope. Intentional owner
differences remain: personal GitHub versus ERS Entra identity, isolated data and
credentials, JEM's retired general queue versus ERS's evidenced Brain-maintenance
scope, and each owner's Capture route. Both retain five-second sync, 60-second
Doctor/heartbeat cadence and bounded recovery.

| Surface | How this release reaches users | Distribution action |
|---|---|---|
| Hosted MCP and schema/policy enforcement | Existing authorised connections call the independently deployed service | No client package required. Enforcement is server-side. |
| Hosted status/history/diffs | Current HTML/assets are served by the hosted endpoint | Refresh an already-open page; use existing Brain sign-in. |
| Client tool definitions | A client may cache its discovered schemas | Normal tool refresh or a fresh session may be needed for the new reader/evidence fields. Existing shared app definitions were refreshed; every colleague's open chat was not audited. |
| Optional native Monitor/local cockpit/local stdio | Installed code and profile on each operator machine | John's two profiles are current. Other installations are not verified and do not receive updates just because Git was pushed. |

No package rollout is required for ordinary hosted users. The native app's
script-change detection restarts changed files in its own configured local
checkout; it is not a fleet updater. Signing/notarization, installers, updates
and portable setup remain the existing optional packaging backlog. Identity-based
local sync for colleague machines remains separately scoped. Do not distribute
John's owner-specific profiles or database credentials as a user package.

## Resume and custody

- No implementation, approval or deployment task remains open for this effort.
  Ask John to choose the next backlog item before starting further work.
- Preserve automatic corrections, optional retrospective review, owner isolation,
  current grants, guarded releases, reviewed revisions and retained recovery bytes.
  Do not repeat migrations, change secrets or create a new queue to resume.
- Inspect live Git/remotes and owner-bound health before using dated evidence:
  `BRAIN_ID=ai-brain-jem npm run hosted:doctor` and
  `BRAIN_ID=ers-brain npm run hosted:doctor`.
- Production credentials, Keychain records, installed Monitor profiles,
  `.env.local`, local recovery data, build output and ignored deployment
  provenance remain local/private. A fresh Git checkout does not restore them.
  Public and private runbooks retain non-secret deployment receipts; ignored
  fixture screenshots/logs are not claimed as remotely backed up.
- Documentation checkpoint commits follow the application tag; do not retag or
  redeploy unchanged runtime merely to align a documentation HEAD.

**Next-session recommendation:** `gpt-6.1-sol` / medium for routine reconciliation;
reassess when John selects substantive new work. No agent delegation or new
workstream is authorised by this handoff.
