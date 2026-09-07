# 019 — Hosted Latency Finding Semantics And Connection Warmth

**Status:** draft
**Source:** `BACKLOG.md` — the `db_max_span` re-specification item and the doctor transient-tolerance item, which that backlog explicitly directs to be promoted together
**Roadmap link:** ad-hoc — hosted observability maintenance, follows spec 004 (auth-failure alerting) and spec 005 (stale-connector classification)
**Decisions impact:** locks three decisions on ship — the `db_max_span` SLO becomes a windowed percentile rather than an un-windowed max; concurrent DB spans are annotated, never de-duplicated; the Postgres pool idle timeout is not raised without TCP keepalive
**Related:** [`004-hosted-auth-failure-alerting.md`](004-hosted-auth-failure-alerting.md); [`archive/005-auth-client-identity-and-stale-connector-classification.md`](archive/005-auth-client-identity-and-stale-connector-classification.md); [`007-brain-cockpit-ux-redesign.md`](007-brain-cockpit-ux-redesign.md); [`../hosted-cockpit.md`](../hosted-cockpit.md)

## Problem

The hosted doctor reports momentary and stale conditions as live top-severity
incidents, and the metric that most often fires does not measure what it claims
to measure. Two backlog items describe the same failure from different angles;
a 2026-09-07 investigation on `ai-brain-jem` established a third.

**Findings latch.** `latencyRowsQuery` (`scripts/hosted-doctor.mjs:856`) selects
the most recent 240 `hosted_mcp_latency` rows with no time filter, and
`evaluateLatencySlo` takes `Math.max` over the whole history
(`scripts/lib/latency-summary.mjs:859`). A single outlier therefore holds the
check at `warn` or `fail` for as long as 240 operations take to accumulate — on
JEM's traffic (~77 latency operations per 7 days) roughly three weeks. The JEM
warning observed on 2026-09-07 was a single 542ms span dated 2026-09-02T14:52Z,
the only breach in the window, on a machine that had been up since
2026-09-01T22:29Z with `auto_stop_machines = "off"`. The earlier `ers-brain`
occurrence (3555ms, 2026-07-29) was the same shape after a deploy.

**A single transient is indistinguishable from a dead database.**
`checkPostgresSummary` (`scripts/hosted-doctor.mjs:467`) turns any exception into
`fail`, which maps to `postgres_diagnostics_failed` at urgency `now`
(`scripts/hosted-doctor.mjs:498` -> `:1476`) with no retry, no consecutive-failure
threshold and no error classification. Observed 2026-08-20 on `ers-brain`: a
DNS `ENOTFOUND` during a laptop sleep/darkwake cycle produced a full-severity
banner while hosted MCP calls were succeeding throughout. Findings also carry no
observation timestamp and `hosted-doctor.out.json` is overwritten each cycle, so
the operator cannot tell a one-off from a pattern, or a live fault from one that
self-healed hours earlier.

**A "DB span" is not query time.** `instrumentPostgresPool`
(`src/services/operation-telemetry.ts:163`) wraps `pool.query`, and node-postgres
`Pool.query` calls `this.connect()` before `client.query()`
(`pg-pool/index.js:449`). Every span therefore bills connection acquisition —
TCP, TLS, SCRAM (PBKDF2, 4096 iterations in JS), Supavisor upstream connect — to
the SELECT, and attributes it to a table and a SQL verb. Spans taken on a client
acquired explicitly through `pool.connect()` (`postgres-revision-store.ts:207`)
exclude that cost, so spans are not mutually comparable. ERS supplies the
natural experiment on one database and one machine: `commit` spans, which run on
an already-warm connection, average 4ms, while the trivially-indexed 52-row
SELECT issued through `pool.query` averages 34ms.

