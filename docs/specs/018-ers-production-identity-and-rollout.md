# 018 — ERS Production Identity, Access Administration And Team Rollout

**Status:** in progress — tenant-neutral implementation complete in upstream
release `v1.8.0`; corrective operator-profile binding is included in `v1.8.1`,
and the observability-acceptance correction is included in `v1.8.2`. The tagged
release is deployed and has passed the profile-bound JEM re-canary.
The private ERS overlay has passed intake. TDM completed the single-tenant app,
fixed-role groups, consent and certificate upload; the ERS access-ledger
migration and live Supabase security gate passed on 2026-08-28; and John,
Cillian and Rick were bootstrapped as the three exact Entra-backed ERS Brain
Owners. Fly secret changes, dual-provider deployment/canary and user enrollment
remain separately approval-gated and are not activated.
**Source:** John E. Milad, 2026-08-25: promote the ERS production rollout,
make Microsoft Entra ID authentication and permission management the primary
technical risk, and treat a restore rehearsal as useful resilience work rather
than a launch blocker. Follow-up owner decision: John, Cillian and the
designated IT/TDM identity are the initial access owners, and routine role
changes must be available through a hosted in-app administration surface rather
than requiring TDM to operate the Entra portal.
**Roadmap link:** [`../ROADMAP.md`](../ROADMAP.md), Milestone 4 — ERS
Multi-User Access
**Decisions impact:** supersedes spec 012's decision to keep Entra out of the
fork rollout and its requirement that a timed restore rehearsal block production
cutover. It does not weaken the owner-isolated JEM/ERS topology or the private
Supabase security boundary.
**Related:** [`012-ers-mcp-fork.md`](012-ers-mcp-fork.md);
[`../protocols/REMOTE_MCP_SERVICE_PATTERN.md`](../protocols/REMOTE_MCP_SERVICE_PATTERN.md);
[`../protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md`](../protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md);
[`../security/hosted-brain-supabase-security-gate.md`](../security/hosted-brain-supabase-security-gate.md);
private ERS `docs/ers-deploy-and-operations.md`; ERS Brain
`governance/brain-mcp-fork-signoff.md` item 14.

## Problem

The dedicated ERS Brain development stack is live, isolated and healthy, but
its authentication and access model are still the two-person GitHub pilot:

- the server has one upstream identity provider, implemented directly in
  `src/oauth/github.ts`;
- `buildOauthConfig` always requires GitHub credentials;
- the private ERS registry contains John and Cillian as GitHub principals and
  can be changed only through an image/redeployment workflow;
- the pilot proved positive ERS access, negative JEM access and unregistered
  identity rejection, but only through GitHub;
- the current generic write guard distinguishes `reader` from every other
  role, while `member`, `admin` and `owner` share too much mutation authority;
- SharePoint/OneDrive is a parallel human write plane whose permissions can
  bypass the MCP role model; and
- the standing ERS governance gate remains open for rollout beyond John and
  Cillian.

GitHub is appropriate for the engineering pilot but not for ordinary ERS
workforce identity. Wider rollout needs single-tenant Microsoft Entra ID
authentication, exact durable principal matching, a comprehensible role model,
one access policy across hosted MCP and SharePoint, and a narrow hosted
administration surface that ERS owners can operate without recurring IT/TDM
intervention.

## Decisions locked by promotion

1. **Entra is mandatory before user three.** GitHub OAuth remains a temporary
   John+Cillian pilot and rollback path; it is not an ERS team enrolment route.
2. **The Brain server remains the OAuth authorization server presented to MCP
   clients.** Entra is the upstream workforce identity provider. The public
   MCP hostname, resource URI, `/authorize`, `/token`, durable client
   registrations and Brain-issued access tokens remain under ERS Brain control.
3. **Identity and authorization stay separate.** Entra proves the ERS tenant
   and person. Dedicated Entra security groups mapped to application roles are
   the workforce role authority; a private Postgres grant projection is the
   Brain's immediate enforcement and audit layer. Email address, UPN, display
   name, email domain and self-asserted organization membership are never
   authorization inputs.
4. **A principal is keyed by exact Entra tenant ID plus object ID.** Both are
   immutable GUID claims. Human-readable claims are display metadata only.
5. **Access is explicitly granted in-app.** A new colleague selected by an
   owner defaults to `reader`; curator, admin or owner is a separate deliberate
   choice. There is no wildcard or email-domain grant and no automatically
   content-enabled self-enrolment. An unassigned tenant user receives no Brain
   access.
6. **SharePoint Brain-folder writes are restricted to the same named curator
   population that may write through MCP.** Reader access can remain broader.
   The hosted role model must not claim enforcement while a broader file-plane
   write path bypasses it.
