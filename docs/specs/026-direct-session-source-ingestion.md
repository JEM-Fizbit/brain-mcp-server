# 026 — Direct session source ingestion

**Status:** JEM v1.16.2 deployed and verified, selected essay completed; ERS v1.16.2 prepared, activation blocked on existing admin sign-in
**Release:** v1.16.2; JEM active, ERS still v1.15.0
**Owner decision:** John, 3 November 2026: the working Claude/ChatGPT session is a primary Brain writer. Capture tracks to-dos, routes information and supports surfaces; it is not a mandatory intermediary for Brain work.

## Outcome

An authorised session can retain a selected original, inspect an exact candidate,
register provenance, curate knowledge and verify hosted read-back in one session.
No Mac, Capture assignment, worker or new queue is required. Capture remains an
optional deferred/blocked handoff. Ordinary evidence-backed corrections retain
their existing automatic write path and readable retrospective review.

The August spec 017 operator-only source-upload default is superseded **only for
explicitly enabled hosted session ingestion**. Fly does not gain a filesystem
inbox or become the authority for local/SharePoint folders. Spec 022's durable
jobs, immutable originals, leases, CAS, atomic persistence and replay receipts are
reused. Session review under existing user/task authority is sufficient for these
selected-source jobs; an extra human approval round is not imposed. Ambiguous
retention, conflicting facts and reserved consequential changes still need John.

## Implemented contract

- `brain_source_prepare`: member-or-higher; caller/tenant/Brain-bound durable
  reservation. Stable source/artifact UUIDs, selected category, original hash and
  size. UTF-8 originals up to 256 KiB can be submitted directly; binary originals
  use an exact-object upload-only Supabase grant. No arbitrary URL fetching,
  local path access, original download grant or binary/base64 tool payload.
- `brain_source_review`: verify original bytes (maximum 20 MiB), accept the
  session's inspected Markdown conversion (explicitly attributed; no claim of
  server Office extraction), and return exact previous/proposed text and digest.
  A `SOURCES.md` pointer is included mechanically unless explicitly supplied.
  Optional semantic targets require the revision from their reviewed read.
  Existing companions require `companion_expected_revision` from source status.
- `brain_source_apply`: recheck current role, write evidence, policy, original
  bytes and target CAS; bind the exact inspected digest. Session review replaces
  an additional human review step only within existing authority. Source metadata,
  companion, source index, curated changes and bounded readable LOG receipt commit
  together. A stale candidate needs a fresh review; completed retry returns the
  same receipt and does not reapply.
- `brain_source_status`: read only this principal's job, original-verification
  state, review digest, receipt and current companion baseline. A stored original,
  candidate and completed ingestion are distinct observations.
- Whole original text belongs only in the selected source companion, never a hub
  or operational receipt. Other targets use normal write-admission checks,
  structural-role protection and the retired-queue database fence.
- Every tool re-resolves access for the selected Brain. Jobs are bound to a hash
  of provider, tenant and user; clients cannot supply owner identities. Source
  IDs already owned by another Brain/principal are refused. Local operator jobs
  preserve their existing custody and explicit operator-review path.
- `brain_prepare_ingest` resolves the same deployment policy as `brain_describe`;
  it advertises direct ingestion separately from unsupported filesystem tools.
  Its unconditional human-approval instruction is removed.

One selected original per job is supported. A binary original plus its reviewed
Markdown companion is supported; arbitrary multi-original bundles, native client
attachment importing and large-text chunking are not implemented. A client must
be able to submit UTF-8 text or perform the granted HTTPS PUT. If it cannot, use
Capture as the optional handoff and report the actual limitation.

## Activation and security decision

Default is disabled. For each independently approved deployment set
`BRAIN_HOSTED_INGESTION_BRAINS` to that deployment's single Brain ID. Activation
also requires the existing Postgres runtime, existing private artifact bucket,
`BRAIN_EXPECTED_SUPABASE_PROJECT_REF`, matching `BRAIN_SUPABASE_URL` and existing
server-only `BRAIN_SUPABASE_SERVICE_ROLE_KEY`. The database/project/key binding is
checked before network access. No key is returned to a client. Keep legacy `BRAIN_ARTIFACT_BYTE_ACCESS=metadata_only`; this separate lane must not turn on general original downloads. If the private Storage credential is absent on Fly, activating the lane requires installing the existing matching owner credential there under the same security approval; no new key is generated. No schema or
public-role grant change is needed; spec 022's private job table is reused.

**Material exposure:** activating this lane permits existing members/curators
and higher roles to submit selected sources through the service. The server
uses its private Storage administration credential behind that boundary.
Supabase upload grants are bearer URLs valid for two hours, limited to the exact
original object and issued with replacement disabled. They are not individually
revoked when a role is revoked; subsequent review/apply still rechecks access.
The 20 MiB size/hash check is enforced on verification, not by a per-upload grant;
the private bucket's configured upload limit also applies. Wrong bytes never
become an accepted source. Do not expose grants in logs, notifications or chat.

