# 021 — Authenticated colleague monitoring

**Status:** implemented; release verification in progress — John approved 2026-09-11
**Source:** monitoring design in `docs/production-engineering-followthrough.md`
**Decisions impact:** monitoring uses current Brain identity/roles without distributing database credentials

## Contract

Serve `/monitor` from the hosted service, with a separate browser session and existing GitHub/Entra sign-in. Readers/Curators see version, service availability and observed sync freshness; Admins/Owners additionally see sanitized aggregate diagnostics. Check exact current Brain/tenant grants on every response. No monitoring session confers MCP write, Graph administration or local filesystem authority. A local inbox remains unobserved from the hosted page.

Use the existing authorization-code/PKCE flow as a first-party client with a fixed same-origin callback. Keep pending-login state and hashed opaque sessions in the private OAuth state store, with bounded TTL, browser binding, no browser-visible bearer/refresh tokens, explicit logout and fail-closed storage errors. Never add provider consent, change existing grants or reuse the Graph-bearing Owner session. Runtime sessions survive host replacement through the existing Postgres state provider.

Reads are bounded and uncached across requests/roles. Query failures show unavailable rather than old success. Public health gains no private diagnostics. Add a hosted-monitor link to the local Cockpit/Monitor; local supervision is unchanged. Support browser-only use with no local installation.

## Acceptance

Test login state binding, PKCE, one-time code/callback, cookie expiry/logout, disabled provider, wrong tenant/Brain, same-session downgrade/revocation, Reader redaction, sanitized errors, unknown/stale heartbeat, bounded query admission and browser desktop/mobile in light/dark. Verify both identity-provider routes using isolated fixtures, then the guarded personal-first/company-second release path and live read-only health. Keep the company rollout hold.

## Exclusions

Native OAuth/token storage, app signing/updater, a new sync transport, provider permission expansion and ingestion UI are separate work.