7. **The identity migration is dual-provider only during the bounded canary.**
   John and Cillian each complete an Entra login and the complete negative test
   matrix before the ERS runtime becomes Entra-only.
8. **The restore rehearsal is not on the critical path.** Supabase-hosted state
   plus the SharePoint/OneDrive mirror and its version history are accepted as
   sufficient redundancy for this rollout. A timed isolated restore remains a
   worthwhile resilience exercise and backlog item, but its absence does not
   block Entra rollout or team access. This is an accepted residual risk, not a
   claim that recovery has been rehearsed.
9. **Do not combine this change with the MCP `2026-07-28` transport migration.**
   Spec 018 compatibility-gates the currently deployed transport against every
   target client. The protocol/SDK migration remains separate unless a target
   client makes it unavoidable.
10. **Brain Cockpit is the shared control-plane shell, with profile-scoped
    capabilities.** John, Cillian and the designated IT/TDM identity are the
    initial ERS `owner`s. After one-time group creation, enterprise-app
    assignment and admin consent, those owners use Cockpit's ERS **Access &
    Roles** section to add, change, suspend and remove users without asking TDM
    to perform each change. JEM continues to use GitHub authentication and does
    not expose multi-user role administration. The existing local Cockpit
    process remains loopback-only; privileged ERS mutations run only on the
    hosted ERS origin.

## Acceptance criteria

### Identity

- The public runtime supports configurable identity providers without
  requiring unused provider credentials. JEM remains GitHub-only.
- The ERS runtime can move through `github,entra` canary mode to `entra`-only
  mode without changing `https://brain.ersgenomics.online/mcp` or resetting
  unrelated durable MCP client registrations.
- The Entra app registration is single-tenant and uses exact production MCP
  and admin callbacks. Ordinary Brain authentication requests only OIDC
  identity scopes. Microsoft Graph delegated scopes are requested only in a
  fresh, owner-authorized admin session.
- The Entra authorization-code callback validates state, nonce, upstream PKCE,
  token signature, algorithm, key ID, issuer, audience, expiry/not-before,
  tenant ID and object ID before creating a Brain authorization code.
- Entra keys are resolved from tenant-specific OIDC discovery/JWKS with bounded
  caching and key-rollover retry. Token verification is library-backed, not
  handwritten cryptography.
- The production confidential-client credential is certificate-backed
  `private_key_jwt`, held only in ERS secret custody. A client secret may be used
  for a local test harness only and cannot satisfy the ERS deployment profile.
- Wrong-tenant, personal Microsoft, missing-claim, invalid-signature,
  wrong-audience, replayed-state, replayed-code, unassigned-role and
  unregistered-object-ID attempts fail closed without an MCP authorization code
  or Brain data.

### Authorization and permissions

- Principals support an exact provider tenant ID in addition to the provider
  object ID. Entra records require both GUIDs. The active role/status grant is
  held in private Postgres so an approved in-app change does not require an
  image rebuild or Fly deployment.
- If a registry record has a stable provider object ID, matching cannot fall
  through to mutable login or email fields after an ID mismatch.
- The ERS deployment profile rejects email/domain allowlists, unknown role
  group IDs, GitHub fallback variables, duplicate principals, duplicate
  tenant/object pairs, invalid role names, an ownerless Brain, and GitHub
  principals once provider mode is `entra`-only.
- Every tool is classified and exhaustively tested against the role matrix
  below. A newly added mutation tool fails the test until its minimum role is
  declared.
- Current Postgres authorization is re-evaluated on every tool call and
  refresh-token exchange. An in-app removal, suspension or downgrade revokes
  existing Brain sessions and takes effect without a Fly deployment even if
  the user still holds a previously issued access or refresh token.
- The current enabled-provider set is checked before grant lookup during
  authorization-code exchange, refresh-token exchange and MCP bearer
  authentication. Entra-only therefore denies existing GitHub codes and tokens
  even while their Postgres grants are retained inert for the bounded rollback
  window.
- No principal can list, read or mutate a Brain absent from its explicit role
  map. The ERS endpoint still denies `ai-brain-jem`; the JEM endpoint still
  denies `ers-brain`.
- SharePoint/OneDrive Brain-folder permissions are reconciled before the first
  non-pilot writer: broad colleagues are readers, and only named curators may
  edit the Markdown tree.

### Cockpit access administration

- Cockpit is the normal shared entry and uses profile-aware navigation. When
  the active profile is ERS, its first-screen Overview exposes a prominent
  **Identity & Access** module plus a matching navigation link; both transition
  to the hosted `/admin/access` route. When the active profile is JEM, both
  entries are absent for the single-owner profile.
- JEM remains GitHub-authenticated. Enabling ERS Entra or Graph administration
  cannot make JEM require Entra credentials, accept an Entra principal, expose
  a role ledger or enable an access mutation route.
