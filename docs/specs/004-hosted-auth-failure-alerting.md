# 004 - Hosted Auth-Failure Surfacing And Slack Alerting

**Status:** implemented 2026-06-23 (pending operator Fly secret + spec review)
**Source:** 2026-06-23 operator report — the cockpit showed a slew of recent OAuth errors while the Checks tab stayed green and no notification ever fired. Slice of the BACKLOG observability line ("…and alerting once baseline distributions are known").
**Related:** `docs/hosted-cockpit.md`; `src/services/auth-telemetry.ts`; `scripts/hosted-doctor.mjs`; `docs/DECISIONS.md`; `CLAUDE.md` (Hosted Cockpit And Telemetry)

## Problem

Hosted OAuth/auth failures are written to `brain.sync_events` as `event_type = 'hosted_mcp_auth'` (`ok:false`, sanitized reason code + HTTP status) and are displayed in the cockpit's Operation Log. But:

1. **The Checks tab stays green.** None of the doctor's checks inspect `hosted_mcp_auth` rows. The closest check, `user_operation_latency`, builds its history from `latencyRowsQuery`, which is called with `HOSTED_MCP_LATENCY_EVENT_TYPE` only (`scripts/hosted-doctor.mjs:580`), so auth rows never reach the SLO engine. Overall status derives solely from the named checks (`scripts/hosted-doctor.mjs:1054`), none of which is auth-aware.
2. **No notification ever fires.** There is no alerting path anywhere in the codebase. The cockpit is passive and pull-based — the doctor only runs when the page is open and refreshed.

Net effect: persistent auth failures are invisible to the health verdict and silent to the operator.

## Decision Summary

Two coordinated additions that share one threshold configuration:

- **A. Doctor check** — a new `hosted_mcp_auth_failures` check joins the existing check list so auth failures drive the Checks tab and the overall green/warn/fail status.
- **B. Real-time Slack alerter** — when the server records an auth failure it also evaluates, best-effort and non-blocking, whether to post a Slack alert (`warn` → `#claude-ops`; `fail` → operator DM with `[Action needed]`).

The alert is posted **server-side from the Fly app** by calling the Slack Web API `chat.postMessage` with the jembot bot token. This posts as the `claude-jembot` identity but does **not** use the slack-claude-jembot MCP connector (that is only reachable from a Claude client, not from the Fly runtime).

Non-negotiable constraints (from `CLAUDE.md` → Hosted Cockpit And Telemetry):

- Best-effort and non-blocking by default — alerting must add no user-facing latency to the auth path. An `_AWAIT` flag enables synchronous behavior for diagnostics/tests only.
- Sanitization — alerts and dispatch rows carry only reason codes, HTTP status, and counts. OAuth token failures use the detailed sanitized server-side class when available (for example `unknown_client_id` vs `client_authentication_failed`) so stale-client and bad-secret conditions are distinguishable without recording raw credentials. Never tokens, headers, request/response bodies, SQL text, or connector payloads.
- No new metrics database, daemon, or analytics service. Cooldown/dispatch state reuses `brain.sync_events`.

## Components

All new server logic lives behind small, independently testable units.

### `src/services/slack.ts` (new)
- `postSlackMessage(channel: string, text: string): Promise<{ ok: boolean; error?: string }>` — thin wrapper over Slack Web API `chat.postMessage`.
- **No-op (returns `{ ok: false, error: "disabled" }`) when `BRAIN_SLACK_BOT_TOKEN` is unset** — keeps local/dev and tests hermetic (no network).
- Bounded timeout; never throws to callers. Only transmits the `text` the caller built.