John's project gate requires separate production/security activation approval.
Complete local tests and the concrete release first; then obtain that decision.
Do not create/rotate credentials, widen bucket access, change limits or enable a
Brain merely because configuration is missing. Keep JEM and ERS credentials,
registries, content and rollout receipts separate.

## Acceptance and rollout

Isolated real PostgreSQL under `brain_runtime` proves direct long-text and binary
conversion ingestion for synthetic JEM and ERS configurations, actual MCP
prepare/review/apply/status, source/index/knowledge read-back, readable receipt,
completed replay, wrong-owner and wrong-Brain refusal, stale targets, hash
mismatch, structural roles and retired intake. Existing ingestion recovery,
transaction rollback and lease tests remain required. Storage grants are tested
through the installed Supabase adapter; synthetic tests are not production
provider/client acceptance.

After approval: security-check each existing private bucket/job table; deploy
JEM first, enable only its lane and prove a synthetic source over authenticated
hosted MCP with exact read-back. Refresh native connector metadata and verify a
fresh client. Repeat the unchanged source release through ERS's private overlay
and its own activation/security checks. Both live loaders/operations guides already state the primary direct-session route conditionally on discovered capability, retaining local inbox distinctions and optional Capture; verify those instructions against the enabled endpoint. Only then process the existing selected essay using its
verified originals; reconcile its existing Capture record rather than create a
new item or claim ingestion from an upload receipt. No real source was ingested
by implementation tests.

## Verification receipt — 3 November 2026

The required full Node gate passed: 672 passed, 14 fixture-dependent skips, zero
failures. The initial sandboxed attempt could not open loopback listeners; the
normal host rerun passed. A separate disposable UTF-8 PostgreSQL cluster applied
all migrations to synthetic data, and 18 source-ingestion checks passed with no
skips under runtime privileges. These include actual MCP tool discovery and
source prepare/review/apply/status for both configurations, original mismatch,
companion ownership, stale replacement, structural roles, retired intake and
source/index/knowledge read-back. No production source ingestion, schema, roles, secrets or service configuration changed. The separately authorised live guidance changes below did land. Production bucket/grant and fresh-client
acceptance remain pending activation approval.

Official Storage contract checked for this implementation:
[Supabase createSignedUploadUrl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).

## Live guidance correction

Both live loaders and operations guides were narrowly updated through their
normal hosted revision tools under John's explicit instruction. Each write
reported exact read-back verification and a readable LOG entry, without Capture
or a per-fact approval. The guidance is conditional on discovered capability and
does not claim source-tool activation. Final operations-guide revisions:

- JEM: `e3e63310-b458-4bf8-94d8-16f2d4606d66`; loader
  `1ea86055-8eb7-49f6-956b-1af630e05a8e`.
- ERS: `674102dd-486f-4261-8f2a-c29171e579f0`; loader
  `75f3fbf4-1953-427d-acd3-3ede6dce0a31`.

Read-only lint completed on both after the primary edits. It reported existing
freshness/maintenance findings (JEM six, ERS one), with no graph-unreachable ERS
files and its bootstrap within budget; this is not a claim of a clean corpus.
Final follow-up edits only qualified legacy ingestion wording in on-demand
guides. No unrelated freshness repair or original ingestion was performed.

The candidate's source-ingestion receipt uses the existing standard LOG format
and exact-change link, so the Monitor's All entries view opens its before/after
record. This was checked through the existing change-log renderer against an
actual fixture ingestion receipt. v1.16.1 supersedes the default-disabled
v1.16.0 code tag before any production activation.

## Approved activation and production acceptance — 3 November 2026

John separately approved both deployments and installation of each existing
owner Storage credential on Fly. JEM v1.16.1 deployed at 13:11:12 UTC, source
`7d4d766332194c032f21f16dc60bfb6bd05daf17`. Its existing matching service key was
staged privately, with the exact Brain/project binding. General original
downloads remain `metadata_only`. No migration, bucket policy or role changed.

A fresh owner OAuth client discovered all four tools, completed both inline text
and signed PUT binary ingestion, then verified source read-back, original hashes,
caller-bound status and identical completed-retry receipts. Text job
`369f947f-0f52-471d-ad6a-184e128c64ad`; binary job
`0af18268-3655-43d0-a773-e492edb429d3`. Both are explicitly labelled synthetic
fixtures, with no personal or company fact promotion. The authenticated browser
opened the real source diff and retained cockpit navigation.