The combined effect is that the check most likely to catch a real regression is
the one an operator learns to dismiss — and the SLO set is incoherent while it
does so. On 2026-09-07 `ers-brain` passed `db_max_span` at 281ms despite worse
user-facing latency than JEM (read p95 462ms, max 765ms, against JEM's 276ms and
544ms), because JEM happened to hold one stale outlier and ERS did not.

## Phasing

The program runs in three phases, each independently shippable and independently
revertible. Phase 1 is the only phase that resolves the current alarm, and it is
the only phase that requires no deploy.

### Phase 1 — Doctor finding semantics (local scripts, no deploy)

The doctor runs locally on the operator Mac against each Brain's Postgres, so
this phase changes no runtime code, requires no Fly release, and applies to both
`ai-brain-jem` and `ers-brain` the moment it lands.

- `db_max_span` is evaluated over an explicit time window rather than a row
  count. Add a `created_at >=` bound to `latencyRowsQuery` and score a
  percentile or a count-over-threshold instead of a single maximum. The stated
  window and statistic appear in the finding text.
- Every finding carries `observedAt` and a consecutive-observation count, and
  the finding text states breach age and sample position so a stale outlier
  cannot read as a live incident.
- `checkPostgresSummary` retries once or twice with short backoff, then
  classifies the error. Durable classes — authentication, schema, permission,
  sustained unreachability — reach `fail`. Transient network and DNS conditions
  degrade to `warn` carrying a recurrence count. Remediation text names the
  actual fault class rather than a single generic instruction.
- A bounded rolling history of doctor snapshots is retained so recurrence is
  visible and a failing snapshot survives the next cycle.
- `BRAIN_HOSTED_MCP_LATENCY_HISTORY_LIMIT` and the new window settings are
  documented in `docs/hosted-cockpit.md`.

### Phase 2 — Truthful span measurement (runtime code)

Ships to JEM first. ERS consumes it at its next planned annotated tag through
the existing private-overlay release contract; no ERS release is cut for this
phase alone.

- Connection acquisition is measured as its own span. Instrument `connect` in
  both callback and promise form rather than `pool.query`, so each `pool.query`
  yields an `acquire` span plus a SQL span, and the transaction path
  (`postgres-revision-store.ts:203-216`) reports acquisition on the same terms.
  Record an acquire span only when a new client is created or the wait is
  non-trivial, so the 24-span cap (`operation-telemetry.ts:50`) does not truncate
  heavy tools.
- Each span records `startOffsetMs` relative to handler start. The operation
  summary reports both the existing sum and a new `wallMs` — the union of span
  intervals, i.e. the DB-attributable critical path. A `Promise.all` of two
  530ms spans reports `totalMs` 1060 and `wallMs` 540; neither number is
  falsified.
- Concurrent spans are **not** de-duplicated. See "Rejected alternatives".
- `metadata.version` (`tool-telemetry.ts:165`) is bumped. Rows written before
  this phase lack acquire spans and must continue to render.
- `docs/hosted-cockpit.md`, the `CLAUDE.md` telemetry contract and
  `test/tool-telemetry.test.mjs` are updated in the same change.

### Phase 3 — Connection warmth (runtime code, evidence-gated)

Gated on the Phase 0 validation below. If warm-bucket p50 is not materially
lower than cold-bucket p50, connection setup is the wrong lever and this phase
is abandoned rather than shipped.

- `postgresPoolOptions` (`postgres-revision-store.ts:55`) sets `keepAlive: true`
  with an env-overridable initial delay. This is a prerequisite, not an option:
  pg defaults `keepAlive` to false (`pg/lib/client.js:94`), so a longer-lived
  connection silently dropped by Supavisor, NAT or Fly egress is handed to the
  next caller and hangs until `query_timeout` (30s) — a user-visible stall worse
  than the ~40ms it would save.
- Expose pg-pool `min` as `BRAIN_PG_POOL_MIN`, default 0. Setting it to 1 keeps
  one warm connection while the remaining three still evict at 10s. Note that
  `min` does not itself create connections; boot warmup creates the first, and
  after a purge the pool sits empty until the next call.
