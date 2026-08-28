# ERS Brain Entra Access Runbook

**Status:** dual-provider canary active; Entra-only cutover remains approval-gated
**Last updated:** 2026-08-28
**Scope:** ERS-owned deployment only (`ers-brain`)

This runbook activates and operates the Spec 018 identity and permissions
baseline. It does not apply to JEM Brain: JEM remains GitHub-authenticated and
does not expose hosted role administration.

## Trust boundaries

- Entra authenticates the workforce tenant and person using exact `tid` plus
  `oid` claims.
- Four dedicated Entra security groups map to Reader, Curator, Admin and Owner
  application roles.
- Private Postgres grants are the immediate Brain enforcement and audit layer.
- The hosted ERS `/admin/access` page is the only normal role-mutation UI.
- Its Graph token is delegated, held only in a short server-memory session and
  never sent to the browser, database, logs or telemetry.
- Brain Cockpit is the normal operator entry: the ERS Overview presents a
  dedicated **Identity & Access** module and matching navigation link to the
  hosted page. It never receives or proxies a Graph token. The JEM Cockpit
  presents neither entry.

## Approval boundaries

The following are separate ask-first actions: Entra app/group creation, tenant
admin consent, certificate custody, applying the database migration, initial
Owner bootstrap, changing Fly secrets, deploying either runtime, SharePoint
permission changes and enrolling users. A successful local test does not imply
that any of these actions occurred.

## 1. One-time TDM setup

Create one single-tenant ERS app registration with exact production redirect
URIs:

```text
https://brain.ersgenomics.online/authorize/entra/callback
https://brain.ersgenomics.online/admin/oauth/callback
```

Create these application roles, allowing assignment to users/groups:

| Entra app role | Brain role | UI label |
|---|---|---|
| `Brain.Reader` | `reader` | Reader |
| `Brain.Curator` | `member` | Curator |
| `Brain.Admin` | `admin` | Admin |
| `Brain.Owner` | `owner` | Owner |

Create four dedicated cloud-only, security-enabled, non-role-assignable groups,
one per role. Assign each group to exactly its matching enterprise-application
role. Do not reuse a broad department, dynamic or nested group. Verify the
tenant's licensing supports group assignment to the enterprise application.

Grant only these delegated Microsoft Graph permissions for the separate admin
session and complete tenant admin consent:

- `User.ReadBasic.All` for the directory picker;
- `GroupMember.ReadWrite.All` for reading and changing direct membership of the
  four fixed role groups.

Reconciliation enumerates only those four managed groups and compares their
member object IDs with the private grant ledger. It does not request permission
to enumerate another user's wider directory memberships. Do not add
`User.Read.All`, `GroupMember.Read.All` or `Directory.Read.All` for this flow.

Do not grant app-only Graph write permission. Make John and Cillian group
owners for the four groups; retain the designated IT/TDM identity as the third
operational Owner/recovery path.

Create an RSA certificate credential. Store the unencrypted PKCS#8 private key
and SHA-256 certificate thumbprint only in ERS secret custody/Fly secrets. Record
the certificate expiry as non-secret health metadata and set a renewal action
well before the 30-day warning.

## 2. Database migration and security gate

Apply, in order, the existing migrations followed by:

```text
db/migrations/2026-08-25_001_entra_access_grants.sql
```

Then rerun [`security/hosted-brain-supabase-security-gate.md`](security/hosted-brain-supabase-security-gate.md).
The required result is:

- `brain.access_audit_events` has RLS enabled;
- only `brain_runtime` has a policy and table privileges;
- `anon`, `authenticated` and `public` have no Brain grants;
- the existing principal/role rows remain intact;
- `(provider, provider_tenant_id, provider_user_id)` is unique.

Do not run the migration from a routine test or deployment smoke.

**Completed 2026-08-28:** migration
`db/migrations/2026-08-25_001_entra_access_grants.sql` (SHA-256
`9452e1b88a4b263ca6255f144824c5f5f1dd38d2996b1a63c58c82c759617702`)
was applied to the ERS-owned `brain-platform-pilot` project. The complete live
security gate passed: 18/18 Brain tables retain RLS, client/public Brain grants
and non-runtime Brain policies remain zero, the access audit is append-only for
`brain_runtime`, pre-existing content/telemetry counts were preserved, the
artifact bucket remains private, and Security Advisor reports no issues. The
active `brain_runtime_user_v3` login passed a direct `verify-full` smoke; older
`brain_runtime_user` and `_v2` roles are `NOLOGIN`. This completion does not
authorize the Owner bootstrap, Fly secret changes, deployment or enrollment.