That browser check exposed a receipt-detail gap: the trusted companion import
retained before/after bytes but omitted session authority metadata, so the
review page incorrectly classified it as historical. v1.16.2 retains the actual
user/task evidence on new companion revisions and verifies committed revision
bytes separately from caller read-back. This does not subject original text to
knowledge heuristics or add a human approval. Completed retries verify retained
revision IDs rather than a newer file head. Existing v1.16.1 fixture receipts
remain historical evidence; no audit evidence is retroactively invented.

JEM Security Advisor: no issues; 20/20 Brain tables have RLS, zero client/public
Brain grants, zero non-runtime Brain policies, zero Storage policies and a private
artifact bucket. ERS preflight: private bucket, zero Storage policies and zero
Security Advisor findings. The existing ERS browser admin session is expired;
its connected SQL tools work, while the local CLI lacks ERS key access. ERS
activation needs that existing account session, not a new key or account.

## JEM completed receipt and remaining ERS handoff

JEM v1.16.2 deployed at **13:19:58.264 UTC**, annotated source
`dfdf1d6ae46d205ad2b62e88caf791eb03864e1a`, image
`registry.fly.io/jem-brain-mcp:deployment-01M6GRZY392EYP39QM0FW574SA`. The
mandatory guard passed all 672 runnable tests (14 existing fixture skips); a
separate disposable database passed all 18 ingestion checks with zero skips and
was stopped/removed. The public source release and prepared private ERS intake
are committed and pushed. No Monitor binary/update feed was changed.

New JEM audit canary job `5a6b5914-681d-42ff-b092-918a752b7973` completed with
exact read-back and identical replay. Its actual authenticated
[Monitor diff](https://jem-brain-mcp.fly.dev/monitor/changes/368da7c6-308d-4c8b-9edf-35b14999aa4a?brain_id=ai-brain-jem)
shows `Result: verified`, the task authority and its source evidence, plus cockpit
navigation. Existing companion receipts were not retroactively rewritten.

The existing personal ChatGPT JEM app was refreshed through **Settings → Plugins
→ JEM Brain → Refresh tools**, without reconnecting or changing permissions. A
[fresh ChatGPT session](https://chatgpt.com/c/6ae9dfc2-1de8-83eb-a6c3-bf9c2fd56471)
then discovered all four tools and actually called `brain_describe` and
`brain_source_status` against that completed job. This is fresh discovery/read
acceptance, not a ChatGPT-issued mutation. The production mutations were through
a fresh authenticated owner OAuth MCP client. Claude desktop verification was
blocked by the locked Mac; no lock was bypassed. Existing chats may retain older
tool declarations.

The selected **Turning the Crank Faster** essay was then ingested directly in
JEM, job `37d3f478-a0fa-43ac-8ad8-c434fcd2f2d2`, source
`fba76fb2-60ce-4a19-8d0b-867ed08219aa`. The Word original's 196,713 bytes and
SHA-256 `d74bfa2d1bd9b21de989c95ff4b8e81fc71628c57c0620e2d5e9c3a02748c676`
were verified in private Storage. The inspected Markdown exactly matched the
29,522-byte frozen original retained in the project and existing Capture record.
Exact hosted read-back passed for the source companion, `SOURCES.md`, the
`07_interests_learning.md` AI-topic backlink and the `ref_publications_media.md`
source backlink. No master publication inventory or live project tracker was
changed. [Essay change record](https://jem-brain-mcp.fly.dev/monitor/changes/ff3ffd05-c285-47be-9aa7-136bc54706a2?brain_id=ai-brain-jem).
The same Capture item `15bae6cb-ddb5-409d-b9f1-8122798658d1` is now
`brain_processed`, version 8, with this result and no next review. Capture
correctly labels this agent-reported (`remote_verified: false`); it does not
independently verify Brain. No second Capture or duplicate ingestion was created.
Its contract required assignment bookkeeping before accepting the result;
inspection confirmed no work dispatch, then completion cleared the review date.

JEM sync reports zero open conflicts. Read-only lint retains six existing
maintenance findings, including the 2,534-token bootstrap over its 2,500 budget;
these were not silently repaired or claimed clean.

**Remaining input:** unlock the Mac and restore the existing ERS Supabase admin
session in the opened project tab. The connected ERS SQL administration still
works and confirms 21/21 Brain tables with RLS, zero client/public Brain grants,
zero non-runtime Brain policies, zero Storage policies and a private bucket. Its
Security Advisor is clean. The local personal Supabase CLI cannot retrieve ERS's
existing Storage key, and neither owner Monitor runtime profile contains it.
No new key, account, grant or migration is needed or authorised. After access is
restored, stage only ERS's exact project/Brain config and existing matching key,
run `deploy:guarded` with `BRAIN_DEPLOY_UPSTREAM_TAG=v1.16.2`, repeat the finite
hosted acceptance, refresh its existing client metadata, then fast-forward
`ers-main` only after verification. ERS has not been deployed or activated by
this turn. Existing production and Monitor exclusions remain intact.
