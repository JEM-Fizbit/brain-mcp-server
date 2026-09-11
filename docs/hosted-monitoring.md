# Hosted Brain monitoring

**Version:** 1.0 — 11 September 2026
**Release:** v1.10.0; see the owner-specific deployment record for live verification

Open the Brain endpoint followed by `/monitor`, then sign in with the existing enabled GitHub or company identity. The browser is sufficient: no app, database credential, Fly access or local Brain folder is needed. Cockpit and Brain Monitor also link to this page for their selected profile.

Readers and Curators see the deployed version, service availability, latest configured operator sync heartbeat and whether attention is required. Admins and Owners additionally see aggregate conflicts, operation failures, successful-operation p95 and authentication-event counts. Diagnostics use the latest 1,000 matching events within 24 hours, so they are a bounded sample. No source bytes, filenames, individual actors or raw error text are returned.

The heartbeat is per Brain, not per colleague or device. A recent heartbeat shows observed operator activity, not proof that every local copy is synchronized. Five minutes without a heartbeat is stale; missing or invalid observations are unknown. Manual local inbox access remains independent of MCP roles. The hosted viewer explicitly cannot observe those inboxes.

## Session and authorization

Sign-in uses a fixed first-party OAuth client, the existing authorization-code/PKCE flow and upstream provider callbacks. A ten-minute browser-bound pending login is consumed once. Sessions contain only verified identity in the private OAuth state store; opaque cookie handles are stored hashed. Production cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite=Lax. No access/refresh token reaches the browser; the temporary refresh token is deleted during login.

Sessions expire after one hour and survive host replacement through Postgres. Every API request checks the enabled provider, exact tenant, registered Brain and current grants. Downgrade or revocation applies without waiting for sign-out. Logout requires same-origin POST and invalidates the stored session. Monitoring sessions cannot authorize MCP, access administration, Graph mutations or local maintenance.

## Failure and resource behavior

Status has no cross-request cache. Failed reads clear the dashboard and show unavailable; they never reuse a previous green result. Missing sessions return 401, denied access 403, bad login 400, temporary failure 503, and excess login attempts 429. Error bodies contain fixed sanitized messages. Responses are no-store with a restrictive same-origin CSP.

The server admits at most four concurrent monitoring reads per process, with a dedicated pool capped at two connections and five-second statement/query timeouts. Login admission is capped at 30 attempts per minute per process. The browser refreshes once per minute while visible. These bounds are not a certified whole-service capacity limit.

Set `BRAIN_MONITORING_ENABLED=0` to disable this surface. Existing private `oauth_states` storage is reused, with no schema migration or public grants. Public `/health` retains its existing response contract.

## Verification

`test/monitoring.test.mjs` covers session binding, expiry, replay, logout, provider/tenant/Brain isolation, mutable role checks, sanitization and admission. `test/monitoring-postgres.test.mjs` runs against the explicit disposable loopback Postgres fixture to verify durable sessions and real grants/revocation. `e2e/monitoring.playwright.mjs` checks desktop/narrow layouts in both themes, role redaction and failure clearing.

After the guarded release, verify the live shell/assets, unauthenticated API refusal and ordinary existing-provider sign-in. Record any remaining identity-provider journey separately; fixture success is not evidence of a completed live colleague journey. Installed MCP client acceptance and the company rollout hold remain separate.
