# Protocol — Remote MCP Service Pattern (cloud-hosted MCP server with MCP-spec OAuth 2.1)

> Reusable canonical pattern for building a cloud-hosted MCP server with full MCP-spec OAuth 2.1 authorization. Extracted 2026-05-15 from the [slack-mcp-server](https://github.com/JEM-Fizbit/slack-mcp-server) reference implementation (v0.4.1, ~13-15 hours operator+LLM build time across 2026-05-08 to 2026-05-15). Designed so the next MCP server build (planned ERS Brain MCP, JEM Brain Platform, any future service) lifts the auth + transport + attribution layers wholesale rather than re-deriving from spec.

**Last Updated:** 2026-07-03
**Version:** 1.7
**Status:** v1.7 — folds in the stale-connector-downgrade classification pattern proven on brain-mcp-server (conservative benign-case downgrade shared between health check and alerter); corrects the slack-mcp-server reference implementation description (ported to Cloudflare Workers at v0.5.0, now v0.8.5+, file inventory below is v0.4.1-era); points to the new `MCP_SERVER_OPERATIONAL_TELEMETRY.md` protocol for the general (non-auth) telemetry shape; retires a stale forward-pointer to a superseded roadmap doc. (v1.6 added the OpenAI operator-facing recovery companion protocol for ChatGPT/Codex connector state after hosted MCP updates. v1.5 added brokered-DCR recovery lessons from ChatGPT hosted Brain enrollment.)

**Reference implementations:**
- [`~/Projects/slack-mcp-server/`](https://github.com/JEM-Fizbit/slack-mcp-server) — originally a standalone always-on Node process behind a Cloudflare tunnel (v0.4.1, the version this protocol was extracted from); **ported to Cloudflare Workers at v0.5.0** (2026-05-15, LaunchAgent + named tunnel decommissioned) and now at **v0.8.5+**. Production at `https://slack.ersgenomics.online/`. Treat the file-inventory and effort estimates below as v0.4.1-era; re-derive from the Workers-era layout before reusing verbatim.
- `~/Projects/Social-Creator-Claude/` (2026-06-10) — **embedded in an existing Next.js app on Vercel**; production at `https://social-creator-claude.vercel.app/api/mcp`. See § Serverless/embedded variant. Spec doc: `Social-Creator-Claude/docs/specs/008-remote-mcp-server.md`.
- `~/Projects/brain-mcp-server/` (2026-06-23, tool surface current as of 2026-07-03) — **hosted Brain MCP on Fly.io** with GitHub OAuth, Supabase Postgres for Brain data + operational telemetry + durable OAuth state + real-time auth-failure alerting; now multi-tenant (`brain_id` param, `BrainStore` abstraction, semantic search, sync/conflict tools — see `CLAUDE.md` "Brain Platform" section for the current tool list); production at `https://jem-brain-mcp.fly.dev/mcp`.

All reference implementations are spec-compliant per the [MCP 2025-06-18 authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) plus RFCs 7591 / 7636 / 8252 / 8414 / 8707 / 9728.

---

## When to use this pattern

You're building an MCP server that needs to be reachable from MCP clients (Claude Code CLI, Claude Code Desktop, Cowork, Chat Desktop, claude.ai web, claude.ai mobile) **with per-user attribution** and **without per-machine installation overhead**. Examples:

- A Slack/Teams/Discord bot exposed as an MCP tool surface for ops notifications and approvals (the slack-mcp-server case)
- A team-shared Brain MCP serving a knowledge base to multiple users with per-user identity attribution
- An internal-business-process MCP (CRM access, invoicing, document workflows) where the same server serves many users with their own permissions

**Don't use this pattern** for single-user MCPs that can stay stdio (no multi-user attribution needed, no Class C reach needed, no remote hosting needed). Plain stdio via Claude Code's `mcp add` is simpler and right for those cases.

---

## Architecture

```
                  ┌──────────────────────┐
   Class A    →   │  Code CLI / Desktop  │   reads ~/.claude.json (user scope, HTTP MCP entry)
                  └──────────┬───────────┘
   Class B    →   ┌──────────▼──────────┐   inherits broker-managed connector under UUID namespace
                  │  Cowork (Desktop)   │
                  └──────────┬───────────┘
   Class C    →   ┌──────────▼──────────┐   Anthropic broker brokers OAuth + relays MCP JSON-RPC
                  │  Chat Desktop /     │
                  │  claude.ai web /    │
                  │  claude.ai mobile   │
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │ Cloudflare named     │   stable public URL; host-portable; survives migration
                  │ tunnel               │
                  └──────────┬───────────┘
                             │
              ┌──────────────▼──────────────────┐
              │ Node HTTP server (LaunchAgent / │
              │ systemd persistence)            │
              │ ┌─────────────────────────────┐ │
              │ │ MCP transport: POST /mcp    │ │   JSON-RPC over HTTP; 8-tool registry; stateless
              │ │ OAuth 2.1 provider:         │ │
              │ │   GET  /.well-known/*       │ │   RFC 9728 + RFC 8414 metadata
              │ │   POST /register            │ │   RFC 7591 DCR
              │ │   GET  /authorize           │ │   OAuth 2.1 §3.1 consent UI
              │ │   POST /authorize/email     │ │   IdP lookup + OTP delivery
              │ │   POST /authorize/verify    │ │   OTP verification → auth code
              │ │   POST /token               │ │   PKCE + audience binding → JWT
              │ │ Health: GET /health         │ │
              │ └─────────────────────────────┘ │
              │ OAuth state store: clients,     │
              │ auth_codes, refresh_tokens,     │
              │ sessions, otps                  │
              └─────────────────────────────────┘
```

Single process serving three concerns (Slack interactivity / approval webhook + MCP server + OAuth provider) is workable for low-scale use. Split when traffic warrants.

---

## Required MCP-spec endpoints

Per the [MCP 2025-06-18 authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), the server MUST implement:

| Endpoint | Method | Spec | Purpose |
|---|---|---|---|
| `/.well-known/oauth-protected-resource[/<path>]` | GET | [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) | Resource server metadata; advertises authorization server location, supported scopes, bearer methods. RFC 9728 §3.1: path component appended to well-known URI (e.g., `/.well-known/oauth-protected-resource/mcp` for resource `https://x/mcp`). |
| `/.well-known/oauth-authorization-server` | GET | [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) | Authorization server metadata; advertises endpoints (authorization, token, registration), supported grants, PKCE methods, scopes. |
| `/register` | POST | [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) | Dynamic Client Registration. Anthropic's broker calls this to mint a `client_id` for each enrollment. |
| `/authorize` | GET | OAuth 2.1 §3.1 | Consent UI entry point. Validates `client_id` + `redirect_uri` + PKCE challenge + `resource` parameter. |
| `/token` | POST | OAuth 2.1 §3.2 | Exchange authorization code (+ PKCE verifier) for access_token + refresh_token. Validates audience binding (RFC 8707). |
| `/mcp` | POST | [MCP 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18) | The MCP resource itself. Validates Bearer JWT (signature, audience, expiry) before dispatching. |

### Required spec behaviors

- **WWW-Authenticate on 401 from `/mcp`** (RFC 9728 §5.1):
  ```
  WWW-Authenticate: Bearer realm="<RESOURCE_URI>", resource_metadata="<absolute URL to .well-known/oauth-protected-resource/...>", error="invalid_token", error_description="..."
  ```
  This is how the client discovers the OAuth flow.

- **PKCE-S256 mandatory** (OAuth 2.1 §7.5.2): reject `plain`; only accept `S256` at `/authorize`. Verify code_verifier matches challenge at `/token`. Verifier is 43-128 chars from `[A-Z a-z 0-9 -._~]`; challenge is 43-char unpadded base64url of SHA-256(verifier).

- **Resource parameter (RFC 8707)** at `/authorize` and `/token`: explicit binding between issued token and target MCP server URI. Validate the `resource` parameter matches the canonical server URI byte-exact (after lowercasing scheme + host). Reject if not. Embed as `aud` claim in JWT.

- **Token audience validation at `/mcp`**: every request validates the JWT `aud` claim matches the canonical resource URI. Reject (401) if not — this is the confused-deputy mitigation per RFC 8707.

- **Redirect URI validation** at `/register` and `/authorize`: exact-match against the client's registered redirect URIs. Two URI shapes you MUST accept:

  | Shape | For | Why |
  |---|---|---|
  | `https://claude.ai/api/mcp/auth_callback` | Anthropic broker (Class C surfaces — Chat Desktop, claude.ai web/mobile) | The broker uses this exact callback URL; exact-match enforced per OAuth 2.1 §3.1.2.4 |
  | `https://chatgpt.com/connector/oauth/<callback-id>` plus documented legacy ChatGPT callback URLs | OpenAI / ChatGPT MCP app broker | ChatGPT can mint connector-specific callback IDs; accept the documented path class by narrow pattern (HTTPS, exact host, no query/fragment, one callback-id segment) rather than per-app secret churn |
  | `http://(localhost\|127.0.0.1):<port>/<path>` | RFC 8252 §7.3 native-app clients (Class A — Code CLI, Code Desktop, any CLI/desktop OAuth client) | Loopback redirect with ephemeral port — OAuth 2.1 §3.1.2.3 mandates accepting "any port" on loopback |

  **The single most-painful "we tested only one and the other was broken" trap.** Test plan MUST exercise every broker callback class and loopback native clients. See § Test coverage matrix below.

- **Short-lived access tokens + rotating refresh tokens** (OAuth 2.1 §4.3.1): 1-hour access token TTL is reasonable for ERS-scale; refresh tokens rotate on use (issue new refresh + invalidate old). Reject stale-token reuse by default, but allow a short same-client/same-resource grace window for duplicate refresh attempts caused by cloud-synced desktop/web/mobile clients.

- **HTTPS only**: All auth endpoints + MCP transport must be HTTPS. Cloudflare named tunnel handles TLS termination.

---

## User auth at /authorize — pick an IdP

`/authorize` needs a way to authenticate the human end-user (the "resource owner" in OAuth terms). Pick based on what's operationally cheapest for your team:

| Strategy | Effort | Best for |
|---|---|---|
| **Slack-DM OTP via existing bot** | Low (~2 hr if bot exists) | Teams already on Slack; bot is already operationally trusted (the slack-mcp-server pattern). Required scopes: `chat:write` + `im:write` + `users:read.email`. |
| **Email OTP** | Medium (~3 hr) — needs SMTP | Teams without a chat tool; offline-ish workflows. |
| **GitHub OAuth federation** | Medium (~3-4 hr) | Personal-scope MCPs (e.g., JEM Brain). Federates to GitHub identity; reuses Brain repo's auth surface. |
| **Microsoft Entra ID / Azure AD federation** | Higher (~4-6 hr) | Enterprise teams already on M365 (e.g., ERS Brain MCP). Requires Entra app registration + admin consent for needed Graph scopes. |
| **Google Workspace federation** | Similar to Entra (~4-6 hr) | Teams on Google Workspace. |

### IdP scope-add-before-deploy — check scope-per-method, NOT by inference

Concrete example from the slack-mcp-server build: `users.lookupByEmail` requires Slack scope `users:read.email`, NOT just `users:read`. We had `users:read`. Synthetic dev test would have skipped this. **Check the documented scope for each specific API method you'll call, do NOT infer from related methods, and add scope-add + workspace-reinstall (or admin-consent for Entra/Google) as a sprint plan item.**

### Identity discovery — let the IdP be authoritative, don't maintain a roster

The first cut of slack-mcp-server (v0.3.x) maintained a manual `users.json` roster: operator edits SharePoint file + syncs local mirror per new user enrollment. v0.4.0 replaced this with the IdP's own user lookup (Slack `users.lookupByEmail`). **Trust boundary collapsed from "operator-curated roster" to "IdP workspace membership"** — single source of truth, no drift, zero per-user operator touch in onboarding.

When the IdP can answer "is this email a valid user, and what's their identity?", let it. Keep a manual override file as optional fallback for edge cases (deactivated-but-not-yet-removed users, emergency overrides during IdP outage, test fixtures).

---

## JWT design — identity claims at issue time

Sign access tokens as JWTs with these claims:

```js
{
  // Standard OAuth 2.1 / OIDC claims
  iss,           // authorization server URL
  aud,           // canonical resource URI (RFC 8707 audience)
  sub,           // user identifier (email, GitHub login, Entra UPN — pick one)
  client_id,     // DCR client_id
  scope,         // space-separated scope string
  iat, exp, jti, // standard

  // Identity claims — embedded at issue time, NOT looked up runtime
  name,          // OIDC standard claim — display name from IdP
  <idp_user_id>, // your IdP's primary key (slack_user_id, github_id, entra_object_id)
  // ... any other attributes the resource server needs for tool dispatch / attribution
}
```

**Why embed identity at issue time, not look up runtime:** the resource server (`/mcp` handler) reads identity from JWT claims directly — no per-tool-call IdP API request. Saves runtime latency, removes a runtime dependency surface, and reduces IdP rate-limit pressure. This was the v0.4.0 redesign and is non-negotiable for the pattern.

**Refresh-token records** in the state store should also carry the identity attributes — on rotation, the new access token carries the same identity without re-hitting the IdP. **Back-compat backfill** path: if a refresh-token record is missing identity attributes (pre-v0.4.0 refresh tokens after a migration), do one IdP lookup on first refresh and backfill into the new refresh record.

### HS256 vs RS256

| Algorithm | When to use |
|---|---|
| **HS256** (HMAC-SHA-256) | Single-tenant; resource server and authorization server are the same process (or share a secret). Default for reference-implementation simplicity. Signing secret stashed in macOS Keychain (or HSM-equivalent on Linux). |
| **RS256** (RSA-SHA-256) | Multi-consumer; external services need to verify JWTs without sharing the signing key. Adds a `GET /.well-known/jwks.json` endpoint exposing the public key. Required if a SECOND MCP server (e.g., a Brain MCP) wants to trust JWTs issued by this one for cross-server federation. |

Default: ship HS256 v1; migrate to RS256 + JWKS endpoint when external consumers materialize. Mechanical change, not architectural.

---

## State storage

Five state stores. For local development, prototypes, or a single always-on host with disposable clients, file-backed JSON can work. For any cloud-hosted connector enrolled through a third-party broker, treat OAuth state as durable production state from day one: losing DCR clients or refresh-token hashes strands enrolled clients, and the client may fail silently instead of showing a useful reconnect prompt.

Use a durable store such as Postgres or SQLite for hosted production. On Supabase, keep it in a private schema, use runtime-only grants/policies, and do not grant `anon`, `authenticated`, or `public` access. File-backed stores may remain as a local fallback or migration bootstrap, but they should not be the canonical state for broker-enrolled production connectors on ephemeral platforms.

| Store | Lifetime | Purpose | Key |
|---|---|---|---|
| `clients` | Long-lived | DCR registrations. One row per `POST /register` call. | `client_id` |
| `auth_codes` | 10 min, single-use | Authorization codes pending exchange at `/token`. Atomic check-and-delete pattern (consume-once). | code value |
| `refresh_tokens` | 30 days, rotating | Refresh tokens for issuing new access tokens. Hashed at rest (SHA-256). Rotation per OAuth 2.1 §4.3.1, with optional 10-30s same-client/same-resource reuse grace for client refresh races. | hash of token |
| `sessions` | 10 min | Short-lived OAuth flow state during the consent UI. Captures user identity post-`/authorize/email` for use at `/authorize/verify`. | random session_id |
| `otps` | 5 min, 3-attempt cap | OTP records keyed by session. Hashed at rest. | session_id |

File-backed implementations need atomic-ish writes (`.tmp` + rename) plus per-file write mutex to serialize concurrent updates. Durable DB implementations need atomic consume-once operations for auth codes and refresh rotation. Lazy expiry sweep on read is fine at low scale; add scheduled cleanup only when stale rows become operationally noisy.

### Hosted OAuth state migration rules

- If refresh tokens were stored only as hashes, assume existing client sessions cannot be server-migrated perfectly. Plan a one-time re-enrollment per affected Anthropic/OpenAI/Claude account when moving from file-backed state to DB-backed state.
- Keep the signing secret stable during the storage migration unless the intent is to force every access token to expire immediately.
- Verify the post-migration state store by registering a new client, completing consent, refreshing once, and making a real `/mcp` tool call through the broker.
- Do not store raw refresh tokens to make duplicate refreshes idempotent. Use a bounded reuse-grace record keyed by old hash, client, resource, and successor token metadata.
- Record an intended state-invalidating migration (forced re-enrollment, refresh-token reset) as an operational event — a `DECISIONS.md` entry and/or a deploy note — so the resulting `invalid_client`/re-auth spike is attributable, not mistaken for a fresh incident. This matters most when the same deploy *introduces* the auth-failure telemetry, which leaves the spike no pre-migration baseline.
- Confirm durability survives a redeploy: once state is DB-backed, a routine redeploy / machine replacement should produce **zero** new `invalid_client` events — existing connectors keep working. If a redeploy still strands clients, the state is not actually durable.
- Treat `unknown_client_id` at `/token` as a specific diagnostic, not a generic OAuth failure. Check the durable `clients` store for a matching DCR registration. If there is no matching row and no fresh `/register` record appears during a reconnect attempt, the broker is still holding stale client state. The practical remediation is full connector/app removal and reinstall/recreate so the broker performs Dynamic Client Registration again; simple "Reconnect" or re-auth may keep reusing the stale client id.
- Post-recovery verification must prove all four links: the server accepts the broker callback class; a fresh DCR `clients` row exists for that broker/account; token exchange succeeds; a real `/mcp` tool call works with no fresh `unknown_client_id` auth events.

### Auth-failure telemetry

The RFC-required `401` + `WWW-Authenticate` response from `/mcp` is necessary but not sufficient. Brokered clients may not show a reconnect prompt, especially on mobile or when account-level connector state is stale. Record metadata-only auth failures to the existing operational telemetry store so the operator can see that the connector is failing before a tool handler runs.

Capture: failure reason (`missing_bearer`, `invalid_token`, `expired_token`, `unknown_client`, `invalid_refresh`, `refresh_reuse_outside_grace`), endpoint, HTTP status, client id hash or safe client label, surface/source when available, and timestamp.

Never capture: access tokens, refresh tokens, Authorization headers, client secrets, PKCE verifiers, raw request bodies, Brain/tool payloads, SQL text, SQL parameters, or user content.

Surface auth failures near the operation log, but keep them separate from normal latency averages unless the timing layer is explicit. They are availability signals first, not user-tool latency samples.

### Close the loop: telemetry → health check → alert

Recording auth-failure telemetry is necessary but not sufficient. Telemetry that is written and *displayed* but wired into no health verdict and no notification is a silent blind spot. The failure mode (observed on brain-mcp-server, 2026-06-23): a persistent OAuth failure ran for hours while the operator cockpit showed the errors in its log, yet the health check stayed green and nothing alerted. Wire auth failures into BOTH:

1. **a health check** whose verdict the operator surface's overall pass/warn/fail actually consults (not just a passive log panel) — count failures in a trailing window and return warn/fail against thresholds; and
2. **an alert path** that pushes when a sustained-failure threshold is crossed.

**Downgrade the benign case instead of alert-fatiguing on it.** A common post-migration/post-cutover pattern is a single *unregistered* client looping the same failure reason (e.g. `unknown_client_id` on a `refresh_token` grant) past a grace window — a stale client the user has already abandoned, not an active incident. Classify failures into a `connectorState` (e.g. `stale` vs `active`) and downgrade `stale` from `fail` to `warn` in both the health check's verdict and the alert severity, gated by a grace period (e.g. `*_STALE_GRACE_MINUTES`, default ~10 min) measured from first-seen. **Keep the downgrade conservative** — any ambiguity (multiple distinct clients, multiple failure reasons, an unknown/unregistered-clients set, or a short burst that hasn't run past the grace window) must keep full severity. Share the exact same classification function between the health check and the alerter so their verdicts never disagree. Reference implementation: brain-mcp-server's `computeStaleConnector` (`src/services/auth-alert.ts`), consumed by both the `hosted_mcp_auth_failures` doctor check and the alert dispatcher.

### Real-time alerting from the hosted process

When the threshold is crossed, post an alert from the server itself (e.g., Slack `chat.postMessage` with a bot token, or a webhook). Make it:

- **best-effort and non-blocking** — fire-and-forget off the telemetry write; never add latency to, or throw into, the auth path;
- **gated on a token/config** — a no-op when unset, so local/dev and tests stay hermetic and a broken alert config cannot regress the server;
- **sanitized** — the same allow-list as the telemetry (reason codes, HTTP status, counts only; never tokens/headers/bodies);
- **severity-routed** — e.g., warn → a shared ops channel, fail → an operator DM;
- **throttled by a per-severity cooldown**, with dispatch state in the same telemetry store (no new datastore); make the cooldown per-severity so a worsening warn→fail still escalates immediately.

**Gotcha — serialize the cooldown.** Auth failures arrive concurrently and each fires its own fire-and-forget evaluation. A naive cooldown that reads "was a recent alert sent?" then writes a dispatch row is a check-then-act race: in a burst, every evaluation reads "no recent alert" before any writes, so they all fire and the cooldown fails for exactly the burst it exists to throttle. Serialize evaluations — an in-process mutex on a single-instance host, or an atomic DB claim if multi-instance. This class of bug is invisible to serial unit tests; a live concurrent smoke test (fire N parallel failures, assert exactly one dispatch row) is what catches it.

---

## Test coverage matrix — what MUST be tested before declaring done

Build sprint MUST exercise BOTH server-side curl tests AND each of the live broker-mediated surfaces. Synthetic tests alone leave RFC 8252 loopback and IdP-scope gaps latent.

### Server-side (curl-level, RFC compliance proof)

```bash
# Metadata endpoints
curl -s https://<server>/.well-known/oauth-protected-resource/<path> | jq
curl -s https://<server>/.well-known/oauth-authorization-server | jq

# /mcp without auth returns 401 + WWW-Authenticate
curl -i -X POST https://<server>/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
# Verify: 401, header includes resource_metadata="...", error="invalid_token"

# DCR with allowed redirect_uri
curl -s -X POST https://<server>/register -H "Content-Type: application/json" \
  -d '{"client_name":"test","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}'

# DCR with ChatGPT connector callback class, if supporting ChatGPT/OpenAI apps — MUST succeed
curl -s -X POST https://<server>/register -H "Content-Type: application/json" \
  -d '{"client_name":"chatgpt-test","redirect_uris":["https://chatgpt.com/connector/oauth/probe"]}'

# DCR with loopback (RFC 8252) — MUST succeed
curl -s -X POST https://<server>/register -H "Content-Type: application/json" \
  -d '{"client_name":"cli-test","redirect_uris":["http://localhost:49604/callback"]}'

# DCR with disallowed redirect — MUST reject
curl -s -X POST https://<server>/register -H "Content-Type: application/json" \
  -d '{"client_name":"evil","redirect_uris":["https://evil.example/cb"]}'
# Verify: 400, error="invalid_redirect_uri"

# /authorize parameter validation — bad PKCE method, bad resource, etc.
# /token: PKCE failure, code reuse, refresh rotation, audience mismatch
# (full set in the slack-mcp-server reference implementation's test script)
```

### Live third-party API exercise (catches IdP scope gaps before deploy)

```bash
# For Slack-based IdP — exercise users.lookupByEmail directly with the bot token
curl -s "https://slack.com/api/users.lookupByEmail?email=<test-user>" \
  -H "Authorization: Bearer $BOT_TOKEN" | jq

# For GitHub-based IdP — exercise the user lookup via GitHub API
# For Entra-based IdP — exercise /users via Microsoft Graph
# etc.
```

**Do not skip this step.** Synthetic auth_code injection on a dev port can prove JWT issuance + `/mcp` consumption end-to-end without ever calling the real IdP. That's the gap where production-deploy bugs hide.

### Cross-surface verification matrix (the "we only tested one" trap)

Verify the connector works from each Claude surface. Don't infer from one to another — each has different reach mechanisms.

| Surface | Class | Verify by |
|---|---|---|
| Code CLI (Terminal `claude`) | A | `claude mcp add --transport http --scope user <name> <URL>` → fresh `claude` session → `/mcp` → Authenticate → smoke-test a tool call. **This is the RFC 8252 loopback path — most likely to reveal redirect-URI-validation bugs.** |
| Code Desktop (Claude Code in Desktop form) | A | Shares `~/.claude.json` user-scope config with CLI; should auto-list under friendly name `mcp__<name>__*`. Also inherits broker-mediated connector under UUID namespace `mcp__<uuid>__*`. Dual-path. |
| Cowork Desktop | B | Inherits broker-mediated connector under UUID namespace ONLY (not the friendly name). Tool spec for routine authors should pin to UUID namespace when writing for Cowork. |
| Chat Desktop | C | Anthropic broker-mediated. Custom connector add via Claude Desktop → Customize → Connectors → Add. Walks OAuth in browser. |
| claude.ai web | C | Inherits Class C connector state from same Anthropic account — usually auto-listed once enrolled on any Class C surface. |
| claude.ai mobile | C | Inherits Class C state. Known mobile pitfall: when a user-OAuth alternative connector is present, mobile may route "Slack" to that instead of your custom connector — pin to your specific tool namespace when probing. |

Each surface MUST be verified with a real probe (Slack post / GitHub action / whatever your tools do) cross-checked for the expected identity in the resulting artifact. See slack-mcp-server's verification matrix in [ROADMAP.md § Full verification suite passed](https://github.com/JEM-Fizbit/slack-mcp-server/blob/main/ROADMAP.md) for the exact pattern.

After OAuth storage, signing, refresh-token, redirect URI, or broker-registration changes, do not infer one surface from another. Verify at least one real tool call from every active account/surface class in use, including mobile if mobile is an expected client. Record the date, account, surface, and tool result in the project runbook or roadmap. If the state store changed from ephemeral/file-backed to durable DB-backed state, expect and document one re-enrollment per affected account.

---

## Operational pitfalls discovered

Empirically encountered during the slack-mcp-server build (2026-05-08 to 2026-05-15). Each is undocumented in obvious places; future builds should expect to encounter at least one and budget accordingly.

### Anthropic org-Connectors UI doesn't expose rename-in-place

To rename a connector you delete and re-add. **However**, if the new entry uses the same URL, the broker recognizes it and auto-resumes user OAuth state across Class C surfaces — no per-user re-consent needed. Verified 2026-05-15 with the slack-mcp-server `claude-jembot-remote` → `slack-claude-jembot` rename. Useful: iterate connector names freely during build.

### Cowork namespaces broker-mediated connectors by UUID, not friendly name

The connector that shows in claude.ai as "your friendly name" surfaces in Cowork as `mcp__<connector-uuid>__*`. Code Desktop is dual-path (sees both friendly + UUID). Code CLI sees only the friendly name (from `~/.claude.json`). When writing routine instructions that target a specific tool in Cowork, pin to the UUID namespace OR generic tool name without forcing a specific MCP prefix.

### Claude Desktop's "Customize → Connectors" is NOT the same as "Developer settings → Local MCP servers"

Two separate UIs for two separate connector classes:
- **Customize → Connectors:** for cloud / Class C custom remote MCP connectors (what this protocol is about)
- **Developer settings → Local MCP servers:** for local stdio MCPs registered in `claude_desktop_config.json`

To remove a local stdio MCP durably, you must remove it via the Developer settings UI — NOT just edit `claude_desktop_config.json` (Claude Desktop rewrites the file on quit from its in-memory connector store, restoring deleted entries).

### Session-cached MCP connections persist until restart

Removing a registration from `~/.claude.json` or `claude_desktop_config.json` doesn't kill in-flight MCP sessions — they hold their child-process or HTTP connection until the Claude session restarts. Test "is it really gone" only from a fresh post-restart session.

### Anthropic stores connector OAuth state at the account level

One OAuth consent flow per Anthropic account unlocks the connector across all of that account's Class C surfaces (Desktop + web + mobile). Saves the "every user re-walks consent on every device" cost. But this means: Class A + B don't inherit — they need their own per-surface registration (CLI via `claude mcp add`; Cowork via account-level inheritance from a different path).

### Ephemeral OAuth state masquerades as a client problem

If the server loses DCR client registrations or refresh-token records, brokered clients can appear connected while tool calls fail or disappear, with no useful reconnect prompt. Mobile may be the first surface where this shows up because it relies heavily on broker/account state. Treat this as a server-side durability and observability issue: move OAuth state to durable storage, add metadata-only auth-failure telemetry, add a short same-client refresh reuse grace, and verify each active surface after re-enrollment.

### Broker "Reconnect" can preserve stale DCR client state

Some brokered clients can keep sending an old `client_id` even after the connector appears installed/connected and even after a user walks an authorization prompt. If `/token` reports `unknown_client_id` and the durable `clients` store has no matching registration, do not keep retrying consent. Full connector/app removal and reinstall/recreate is the recovery path because it forces the broker to perform `POST /register` again. Verify recovery by observing a new durable DCR row and a real tool call, not just by seeing the connector UI say "Connected".

---

## Reference implementation file inventory

slack-mcp-server v0.4.1+ — the canonical source. Lift these wholesale, swap the tool registry + IdP module, point at your service.

| File | Lift as-is | Purpose |
|---|---|---|
| `lib/oauth/config.js` | ✓ — change `PUBLIC_BASE_URL`, `RESOURCE_URI`, `SCOPES`, IdP-specific config | Central constants + redirect URI allowlist + email domain allowlist |
| `lib/oauth/store.js` | ✓ — direct copy | File-backed JSON KV with atomic writes + locks + expiry sweep |
| `lib/oauth/pkce.js` | ✓ — direct copy | RFC 7636 S256 verification |
| `lib/oauth/jwt.js` | ✓ — extend with IdP-specific identity claims | HS256 sign/verify + ID generators |
| `lib/oauth/metadata.js` | ✓ — pure function of config | RFC 9728 + RFC 8414 response builders |
| `lib/oauth/register.js` | ✓ — direct copy (the loopback exception is already there post-v0.3.1) | DCR handler |
| `lib/oauth/authorize.js` | Mostly copy; replace IdP-lookup call in `/authorize/email` handler with your IdP's user-lookup module | Consent UI + email submission + OTP verification |
| `lib/oauth/token.js` | Mostly copy; ensure identity claims flow through session → auth_code → access_token + refresh_token + back-compat backfill | Token issuance + rotation |
| `lib/oauth/identity.js` | Re-implement for your IdP | IdP user lookup wrapper with cache. Slack version in reference; replace with GitHub OAuth (JEM Brain) or Microsoft Graph (ERS Brain) or whichever applies. |
| `lib/oauth/otp.js` | Reuse if Slack-DM OTP; replace if different OTP delivery path | OTP issuance + delivery + verification |
| `lib/mcp-auth.js` | ✓ — direct copy | JWT bearer verification with audience binding + WWW-Authenticate emission |
| `lib/mcp.js` | Replace tool registry + `SERVER_INFO` | MCP JSON-RPC dispatch (the protocol part is reusable; tools are service-specific) |
| `server.js` | Mostly copy; update route table for your service-specific paths beyond /mcp | Top-level router |

Total reusable LOC: ~1100 lines of vanilla Node (no third-party deps, Node 20+ built-ins). Service-specific work (your tool handlers + your IdP integration + your state for tool dispatch) is the additional surface.

---

## Phased build path for a new MCP service

Recommended sprint sequence. Roughly mirrors the slack-mcp-server arc but with the painful lessons pre-resolved.

| Phase | Deliverable | Effort |
|---|---|---|
| **1** | Scope + spec read: read the [MCP 2025-06-18 authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) cover-to-cover; read RFCs 7591 / 7636 / 8252 / 8414 / 8707 / 9728. Spec the IdP integration: list every API method you'll call + its required scopes. Add scopes to the IdP config + reinstall/admin-consent. | ~2-3 hr |
| **2** | Lift the substrate from slack-mcp-server v0.4.1+. Adjust config (URL, resource URI, IdP). Implement service-specific tool registry + handlers in `lib/mcp.js`. Implement service-specific IdP module in `lib/oauth/identity.js`. | ~3-6 hr depending on service complexity |
| **3** | Dev smoke tests on a non-prod port: full server-side curl matrix (each endpoint in isolation). **Plus exercise the real IdP API.** | ~1-2 hr |
| **4** | Set up the Cloudflare named tunnel + LaunchAgent persistence (or your equivalent on Linux). Deploy. | ~1 hr (smaller if reusing existing tunnel infrastructure) |
| **5** | End-to-end cross-surface verification. BOTH Class C broker flow (custom connector add via Claude Desktop) AND Class A CLI loopback (`claude mcp add --transport http --scope user`). Plus Cowork via account-level inheritance. Document the verification matrix in your service's ROADMAP. | ~1-2 hr |
| **6** | Org-level connector registration in Anthropic Teams admin console (delete-and-re-add if rename needed). | ~30 min |
| **7** | Documentation: service-specific README, a small operator runbook for adding a new user, LOG entry. | ~1-2 hr |
| **Total** | | **~10-16 hr** for a service of comparable scope to slack-mcp-server, assuming the reference implementation is lifted. Reference build before substrate existed was ~13-15 hr; lifting cuts substantial time at Phases 2-3 and removes the spec-discovery cost from Phase 1. |

---

## Serverless/embedded variant (second reference: Social-Creator-Claude, 2026-06-10)

When the MCP serves an **existing web app** (its data, its users, its business logic), embed the server in the app instead of standing up a separate process. The OAuth substrate ported ~60–70% as-is (~5 h actual for the auth layer); the deltas:

| Concern | Standalone (slack-mcp-server) | Embedded/serverless (SCC) |
|---|---|---|
| Hosting | Node process + Cloudflare tunnel + LaunchAgent | Route handlers in the app; platform TLS + stable URL; zero new infra |
| Endpoints | `server.js` router | One `route.ts` per endpoint. Dot-folder `app/.well-known/...` **works** in Next.js App Router (verified Next 16, Turbopack dev + Vercel prod) — no rewrites needed |
| State | File-backed JSON stores | One generic Prisma KV table `(store, key, value JSON, expiresAt)`; `consumeOnce` = single-statement `DELETE ... RETURNING` (Prisma `delete()` in try/catch) — the only atomic primitive the pattern needs; lazy expiry sweep on ~1-in-10 writes |
| IdP | Slack-DM OTP (own OTP store) | **The app's own auth.** With Supabase: `signInWithOtp({ shouldCreateUser: false })` + `verifyOtp` — Supabase owns OTP issuance/expiry/attempt limits, so the reference's `otps` store disappears. Enrolment roster = the app's user table (`status === "active"`), not a chat-workspace membership |
| Tool layer | Slack client wrappers | Reuse the app's existing executor functions in-process; **check who enforces ownership** — if the executors assume route-level guards, the MCP layer must apply the same guards (centralize in a context module so a tool can't forget) |
| Revocation | rotate signing secret | Same, PLUS a live roster-status check on every `/mcp` call (deactivating the user kills access despite valid 1h JWTs) |
| Long tools | n/a (Slack calls are fast) | Set the platform's max function duration on `/mcp` (Vercel `maxDuration = 300`); flag long-running tools ("takes 30–90s") in their descriptions |