## 3. Initial Owner bootstrap

First place John, Cillian and the designated IT/TDM identity in the dedicated
Owner group and verify all three have the `Brain.Owner` enterprise-app role.
Prepare a local owner-only JSON file outside git:

```json
[
  { "oid": "<john-object-guid>", "name": "John E. Milad", "email": "<ERS email>" },
  { "oid": "<cillian-object-guid>", "name": "<name>", "email": "<ERS email>" },
  { "oid": "<it-tdm-object-guid>", "name": "<name>", "email": "<ERS email>" }
]
```

With the ERS runtime database URL loaded from secret custody, run the guarded
one-time command:

```bash
BRAIN_ID=ers-brain \
BRAIN_ACCESS_BOOTSTRAP_CONFIRM=ers-brain \
ENTRA_TENANT_ID="<tenant-guid>" \
ENTRA_OWNER_GROUP_ID="<owner-group-guid>" \
ENTRA_INITIAL_OWNERS_FILE="<owner-only-json-path>" \
npm run access:bootstrap:entra-owners
```

The command records metadata-only audit rows and refuses fewer than three
reviewed Owners. Delete the temporary JSON securely after the OIDs are retained
in the private grant ledger/password-manager record.

**Completed 2026-08-28:** the guarded bootstrap created exactly three active
`ers-brain` Owners: John E. Milad, Cillian McGorman and Rick Price. Each
principal is bound to the exact ERS tenant and reviewed Entra object ID; each
grant records `Brain.Owner`, the fixed Owner group and
`initial_owner_bootstrap`. The command created three metadata-only `grant`
audit rows with `graph_outcome=preverified` and empty metadata. Post-write
checks retained 18/18 Brain tables under RLS with zero client/public grants and
zero non-`brain_runtime` policies. The temporary owner JSON was removed after
the identities were retained in the private ledger. This completion does not
authorize Fly secret changes, deployment or enrollment.

## 4. ERS canary configuration

The private ERS overlay supplies non-secret deployment values and Fly supplies
secret values. The dual-provider canary uses:

```text
BRAIN_ID=ers-brain
BRAIN_IDENTITY_PROVIDERS=github,entra
BRAIN_IDENTITY_DEFAULT_PROVIDER=entra
BRAIN_ACCESS_GRANT_STORE=postgres
BRAIN_OAUTH_STATE_STORE=postgres
ENTRA_TENANT_ID=<exact tenant GUID>
ENTRA_OAUTH_CLIENT_ID=<exact app GUID>
ENTRA_OAUTH_CALLBACK_PATH=/authorize/entra/callback
ENTRA_ADMIN_CALLBACK_PATH=/admin/oauth/callback
ENTRA_ADMIN_GRAPH_ENABLED=1
ENTRA_REQUIRED_INITIAL_OWNER_COUNT=3
ENTRA_OAUTH_CLIENT_CERT_EXPIRES_AT=<ISO date/time>
```

Secret/private deployment values are:

```text
ENTRA_OAUTH_CLIENT_PRIVATE_KEY_PEM
ENTRA_OAUTH_CLIENT_CERT_THUMBPRINT
ENTRA_BRAIN_ROLE_GROUP_IDS
ENTRA_ADMIN_SESSION_SECRET
```

`ENTRA_BRAIN_ROLE_GROUP_IDS` is a JSON object with exactly four distinct GUIDs
keyed by `reader`, `member`, `admin`, and `owner`. The session secret must be at
least 32 characters. A client secret is local-test-only and is rejected by a
hosted HTTPS profile. Do not set email/domain/self-enrolment allowlists.

The ERS service refuses to register `/admin/*` unless the deployment is bound
to `ers-brain`, Graph administration is enabled and the required Owner roster
already exists. The JEM Fly profile must explicitly retain:

```text
BRAIN_ID=ai-brain-jem
BRAIN_IDENTITY_PROVIDERS=github
BRAIN_IDENTITY_DEFAULT_PROVIDER=github
```

## 5. Canary and cutover

For local JEM or ERS doctor/smoke commands, select the exact owner-only Brain
Monitor profile. Do not switch Brains by changing only `BRAIN_ID`:

```bash
BRAIN_ID=ai-brain-jem \
BRAIN_MONITOR_CONFIG_FILE="$HOME/Applications/Brain Monitor.app/Contents/Resources/brain-menubar-config.json" \
npm run hosted:doctor
```

