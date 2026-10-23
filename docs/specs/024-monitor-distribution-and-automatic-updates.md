# 024 — Monitor distribution, automatic updates and installation inventory

**Status:** in-progress — implementation authorised by John on 23 October 2026;
production migration, release signing and fleet activation require their concrete
deployment checks. No update feed or colleague installation is active yet.
**Source:** BACKLOG.md optional Monitor packaging; John's 23 October request for
automatic updates, developer exclusions and a build inventory in Identity & Access.
**Roadmap link:** ad-hoc
**Decisions impact:** distinguish native installations from Brain grants; preserve
owner isolation, current roles and developer-device exclusions.

## Intent and authority

People should receive tested Monitor releases without asking an agent or replacing
files themselves. Owners can see who has reported an installation, the exact build,
last contact and update mode. An access grant is never evidence of installation.

The Owner control plane and private access ledger were read on 23 October.
The approved cohort contains human Owners and Curators, excluding the break-glass
and agent identities. Its exact names, identifiers and deployment policy belong
in the private owner overlay, never public source. Distinct principals remain
distinct; a person may hold several identities. Do not merge grants based on
names/email or change roles to issue the app.

The dated staff-seat record confirms Intune on Windows and macOS, with explicit
developer-toolchain exclusions on two named operator devices. Preserve those:
developer builds report their version but do not self-replace the checkout or app.
Other managed devices use IT deployment or the signed app updater, never two
concurrent installation owners. No IT instruction is sent by this implementation.

## Delivery

- macOS native Monitor first: it is the only native implementation currently in
  this repository. Browser users and Windows users can use hosted status/Doctor
  observations without installing a macOS package. Windows native packaging is
  outside this work unit.
- Use Sparkle 2 with HTTPS, Ed25519 signed archives and feeds, Developer ID signing
  and notarisation. Validate before extraction; signed-feed failures never expire
  into accepting an unsigned feed. No git-pull, remote shell or unsigned updater.
- Daily automatic checks and downloads/install-on-quit for the standard channel;
  explicit Check for Updates remains available. MDM/developer mode disables the
  app updater. Do not force-quit a sync worker to install a release.
- Existing ad-hoc apps need one bootstrap install. No fleet push can reach an
  old app that lacks an updater, except an authorised MDM deployment.
- Real app version/build/source revision are independent of hosted server version.
  Owner-specific feed/public key and app identity are immutable release inputs.
- Keep profiles, credentials, logs, sync state and recovery bytes outside the
  replaceable app. A distributable bundle contains no operator profile, .env,
  database credential, user path or developer checkout dependency.
- Self-contained browser-monitor packages carry their runtime. Native sync and
  database Doctor remain explicitly provisioned operator capabilities; no sharing
  John's database login. Identity-based colleague sync remains separate backlog.

## Inventory and control plane

- Use the existing Brain OAuth authorization-code/PKCE flow with a loopback
  callback and current identity grants. Keychain holds native tokens, with no
  token/profile contents in telemetry or packages. No automatic sign-in loop.
- Installation reports are scoped to the authenticated principal and runtime Brain;
  the body cannot choose another person or Brain. Suspended/revoked/Reader accounts
  cannot enrol as operators. The private operator policy excludes break-glass and
  agent accounts, and records developer exclusions separately from role grants.
- Report only a random per-installation UUID, app version/build/source revision,
  platform/architecture, update mode and bounded update state. Server timestamps
  establish last contact. No hardware serial, hostname, IP, local path or content.
- Store latest reports in private Postgres with RLS, no public/client grants,
  parameterised bounded queries and request/concurrency limits. The production
  migration must pass the existing Supabase security gate separately in each stack.
- Owner Identity & Access displays the current access roster joined by exact
  provider/tenant/object identifiers. No report means installation unverified;
  offline/stale means last seen, not uninstalled. Reports are self-reported build
  observations, not remote attestation. Multiple devices remain visible.
- JEM uses its existing authenticated owner monitoring surface; never expose ERS
  people or install records there. Curators keep existing content permissions;
  installing a Monitor grants no SQL, Fly, access-admin or structural authority.

## Verification and activation

Test auth/Brain/principal isolation, revocation, malformed/oversized reports,
role/exclusion enforcement, SQL privileges and restart persistence. Exercise the
inventory UI at desktop/narrow sizes, with missing/stale/error/multi-device data.
Test bundle configuration migration, immutable signing inputs, excluded mode,
archive verification and the refusal of incomplete distribution configuration.

Run the full Node 22 suite and relevant Chromium checks. Compile a native fixture;
the real release still needs signed/notarised canary install, bootstrap and upgrade
with profiles/state retained, safe process exit and relaunch health. Publish only
after these checks, then observe the named cohort's actual installation receipts.
Keep the prior signed release available for deliberate rollback; do not claim
automatic post-launch rollback from Sparkle alone.

## Signing custody and remaining gates

The canonical personal asset register records one existing individual Apple
Developer membership. Host-level verification found its valid Developer ID and
working notarisation profile. An earlier restricted-environment check reported
zero identities; that was a visibility limit, not a missing certificate. Reuse
the existing membership; no conversion, new account or purchase is required.
Sparkle signing key/feed custody and the private-schema migration remain separate
production activation gates. Do not invent keys, add CI secrets, target Intune
groups, or publish a feed as a workaround.
Prepare and test the concrete changes before requesting the remaining deployment
authority. The original v1.13.3 full-stack closeout remains complete; this is new
work, not a reopened defect in that release.

## References

- [Sparkle setup](https://sparkle-project.org/documentation/)
- [Sparkle update and verification settings](https://sparkle-project.org/documentation/customization/)
- [Current local operator surface](../hosted-cockpit.md)
- [Hosted status](../hosted-monitoring.md)
- [Identity and rollout contract](018-ers-production-identity-and-rollout.md)


## Implementation checkpoint — 23 October 2026

Implemented on the feature branch: private installation schema, bounded report
API with exact current-role/identity checks, Owner inventory in the existing
control plane plus a JEM Owner page, cohort diagnostics, portable native host,
Keychain-only credential custody, PKCE reporting client, exclusion-aware Sparkle
startup and signed package/feed preparation with deploy-time hash verification.
Private ERS operator IDs are prepared separately without activating the policy.

Observed verification: the full clean Node 22 gate passed 657 tests with 13
optional integration skips; the separate isolated PostgreSQL test passed real
RLS, runtime-privilege, deduplication, restart and Brain-isolation checks. Nine
Chromium checks passed, including desktop/narrow inventory and unavailable-data
handling. Both developer and Sparkle 2.10 automatic native fixture modes compiled.
The synthetic native OAuth/refresh flow also passed. Production signing,
feed verification/upgrade, migration/security re-gates and actual installation
receipts remain pending; do not mark the work complete or deployed from these
fixtures. The existing Apple certificate/notarisation profile is verified usable.


Device policy clarification: a default developer hold preserves pre-inventory
machines. Optional exceptions bind modes to observed installation UUIDs, not an
entire person's role or every computer they own. The updater starts only after a
matching authenticated policy receipt and requires a receipt under 20 minutes
old for each check. Unknown or newly excluded devices cannot start automatic
checks by merely installing the standard-channel binary.
