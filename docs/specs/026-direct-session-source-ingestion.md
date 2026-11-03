# 026 — Direct session source ingestion

**Status:** implemented and isolated acceptance passed; production activation pending security approval
**Candidate release:** v1.16.0 (not deployed)
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