Empirical gotchas from the SCC build:

- **Supabase email-OTP IdP needs the Magic Link template to include `{{ .Token }}`** — default template only carries `{{ .ConfirmationURL }}`, so the consent page's "enter the code" step has nothing to type. Keeping both placeholders leaves the app's own magic-link login unaffected.
- **Magic-link click stalls the consent flow** — if the user clicks the emailed link instead of typing the code, Supabase consumes the token and signs them into the web app; the OAuth session must be restarted. Put "type the code, don't click the link" copy on the OTP page.
- **`auth.admin.generateLink({ type: "magiclink" })` returns `email_otp`** — lets E2E tests drive the full consent flow without reading email (and without burning SMTP rate limits). Negative-path token tests (PKCE fail, foreign audience) are cheapest via synthetic auth-code injection directly into the state table, since a failed exchange correctly burns a real code (consume-once runs before PKCE verification).
- **Add permissive CORS (`Access-Control-Allow-Origin: *`) + OPTIONS handlers on metadata/register/token** — server-side brokers don't need it, but the browser-based MCP inspector does.
- **`aud` is bound to the public base URL** — a future custom-domain migration invalidates all live tokens (users re-consent). Make the base URL config-driven from day one.

### Email-OTP IdP delivery hardening (the part that actually broke in production)