- The local Cockpit remains bound to `127.0.0.1` for device, sync, lint and
  maintenance functions. Its ERS navigation transitions to the hosted,
  Entra-authenticated Access & Roles section; the local process never receives
  a Graph token or proxies a permission mutation.
- Cillian and IT/TDM can open the hosted ERS Access & Roles surface directly without
  installing John's local Brain Monitor or sync stack.
- Hosted access routes are deployment-bound to `ers-brain`; they do not accept
  a caller-selected `brain_id`, cannot enumerate JEM, and are absent from the
  JEM hosted deployment. JEM and ERS sessions, credentials, grant records and
  audit rows remain owner-isolated.
- John, Cillian and the designated IT/TDM identity are bootstrapped and
  verified as the three initial `owner`s. Losing any one person does not remove
  the remaining owners' ability to operate access.
- The surface can search basic ERS directory profiles; grant exactly one of
  Reader, Curator, Admin or Owner; change a role; suspend/reinstate; revoke; and
  show effective access plus a dated audit history.
- UI labels map `Curator` to the internal `member` role. Only Owners can mutate
  access. Admins remain content/operations administrators and cannot grant
  roles, change managed group IDs or alter identity-provider configuration.
- The UI explains all four roles beside directory search and shows the selected
  role's authority inside the confirmation modal. Drift actions are labelled
  **Review & reconcile** and explain that opening the modal is read-only,
  confirmation reapplies a deliberately reviewed state, and the system never
  chooses a role automatically. GitHub fallback rows offer no Entra action.
- Role changes operate only on an allowlisted set of dedicated, cloud-only,
  non-role-assignable Entra security-group IDs. The UI is not a generic Graph
  client and accepts no caller-supplied group ID.
- Directory search uses least-privileged delegated `User.ReadBasic.All`.
  Direct membership reads and changes for the four fixed groups use delegated
  `GroupMember.ReadWrite.All` in the signed-in owner's context. Reconciliation
  reads those groups once and maps their member object IDs to local grants; it
  does not enumerate each target user's broader directory memberships. No
  app-only Graph write permission or background Graph credential is accepted
  for this release.
- Group creation, enterprise-app role assignment and tenant admin consent are
  one-time IT/TDM setup. John and Cillian are group owners so subsequent
  membership changes do not require TDM. Licensing for group assignment to the
  enterprise application is verified before implementation approval.
- A role reduction or revocation disables the local grant and Brain sessions
  before the Graph removal is attempted; a Graph failure remains fail-closed
  and is surfaced as a reconciliation incident. A grant or elevation becomes
  usable only after the Graph write succeeds and the local projection commits.
- Every change records actor and target `tid`/`oid`, old/new role and status,
  timestamp, bounded reason and Graph request outcome; it never records Graph
  tokens, Brain content or mutable claims as authority.
- Mutations require a recent Entra owner session, CSRF/origin protection and an
  explicit confirmation. The UI prevents reducing the active Owner roster
  below two and flags multiple managed-role-group membership instead of
  silently choosing a role.

### Rollout and operations

- John and Cillian pass Entra positive ERS and negative JEM tests before GitHub
  is disabled.
- Each intended client/account surface passes a real hosted read. At least one
  reader-denied write and one approved curator write are exercised through a
  real client, with the resulting revision actor correctly attributed.
- ChatGPT Business is tested from the browser workspace-app surface; Claude ERS
  and Codex use fresh sessions. Reconnect versus delete/recreate outcomes are
  recorded without exposing credentials.
- An ERS-owned external `/health` check and an actionable alert route are live.
  The exact alert product is not prescribed; the current laptop-only Monitor
  cannot be the sole production signal.
- Cillian's and IT/TDM's owner/admin recovery paths are reverified and a short
  onboarding/offboarding procedure covers the in-app, Entra-group, SharePoint
  and emergency-revocation steps.
- The item-14 ELT evidence package contains the vendor review outcome, Entra
  isolation results, pilot findings, onboarding guide, proposed access model
  and team-wide audit/read-logging decision before rollout beyond the approved
  pilot.
- Production metadata no longer says `team_access=false` after the gate opens,
  and all public/private runbooks describe the same current state.

## Out of scope

- A timed Supabase restore rehearsal as a cutover requirement. It remains open
  resilience work and must be completed before any future decision to remove an
  existing redundancy layer or make recovery-time guarantees.
- PITR purchase or a new backup product.
- The MCP `2026-07-28` transport/SDK/CIMD migration. Existing DCR is retained
  only as a compatibility path for named clients and remains separately tracked.
- Open tenant-wide content enrolment, email-domain grants, nested/dynamic role
  groups, SCIM and an app-only/background Graph writer.