If a database URL is present, the command refuses to run until the selected
Brain id, HTTPS hosted endpoint and expected Supabase project ref match the
credential. This guard applies before reads, telemetry or content writes.

Run the Spec 018 live matrix in order:

1. Deploy the shared release to JEM in GitHub-only mode; verify GitHub login,
   refresh, read and approved write, with `/admin/access` returning 404.
2. Intake the same annotated release into the private ERS overlay.
3. Deploy ERS in `github,entra` mode. John, Cillian and IT/TDM each complete a
   fresh Entra Owner login and open `/admin/access`.
4. Prove wrong tenant, unregistered object ID, JEM Brain access from ERS and
   ERS Brain access from JEM all fail without content changes.
5. Grant a bounded test identity Reader, change it to Curator, suspend and
   revoke it. Verify the local grant, fixed groups, dated audit history,
   reader-denied mutation, curator write and immediate refresh/tool denial.
6. Exercise Claude ERS, ChatGPT Business browser workspace and a fresh Codex
   session. Record reconnect versus recreate behavior without credentials.
7. Reconcile SharePoint Brain-folder writes to the named Curator population.
8. Activate an ERS-owned external `/health` check and actionable alert route.
9. Only after John and Cillian accept the results, switch ERS to
   `BRAIN_IDENTITY_PROVIDERS=entra`, remove GitHub fallback configuration and
   prove ERS GitHub authorization no longer starts or completes.

Do not broaden the cohort during the dual-provider canary.

### 2026-08-26 JEM canary correction

The first JEM `v1.8.0` canary passed GitHub login, refresh, read/write and route
isolation. Its local smoke/doctor process nevertheless exposed a separate
operator-configuration defect: ambient `.env.local` held the ERS runtime
database while the command defaulted to the JEM Brain id and endpoint. No Brain
content, source bytes, grants or OAuth state crossed deployments. The effect was
limited to operational metadata, but it was material: 481,170 historical
JEM-labelled `brain.sync_events` rows and one JEM heartbeat had accumulated in
the ERS database. Those exact rows were deleted on 2026-08-26; legitimate ERS
rows were unchanged.

Corrective release `v1.8.1` adds a shared fail-closed binding assertion to the
doctor and OAuth smoke, makes the local environment template realm-neutral, and
uses the selected Brain Monitor profile as the durable manual-command source.
It was deployed to JEM on 2026-08-26. GitHub OAuth refresh, authenticated reads,
the bounded hosted write, local sync verification, current heartbeat, 40 hosted
files and zero conflicts all passed. JEM's database recorded the server, client
end-to-end and sync-wait canary rows. The final ERS check remained exactly zero
JEM events and zero JEM heartbeats, with the legitimate ERS event count
unchanged at 476,494.

Release `v1.8.2` adds the follow-up observability acceptance fix: a live legacy
heartbeat fallback is now an actionable missing-migration warning rather than
a false green. The JEM bounded-observability migration passed its complete
security gate, and its active watcher adopted the current-state row without a
restart. After fresh state rows were proved on both Brains, 57,861 JEM and
475,091 ERS obsolete heartbeat events were removed in bounded, profile-guarded
batches; the 1,890 JEM and 1,404 ERS non-heartbeat events were unchanged. This
is distinct from the earlier misrouted-telemetry cleanup above. JEM Fly release
76 now reports version 1.8.2 and the expected GitHub-only runtime. ERS remained
untouched on version 1.7.3 / Fly release 15. Automatic vacuum completed on both
event tables with zero estimated dead rows; allocated relation space remains
available for reuse and no locking `VACUUM FULL` was run.

Private ERS overlay intake may proceed from the exact `v1.8.2` tag; this
evidence does not authorize an ERS migration, secret change, Entra action or
deployment.

The 15:29 BST JEM auth alert was investigated separately. Two `token_expired`
requests came from the registered Cursor client and were followed about 0.3
seconds later by refresh-token rotation and successful MCP requests. The single
`missing_bearer` request was an isolated unauthenticated request whose caller is
not identifiable from deliberately bounded telemetry. Successful JEM hosted
tool calls followed at 15:32 BST. Treat this event as recovered client behavior,
not an outage or evidence of the telemetry-routing defect. If the same client
repeats failures without an immediate successful refresh/tool call, reconnect
or re-enrol that client using the connector-recovery protocol.