### `src/services/auth-alert.ts` (new)
- `decideAuthAlert(input): AlertDecision` — **pure function, no IO.** Inputs: `failureCount`, `windowMinutes`, `warnThreshold`, `failThreshold`, `lastWarnAt`, `lastFailAt`, `cooldownMinutes`, `now`, `reasonSummary`, `topStatus`. Output: `{ fire: false }` or `{ fire: true, severity: "warn" | "fail", channel, text }`.
  - Severity: `fail` if `failureCount >= failThreshold`, else `warn` if `failureCount >= warnThreshold`, else no fire.
  - **Per-severity cooldown so escalation breaks through:** a `warn` is suppressed if `max(lastWarnAt, lastFailAt)` is within `cooldownMinutes`; a `fail` is suppressed only if `lastFailAt` is within `cooldownMinutes`. A worsening warn→fail therefore pages immediately.
- `maybeAlertOnAuthFailure(deps?)` — orchestrator. Config-gated; runs one query (trailing-window failure count + top reason codes + most-recent warn/fail dispatch timestamps); calls `decideAuthAlert`; on fire posts via `postSlackMessage` and writes a dispatch row. `deps` (pool, clock, slack poster) are injectable for tests; defaults wire the real implementations.

### Wiring into the auth path
- [`recordAuthEventBestEffort`](../../src/services/auth-telemetry.ts) gains a fire-and-forget call to `maybeAlertOnAuthFailure()` after the telemetry write is dispatched. It honors the same await-override discipline: synchronous only when `BRAIN_AUTH_ALERT_AWAIT === "1"`.

### Cooldown / dispatch state
- Reuses `brain.sync_events` with a new `event_type = "hosted_mcp_auth_alert"`. Metadata: `{ version, source: "hosted_mcp_server", kind: "auth_alert", severity, count, window_minutes, reasons: [...], httpStatus, channel, ok }`. Reading the latest row per severity yields cooldown state. No schema change.

### Doctor check
- New `checkAuthFailures` in `scripts/hosted-doctor.mjs`, registered in the `Promise.all` check list. Queries the trailing-window `hosted_mcp_auth` failure count + top reason codes and returns `pass` / `warn` / `fail` using the same thresholds/window as the alerter (read from the same env vars, with identical defaults). Adds an operator action via `buildOperatorActions` on `warn`/`fail`.

## Data Flow

```
auth failure
  → recordAuthEventBestEffort  (existing: writes hosted_mcp_auth row)
  → maybeAlertOnAuthFailure()  (new, fire-and-forget)
       1. gate: enabled && BRAIN_SLACK_BOT_TOKEN set → else no-op
       2. one query: window failure count + top reasons + last warn/fail dispatch ts
       3. decideAuthAlert(...) → fire? severity? text?
       4. if fire:
            warn → postSlackMessage(#claude-ops, text)
            fail → postSlackMessage(operator DM, "[Action needed] " + text)
            → write hosted_mcp_auth_alert dispatch row (ok reflects post result)
```

Cockpit refresh path is unchanged; the new doctor check simply appears in `payload.checks[]` and contributes to `payload.status`.

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `BRAIN_SLACK_BOT_TOKEN` | jembot bot token (`xoxb-…`). **Gate** — unset disables all alerting. Fly secret. | unset |
| `BRAIN_SLACK_ALERT_CHANNEL` | `warn` destination; required with token | unset (alerting disabled) |
| `BRAIN_SLACK_ALERT_DM` | `fail` destination; required with token | unset (alerting disabled) |
| `BRAIN_AUTH_ALERT_WINDOW_MINUTES` | Trailing window for the count | `60` |
| `BRAIN_AUTH_ALERT_WARN_THRESHOLD` | `warn` at count ≥ this | `3` |
| `BRAIN_AUTH_ALERT_FAIL_THRESHOLD` | `fail` at count ≥ this | `10` |
| `BRAIN_AUTH_ALERT_COOLDOWN_MINUTES` | Per-severity suppression window | `30` |
| `BRAIN_AUTH_ALERT_AWAIT` | `1` = await post (diagnostics/tests) | unset |