- Only then consider raising `BRAIN_PG_IDLE_TIMEOUT_MS` toward the ~5 minutes at
  which Supavisor closes its own Postgres-side connection.
- `/health` (`src/http/server.ts:219-258`) touches no Postgres, so Fly's 30s
  health check does not keep the pool warm. If a keepalive query is added
  instead, it must be a read; the sync-heartbeat write path inserts rows
  (`postgres-revision-store.ts:289`) and ERS has already had to purge 475k of
  them (`docs/ers-entra-access-runbook.md:303`).

### Phase 0 — Validation before Phase 3 (no code)

Runs against existing stored telemetry, metadata-only. Join each
`hosted_mcp_latency` row to its predecessor's `created_at`, bucket first-span
duration by the gap — under 10s warm, under 5 minutes cold-client, longer
cold-both — and compare p50 per bucket. A step at 10s confirms client
cold-connect and quantifies Phase 3's benefit; a further step at 5 minutes
confirms the Supavisor backend layer; a flat profile falsifies the hypothesis
and cancels Phase 3.

## Acceptance criteria

- A single stale outlier no longer holds `db_max_span` at `warn`. Replaying the
  JEM 2026-09-07 history through the evaluator yields `pass`, and a synthetic
  history with a sustained breach still yields `warn`/`fail`.
- A one-off Postgres exception yields at most `warn` with a recurrence count; a
  sustained authentication or schema failure still yields `fail` at urgency now.
- Every finding renders an observation timestamp and consecutive-observation
  count.
- After Phase 2, a `brain_sync_status` call reports separate `acquire` and
  `select` spans, and its operation summary reports `wallMs` below the sum of
  its concurrent spans.
- Telemetry rows written before Phase 2 still render in the cockpit.
- Phase 3 ships only if Phase 0 shows a warm/cold p50 step, and `keepAlive`
  lands in the same change as or before any idle-timeout increase.
- Both Brains reach a coherent verdict: the Brain with worse user-facing latency
  does not pass while the better one warns.

## Out of scope

- New metrics databases, daemons or analytics services.
- Latency/SLO Slack alerting, which the hosted-observability backlog item defers
  pending baseline distributions.
- Operator-selectable cockpit time windows (1H/1D/1W/1M), which is its own
  backlog item and concerns the views rather than the evaluator.
- Per-user attribution and sanitized `User-Agent` capture, both gated by the
  Supabase security review.
- Any change to Supavisor or Supabase project configuration.
- Threshold tuning as a substitute for fixing the statistic.

## Technical constraints

- The doctor and cockpit are local-only and read-only. Nothing in Phase 1 may
  introduce a hosted write, a public bind, or an admin mutation.
- Telemetry stays metadata-only: operation and table names, durations, row
  counts, status and bounded error text. No SQL text, query parameters, file or
  source content, patch text, or search query text.
- Hosted telemetry writes remain best-effort and non-blocking so measurement
  does not add user-facing latency.
- `pg-pool` creates a new client for each concurrent `connect()` while the pool
  is under `max` with no idle client (`pg-pool/index.js:199-236`). Concurrent
  spans therefore represent independent real costs.
- `loadContextFromActiveStore` (`active-brain-store.ts:99`) issues exactly four
  concurrent Postgres reads against a `max: 4` pool — the other two `Promise.all`
  entries are a GitHub call and a filesystem scan — so it contends for CPU on a
  cold pool but does not queue. Any change to pool `max` or that fan-out changes
  whether queue wait enters spans.
- Transaction-pooler (`:6543`) idle clients pin no backend, so the
  `EMAXCONNSESSION` hazard documented in `src/services/pooler.ts` is
  session-mode-only and does not constrain Phase 3. Worst-case held connections
  per machine remain single-digit across all pools.
