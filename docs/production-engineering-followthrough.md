# Production engineering follow-through

**Status:** approved implementation in progress; company rollout remains held
**Updated:** 2026-09-11
**Scope:** remaining Brain-owned engineering after spec 020; existing permissions and connections stay in place

The nine structural audit findings were addressed by spec 020. This pass fixes the remaining sync-health reporting defect, extends recovery and concurrency evidence, and prepares two follow-on designs. Installed-client acceptance remains a separate open rollout gate; this work does not weaken reviewed-write preconditions.

## Sync health: implemented

The doctor now classifies failed sync observations using the existing transient/durable classes. One or two fresh transient failed attempts produce a warning; three distinct failed observations produce failure. Repeated dashboard polls of the same attempt cannot escalate it. Unknown, authentication, permission and schema faults retain immediate failure; sync protection guards retain their existing warning/action.

The health writer exits on error and the supervisor restarts it. Consequently `cycle=1` can refer to many separate failed runs. The doctor uses the source timestamp, persists a compact count alongside that observation, and resets on observed recovery or an observation gap. A later failed watch cycle greater than one also proves an intervening successful cycle and resets the count, even if the doctor missed that success. Stale samples explicitly mean current health is unknown. The count is observed recurrence, not an inferred complete history of every sync attempt.