- Per-principal Postgres RLS. The private server-side `brain_runtime` boundary
  remains unchanged; authorization is enforced in the application and tested
  adversarially.
- Hosted original-binary downloads. Runtime artifact access remains
  `metadata_only`, so no new signed-URL policy is needed for this rollout.
- Automated SharePoint source ingestion, Spec 014, vector search, a hosted
  Brain Library, or a general-purpose administration/content UI. Spec 018's
  narrow access-administration surface is in scope.
- Perfect attribution for edits made directly through SharePoint. Restricting
  file-plane writers closes the privilege bypass; editor passthrough remains a
  separately tracked audit-quality refinement.

## Target authentication flow

```text
MCP client
  -> ERS Brain /authorize                  (MCP OAuth request)
  -> Entra tenant /authorize              (workforce sign-in)
  -> ERS Brain /authorize/entra/callback  (code + state)
  -> Entra tenant /token                  (server-side exchange)
  -> validate ID token: signature, iss, aud, tid, oid, nonce, time
  -> exact grant match: entra + tid + oid + recognized app role
  -> ERS Brain authorization code
  -> MCP client exchanges at ERS Brain /token
  -> Brain-issued access/refresh token
  -> current Postgres role/status rechecked on every tool call and refresh
```

The client never receives an Entra token from the Brain server, and the Brain
server does not accept a Microsoft Graph access token as its MCP bearer token.
The existing MCP resource/audience boundary therefore stays intact.

## Provider configuration contract

The public runtime gains a provider-neutral configuration seam. Exact names may
change during implementation, but the behavior must remain equivalent:

| Setting | Purpose |
|---|---|
| `BRAIN_IDENTITY_PROVIDERS` | Ordered allowlist: `github`, `entra`, or `github,entra` during canary |
| `BRAIN_IDENTITY_DEFAULT_PROVIDER` | Direct provider when more than one is enabled; production ERS default is `entra` |
| `ENTRA_TENANT_ID` | Exact workforce tenant GUID; `common`, `organizations` and `consumers` are forbidden |
| `ENTRA_OAUTH_CLIENT_ID` | ERS-owned single-tenant app registration ID |
| `ENTRA_OAUTH_CALLBACK_PATH` | Defaults to `/authorize/entra/callback` and must resolve under the canonical public base |
| `ENTRA_OAUTH_CLIENT_PRIVATE_KEY_PEM` | Certificate private key; Fly secret only |
| `ENTRA_OAUTH_CLIENT_CERT_THUMBPRINT` | Public certificate identity used in the client assertion |
| `ENTRA_OAUTH_CLIENT_CERT_EXPIRES_AT` | Non-secret expiry metadata for fail-ahead health warning |
| `ENTRA_BRAIN_ROLE_GROUP_IDS` | Private deployment map of Reader/Curator/Admin/Owner to fixed Entra security-group IDs |
| `ENTRA_ADMIN_GRAPH_ENABLED` | Enables the ERS-only hosted access surface; false for JEM |

Provider-mode validation is fail-closed:

- GitHub-only requires only GitHub credentials.
- Entra-only requires only Entra credentials and refuses GitHub fallback env.
- Dual mode requires both complete provider configurations.
- No configured provider, an unknown provider, an ERS `common`/`organizations`
  authority, or incomplete certificate configuration refuses HTTP startup.

JEM's deployment remains explicitly `github`; ERS moves from `github,entra` to
`entra` after acceptance. Provider selection in dual mode is an ERS-hosted,
state-bound choice page or an equally explicit server-controlled mechanism;
clients are not trusted to select an unconfigured provider.

## Entra validation contract

Use the tenant-specific v2.0 OIDC discovery document and authorization-code
flow with server-generated state, nonce and S256 PKCE. At callback:

1. consume the short-lived outer state exactly once;
2. exchange the upstream code over TLS using a certificate-signed client
   assertion and the stored PKCE verifier;
3. validate the returned ID token through a maintained JOSE/OIDC library and
   the discovered JWKS;
4. require `tid` to equal the configured tenant GUID and `oid` to be a GUID;
5. require exact `iss`, `aud`, `nonce`, signature, time and supported algorithm;
6. treat `name`, `preferred_username` and `email` as optional display fields;
7. require exactly one recognized Entra app role for normal access;
8. resolve `provider="entra"`, `provider_tenant_id=tid`,
   `provider_user_id=oid` through the current private grant projection; and
9. issue the existing Brain authorization code only when the grant is active
   and consistent with the presented app role.

No Entra access token, ID token, authorization code, client assertion, private
key, nonce or PKCE verifier may enter logs, telemetry, errors, revisions or
operator documents.

Microsoft's current identity guidance supports the key design choices:

- [OIDC v2 endpoints and discovery](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [`tid` + `oid` as durable identity; mutable claims are not authorization](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [certificate credentials and `private_key_jwt`](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials)
- [app-registration credential and redirect hardening](https://learn.microsoft.com/en-us/entra/identity-platform/security-best-practices-for-app-registration)
- [application roles for application-level authorization](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)
- [delegated group-membership permissions and group-owner requirement](https://learn.microsoft.com/en-us/graph/api/group-delete-members?view=graph-rest-1.0)
- [least-privileged directory user listing](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)

Revalidate these official sources immediately before implementation.

## Role and tool-authority matrix

| Role | Intended user | Allowed | Denied |
|---|---|---|---|
| `reader` | Default ERS colleague | Brain/source metadata and content reads, search, context load, sync/conflict status, read-only preflight | Every state-changing tool, lint if it writes a receipt, original bytes, conflict resolution |
| `member` | Named curator | Reader rights; ordinary non-structural file updates; content log/capture actions | Structural files, delete/rename/restore, conflict resolution, identity or deployment administration |
| `admin` | Break-glass/content administrator | Member rights; approved structural and recovery/conflict operations | Identity registry, secrets, Fly/Supabase/app-registration custody through MCP |
| `owner` | Deployment/governance owner | Same in-service content authority as admin; named owner for release and custody decisions | No implicit credential or database-admin capability through MCP |

Implementation must classify the actual tool registry rather than infer safety
from names. `brain_lint` currently writes a log receipt and is therefore not a
reader tool unless that side effect is removed for readers. Any destructive or
structural call keeps host approval in addition to server authorization.

Initial production owners:

- John: `owner`;
- Cillian: `owner`;
- designated IT/TDM identity: `owner`;
- every additional colleague: `reader`;
- additional Curator (`member`), `admin` or `owner` grants only through the
  permission rules above.

No existing GitHub role is automatically copied to an Entra identity. The
bootstrap must explicitly map and review each initial owner Entra object ID;
subsequent identities are resolved from Entra by the in-app directory picker
and persisted by immutable object ID.

## Provisioning, changes and offboarding

The first production version replaces the image-baked user roster with a
private Postgres grant ledger and a hosted owner workflow:

1. An owner opens the ERS access surface and completes a fresh Entra admin
   session.
2. The owner selects a user from the basic tenant directory picker and chooses
   Reader by default or a deliberate higher role.
3. The server adds the immutable Entra object ID to exactly one allowlisted
   role group through delegated Microsoft Graph, then commits the active local
   grant and audit event.
4. The user authenticates through Entra and completes a role-appropriate
   acceptance check.

Role changes use the same workflow and preserve one effective managed role per
person. Revocation/suspension invalidates the local grant and Brain sessions
immediately, then removes managed group membership. Disabling an Entra account
alone is not complete Brain offboarding because the Brain server issues its own
tokens; the local action is mandatory.

The admin surface reads live membership for the four managed groups during an
owner session, reports projection drift and offers a bounded reconciliation
action. Out-of-band Entra changes are break-glass operations and must be paired
with immediate local suspension/reconciliation. There is no permission-
management MCP tool: agent clients cannot grant access.

## Implementation work packages

**Local implementation record (2026-08-25):** work packages A-E are complete
in `v1.8.0`. The focused security suite covers provider modes, OIDC/PKCE,
certificate `private_key_jwt`, immediate JWKS rollover, exact tenant/object
identity, current-grant refresh enforcement, the complete role/tool matrix,
fixed direct group membership, Graph/local failure ordering, Owner recovery,
admin-session/CSRF/origin isolation, private append-only audit privileges and
JEM/ERS route separation. The complete repository suite, Cockpit Playwright
suite, dependency audit, desktop render and 390px render pass. Work packages
F-G remain live/organizational rollout work and are not implied by the local
result.

**JEM correction record (2026-08-26):** The initial `v1.8.0` JEM canary passed
the GitHub login/refresh/read/write and route-isolation checks, but its local
doctor/smoke process inherited a stale ERS database URL from ambient
`.env.local`. Hosted content, sources, grants and OAuth state did not cross;
operational telemetry did. The exact 481,170 JEM-labelled event rows and one
heartbeat were removed from the ERS database without changing legitimate ERS
rows. `v1.8.1` makes every database-aware doctor/smoke command prove its Brain,
HTTPS endpoint and Supabase project binding before network access, or load that
tuple from the exact owner-only Brain Monitor profile. The tagged release was
deployed to JEM on 2026-08-26 and passed GitHub refresh, authenticated read,
bounded write, local sync and heartbeat checks with 40 hosted files and zero
conflicts. Canary telemetry landed in the JEM database; the post-canary ERS
check remained at zero JEM events and zero JEM heartbeats. The follow-up
`v1.8.2` release makes the legacy heartbeat compatibility path an actionable
schema-migration warning. After the missing JEM migration passed its security
gate and the live watcher adopted current-state storage, 57,861 JEM and 475,091
ERS obsolete heartbeat events were removed without changing either Brain's
non-heartbeat event count. Work package F may now proceed to private overlay
intake from the exact `v1.8.2` tag. JEM Fly release 76 reports version 1.8.2
and the expected GitHub-only runtime; ERS remained untouched on version 1.7.3
and Fly release 15.

**ERS Graph correction record (2026-08-28):** The first live John Entra Owner
session proved certificate-backed admin authentication but exposed unavailable
drift checks for other Owners because the adapter enumerated each target user's
directory memberships. Release `v1.8.3` instead enumerates only the four fixed
managed groups using the already-approved delegated permission, performs one
bounded group-read set per access-page reconciliation and leaves the wider
directory unread. The three-owner and Reader lifecycle canary remains required
before Entra-only cutover.

**Access UX correction record (2026-08-28):** Release `v1.8.4` makes the ERS
Cockpit first screen the normal Identity & Access entry, explains all four
roles both before selection and inside the confirmation modal, and replaces
the ambiguous `Reconcile` action with a review-first workflow. GitHub fallback
rows remain visible for the dual-provider rollback window but no longer expose
an Entra action they cannot complete. This changes no role authority, provider
mode, Graph scope or Entra-only activation gate. The annotated release was
deployed JEM-first on 2026-08-28 as Fly releases 78 (JEM) and 18 (ERS). Live
health and Machine checks passed, and the profile-bound ERS hosted doctor
returned `pass` with no operator action. Cillian's Owner sign-in and Jeronimo's
Reader sign-in/read remain the human acceptance gate.

**GitHub display-label correction record (2026-08-28):** Release `v1.8.5`
shows each bounded GitHub fallback principal by human name and login, with the
immutable numeric GitHub ID retained underneath as audit detail. Display
metadata is accepted only from the deployment registry entry whose provider,
tenant and user ID exactly match the enforced grant; names and logins never
participate in authorization. This adds no external GitHub lookup, database
migration, grant mutation, provider change or Graph scope. The annotated release
was deployed JEM-first as Fly release 79 and then as the reviewed private ERS
overlay at Fly release 19. Both health and Machine checks passed. A live ERS
Owner-session UI check confirmed the two fallback rows render as Cillian
McGorman / `@Cillianm-ers` and John E. Milad / `@jemilad-ers`, with their
immutable GitHub IDs retained beneath.

**Provider kill-switch correction record (2026-08-28):** Release `v1.8.6`
makes `BRAIN_IDENTITY_PROVIDERS` a complete runtime authorization boundary,
not only an authorization-redirect choice. Disabled-provider authorization
codes, refresh tokens and signed bearer tokens fail before grant lookup. The
denial has a bounded `provider_disabled` auth-telemetry reason on the bearer
path and records no credential material. The ERS GitHub grants may remain inert
during the approved rollback window; no permanent legacy GitHub-user controls
are added. JEM's explicit GitHub-only provider remains enabled and covered by
the same positive-path regression suite.

**Entra-only release-contract correction (2026-08-28):** Release `v1.8.7`
retains the exact `v1.8.6` runtime behavior and corrects the shared deployment
gate to recognize provider-appropriate immutable Owner IDs: numeric for GitHub
and GUID for Entra. The gate rejects a numeric ID presented as Entra. This is a
test/release-contract correction only; it adds no runtime, schema, provider,
secret or Brain-content change.

### A. Provider-neutral authorization shell

- Separate shared MCP authorize-request validation/state creation from the
  GitHub redirect/callback implementation.
- Replace mandatory GitHub fields in `OauthConfig` with a discriminated,
  provider-aware configuration.
- Route callbacks per enabled provider while preserving `/authorize`, `/token`,
  `/register`, issuer and resource URI.
- Persist provider, upstream nonce/PKCE state and tenant identity in the existing
  short-lived/durable OAuth records without a schema migration if the JSON store
  can safely carry them.

### B. Entra OIDC provider

- Add tenant-specific discovery/JWKS, authorize redirect, certificate-backed
  token exchange and validated identity resolution.
- Use an established JOSE/OIDC dependency; pin and review it through the normal
  dependency process.
- Add bounded discovery/JWKS caching, rollover behavior, timeouts and sanitized
  failure classes.
- Add certificate-expiry health output with no private-key or assertion data.

### C. Grant ledger and session authorization hardening

- Add `provider_tenant_id` to principal/JWT/auth-record handling.
- Make stable-ID matching exclusive when an ID exists; remove mutable-field
  fallback after a stable-ID mismatch.
- Add private Postgres principal/grant and immutable audit-event records with a
  reviewed migration; retain only a private initial-owner bootstrap path.
- Recheck current grant authority during refresh and every tool call; revoke
  current sessions on suspension, removal or downgrade.
- Add duplicate/format/provider-mode validation and deployment-profile tests.
- Remove GitHub-specific fabricated noreply addresses from generic Entra
  revision attribution.

### D. Hosted access administration

- Reuse the Cockpit shell, navigation and components for a profile-scoped
  **Access & Roles** section, while keeping the local and hosted backends
  separate.
- Add the same-origin ERS-only hosted access page and a separate recent Entra
  admin session; keep ordinary MCP OIDC authentication free of Graph scopes.
- Add a least-privileged directory picker and fixed-group membership adapter
  using delegated Graph tokens only while an authorized owner is present.
- Make Graph/local grant transitions fail closed, idempotent and auditable;
  include live drift detection and bounded reconciliation for the four groups.
- Add owner/admin privilege separation, two-owner minimum, CSRF/origin and
  confirmation controls, accessible states, and explicit partial-failure
  remediation.
- Do not retain Graph access or refresh tokens beyond the short admin session,
  expose a generic Graph proxy, or allow a request to supply a group ID.
- Keep the JEM profile GitHub-only and prove that neither its local nor hosted
  surface registers the ERS access routes or loads ERS Entra/Graph config.

### E. Role enforcement

- Declare the minimum role for every tool in one testable authority table.
- Tighten member/admin boundaries for high-impact and structural operations.
- Keep `reader` genuinely read-only, including hidden receipts or logs.
- Add exhaustive role tests that fail when a tool is added without a policy.

### F. JEM canary and ERS private overlay

- Release the tenant-neutral code upstream first.
- Deploy JEM first in explicit GitHub-only mode and prove no OAuth, tool or
  connector regression.
- Intake the annotated tag through the exact four-surface ERS private overlay.
- Create/custody the ERS Entra app certificate and secrets, four role groups,
  fixed app-role assignments and delegated Graph consent through ask-first
  provider actions; no secret value enters chat or git.
- Bootstrap John, Cillian and the designated IT/TDM identity as owners and
  group owners before enabling the UI.
- Run ERS dual-provider canary, then a second guarded deployment in Entra-only
  mode after acceptance.

### G. Production access and governance closeout

- Restrict SharePoint Brain Markdown writes to the curator group; preserve
  appropriate read access to Brain/source links.
- Reverify second-admin custody, external health/alerting and the onboarding/
  offboarding runbook.
- Complete the item-14 evidence package and record the ELT decision.
- Reconcile public roadmap/security wording, private deploy docs, the ERS Brain
  sign-off register and `team_access` metadata.

## Verification plan

### Automated

- Provider configuration matrix: GitHub-only, Entra-only, dual, incomplete and
  forbidden authority values.
- Entra callback fixtures: valid; wrong tenant/audience/issuer/nonce/key;
  expired/not-yet-valid; missing `tid`/`oid`; malformed GUIDs; replayed state;
  token endpoint failure; JWKS rollover; unregistered or unassigned principal.
- Grant matching: exact `entra + tid + oid`; mutable-claim mismatch cannot
  authorize; duplicate identities, multiple role groups and invalid roles fail
  closed.
- Refresh and request authorization: removed/downgraded principal is denied;
  tenant and provider claims survive code/refresh grants; no GitHub-only
  attribution leaks into Entra actors.
- Admin authorization: Reader, Curator and Admin denied; Owner controls all
  roles; reducing below two Owners is denied; admin routes are absent on JEM
  and disabled ERS profiles.
- Profile isolation: switching the shared Cockpit shell between JEM and ERS
  changes only presentation/navigation; JEM cannot call an ERS access endpoint,
  ERS access APIs reject caller-selected Brain IDs, and no session or grant
  crosses deployments.
- Graph adapter fixtures: fixed-group allowlist, directory-search field bounds,
  add/change/remove idempotence, no arbitrary group ID, delegated-token expiry,
  partial failure, fail-closed revocation and drift reconciliation.
- Hosted admin web security: fresh-session requirement, CSRF/origin/cookie
  protections, confirmation flow, safe error rendering and immutable audit
  attribution.
- Exhaustive role matrix across every tool, including hidden write side effects.
- Existing GitHub OAuth, PKCE, DCR, durable-state, callback-allowlist,
  cross-Brain and telemetry regression suites.
- Deployment-profile tests: JEM requires GitHub only; private ERS dual/Entra
  profiles require their exact non-secret settings and forbid fallback paths.
- Secret/redaction scans over errors, telemetry and fixtures.

### Live canary

1. JEM GitHub login, refresh and read/write smoke after the shared release.
2. ERS Entra login for John; list only `ers-brain`; read; approved narrow write;
   negative JEM read and write.
3. ERS Entra login for Cillian and the designated IT/TDM identity; verify all
   three initial owners can access the admin surface and no non-owner can.
4. Wrong-tenant and unregistered-object-ID callback denial with zero Brain auth
   codes/tokens and zero content changes.
5. John uses the hosted UI to grant a bounded test user Reader, change that user
   to Curator, then suspend/revoke. Verify Graph group membership, the local
   audit trail and immediate denial of existing Brain access/refresh tokens.
6. A `reader` attempts every mutation family and is denied; a curator performs
   one non-structural update; an admin performs one bounded structural/recovery
   test if explicitly approved.
7. Restart/redeploy and prove durable MCP registration, Brain refresh, Entra
   reauthentication and auth telemetry remain healthy.
8. Real-client matrix: Claude ERS, ChatGPT Business browser workspace, fresh
   Codex app/session, and any other surface named in the rollout cohort.
9. Switch ERS to Entra-only; prove GitHub can no longer start or complete an ERS
   authorization and that pre-cutover GitHub codes, refresh tokens and bearer
   tokens are denied before grant lookup, while JEM GitHub remains unaffected.

### Commands

- `npm run build`
- focused `node --test` OAuth, registry, request-context, role and deployment
  profile tests during implementation
- `npm test`
- `git diff --check`
- guarded JEM deployment and live health/OAuth/client checks
- guarded ERS private-overlay deployment and live Entra/isolation/client checks

## Cutover sequence and stopping points

1. **Approve Spec 018.** No code, app registration, secret or deployment before
   explicit implementation authorization.
2. **Build tenant-neutral code and tests upstream.** Stop if the provider seam
   would require ERS-private identity in the public repository.
3. **Release and JEM canary.** Stop on any GitHub regression.
4. **Complete one-time Entra setup.** TDM creates/consents the app and fixed role
   groups, verifies group-assignment licensing, and makes John, Cillian and the
   designated IT/TDM identity owners. Provider, consent, secret, DNS and Fly
   actions remain individually ask-first.
5. **Deploy dual mode and access administration.** Stop on any Graph permission
   broader than approved, arbitrary-group path, non-owner access, audit gap,
   partial grant, or non-immediate local revocation.
6. **Three-owner pilot.** Stop on any identity ambiguity, mutable-claim grant,
   permission bypass, foreign-Brain visibility, client incompatibility or
   unactionable auth failure.
7. **Close governance/access gates.** SharePoint permissions, production
   alerting, second-admin evidence and ELT item 14.
8. **Deploy Entra-only and stage readers.** John or Cillian adds the bounded
   cohort through the hosted UI; verify the provider kill-switch against stale
   GitHub credentials and observe auth/support load before adding curators.
9. **Disable GitHub ERS credentials after the rollback window.** Preserve JEM's
   separate GitHub provider and credentials.

## Rollback

- Before Entra-only cutover: use the existing GitHub pilot path; no Brain data
  rollback is required.
- After Entra-only cutover but before GitHub credential retirement: guarded
  redeploy ERS to dual mode and direct only John/Cillian to GitHub while the
  Entra defect is corrected.
- After GitHub credential retirement: roll back to the prior tested Entra
  release or issue a new certificate/secret through the provider recovery
  process. Do not re-enable email/domain fallback.
- A provider rollback never merges the JEM and ERS registries, databases,
  credentials or connectors.
- Connector recovery follows the product-specific runbooks. For OpenAI
  workspace apps, a state-invalidating change may require browser-side
  disable/delete/recreate before Codex is retested.

## Critical path and accepted residuals

**Critical path:** Entra implementation and validation; the narrow hosted
access-administration surface and least-privileged delegated Graph path; exact
principal/grant enforcement; role enforcement; SharePoint write-plane
alignment; three-owner Entra canary; cross-identity/cross-Brain negative tests;
target-client compatibility; external health/alerts; owner recovery evidence;
and the standing ELT rollout decision.

**Non-blocking residuals:** timed restore rehearsal, PITR, automated ingestion,
dedicated Slack-app migration if another ERS-owned alert route is live,
SharePoint editor passthrough, full MCP `2026-07-28` migration, original-byte
downloads, Spec 014, vector search and a hosted reader UI.

## Assumptions requiring confirmation before implementation approval

- The first wider cohort can launch read-only, with curator access granted
  separately.
- The ERS tenant licensing supports assigning security groups to enterprise-
  application roles. If not, implementation returns to design review rather
  than silently widening access or substituting raw email/domain matching.
- ERS can restrict write access on the Brain Markdown folder independently of
  broader read/source navigation.
- A certificate/private-key credential can be held and rotated through the ERS
  Fly/Dashlane custody path; no Azure-hosted managed identity is available.
