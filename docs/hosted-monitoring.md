# Hosted Brain monitoring

> **Current ERS rollout status (6 October 2026):** AI-DEC-2026-027 closed the
> remaining governance gate on 5 October; named Entra enrolment and the team
> launch announcement completed on 6 October. References
> below to an open company-rollout hold describe the dated delivery boundary of
> this monitoring feature, not the current ERS launch status.

**Version:** 1.1 — 23 October 2026
**Release:** v1.13.1 change history; v1.13.2 preserves date-only historical receipts without invented times. See the owner-specific deployment record for live verification.

Open the Brain endpoint followed by `/monitor`, then sign in with the existing enabled GitHub or company identity. The browser is sufficient: no app, database credential, Fly access or local Brain folder is needed. Cockpit and Brain Monitor also link to this page for their selected profile.

Readers and Curators see the deployed version, service availability, latest configured operator sync heartbeat and whether attention is required. Admins and Owners additionally see aggregate conflicts, operation failures, successful-operation p95 and authentication-event counts. Diagnostics use the latest 1,000 matching events within 24 hours, so they are a bounded sample. The status response returns no source bytes, filenames, individual actors or raw error text. Authenticated history deliberately shows the selected Brain's log and revision content, as described below.

## Change log and Git-style diffs

Choose **Change log** on Brain status or the local cockpit, or open `/monitor/changes` directly. Sign in with the existing Brain account; after sign-in choose Change log on status. No agent or database access is needed.

The newest-first history defaults to **Automatic updates** (the explicit spec 023 source-backed receipt type). Choose **All entries** for user-directed changes, maintenance and older receipts. Search file, reason, source or other receipt text. Filtering happens before pagination, with 25 matching entries per page and Newer/Older links preserving the filter and selected Brain. This is the existing `LOG.md` index, not a second audit database; older automation receipts without the explicit type remain under All entries.

Each linked entry opens the retained revision with a Git-style unified diff: old/new line numbers, additions and deletions, three context lines, revision/parent identifiers, reason, source evidence and original read-back result. Full exact before/after snapshots remain expandable. Added/deleted markers supplement colour in both themes. Rendering uses pinned [jsdiff](https://github.com/kpdecker/jsdiff) with bounded input/edit distance/time; a display-limit message falls back to the full snapshots. Historical receipts without a record link are labelled explicitly. Deleting a test file does not remove retained history.

History is read-only and retrospective. It adds no approval step, pending queue, notifications or write permission. Actors reflect the stored authenticated principal/manual-edit attribution; they do not assert a model identity. Current Brain roles are checked independently on every list and record request, including Readers. Anonymous, revoked and other-Brain access is refused. Receipt links must point to the same deployment and selected Brain; log text and diffs are escaped, never executed as HTML. No schema, grants, identity-provider or credential change is required.

At most four list reads are admitted concurrently per process. List failures never reuse an earlier result; responses remain no-store under the monitor CSP. The list reads the current hosted LOG once and does not fetch a revision per row. This is not a complete census of all database or filesystem activity; it browses logged receipts and their linked retained revisions.

The heartbeat is per Brain, not per colleague or device. A recent heartbeat shows observed operator activity, not proof that every local copy is synchronized. Five minutes without a heartbeat is stale; missing or invalid observations are unknown. Manual local inbox access remains independent of MCP roles. The hosted viewer explicitly cannot observe those inboxes.

## Session and authorization

Sign-in uses a fixed first-party OAuth client, the existing authorization-code/PKCE flow and upstream provider callbacks. A ten-minute browser-bound pending login is consumed once. Sessions contain only verified identity in the private OAuth state store; opaque cookie handles are stored hashed. Production cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite=Lax. No access/refresh token reaches the browser; the temporary refresh token is deleted during login.

Sessions expire after one hour and survive host replacement through Postgres. Every API request checks the enabled provider, exact tenant, registered Brain and current grants. Downgrade or revocation applies without waiting for sign-out. Logout requires same-origin POST and invalidates the stored session. Monitoring sessions cannot authorize MCP, access administration, Graph mutations or local maintenance.

## Failure and resource behavior

Status has no cross-request cache. Failed reads clear the dashboard and show unavailable; they never reuse a previous green result. Missing sessions return 401, denied access 403, bad login 400, temporary failure 503, and excess login attempts 429. Error bodies contain fixed sanitized messages. Responses are no-store with a restrictive same-origin CSP.

The server admits at most four concurrent monitoring reads per process, with a dedicated pool capped at two connections and five-second statement/query timeouts. Login admission is capped at 30 attempts per minute per process. The browser refreshes once per minute while visible. These bounds are not a certified whole-service capacity limit.

Set `BRAIN_MONITORING_ENABLED=0` to disable this surface. Existing private `oauth_states` storage is reused, with no schema migration or public grants. Public `/health` retains its existing response contract.

## Verification

`test/monitoring.test.mjs` covers session binding, expiry, replay, logout, provider/tenant/Brain isolation, mutable role checks, sanitization and admission. `test/monitoring-postgres.test.mjs` runs against the explicit disposable loopback Postgres fixture to verify durable sessions and real grants/revocation. `test/monitor-change-log.test.mjs` covers filtering, pagination, legacy receipts, link scoping, diff correctness/limits and HTTP authorization/failure behavior. `e2e/monitoring.playwright.mjs` and `e2e/brain-change.playwright.mjs` check desktop/narrow layouts in both themes, list-to-diff navigation, search, exact snapshots, role redaction and failure clearing.

After the guarded release, verify the live shell/assets, unauthenticated API refusal and ordinary existing-provider sign-in. Record any remaining identity-provider journey separately; fixture success is not evidence of a completed live colleague journey. Installed MCP client acceptance and the company rollout hold remain separate.
