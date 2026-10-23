# Brain write admission and monitor parity — session closeout

**Date:** 23 October 2026; updated 24 October 2026 (Europe/London)

**Status:** macOS engineering complete and deployed for both JEM and ERS; colleague rollout incomplete; Windows package backlogged
**Current application release:** annotated `v1.14.2`; signed portable Monitor build 9
**Original release before the distribution extension:** `v1.13.3`, source `548b1150311c85b78603b3eb8b58bd002f30d811`
**Original source baseline before this documentation checkpoint:** public `main` at `566fee9`; later savepoint-only commits are not new application builds.

## Latest closeout — 24 October 2026

Both runtime source trees still match annotated `v1.14.2`; subsequent commits are
documentation/backlog changes and were not redeployed. Public source baseline at
this closeout is `99e62f0238e51827fb0f95a3156aaf026d1f0864`; private rollout
receipts remain in the ERS operations runbook. This checkpoint is the commit
containing this update, not a new application build.

Fresh Doctors passed on **24 October at 00:48:56/57 Europe/London**
(23 October 23:48:56/57 UTC), both reporting hosted **v1.14.2**, healthy local sync
and zero conflicts. No full Node/browser suite was repeated for prose-only work;
`git diff --check` is the applicable closeout gate. Prior signed upgrade, database,
security and browser acceptance below remain historical engineering evidence.

The **Windows Monitor package is backlog work**, not implemented or deployed.
The [existing backlog](../../BACKLOG.md) explicitly requires a signed Windows
installer, automatic updates, build reporting and preserved developer/IT-managed
exclusions. The [Windows proposal](../specs/024-monitor-distribution-and-automatic-updates.md#windows-extension--proposed-24-october-2026)
identifies the current macOS-only client/API/database constraints and the Windows
signing/build/test prerequisites. Do not implement or deploy wider backlog work
merely because this handoff is being resumed.

Colleague platform and build acceptance remain unverified. Communication receipts,
the rejected sender/review assumptions, corrected email authority and an **unsent**
correction draft live only in the existing private ERS operations runbook. Review
that before any further distribution. Do not assume colleagues use Macs. No
correction email or further outreach was sent after the user's correction.

A bounded read-only thread follow-up remains active through 30 October, quiet
when unchanged. It does not authorise implementation, deployment, policy changes
or messages. The private runbook records its exact schedule and authority.

Signed build 9 recovery archives/feed manifests are retained in each owner's
GitHub release. The private owner release also retains the separately signed
no-updater developer companion build 10. Generated local `monitor-package/` and
staged release-assets directories remain ignored; a fresh checkout must retrieve
its own owner's signed assets. Keychain signing custody and original developer
profiles are deliberately not copied into Git or packages. Do not replace the
original developer supervisor to reproduce a portable canary.

When the Windows item is selected, the next bounded step is to verify device/IT
management and existing Windows signing/build/test access, then review its
implementation plan. Suggested next setup: **GPT-6.1 Sol / high** for the Windows
authentication and updater design. No delegation or settings change is implied.

## Automatic Monitor updates — completed engineering extension

Both cloud services and normal signed update feeds run v1.14.2. JEM deployed
source `d7d2adc9d987a82a78801b81d97eee984c894721` at 15:59:51 UTC; ERS deployed
its private overlay `d0527578d30e411c2c149552cbd847c17cd2e393` at 15:59:10 UTC.
Protected ERS runtime/tooling/migration sources match the public tag exactly.
Approved inventory migrations and both security re-gates passed; signing keys
remain separate in Keychain under the existing personal Developer ID custody.

Both guards passed 658 tests with 13 optional skips, real disposable PostgreSQL
checks passed and 10 Chromium checks passed. Both signed upgrade canaries passed;
ERS also installed its automatically downloaded normal-channel update on quit.
Both final build 9 apps retained sign-in, reported into inventory and displayed
**current** after a no-update check. Both complete Doctor profiles passed at
16:01 UTC. A Homebrew Node 22 linkage fault was repaired at the stable configured
path. A later ERS child-process file-access fault recovered through restart of
the unchanged developer Monitor and its documented bounded retry. No privacy
grant, access role, Brain content or developer profile changed in that recovery.

The observed portable test installations have explicit per-device automatic
exceptions; the original developer app/toolchain and default exclusions remain
intact. Other installations stay unverified. Legacy apps need one bootstrap;
Apple silicon is accepted, Intel-native packaging and colleague OS/installation
receipts are not. No Intune target was deployed. Later owner-scoped distribution
receipts are in the private runbook; they do not prove recipient installation.
The portable app supplies hosted diagnostics, not a copied local SQL Doctor/sync stack.

Next action: review the private rollout correction and Windows backlog before
selecting an appropriate package for any colleague. Keep named ERS policy,
communication and acceptance receipts in the existing private operations runbook;
do not create a Brain intake queue or another handoff tracker. Original
schema/key approvals covered the deployed Mac work; any Windows production
migration needs its own concrete review and security gate. The original
completed effort is recorded below.

Signed recovery assets and feed manifests are now published in each owner's
GitHub release, with uploaded sizes/digests checked against its own manifest.
Both final portable-trial inventory rows reported v1.14.2 build 9 and **current**
at the 23 October trial; this is not colleague fleet acceptance. Public and private
closeout commits are pushed; application sources still match the deployed tag.

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