The rolling count later reached four because of one additional isolated
`token_expired` request at 15:51 BST during the release window. Its caller
cannot be safely attributed from the bounded failure row. Five successful JEM
MCP requests began 17 seconds later in the profile-bound canary, and no service,
sync or database check failed. The Cockpit warning therefore needs no manual
clear; it expires with the 60-minute observation window. Reopen the incident
only if new failures recur without subsequent successful traffic.

## 6. Routine access operations

An Owner normally opens the ERS Brain Cockpit and selects **Identity & Access →
Open Access & Roles**. Direct access at
`https://brain.ersgenomics.online/admin/access` remains available for another
Owner who does not operate John's local Brain Monitor. Complete a fresh
Microsoft sign-in, search the basic ERS directory and select the person. Reader
is the default. A higher role requires deliberate selection and explicit
confirmation. The page and confirmation modal describe the roles:

- Reader can search and read Brain content and status, but cannot change it;
- Curator adds ordinary non-structural content updates;
- Admin adds structural, recovery and conflict operations, but cannot manage
  access; and
- Owner has Admin-level content authority plus access administration and
  governance responsibility.

- Grant/elevation: Graph succeeds first; the local grant becomes usable only
  after the private projection commits.
- Downgrade/suspend/revoke: the local grant is restricted first; Graph follows.
- Multiple, missing, mismatched or unexpected group membership is shown as
  drift. **Review & reconcile** opens a confirmation form prefilled with the
  audited local role/status; opening it changes nothing. The Owner must confirm
  or deliberately revise the intended state. Confirmation reapplies the fixed
  Entra groups and local grant using the normal fail-closed order. The system
  never chooses a role automatically.
- A fixed-group read failure marks Entra drift unavailable as a unit and never
  widens local access. GitHub rollback grants are not Graph-managed: they stay
  visible during dual-provider validation as **not managed here** and expose no
  Entra reconciliation button.
- Admins can administer Brain content/recovery but cannot administer identity.
  Only Owners can use the access mutation APIs.
- The active Owner roster cannot be reduced below two.

Every action records immutable actor/target tenant and object IDs, old/new
role/status, bounded reason and Graph outcome. Display name and email are for
display only.

## 7. Onboarding, changes and offboarding

Onboarding:

1. Confirm the person is an intended ERS user.
2. Grant Reader unless a named Curator/Admin/Owner role is specifically
   approved.
3. Verify exactly one managed group and one matching local active grant.
4. Have the person complete a real client read; for Curator, exercise one
   approved non-structural write.

Role change:

1. Confirm the new role and reason in the hosted UI.
2. Verify the audit row and no drift.
3. For reduction, verify an existing refresh token and prohibited tool family
   are denied immediately.

Offboarding:

1. Suspend or revoke in the hosted UI first. This immediately denies Brain
   tools and refresh even while the old Brain-issued token still exists.
2. Verify removal from all four managed groups and the successful audit row.
3. Remove SharePoint Brain-folder access and complete normal Entra offboarding.
4. Recheck client denial. Disabling the Entra account alone is insufficient.

## 8. Emergency and partial failure

If the hosted UI is unavailable but the private runtime database is reachable,
load secrets locally and use the guarded emergency suspension:

```bash
BRAIN_ID=ers-brain \
ENTRA_TENANT_ID="<tenant-guid>" \
ENTRA_TARGET_OBJECT_ID="<target-object-guid>" \
BRAIN_ACCESS_EMERGENCY_CONFIRM="ers-brain:<target-object-guid>" \
BRAIN_ACCESS_EMERGENCY_REASON="<bounded incident reason>" \
npm run access:emergency-suspend
```

Then TDM removes the target from all four managed groups and an Owner verifies
the audit/drift state after service recovery. The command will preserve the
two-Owner minimum; if only two Owners remain, add/verify a replacement Owner or
use the ERS database-owner break-glass process with two-person review.

If the UI reports `reconciliationRequired`, do not repeatedly click. Capture
the phase and time (never a token), inspect the four fixed groups, keep the
stricter local state, then use **Review & reconcile** once Graph is healthy.

## 9. Rollback

- Before Entra-only: keep the existing bounded GitHub pilot available while
  correcting Entra. Do not alter Brain data.
- After Entra-only but before GitHub credentials are retired: a guarded ERS
  release may temporarily restore dual mode only with owner approval.
- After GitHub retirement: redeploy the prior tested Entra release/config;
  GitHub is not an automatic fallback.
- Never point ERS at JEM credentials, database, registry or OAuth registration.
