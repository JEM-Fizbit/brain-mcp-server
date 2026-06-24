# 005 — Auth client identity recording + stale-connector classification

**Status:** approved
**Source:** Live investigation 2026-06-24 (zombie ChatGPT connector looping `unknown_client_id`); planning thread "harden how we record client identity"
**Roadmap link:** ad-hoc (hardening slice within the hosted-Brain pilot; relates to the BACKLOG "expand hosted observability" item)
**Decisions impact:** locks a new `DECISIONS.md` entry — "Record non-secret client identity on hosted auth telemetry; classify stale-connector loops separately from auth incidents"
**Related:** builds on `64003f3` (Codex — hosted auth-failure cockpit view); `docs/specs/004-hosted-auth-failure-alerting.md`; `docs/DECISIONS.md` 2026-06-23 (durable OAuth state migration invalidates pre-existing registrations → expected `invalid_client` wave)

## Problem

After the 2026-06-22 durable-OAuth-state migration emptied the client-registration store, a connector (a frozen/half-deleted ChatGPT connector on OpenAI's backend) keeps presenting a **pre-migration `client_id`** to `POST /oauth/token` on a fixed ~11-minute timer. The server correctly rejects it (`401 invalid_client` / `unknown_client_id`) — but:

1. **It is unidentifiable from telemetry.** Auth-failure rows record `reason`/`name`/`httpStatus`/`target` only. The rejected `client_id` — the one stable, unique signature that distinguishes this zombie from any other client and from a legitimate connector mid-re-registration — is read at `src/oauth/token.ts:43-44` and then discarded. We verified the client has zero server-side state (not in `clients`, no orphan refresh tokens), so it can only be tracked by what it presents.
2. **A benign zombie pages at `fail` severity indefinitely.** `hosted_mcp_auth_failures` and the spec-004 Slack alerter treat sustained `unknown_client_id` the same as a real auth incident. But `DECISIONS.md` (2026-06-23) already rules that the post-migration `invalid_client` wave is "expected, self-healing… not an incident." The monitoring doesn't encode that.

The server cannot stop a remote client from retrying (a `401` is already the spec-correct "give up" signal; OpenAI's stuck connector ignores it). So the fix is **observability + classification**, not enforcement.

## Acceptance criteria

- Hosted auth telemetry rows (`brain.sync_events`, `event_type = 'hosted_mcp_auth'`) carry a non-secret `clientId` and `grantType` in `metadata` when derivable, `null` when not (e.g. `missing_bearer` has neither).
- The recorded `clientId` is the **raw** OAuth client id (already stored plaintext in `brain.oauth_state` `clients`), so it joins directly to the registration store. No tokens, secrets, headers, bodies, or content are added — the existing "never record" list is unchanged.
- `authFailureSummaryFromSyncEventRows` exposes `clients` and `grantTypes` breakdowns (top-N, same shape as the existing `reasons`/`targets`/`names`).
- The summary classifies a **stale-connector** condition: failures dominated by `unknown_client_id` on `grant_type = refresh_token`, concentrated in one (or few) `clientId`(s) that are **not in the `clients` store**, sustained past a grace window. This is surfaced as a distinct `connectorState` (e.g. `stale_connector`) separate from the `active`/`stale`/`clear` activity state.
- `hosted_mcp_auth_failures` doctor check and the spec-004 alerter **downgrade a pure stale-connector condition** below `fail`/page severity (→ `warn`/informational), while a real auth incident (`missing_bearer` spike, credential failures, multi-reason burst, or a client that fails-then-succeeds) keeps full severity.
- Cockpit Auth subtab shows the per-`clientId` breakdown and the stale-connector verdict.
- The doctor verdict and the Slack alert agree on the stale-connector downgrade (same thresholds/logic), per the CLAUDE.md invariant.

## Out of scope

- **`User-Agent` capture on auth failures** — approved in principle (planning decision 2) but folded into the BACKLOG "expand hosted observability" item per decision 3. `clientId` alone is sufficient to classify and quiet this zombie; UA only helps *name* unregistered software and carries a higher privacy cost (gated by the security review).
- **Per-user attribution** (`github_login`/`provider_user_id`) on success/tool telemetry, **correlation IDs**, and dashboard rollups — these stay in the observability BACKLOG item.
- **Tool-telemetry** client attribution (`hosted_mcp_latency` rows) — this spec scopes identity recording to the two auth events (`oauth_token`, `mcp_authorization`).
- Any change to OAuth grant behavior, token issuance, refresh rotation, schema, or auth-state storage. **None.** (Recording is additive metadata only.)
- Server-side blocking/denylisting of the zombie by IP/UA — not pursued (harmless, already rejected; would require capturing network identifiers we deliberately don't store).

## Technical constraints

- **Recording happens at the HTTP layer, not in `handleToken`.** `src/oauth/token.ts:handleToken` returns only `{ status, body }`. `client_id` and `grant_type` live inside `authenticateClient`/`handleToken`. To record them, `handleToken` must **surface them to the caller** (return `clientId`/`grantType` alongside status, including on the failure path) so `src/http/server.ts` (around lines 268-285) can pass them to `recordAuthEventBestEffort`. Do not move the telemetry write into the OAuth core — keep the OAuth module free of telemetry coupling.
- **`recordAuthEvent` metadata** (`src/services/auth-telemetry.ts:80-92`) is the single write point. Add optional `clientId`/`grantType` to the `input` type and the `metadata` object. `safeText`-sanitize the `clientId` defensively (it's attacker-controlled on the failure path) and bound its length; `grantType` is a small enum-ish string — sanitize/clip likewise. Keep `db: null` and the rest intact.
- **`mcp_authorization` failures** (`src/http/server.ts:144`): `missing_bearer` has no client id (no token) → `clientId: null`. An expired/invalid bearer may carry `client_id` in the verified JWT payload (`src/http/mcp-auth.ts:32`) → record best-effort when available.
- **Summary normalizer:** `authEventFromSyncEventRow` (in `scripts/lib/latency-summary.mjs`) must surface `clientId`/`grantType` from metadata so `countBy(...)` and the classifier can use them. The function is pure/tested — extend, don't rewrite.
- **Registration cross-check:** the doctor/summary classifier needs to know whether a failing `clientId` is currently registered. The doctor (`scripts/hosted-doctor.mjs`) already has DB access — it can pass the current set of registered `clientId`s (from `brain.oauth_state` `clients`) into the summary options so the pure summary function stays DB-free. The summary treats "registered set unknown" as "cannot confirm stale" (conservative — keep full severity).
- **Grace window** prevents masking a genuinely failing *new* enrollment, which also briefly emits `unknown_client_id` before DCR completes. Reuse/align with Codex's `activeThresholdMinutes` style; make it a config knob.
- **Backward compatibility:** existing rows have no `clientId`/`grantType`. Treat absent as `null`/`unknown`; all current tests and the cockpit must still render.

## Design (summary)

1. **Record:** `handleToken` returns `{ status, body, clientId, grantType }`; `server.ts` forwards them; `auth-telemetry.ts` writes sanitized `metadata.clientId` / `metadata.grantType`.
2. **Summarize:** `authEventFromSyncEventRow` surfaces the two fields; `authFailureSummaryFromSyncEventRows` adds `clients`/`grantTypes` breakdowns and a `connectorState` derived from `{ dominant reason = unknown_client_id, dominant grant = refresh_token, dominant clientId ∉ registeredClientIds, minutesSinceLastFailure > graceWindow }`.
3. **Classify:** doctor + alerter map a pure `stale_connector` verdict to `warn`/info (not `fail`/page); everything else unchanged. Same logic both sides.
4. **Surface:** cockpit Auth subtab renders the `clients` breakdown and the stale-connector verdict.

## Test plan

- `test/latency-summary.test.mjs` — unit cases for `authFailureSummaryFromSyncEventRows`: (a) single unregistered `clientId` + `refresh_token` + past grace → `connectorState: stale_connector`, status downgraded; (b) within grace window → not yet stale (full severity); (c) `missing_bearer` spike → not stale; (d) multi-`clientId` / multi-reason burst → not stale; (e) a `clientId` that fails-then-succeeds → not stale; (f) `registeredClientIds` unknown → conservative (not downgraded); (g) rows lacking `clientId` (legacy) still summarize.
- `test/auth-telemetry.test.mjs` (or existing telemetry test) — `clientId`/`grantType` written when provided; sanitized; `null` when absent; "never record" fields still absent.
- `test/auth-alert.test.mjs` — stale-connector condition does not page at `fail`; a real incident still does.
- Doctor shape test in `test/deploy-config.test.mjs` if it asserts the auth summary shape — extend for the new fields.
- Manual: `npm run hosted:doctor` shows the live zombie reclassified to `warn`/stale-connector with its `clientId`; cockpit Auth subtab shows the per-client breakdown.

## Data files touched

None (no migration; `brain.sync_events.metadata` is schemaless JSONB and additive). `.env.local.example` updated for any new knob (grace window / classifier thresholds).

## Verification commands

- `npm run build` — type-only sanity
- `npm test` — full suite (must stay green; current baseline 148 pass / 1 skip)
- `npm run hosted:doctor` — live reclassification check

## Security / privacy

- **`clientId` is non-secret** — a public OAuth client identifier already persisted in plaintext in `brain.oauth_state` `clients`. Recording it does not cross the CLAUDE.md "never record" line (tokens, refresh tokens, `Authorization` headers, request bodies, client secrets, Brain content, SQL). This is a deliberate, bounded widening of auth-row metadata — documented in `DECISIONS.md` and the CLAUDE.md telemetry rules.
- Update the telemetry rules in `CLAUDE.md` (and `AGENTS.md`) and `docs/security/hosted-brain-supabase-security-gate.md` to state that `clientId`/`grantType` are recordable non-secret auth identifiers, and that UA / network identifiers remain out (deferred + gated).
- `clientId` is `safeText`-sanitized and length-bounded on the failure path (attacker-controlled input).

## Assumptions

- Recording the **raw** `clientId` (not a hash) is acceptable, since the value is non-secret, already stored plaintext, and hashing would break the join to the registration store. (Flag if you'd prefer a hash.)
- This spec ships as one unit (recording + summary + classification + docs + tests) in a single commit/PR; it does not touch Codex's `64003f3` files beyond additive extension.
- Scope is the two auth events only; broader per-client tool attribution is the observability BACKLOG item.
