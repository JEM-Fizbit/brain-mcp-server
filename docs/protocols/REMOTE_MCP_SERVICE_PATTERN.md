# Protocol — Remote MCP Service Pattern

> Reusable pattern for designing, hosting, securing, and operating a remote Model Context Protocol service. The hosting topology is a decision, not part of MCP: choose a managed public service, an embedded/edge deployment, or a private tunnel from the clients that must reach it.

**Last Updated:** 2026-08-21
**Version:** 2.0
**Status:** Current against MCP specification `2026-07-28`, current OpenAI remote-MCP guidance, and the deployed Brain substrate. Revalidate the protocol revision and every target client's compatibility before implementation.

**Current references:**

- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP 2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [OpenAI MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

---

## When to use this pattern

Use a remote MCP service when one tool surface must be reachable from multiple machines, accounts, hosted agents, API workers, or interactive clients; when per-user identity and authorization matter; or when the service needs durable state and centralized operations.

Examples:

- a shared Brain or knowledge service;
- a business-process MCP for CRM, documents, approvals, or notifications;
- a coordination plane used by agents on different platforms;
- a product tool surface consumed by ChatGPT, Codex, Claude, or API agents.

Prefer local `stdio` when one user on one machine is the whole audience, remote reach adds no value, and machine-local credentials are acceptable. If both are required, use the shared-registry pattern in [`DUAL_TRANSPORT_MCP_SERVER.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/DUAL_TRANSPORT_MCP_SERVER.md).

MCP is a request/response tool surface. It does not by itself schedule work, wake an idle agent, guarantee exactly-once execution, or authorize an action merely because another agent requested it. Put routing, leases, polling, notifications, and platform wake adapters in explicit workers around the service's durable state.

---

## Start with reach, ownership, and authority

Before choosing a framework or host, write down:

1. **Clients:** exact products, accounts/workspaces, API callers, and legacy clients that must connect.
2. **Reach:** public Internet, private network, local machine, or vendor-specific tunnel.
3. **Ownership boundary:** who owns code, data, cloud account, OAuth client, secrets, logs, and operational alerts.
4. **Identity:** human-delegated, workload identity, or both.
5. **Authority:** which tools are read-only, mutating, sensitive, destructive, or externally visible.
6. **Durability:** which application and OAuth state must survive redeploys, scale-out, and host replacement.
7. **Autonomy:** whether clients only call tools interactively or whether separate workers poll, route, notify, or spawn runs.

The deployment and credential boundary should follow the ownership boundary. Personal and company realms can reuse the same code, but should normally use separate deployments, databases, OAuth registrations, service credentials, logs, and administrators.

---

## Hosting decision tree

```text
Which clients must reach the MCP service?

All required clients can reach public HTTPS
    |
    +-- Standalone, durable, multi-worker service? -> managed container / VM
    |
    +-- Shares an existing app's users and logic?  -> embed in that app
    |
    +-- Small stateless/event-driven tool layer?   -> edge/serverless worker

Service must remain private
    |
    +-- OpenAI products are the only remote clients? -> OpenAI Secure MCP Tunnel
    |
    +-- Several vendors/platforms need reach?        -> private network gateway,
                                                        public authenticated proxy,
                                                        or per-vendor adapters

Single local user only -> stdio, not remote MCP
```

| Topology | Prefer when | Main trade-off |
|---|---|---|
| Managed container/VM with public HTTPS | Always-on service, durable DB, background workers, broad client reach | Own deploys, scaling, TLS/domain, health, backups, and alerts |
| Embedded in an existing app | MCP shares the app's identity, data model, and business logic | Couples availability and deploy cadence to the app |
| Edge/serverless | Short stateless calls, platform-native storage, low operational overhead | Duration, streaming, socket, package, and storage limits vary by platform |
| OpenAI Secure MCP Tunnel | Private/on-prem service used by supported OpenAI products without inbound firewall exposure | OpenAI-specific reach; tunnel client becomes an always-on dependency; not valid for public plugin distribution |
| Generic reverse tunnel | Temporary development or a deliberate network bridge | Another availability/security dependency; do not make it the default production blueprint |

For a genuinely cross-platform coordination service, a vendor-specific tunnel cannot be the only reach path. A stable authenticated public endpoint or a neutral private-network gateway is usually the interoperable default.

### OpenAI Secure MCP Tunnel constraints

Run `tunnel-client` inside the network that can already reach the private MCP server. It makes outbound HTTPS connections, polls OpenAI for work, forwards MCP requests to a local `stdio` or HTTP server, and returns responses through the tunnel.

- Monitor `/healthz`, `/readyz`, `/metrics`, and the loopback-only admin UI; requests fail while the client is disconnected.
- OAuth discovery may traverse the tunnel, but the authorization server itself is not automatically tunneled. Browser-facing authorization still fails if neither the public Internet nor the tunnel host can reach it.
- Tunnel RBAC, Platform organization/workspace association, and target-product developer access are separate controls; test all three.
- The tunnel supports private connections and developer-mode testing. Public plugin submission still requires a stable public HTTPS MCP endpoint.
- Treat tunnel transport logs and application/compliance logs as separate observability layers.

---

## Current protocol baseline: MCP `2026-07-28`

The July 2026 revision is a breaking architectural change from the 2025-era protocol used by several deployed references. New implementations should target it unless a named client has not yet adopted it; backward compatibility must be an explicit, tested branch.

### Streamable HTTP is stateless at the protocol layer

- One MCP endpoint accepts HTTP `POST`.
- Every JSON-RPC request is a separate POST.
- Replies are either one JSON object or a request-scoped SSE stream.
- The `initialize` / `notifications/initialized` handshake, `Mcp-Session-Id`, standalone GET stream, resumable SSE, and server-initiated JSON-RPC requests are not part of the current revision.
- Application state can remain durable and stateful. Expose explicit handles, job ids, cursors, or leases in tool schemas instead of hiding them in a transport session.
- Use MRTR `InputRequiredResult` for input needed during a call; use `subscriptions/listen` for opted-in change notifications.
- Legacy HTTP+SSE is deprecated. Support it only for a named compatibility need and give it a removal gate.

### Required request metadata and validation

Each modern Streamable HTTP request carries protocol version, client identity, and capabilities in `_meta.io.modelcontextprotocol/*`. The HTTP binding mirrors routing metadata into headers:

- `MCP-Protocol-Version` on every POST;
- `Mcp-Method` on every request;
- `Mcp-Name` for `tools/call`, `resources/read`, and `prompts/get`.

The body is the source of truth. A server that processes it must reject missing, malformed, or header/body-mismatched metadata with HTTP 400 and the protocol `HeaderMismatch` error. This prevents a gateway authorizing one header while the service executes a different body.

If a tool uses `x-mcp-header` to mirror a primitive argument into `Mcp-Param-*`, follow the specification's type, encoding, and validation rules exactly. Do not invent ad hoc routing headers from untrusted arguments.

### Transport security

- Validate `Origin` on incoming Streamable HTTP requests; reject an invalid present origin with 403.
- Bind local-only servers to `127.0.0.1`, not `0.0.0.0`.
- Serve public MCP and authorization endpoints over HTTPS.
- Enforce body-size, time, concurrency, and rate limits before expensive parsing or tool work.
- Propagate cancellation from a closed response stream into tool work where practical.
- Configure proxies not to buffer request-scoped SSE (`X-Accel-Buffering: no`) and verify real streaming through the production path.

---

## Authorization architecture

Authorization is optional for MCP generally, but it is normally required for a multi-user remote service. Treat the MCP server as an OAuth 2.1 protected resource. The authorization server may be colocated or separate.

### Discovery and registration

Current MCP authorization requires:

- OAuth Protected Resource Metadata (RFC 9728) from the MCP resource;
- authorization-server discovery through RFC 8414 metadata or OpenID Connect Discovery;
- resource/audience binding with RFC 8707;
- PKCE for authorization-code clients;
- bearer-token handling per RFC 6750;
- issuer-mix-up protection using RFC 9207 behavior.

Client registration priority is now:

1. OAuth Client ID Metadata Documents (CIMD);
2. pre-registration;
3. Dynamic Client Registration (DCR) for backward compatibility.

DCR is deprecated in MCP `2026-07-28`, though deployed brokers may still depend on it. Do not delete DCR merely because the new spec prefers CIMD: inventory actual clients, add CIMD/pre-registration, migrate and verify each surface, then retire DCR only when compatibility evidence allows.

Endpoint ownership must be explicit:

| Surface | Owner | Purpose |
|---|---|---|
| MCP endpoint, normally `/mcp` | Resource server | Authenticated MCP requests |
| `/.well-known/oauth-protected-resource[/path]` | Resource server | Advertises authorization server(s) and minimal resource scopes |
| RFC 8414 or OIDC discovery | Authorization server | Advertises authorization/token/registration capabilities |
| Authorization and token endpoints | Authorization server | User authorization and token issuance |
| Client metadata document, preregistration, or legacy `/register` | Client/auth server | Establishes client identity |

### Scopes and step-up authorization

- Put the minimal basic scopes in protected-resource metadata.
- Include the scopes required for the current request in `WWW-Authenticate` when useful.
- Return 401 for missing/invalid tokens and 403 plus `error="insufficient_scope"` for a valid token lacking operation scopes.
- Emit all scopes needed for the current operation together. Do not force one scope-upgrade round trip per missing permission.
- Do not advertise `offline_access` as a resource requirement; refresh-token issuance remains the authorization server's decision.
- Authorization is checked server-side on every tool call. A client approval prompt is additional protection, not an authorization mechanism.

### Redirects, resource binding, and token handling

- Match registered redirect URIs exactly, with the standards-defined native loopback exception where applicable.
- Accept broker callback classes only by a documented narrow pattern: exact HTTPS host, constrained path, no unexpected query/fragment.
- Include and validate the canonical `resource` URI in authorization and token requests; validate token audience on every MCP request.
- Use short-lived access tokens. Rotate public-client refresh tokens and detect stale reuse, with only a bounded same-client/same-resource grace for proven refresh races.
- Include and validate authorization-response issuer (`iss`) per RFC 9207 where supported; advertise `authorization_response_iss_parameter_supported` accurately.
- Never put access tokens, refresh tokens, client secrets, PKCE verifiers, or authorization headers in URLs or logs.

### Identity and authorization claims

When issuing JWT access tokens, include only the claims the resource server needs: issuer, audience, subject, client id, scope, issued/expiry ids, and stable identity/realm claims. Embedding stable identity at issue time avoids a third-party IdP lookup on every tool call; separately decide whether live revocation or membership requires a bounded current-status check.

HS256 is acceptable when one colocated authorization/resource service is the only verifier and the secret is held in a proper secret store. Prefer asymmetric signing plus JWKS when multiple services verify tokens or independent key rotation/ownership matters.

---

## Durable state and realm isolation

Durable application state and durable OAuth state are different concerns; both must survive routine deploys if clients depend on them.

For legacy DCR/authorization-code support, typical stores include:

| Store | Purpose | Required property |
|---|---|---|
| clients | Legacy DCR registrations | Long-lived and migration-safe |
| auth codes | Pending code exchange | Short TTL, atomic consume-once |
| refresh tokens | Rotation state | Hashed at rest, atomic rotation |
| authorization sessions | Consent flow state | Short TTL, bound to issuer/client/resource/PKCE |
| optional OTPs | Local OTP IdP only | Hashed, attempt-limited, short TTL |

Use Postgres, a durable platform KV, or another store with atomic consume/compare operations for hosted production. File-backed JSON is appropriate only for local development or a single persistent host whose clients can tolerate re-enrolment.

Migration rules:

- Keep signing keys stable unless forced reauthorization is deliberate.
- Record intentionally invalidating migrations before deployment.
- Verify a fresh client registration/metadata flow, authorization, refresh where applicable, and a real tool call.
- Prove existing brokered clients continue working after a redeploy or machine replacement.
- Treat `unknown_client_id` as a specific DCR-state diagnosis. If no matching durable row or fresh registration appears, a full app/connector remove-and-recreate may be needed; a cosmetic reconnect can preserve stale broker state.

For separate personal/company realms, do not rely on a `realm_id` column alone. Use separate deployments and stores where ownership or exit custody differs. If multi-tenancy is deliberate, enforce tenant/realm at authentication, authorization, queries, telemetry, backups, and operator tooling, then test cross-tenant denial adversarially.

---

## OpenAI Responses API consumption

The Responses API can call a public remote MCP server with an MCP tool definition containing `server_url`; an OAuth access token can be passed in `authorization` when required. OpenAI currently supports remote servers using Streamable HTTP or legacy HTTP/SSE, but new servers should target the current MCP Streamable HTTP revision and verify compatibility in a live Responses API call.

```json
{
  "type": "mcp",
  "server_label": "handoffs",
  "server_url": "https://handoffs.example.com/mcp",
  "allowed_tools": ["handoff_list", "handoff_get"],
  "require_approval": "always"
}
```

Client-side controls:

- Use `allowed_tools` to expose the smallest useful subset; large tool catalogs add latency, tokens, and attack surface.
- Keep the `mcp_list_tools` item in conversation/workflow context when the API supports it, so tool definitions are not repeatedly fetched.
- Approvals are requested by default before data is shared with a remote MCP server. Preserve approval for sensitive actions and log the reviewed data boundary where appropriate.
- Never use `require_approval: "never"` as a substitute for server-side authorization, idempotency, or action policy.
- Treat tool descriptions, arguments, outputs, and returned URLs as untrusted content. Connect to servers you trust, constrain URLs/domains, and defend against prompt injection.
- Do not conflate the Responses API's `authorization` bearer value with the MCP server's user-enrolment design. One is a client-supplied access token; the other is how the server discovers an authorization server, registers/identifies clients, authenticates users, and issues scoped tokens.

---

## Operational telemetry and alerts

Use metadata-only telemetry, following [`MCP_SERVER_OPERATIONAL_TELEMETRY.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/MCP_SERVER_OPERATIONAL_TELEMETRY.md). Separate at least:

- public endpoint/tunnel reach and transport errors;
- authorization discovery, registration, issuer, token, scope, and audience failures;
- tool dispatch and tool-handler duration;
- backing-store operations;
- background router/poller/notifier health if the application has autonomous workers.

Record reason codes, endpoint, status, safe client label/hash, realm, timing layer, correlation id, and timestamp. Never record credentials, raw auth headers, PKCE material, request bodies, model context, SQL parameters, or user content by default.

Telemetry without a verdict and action path is only a log. Wire sustained failures into health and alerts. Use conservative stale-client classification, per-severity cooldowns, and an atomic or serialized alert claim so a concurrent burst produces one alert rather than many. Health should evaluate fresh successful work and oldest-due age, not just process liveness.

---

## Verification matrix

### 1. Protocol and transport

- current-version POST with required `_meta` and mirrored headers succeeds;
- missing/unsupported protocol version returns the specified modern error;
- header/body mismatch returns HTTP 400 `HeaderMismatch`;
- invalid present `Origin` returns 403;
- JSON and request-scoped SSE responses both work through the production proxy;
- cancellation stops work where supported;
- any declared older protocol revision or HTTP/SSE fallback is tested explicitly.

### 2. Authorization

- protected-resource and authorization-server/OIDC discovery documents are correct;
- CIMD or preregistration works for current clients; retained DCR works for named legacy brokers;
- PKCE, redirect validation, issuer validation, resource binding, audience validation, code consume-once, refresh rotation, and scope challenges have negative tests;
- the real IdP API is exercised with the exact methods/scopes used in production;
- token/registration state survives a redeploy.

### 3. Tools and authority

- tool schemas are strict and stable; list caching metadata is correct if used;
- every tool enforces realm, identity, scope, object ownership, and action policy inside the service;
- mutating tools are idempotent or carry explicit compare-and-swap/version contracts;
- sensitive actions still require the executing surface's approval policy;
- telemetry contains no payload/secrets.

### 4. Every active client surface

Test a real tool call from every product/account/surface that matters. Do not infer OpenAI from Claude, API from UI, desktop from mobile, or a public route from a tunnel route. Record client, account/workspace, protocol path, auth path, tool, identity attribution, and date.

For OpenAI, include a Responses API probe with `allowed_tools` and the intended approval policy. For private tunnel use, prove tunnel readiness, target-workspace association, OAuth reach, tool call, disconnect failure behavior, and recovery.

### 5. Operations

- health checks distinguish endpoint, auth, database, worker, and end-to-end synthetic health;
- alert routing, cooldown, worsening-severity escalation, and notification redaction work;
- backups restore into an isolated environment and the restored service passes a real client call;
- owner/realm isolation is tested, not inferred from configuration.

---

## Phased build path

| Phase | Deliverable |
|---|---|
| 1 — Contract | Name clients, protocol versions, topology, ownership/realm, identity provider, scopes, tool risk classes, and approval boundaries. Read the current MCP spec and official docs for every target client. |
| 2 — Local vertical slice | Current SDK/runtime; shared tool registry; strict schemas; durable-store interfaces; current stateless Streamable HTTP; auth discovery/registration strategy; deterministic authorization tests. |
| 3 — Production substrate | Chosen host or tunnel, durable application/OAuth state, secrets, migrations, health, telemetry, alerts, backups, and worker supervision. |
| 4 — Server compliance | Transport/header/origin tests, auth negative matrix, real IdP call, redeploy durability, tenant denial, load and concurrency probes. |
| 5 — Cross-client pilot | One real low-risk tool through every active client/account; OpenAI approval/tool filters; Claude/broker callbacks where applicable; document incompatible legacy branches. |
| 6 — Operational gate | Restore rehearsal, synthetic end-to-end check, alert test, rollback, owner/runbook, deprecation plan for legacy transport/DCR. |
| 7 — Cutover | Explicit authority switch; never leave two silent live stores or queues. Monitor real usage before expanding write authority. |

Do not copy an old repository's dependency pins, server router, OAuth endpoints, or deployment topology wholesale. Reuse invariants and tests; select current SDKs and hosting from current client constraints.

---

## Reference implementations and what they prove

### `brain-mcp-server`

The hosted Brain on Fly.io is the primary local reference for:

- managed-container deployment with Streamable HTTP;
- durable Supabase/Postgres application and OAuth state;
- shared tool registry and store abstraction;
- metadata-only tool/auth telemetry, health checks, and alerts;
- owner-isolated deployments and broker-state recovery.

It is **not currently the protocol-version reference**. At audit on 2026-08-21 it used `@modelcontextprotocol/sdk` v1 and a 2025-era initialize/session-compatible transport and DCR-first authorization flow. MCP `2026-07-28` removed the handshake/session model, requires request metadata headers, adds RFC 9207 issuer hardening, and prefers CIMD over deprecated DCR. Treat the Brain implementation as a proven operational substrate pending its separately tracked protocol/SDK migration.

### Embedded/serverless application

`Social-Creator-Claude` proved that an MCP serving an existing product can live inside the app and reuse app auth, data access, and executor functions. The important lessons remain:

- use an atomic durable store for consume-once auth state;
- centralize ownership checks instead of assuming route-level guards still exist;
- check live account status when rapid revocation matters;
- configure function duration/streaming limits for long tools;
- test human OTP/email delivery, not only synthetic tokens;
- bind tokens to a config-driven canonical public URI because domain changes invalidate audiences.

### Edge/worker service

`slack-mcp-server` moved from its original local Node + Cloudflare named-tunnel + LaunchAgent topology to Cloudflare Workers. It remains useful evidence for broker callback handling, IdP scope pitfalls, and connector recovery, but its v0.4.1 file inventory and 10–16 hour estimate are historical—not a scaffold or hosting default.

---

## Known migration traps

- A client UI saying “connected” is not proof of a valid DCR/CIMD registration, token exchange, or tool call.
- A broker reconnect may preserve stale DCR client state; verify new registration evidence when recovery requires it.
- Account-level connector state, machine-level config, vendor tunnel registration, and API bearer tokens are distinct layers.
- Session-cached connector state may persist until a fresh client session/restart.
- A server can be healthy while an auxiliary tunnel, authorization server, router, notifier, or polling worker is dead.
- Moving to MCP `2026-07-28` is not a dependency-only bump: transport shape, headers, discovery/registration, issuer checks, SDK APIs, gateways, tests, and every client compatibility branch must be audited together.

---

## Cross-references

- [`DUAL_TRANSPORT_MCP_SERVER.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/DUAL_TRANSPORT_MCP_SERVER.md) — shared registry over local stdio and hosted HTTP.
- [`MCP_SERVER_OPERATIONAL_TELEMETRY.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/MCP_SERVER_OPERATIONAL_TELEMETRY.md) — event taxonomy, timing layers, and sanitization.
- [`OPENAI_MCP_CONNECTOR_RECOVERY.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md) — ChatGPT/Codex connector recovery.
- [`MCP_CONNECTOR_SETUP.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/MCP_CONNECTOR_SETUP.md) — product/account installation boundaries.
- [`SCHEDULED_JOBS_AND_POLLING.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/SCHEDULED_JOBS_AND_POLLING.md) — background heartbeat, due-state, retries, and freshness health.
- [`SLACK_BOT_REMOTE_MCP_ENROLLMENT.md`](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/SLACK_BOT_REMOTE_MCP_ENROLLMENT.md) — one operator-facing application of the legacy broker/DCR flow.

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 2.0 | 2026-08-21 | Rebuilt the protocol around MCP `2026-07-28`: stateless Streamable HTTP, required request metadata/header validation, MRTR/subscriptions, RFC 9207 issuer checks, scope challenges, CIMD-first registration with DCR deprecated but compatibility-gated. Replaced the Cloudflare/LaunchAgent default with a hosting decision tree; added OpenAI Secure MCP Tunnel constraints and Responses API `allowed_tools`/approval guidance; made Fly-hosted Brain the operational substrate reference while explicitly recording its pending SDK/protocol migration; demoted the v0.4.1 inventory and effort estimate to history. |
| 1.8 | 2026-07-23 | Reframed hosted Brain as a proven owner-isolated deployment pattern. |
| 1.7 | 2026-07-03 | Added conservative stale-connector classification, telemetry cross-reference, and updated deployed-reference notes. |
| 1.6 | 2026-06-25 | Added the OpenAI connector-recovery companion. |
| 1.5 | 2026-06-23 | Added broker callback classes and `unknown_client_id` recovery. |
| 1.4 | 2026-06-23 | Closed auth telemetry into health and alerts. |
| 1.3 | 2026-06-23 | Made durable OAuth state the hosted-production default. |
| 1.2 | 2026-06-10 | Added email-OTP delivery hardening. |
| 1.1 | 2026-06-10 | Added the embedded/serverless application variant. |
| 1.0 | 2026-05-15 | Initial extraction from `slack-mcp-server` v0.4.1. |

---

**Protocol Version:** 2.0
**Last Updated:** 2026-08-21
