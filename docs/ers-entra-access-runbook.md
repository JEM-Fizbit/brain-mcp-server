# ERS Brain Entra Access Runbook

**Status:** implementation runbook; activation remains approval-gated
**Last updated:** 2026-08-25
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
- The local ERS Cockpit links to the hosted page. It never receives or proxies
  a Graph token. The JEM Cockpit does not show that link.

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
- `GroupMember.ReadWrite.All` for fixed-group membership changes.

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

## 6. Routine access operations

An Owner opens `https://brain.ersgenomics.online/admin/access`, completes a
fresh Microsoft sign-in, searches the basic ERS directory and selects the
person. Reader is the default. A higher role requires deliberate selection and
explicit confirmation.

- Grant/elevation: Graph succeeds first; the local grant becomes usable only
  after the private projection commits.
- Downgrade/suspend/revoke: the local grant is restricted first; Graph follows.
- Multiple, missing, mismatched or unexpected group membership is shown as
  drift. Use **Reconcile** to reapply the reviewed local role/status.
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
stricter local state, then use **Reconcile** once Graph is healthy.

## 9. Rollback

- Before Entra-only: keep the existing bounded GitHub pilot available while
  correcting Entra. Do not alter Brain data.
- After Entra-only but before GitHub credentials are retired: a guarded ERS
  release may temporarily restore dual mode only with owner approval.
- After GitHub retirement: redeploy the prior tested Entra release/config;
  GitHub is not an automatic fallback.
- Never point ERS at JEM credentials, database, registry or OAuth registration.