When the IdP delivers OTPs by email (vs the Slack-DM reference), the email pipeline is the fragile link. All four of these bit during the SCC rollout, after every synthetic test had passed:

1. **Supabase built-in SMTP is rate-limited to ~2 auth emails/hour project-wide.** Enrolment fails with `email rate limit exceeded` the moment a test run and a real user share an hour. **Custom SMTP is a launch prerequisite, not a nice-to-have.** Resend free tier (3k/mo) is the default pick: Supabase Dashboard → Authentication → Emails → SMTP Settings → host `smtp.resend.com`, port `465`, user `resend`, password = Resend API key, sender `onboarding@resend.dev` (sandbox) or `auth@<verified-domain>`. Enabling custom SMTP auto-raises Supabase's limit to 30/h (adjustable further under Auth → Rate Limits).
2. **Resend sandbox only delivers to the Resend account owner's email.** Fine for the operator's own enrolment; a hard stop for the second user. Verify a sending domain (Resend → Domains → add SPF/DKIM DNS records on a domain you own) before multi-user enrolment. The sending domain is unrelated to users' email domains — users on hotmail/gmail receive fine from `auth@yourdomain.com`.
3. **The provider's email template must actually contain the token.** Supabase's default Magic Link template only carries `{{ .ConfirmationURL }}`; add `{{ .Token }}` or the consent page's "enter the code" step has nothing to type. Keep both placeholders — the app's own magic-link login is unaffected.
4. **Don't hard-code the OTP length in the consent form.** Supabase's code length is project-configurable (SCC issues 8 digits; the reference's Slack OTPs were 6). Use `pattern="[0-9]{6,10}" maxlength="10"`. Synthetic tests miss this because they POST the code programmatically — only a human typing into the real form hits the client-side validation.

Register the SMTP provider account in the assets register when you create it, with the sandbox/domain caveat in the Notes column.

## What future versions of this protocol will fold in

The protocol should bump when any of the following land:

- **Phase F: operator-initiated 2-way comms via events webhook** — adds a new endpoint shape (Slack/GitHub/etc events subscription) and conversation-continuity state pattern.
- **RS256 + JWKS endpoint** — if cross-server JWT verification becomes a real need (e.g., a Brain MCP needs to trust JWTs issued by slack-mcp-server for federated tool access).
- **Token revocation endpoint (RFC 7009)** — currently not implemented (rotating the signing secret nukes all live tokens; sufficient at single-tenant scale).
- **Operational scale lessons from > 6 users** — multi-user concurrency, IdP rate limit handling, refresh-token storm patterns.

When any of these land, bump the protocol with the new evidence folded in.

---

## Cross-references

- **Reference implementation:** [`slack-mcp-server`](https://github.com/JEM-Fizbit/slack-mcp-server) (v0.4.1+) — production at `https://slack.ersgenomics.online/`
- **Hosted Brain reference:** `~/Projects/brain-mcp-server/` — production at `https://jem-brain-mcp.fly.dev/mcp`; durable OAuth state and metadata-only auth-failure telemetry backed by Supabase Postgres.
- **Sprint history:** `~/Projects/claude-ops/plans/ers-mcp-oauth-provider/2026-05-14.md` (D-3 OAuth provider sprint + retrospective) + `~/Projects/claude-ops/LOG.md` 2026-05-15 + 2026-05-15 entries
- **Companion operator-facing protocol:** [`SLACK_BOT_REMOTE_MCP_ENROLLMENT.md`](SLACK_BOT_REMOTE_MCP_ENROLLMENT.md) — the per-user enrollment runbook (slack-mcp-server-specific application of this generic pattern)
- **OpenAI operator-facing recovery:** [`OPENAI_MCP_CONNECTOR_RECOVERY.md`](OPENAI_MCP_CONNECTOR_RECOVERY.md) — ChatGPT personal, ChatGPT Business/workspace apps, Codex app/chat, and Codex CLI recovery after hosted MCP OAuth-state, DCR, callback, or tool-surface changes.
- **Brain MCP forward-pointers (these reference this protocol):**
  - `~/Projects/brain-mcp-server/docs/ROADMAP.md` — canonical, current roadmap (the `ai-brain-jem` `PLAN_brain_roadmap.md` this section previously cited is superseded/historical; don't follow it for current status)
  - `01_ers-brain/MIGRATION_PLAN.md` step 6b (ERS Brain MCP, refreshed substrate pointer)
  - `01_ers-brain/docs/ROADMAP.md` § 5 Decisions log 2026-05-15 entry
- **Adjacent ai-knowledge protocols:**
  - [`MCP_SERVER_OPERATIONAL_TELEMETRY.md`](MCP_SERVER_OPERATIONAL_TELEMETRY.md) — general-purpose latency/usage telemetry shape (event-type taxonomy, timing layers, sanitization boundary); this protocol's § Auth-failure telemetry is the auth-specific slice of that broader pattern
  - [`SLACK_OPS_NOTIFICATION.md`](SLACK_OPS_NOTIFICATION.md) v2.5 § Roadmap (cross-cutting phase ledger that this protocol's reference implementation lives within)
  - [`SLACK_BOT_PROVISIONING.md`](SLACK_BOT_PROVISIONING.md) (Slack-app-specific setup, prerequisite for the slack-mcp-server reference)
  - [`SLACK_BOT_PERSISTENCE.md`](SLACK_BOT_PERSISTENCE.md) (LaunchAgent + named tunnel pattern, prerequisite for any always-on remote MCP server)
  - [`SLACK_APPROVALS_FOR_AI_WORKFLOWS.md`](SLACK_APPROVALS_FOR_AI_WORKFLOWS.md) (Block Kit approval-card pattern, which the same server can co-host)
  - [`CLAUDE_DOC_DRIFT_NOTES.md`](CLAUDE_DOC_DRIFT_NOTES.md) DD-002 (Cloudflare/Anthropic auth-shape incompatibility — historical context for WHY this OAuth-provider pattern exists rather than a Cloudflare-Access-mediated one)

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.7 | 2026-07-03 | Stale-connector-downgrade classification pattern (conservative benign-case downgrade shared between health check and alerter, proven on brain-mcp-server); corrected slack-mcp-server reference description (Cloudflare Workers since v0.5.0, now v0.8.5+); cross-reference to new `MCP_SERVER_OPERATIONAL_TELEMETRY.md` protocol; brain-mcp-server reference bullet updated for its now-shipped multi-tenant/`brain_id`/semantic-search tool surface; retired a forward-pointer to a superseded roadmap doc. |
| 1.6 | 2026-06-25 | Added companion OpenAI MCP connector recovery protocol link. Keeps provider-specific ChatGPT/Codex delete/recreate, workspace-app, fresh-session, and Codex CLI approval procedures out of the architecture pattern while making them discoverable from this canonical MCP protocol. |
| 1.5 | 2026-06-23 | ChatGPT hosted Brain enrollment lesson: accept documented broker callback URI classes by narrow pattern; `unknown_client_id` at `/token` means stale broker-side DCR state when no durable `clients` row exists; recovery is full connector/app removal + reinstall/recreate, followed by verification of DCR row, token exchange, real tool call, and no fresh auth events. |
| 1.4 | 2026-06-23 | Observability-loop and alerting hardening: auth-failure telemetry must feed a health check and an alert path; real-time best-effort alerting from the hosted process with severity routing and serialized per-severity cooldown; intended state-invalidating migrations should be recorded as operational events; durability should be verified across redeploys. |
| 1.3 | 2026-06-23 | Hosted Brain MCP production-hardening: durable OAuth state for broker-enrolled hosted connectors; file-backed state demoted to local/fallback use; migration rule that hashed refresh-token stores may require one-time re-enrollment; short same-client/same-resource refresh reuse grace; metadata-only auth-failure telemetry; explicit per-account/per-surface verification after auth-state changes. |
| 1.2 | 2026-06-10 | Email-OTP IdP delivery hardening (from SCC live rollout): custom SMTP is a launch prerequisite (built-in Supabase SMTP = 2/h project-wide), Resend SMTP config recipe + sandbox-domain limitation + domain-verification note, `{{ .Token }}` template requirement, variable OTP length in the consent form (6–10), register the SMTP account in the assets register. |
| 1.1 | 2026-06-10 | Second reference implementation: Social-Creator-Claude embedded/serverless variant (Next.js on Vercel). New § Serverless/embedded variant — Prisma KV state with DELETE-as-consumeOnce, app-auth-as-IdP (Supabase email OTP, `shouldCreateUser:false`, `{{ .Token }}` template gotcha, magic-link-click stall, `generateLink` E2E trick), dot-folder `.well-known` works in Next App Router, CORS for browser inspector, live roster-status revocation check, in-process tool-layer ownership guards. |
| 1.0 | 2026-05-15 | Initial extraction from slack-mcp-server v0.4.1. Captures the canonical architecture, required spec endpoints, two redirect-URI shapes (Anthropic broker exact + RFC 8252 loopback), IdP-pick + scope-add-before-deploy + identity-claims-in-JWT + Slack-API-driven user discovery + dev-smoke-must-exercise-real-IdP lessons, file-backed state pattern, test coverage matrix, six operational pitfalls (rename-via-delete-re-add preserves OAuth, Cowork UUID namespacing, Customize-vs-Developer-settings UI separation, session-cached MCP connections persist until restart, account-level OAuth inheritance for Class C, broker auto-resumes on URL match), file-by-file reference implementation inventory, phased build path. |