The doctor check reads `BRAIN_AUTH_ALERT_WINDOW_MINUTES`, `BRAIN_AUTH_ALERT_WARN_THRESHOLD`, and `BRAIN_AUTH_ALERT_FAIL_THRESHOLD` so the cockpit verdict and Slack alerts always agree.

## Message Format

Per the operator Slack protocol (`[<routine>] <ISO date> — <summary>`; DM adds `[Action needed]`). Routine name: `brain-auth-alert`.

- `warn` → #claude-ops:
  `[brain-auth-alert] 2026-06-23 — ⚠️ 4 hosted MCP auth failures in last 60m (invalid_token ×3, token_expired ×1; HTTP 401). Cockpit: http://127.0.0.1:8787/`
- `fail` → operator DM:
  `[brain-auth-alert] [Action needed] 2026-06-23 — 🚨 12 hosted MCP auth failures in last 60m (invalid_token ×9, audience_mismatch ×3; HTTP 401). Cockpit: http://127.0.0.1:8787/`

Reason codes come from the existing `authReasonCode` sanitizer. No raw error text, tokens, or payloads.

## Error Handling

- Every step is best-effort. A Slack post failure is swallowed, logged to stderr (sanitized), and recorded as a dispatch row with `ok:false`. It never propagates to the auth path.
- No recursion: a Slack HTTP failure is not an MCP auth failure, so it cannot re-trigger the alerter.
- Self-throttling: the per-severity cooldown means a persistent condition posts at most once per `cooldownMinutes` per severity.

## Testing

`npm test` (build + Node test runner).

- **`decideAuthAlert` (pure):** boundaries 2/3/9/10/11 → none/warn/warn/fail/fail; cooldown suppress within window; warn→fail escalation breaks through; no fire below warn threshold.
- **`maybeAlertOnAuthFailure` (injected fake pool + fake slack + fixed clock):** posts to the correct channel per severity; writes a dispatch row with the right metadata; honors `BRAIN_AUTH_ALERT_AWAIT`; no-ops when the token is unset; swallows a failing slack poster and records `ok:false`.
- **`postSlackMessage`:** no-op (no network) when `BRAIN_SLACK_BOT_TOKEN` is unset.
- **Doctor check:** `checkAuthFailures` returns `warn`/`fail`/`pass` for seeded counts across the threshold boundary (unit on the check's decision; reuse the existing doctor test harness if present).

## Verification

- `npm run build` — TypeScript compile.
- `npm test` — full suite green, including the new tests above.
- Manual (post-deploy, after the Fly secret is set): confirm a `warn`-level burst posts once to #claude-ops and that the cockpit Checks tab shows the new `hosted_mcp_auth_failures` row turning amber; confirm cooldown suppresses a second immediate post.

## Deployment

- Code is safe to merge before the secret exists: with `BRAIN_SLACK_BOT_TOKEN` unset the alerter is dormant and the doctor check still works.
- Operator step: `fly secrets set BRAIN_SLACK_BOT_TOKEN=… -a jem-brain-mcp` (jembot needs `chat:write` and membership in #claude-ops; DM delivery uses the user ID as the `chat.postMessage` channel). Record the new dependency (Fly app → jembot token) in `personal-assets.md`.

## Scope Guard (YAGNI)

- No new daemon, table, or service. No per-event spam (cooldown). No DM for `warn`. No config UI. Reuse `brain.sync_events`, the `authReasonCode` sanitizer, and the existing best-effort/await telemetry pattern.

## Docs To Update In The Same Change

- `docs/hosted-cockpit.md` — the new check, the alerting behavior, the env vars, and the new `hosted_mcp_auth_alert` event type.
- `docs/DECISIONS.md` — record "real-time server-side Slack alerting, both-by-severity" with rationale and rejected alternatives (scheduled local doctor; scheduled cloud routine).
- `BACKLOG.md` — narrow the broad observability/alerting line to reflect that auth-failure alerting has shipped.