Implementation: `scripts/hosted-doctor.mjs`, `scripts/lib/doctor-actionability.mjs`. Operator contract: [Cockpit documentation](hosted-cockpit.md#doctor-findings-carry-provenance-and-tolerate-transients-spec-019). Monitor invokes the configured script afresh; existing profiles pointing at this checkout receive the fix on their next diagnostic refresh. No hosted runtime release is required for this local diagnostic change.

## Resilience and workload verification

The reproducible fixture is `scripts/verify-isolated-resilience.mjs`. It requires an explicitly selected disposable loopback PostgreSQL cluster and the fixture administrator identity. It creates two uniquely named databases, applies current migrations, uses synthetic Brain/source data, and removes its databases and files on exit. It never loads an operator profile or repository `.env`.

The fixture exercises real HTTP MCP reads and reviewed writes against Postgres with local file edits/sync occurring in the same workload. It uses 102 seed Markdown files, approximately 4 KB per ordinary note, and four stages at concurrency 1, 4, 8 and 16. Each stage performs 70 HTTP reads, 20 HTTP creations with `expected_revision=new`, and 10 local edit/sync operations. Sync operations share a serialized local agent, matching the supported one-watcher-per-mirror model. Latencies include any wait within the stage. The revision pool remains at four connections; grants and telemetry use their separate runtime pools.

A separate 16-way replacement race starts from one reviewed head. Exactly one replacement may succeed; the others must receive stale or revision-conflict refusals. Conflicts recorded by a real transaction race are legitimate evidence and must survive recovery. This test does not silently retry a losing edit or discard its conflict.

The restore portion takes a logical Postgres dump, restores it into the second empty database, compares exact head revision IDs and Markdown bytes, verifies source companion text and original-artifact hash metadata, checks RLS flags, hydrates a fresh local mirror, and reseeds a separate empty Brain from that mirror. Original binary bytes are exported and restored separately using a synthetic local artifact fixture. Missing and corrupted originals must be detected before the valid original passes its hash check.

**Limits:** this proves the tested application recovery path and the separation of database metadata from original bytes. It does not restore a Supabase physical backup, exercise provider Storage recovery, prove provider permission/secret reconstruction, or establish production recovery time. Likewise local concurrency does not measure Fly CPU/memory, Supabase transaction-pooler saturation, internet latency or installed-client overhead. Small live read batches can corroborate responsiveness; they cannot establish write capacity or a saturation limit.

The provider restore rehearsal remains non-blocking under the existing decision. Git recovery stays available until the owner-specific physical-backup and Storage-byte rehearsal passes. Previously unavailable provider inventory reads remain unverified; no permission expansion is implied. See [recovery runbook](hosted-brain-recovery-and-git-export.md).

### Recorded results — 11 September 2026

- Full Node 22 suite: 544 tests, 535 passed, 9 explicit fixture skips, zero failures. The eight real-Postgres integration tests also passed separately with zero skips, including the actual HTTP role/revocation fixture; one deployment-seed check remains an intentional skip because the public profile has no pilot seed.
- Cockpit/Library/access browser suite: 10 passed. The new sync warning/escalation/recovery case also passed a focused rerun with desktop/mobile overflow checks and screenshots.
- Isolated mixed workload: 400 operations completed with zero unexpected failures. Sixteen same-head replacement contenders produced one winner and 15 refusals; all 15 recorded conflicts survived restore unchanged.
- Logical restore: all 222 heads preserved exact revision IDs and Markdown bytes. Source companion, separate original-byte recovery, missing/corrupt-byte detection, fresh mirror hydration and empty-Brain reseed passed. No production backup or source bytes were used.
- Both live owner-bound doctor checks passed with zero conflicts. Live read-only checks are recorded privately; they do not alter the limits above.

| Local stage concurrency | Read p95 (ms) | Reviewed creation p95 (ms) | Local edit/sync p95 including queue (ms) |
| --- | ---: | ---: | ---: |
| 1 | 4.82 | 5.31 | 265.13 |
| 4 | 5.34 | 16.43 | 921.42 |
| 8 | 7.45 | 10.67 | 1510.73 |
| 16 | 15.17 | 20.04 | 2109.62 |

Synthetic results and command requirements: [fixture evidence](production-engineering-evidence.json), [tooling](TOOLING.md#isolated-recovery-and-capacity-fixture).

### Proposed initial workload envelope

Use the tested 1/4/8/16 stages as the shape of a preproduction acceptance run. Use eight simultaneous interactive requests per endpoint as the initial isolated acceptance target, with one sync worker per mirror and one ingestion worker per owner. This is a workload to verify, not a request for colleagues to coordinate their use. Any eventual production concurrency cap must be enforced through admission/backpressure in the service. No cap is certified or enabled by this pass, and current access is unchanged.

Before raising that target, replay the same mixed workload against an isolated deployment with the actual Fly size, owner-specific Supabase pooler and representative file sizes. Proposed pass criteria are zero unexpected errors or lost accepted writes, exactly one winner per same-head race, preserved conflicts/recovery bytes, no growing queue after load stops, read p95 under 1.5 seconds, reviewed-write p95 under 3 seconds, and local/hosted convergence within 30 seconds at the proposed load. These latency targets are proposals, not new commitments. Record CPU, memory, pool wait and request latency together; provider connection limits apply to the sum of all pools and processes. Stop on sustained errors or resource pressure rather than stress production to failure.

## Design proposal: colleague monitoring without database credentials

**Recommendation:** separate the colleague viewer from the privileged local sync operator. Serve authenticated monitoring from the existing hosted Brain service; keep the native app as an optional viewer and local operator launcher. Reuse the existing identity and current-grant checks, not a shared database connection string. A first delivery can open a hosted monitoring page from the local app and avoid introducing native token storage before it is needed.

A credential-free app already works for public hosted health and locally available observations. Lack of Postgres diagnostics is a capability boundary, not proof that an install failed. The viewer profile must explicitly disable unconfigured sync supervision and mark local inbox/sync as not observed where no local root exists. Do not demand a recurring warning acknowledgment for a deliberately unavailable capability.

### Proposed authorization and response contract

| Surface | Proposed access | Response boundary |
| --- | --- | --- |
| Public `/health` | Existing public access | Existing liveness/version only; no added operational detail |
| Authenticated Brain status | Current Reader or higher on that Brain | Deployed version, bounded aggregate availability/sync freshness, observation timestamps and support/unknown states; no other users' paths or identities |
| Detailed operational diagnostics | Current Admin/Owner | Sanitized latency, conflicts and auth summary for that Brain; bounded recent events with an allowlist of fields |
| Local device state and inbox | User's existing filesystem authority | Remain local observations; never presented as hosted observations |
| Restart/maintenance | Existing local operator action or separately authorized hosted operation | A monitoring read confers no write, restart, role-management or secret access |

Every authenticated request resolves current grants and the exact tenant/principal; a still-valid session must stop working after revocation. Cache keys include owner/Brain and permitted response tier; caches cannot serve across identities after grant changes. Include `observed_at`, freshness, source surface and `supported/unknown` distinctions. Return an explicit unavailable result when a downstream check fails rather than an old green status.

Reuse the existing Entra login primitives and grant store, but do not reuse the Owner administration session wholesale: `src/admin/session.ts` currently retains a Graph token, and administration is a more privileged surface. Monitoring needs a separate session/route policy with no Graph mutation token. The existing `src/http/mcp-auth.ts` audience/provider checks and `currentRolesForPrincipal` logic are reusable; merely placing a URL below `/admin` would exclude Readers and misstate the permission boundary. The same design supports the personal endpoint's own enabled identity provider without joining owners' data.

Run bounded metadata queries server-side with the existing private runtime credential. Keep database/service-role secrets out of app bundles and profiles. Preserve the local privileged operator mode for machines that actually run sync; a credential-free viewer cannot transparently perform today's direct-Postgres sync. This proposal solves monitoring distribution, not a new sync transport.

Acceptance must cover missing/expired sessions, wrong tenant/Brain, Reader versus Admin detail, same-session revocation, sanitized errors, stale/unavailable upstream checks, cache separation, and a clean-machine viewer with no database, Fly or local Brain installation. Verify desktop/narrow layouts and both themes. Signed/notarized packaging, update verification, profile discovery and uninstall come after this credential model; packaging alone does not solve authorization.

**Approved and implemented:** [spec 021](specs/021-authenticated-monitoring.md), with the [monitoring runbook](hosted-monitoring.md). Release verification is recorded separately.

## Design proposal: automated source ingestion with operator-side custody

**Recommendation:** build a resumable, owner-bound ingestion worker over the existing source identity and provenance schema. Start with an explicit approved local/SharePoint source selection and dry-run manifest; subsequently add Graph enumeration in a separately approved deployment stage. Neither stage makes hosted MCP authoritative for the user's manual inbox or extends MCP roles to filesystem access.

### Proposed workflow and failure semantics

1. Enumerate only configured source roots. For local mirrored files, require complete readable bytes; an online-only placeholder or unreadable subtree is an unavailable observation, not a deletion. For a future Graph adapter, preserve provider drive/item/revision identity and reconcile changed revisions and deletions before advancing its checkpoint.
2. Build a deterministic manifest under spec 015. Use owner/Brain, provider identity, provider revision and content hash for idempotency; path or filename alone is not identity. Capture the observed editor only when supported by evidence, otherwise retain truthful unresolved attribution.
3. Claim the job with a bounded lease in the existing private Postgres store. Use one worker initially. Upload immutable original bytes to that owner's private artifact store; verify byte size and hash before recording completion. A retry must reuse the same immutable artifact identity; refuse differing bytes under an existing identity.
4. Extract bounded text with size/time/resource limits. Treat documents and extracted instructions as untrusted data. Persist original identity, extraction provenance and status; do not describe mechanical extraction as reviewed semantic truth. Extraction failure leaves the original recoverable and the job retryable.
5. Produce a reviewable candidate manifest/companion and proposed Brain changes. Curator/Admin approval on the hosted write surface applies only to those changes, not to the user's manual files. On approval, send replacements with the exact reviewed revision; a stale refusal returns to review. Do not read a new head and automatically resubmit.
6. Commit final links/status and issue a receipt identifying original hash, artifact identity, companion hash, reviewed Brain revisions and all still-pending steps. Persist checkpoints only after the corresponding durable work exists. Completion is evidence-backed, not inferred from a moved inbox file.

The durable states should distinguish discovery, byte verification, extraction, awaiting review, applying approved changes, complete, retryable failure and terminal refusal. A crashed lease can be reclaimed without duplicating artifacts or Brain writes. Store a bounded attempt count and next retry time, with manual retry of exhausted jobs. An upload succeeded but metadata failed is reconciliation work; never silently discard the original or create unbounded duplicate objects. A provider deletion becomes a tombstone/review event; it must not delete historical evidence or Brain claims automatically.

Operator-side custody describes the authority and independent manual access, not a requirement that every ingest run stay on one laptop. A future owner-controlled worker may read an approved SharePoint source; Fly MCP remains the read/write API for hosted revisions and preflight. It must not invent a second authoritative inbox. Distinguish a worker's timestamped observation of a selected SharePoint root from visibility into all users' local inboxes.

### Delivery sequence and boundaries

- First brief: resumable local adapter, explicit source selection, dry-run manifest, idempotent artifact/extraction stages and review receipts. Reuse source metadata/artifact identity, existing configured byte access and guarded Brain writes. Preserve the manual path throughout.
- Second brief: Graph adapter, selected-site/library access, checkpoint recovery, owner-specific scheduled runner and operational ownership. Choose the smallest site-scoped permission model that supports the selected library; verify the exact provider requirements before implementation. Do not broaden the existing mail application's consent merely because it is available. An ERS-owned ingestion identity is the preferred isolation proposal.
- Schedule only after byte retention, retry visibility and credential custody are designed. A laptop-independent worker is desirable but does not justify buying infrastructure or adding consent without the owner decision.

Acceptance fixtures must cover duplicates, rename with stable provider identity, changed bytes/revision, incomplete enumeration, expired checkpoints, failed uploads, metadata commit failure, interrupted extraction, worker crash/lease recovery, replay after approval, stale reviewed writes, and cross-owner references. Test the actual private object-store adapter in a disposable environment before claiming full ingestion acceptance. Manual inbox access must remain independent throughout.

**Next implementation briefs warranted:** yes, staged as above. A watcher alone cannot provide durable idempotency, byte verification, review or recovery. These are follow-on features, not an unresolved ambiguity in spec 017 and not an additional rollout gate.

## Decisions for the next review

Confirm the monitoring detail split (Reader summary, Admin/Owner diagnostics), the initial workload target and whether the local ingestion stage should precede provisioning an ERS-owned Graph runner. The current single-operator arrangement stays supported until those replacements are built and verified. No access change, new service purchase or automatic rollout follows from these proposals.