- ERS runtime changes reach the dedicated deployment only through an annotated
  upstream tag and the guarded deploy from its private mirror
  (`docs/deploy-fly.md`, guarded deploy and overlay mode).

## Test plan

- Evaluator unit tests over recorded histories: the JEM 2026-09-07 stale-outlier
  history yields `pass`; a sustained-breach history yields `warn`/`fail`; window
  boundaries are exercised at both edges.
- Doctor unit tests for retry, error classification and recurrence counting,
  including a transient DNS failure and a durable auth failure.
- Telemetry tests asserting acquire and SQL spans are recorded separately, that
  `wallMs` is below the sum for concurrent spans and equal for sequential ones,
  and that pre-Phase-2 rows still summarize. `test/tool-telemetry.test.mjs:56`
  currently asserts `queryCount === 1` against a fake pool whose `query` never
  calls `connect`, and `:84` routes through callback connect — both assert
  `queryCount === 1` and need updating.
- Cockpit E2E over a healthy JEM snapshot and a warning-heavy ERS snapshot.
- Phase 3 only: a soak confirming a held connection survives its idle window and
  that a dropped connection surfaces as a pool error rather than a 30s stall.

## Data files touched

- `docs/hosted-cockpit.md` and the `CLAUDE.md` telemetry section, per project
  rule when launcher/cockpit/telemetry behaviour changes.
- No Brain content, no hosted schema, no migration.

## Verification commands

- `git diff --check`
- `npm run build`
- `npm test`
- `npm run test:cockpit:e2e`

## Rejected alternatives

- **De-duplicating concurrent DB spans.** Proposed during the 2026-09-07
  investigation on the reading that the 542ms and 530ms spans of one
  `brain_sync_status` call were a single shared connection cost counted twice.
  Adversarial review falsified this: pg-pool creates a new client per concurrent
  `connect()` when the pool is under `max` with no idle client, so those were two
  independent handshakes that each genuinely paid that cost. Two independent
  connects stalling identically is a common-cause signal — DNS, Supavisor tenant
  auth, or shared-vCPU contention from parallel TLS and PBKDF2 — and
  de-duplicating would erase precisely the evidence needed to diagnose it.
  Annotating with `startOffsetMs` and `wallMs` preserves both truths instead.
- **Raising `BRAIN_PG_IDLE_TIMEOUT_MS` as a standalone secret change.** Would
  trade ~44ms on every call for a rare 30s stall on the first call after a gap,
  because no TCP keepalive is configured. Sequenced behind `keepAlive` and pool
  `min` instead.
- **A post-deploy warm query.** Suggested in the original backlog item on the
  cold-start reading. `warmActiveBrainStore` already runs at boot
  (`src/http/server.ts:382`) and its connections are evicted 10s later, so a warm
  query addresses only the first few seconds of a machine's life and not the
  sparse-traffic steady state.
- **Tuning the 500ms/2500ms thresholds.** Treats the symptom. The defect is a
  single-sample maximum over an unbounded window measuring a conflated quantity;
  any threshold latches on the same outlier.

## Assumptions

- Phase 1 is worth shipping ahead of any evidence from Phase 0, because it is
  correct independently of what causes slow spans.
- ERS remains on the SharePoint write plane for colleague traffic, so its hosted
  MCP stays sparse in the near term. Its telemetry showed no read or write
  between 2026-09-03 and 2026-09-07. If ERS MCP traffic grows materially, Phase 3
  should be re-evaluated against its own numbers rather than JEM's.
- The proximate cause of the specific 2026-09-02 542ms stall is not
  recoverable — Fly log retention has long passed — so the program targets the
  measurement and the steady state, not that incident.
- The operator Fly CLI currently authenticates to the personal org only and
  cannot see `ers-brain-mcp`. Any ERS deploy in Phase 2 or 3 requires the ERS
  Fly identity; Phase 1 needs no Fly access at all.
