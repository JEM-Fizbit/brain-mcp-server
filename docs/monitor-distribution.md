# Monitor distribution and automatic updates

**Status:** inventory deployed; normal update-feed activation in progress, 23 October 2026.
The private inventory migrations were approved and applied to both owners on
23 October. Separate `brain-monitor-jem` and `brain-monitor-ers` signing keys are
held in the existing Mac Keychain. No normal update feed, fleet targeting
or colleague installation has been activated. Both hosted services run v1.14.0;
the developer operator stack remains live. Signed canaries for both owners
automatically downloaded build 6, then installed/relaunched from build 5 with
Developer ID verification. [Implementation brief](specs/024-monitor-distribution-and-automatic-updates.md).

## Two operator surfaces

The existing native developer Monitor supervises local sync, a loopback Cockpit
and database-backed Doctor. Its private profiles remain on the developer machine.
Do not copy that app/configuration to colleagues, or replace its configured
checkout, Node, login item, Keychain, Full Disk Access or recovery state via a fleet
deployment.

The portable Monitor built by `npm run monitor:package` carries Node 22 and a small
signed native host. It opens the existing authenticated hosted Cockpit/status,
operational diagnostics and change log. It has no local sync or SQL credentials.
The approved human Curators can view bounded hosted operational metrics without
gaining structural writes, access administration or database privileges. This is
not a fleet distribution of the full developer Doctor. Windows users use the same
hosted pages; this repo does not build a Windows native Monitor.

## Cohort and installation evidence

`BRAIN_MONITOR_POLICY_FILE=/app/config/monitor-operators.json` activates a strictly
Brain-bound operator policy. Each entry names exact provider, tenant and user IDs,
a human person identifier and an update mode. Role grants remain authoritative and
are checked on each report; the allowlist supplements rather than replaces them.
Never derive human eligibility from a display name, email or a role alone: agents
and break-glass accounts can also hold those roles. Owner-specific names/IDs live
in the private overlay. Several principals may share one person identifier without
merging their identity grants. Optional per-operator `devices` entries bind an
observed installation UUID to a mode. A developer default fails closed until a
specific non-developer installation is classified; it is not a permanent claim
that all of that person's computers are developer devices. Do not infer device
classification from a role or invent installation UUIDs.

| Mode | Package behavior |
| --- | --- |
| `automatic` | Sparkle checks daily, verifies the signed feed/archive, downloads and attempts installation on quit; authorization requirements may need user interaction. |
| `mdm` | No app updater; the IT deployment system owns installation. |
| `developer` | No app updater; preserve the configured developer app and toolchain. |

The app's **Sign in / Register this Monitor** uses existing Brain OAuth, PKCE S256
and a random loopback callback. Credentials stay in the signed native host's
Keychain. The launch window exposes registration, status, refresh, quit and hosted-page
links; **Show Monitor** reopens it from the menu bar. Only private child pipes
carry credentials to the bundled reporter. There is
no token-export CLI, .env loading or command-line token argument. The updater starts only after an accepted report confirms automatic mode; every
update check requires a policy receipt less than 20 minutes old. The app reports
every 15 minutes while running. Identical release reports coalesce for five
minutes; a changed build/version/source/mode is recorded immediately. Bounded request,
query and device admission prevent a tight retry/write loop. A failed report does
not open a login browser automatically. A failed refresh is retried only at the
next heartbeat or explicit sign-in.

Owner **Identity & Access → Installed Monitors** joins reports to exact current
grants. JEM's Owner view is `/monitor/installations`. A report contains random
installation ID, app version/build, code revision, platform/architecture and update
mode/state. It contains no hostname, serial, IP, path, credential or Brain content.
Last contact is timestamped by the server. Build data is authenticated but
self-reported, not remote attestation. Missing reports mean **installation
unverified**; reports older than 24 hours are labelled stale/offline, never
uninstalled. Report history is latest state, not an append-only device audit log.

Existing apps that predate registration cannot be discovered retroactively from
Brain enrolment. The bootstrap/install acceptance must record the actual device
and mode. Do not invent a successful receipt from the access roster or from a
build on the developer's Mac. Installing the portable app does not migrate an
existing developer sync stack.

## Preparing a release

Use existing owner-approved Developer ID signing/notarisation custody. No new
Apple membership or account conversion is necessary. Sparkle Ed25519 keys are
separate credentials; create them only after the production custody decision,
with different owner-controlled Keychain accounts for JEM and ERS. Preserve the
private keys outside the feed-serving host. The public key is embedded in the
signed app and cannot be swapped by a downloaded profile.

Pin Sparkle **2.10.0**, official archive SHA-256
`c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c`.
Obtain it from the [official release](https://github.com/sparkle-project/Sparkle/releases/tag/2.10.0).
Use the official self-contained Node 22 macOS binary for the target architecture;
the production builder rejects Homebrew/external-library dependencies.

Set explicit `BRAIN_MONITOR_ORIGIN`, `BRAIN_MONITOR_BRAIN_ID`,
`BRAIN_MONITOR_BUNDLE_ID`, positive monotonic `BRAIN_MONITOR_BUILD`,
`BRAIN_MONITOR_UPDATE_MODE`, `BRAIN_MONITOR_NODE` and a fresh
`BRAIN_MONITOR_OUTPUT`. For automatic mode also set `BRAIN_MONITOR_SPARKLE_FRAMEWORK`,
the same-owner HTTPS `BRAIN_MONITOR_FEED_URL` ending `/monitor/updates/appcast.xml`,
and `BRAIN_MONITOR_PUBLIC_ED_KEY`. Set `BRAIN_MONITOR_SIGN_IDENTITY` and the existing
`BRAIN_MONITOR_NOTARY_PROFILE`, then run `npm run monitor:package`.

The builder requires a clean committed checkout, bundles no private profile,
signs nested code/runtime, submits to Apple notarisation, staples, assesses with
Gatekeeper, then archives and hashes the final app. `--fixture` builds only an
ad-hoc local fixture, explicitly marked non-distributable. It never overwrites an
existing output directory or installs an app.

`npm run monitor:release:prepare` takes `BRAIN_MONITOR_PACKAGE_RECEIPT`,
`BRAIN_MONITOR_SIGNING_ACCOUNT`, `BRAIN_MONITOR_SPARKLE_BIN`, owner origin/Brain,
and a fresh `BRAIN_MONITOR_RELEASE_OUTPUT`. Optional
`BRAIN_MONITOR_PREVIOUS_RELEASES` retains prior archives in the new output.
The official Sparkle tools sign/verify the feed and archives. Do not prune old
archives or reuse a build number. Prepared output is not published.
For the isolated upgrade trial, `BRAIN_MONITOR_FEED_NAME=canary.xml` prepares a
separate signed feed. Only the portable test installation uses that URL; normal
`appcast.xml` stays absent until the signed upgrade passes. The developer
supervisor app and its profiles are not the test installation.
After acceptance, `BRAIN_MONITOR_PROMOTE_CANARY=1` publishes the verified normal
feed at the retained canary URL too. Trial installations can then upgrade into
the normal channel with the same bundle identity and Keychain credentials.

`npm run monitor:release:stage` uses `BRAIN_MONITOR_PREPARED_RELEASE`, bound
`BRAIN_ID` and `BRAIN_HOSTED_BASE_URL`. It copies only feed/archives into ignored
`config/monitor-release-assets/` and writes the hash manifest as
`config/monitor-release-manifest.json`. Commit that non-secret owner-specific
manifest; private ERS metadata stays in the private overlay. The guarded deploy
checks every asset against it before/after tests and refuses extra files.
Archives stay out of Git but must accompany the build context. Keep a durable
owner-controlled recovery copy before cleaning a checkout.

Once separately approved, the private inventory migration and RLS gate run per
Brain. Enable the policy and set `BRAIN_MONITOR_RELEASE_DIR` to
`/app/config/monitor-release-assets` in the selected deployment's Fly config.
Publish through the normal tagged guarded deployment. The same origin then serves
the feed and immutable build/architecture archives. No new bucket, daemon or
public Brain-data access is needed. Publishing a signed feed makes updates
available; offline clients catch up at a later check. It is not an instant push.

## Acceptance and remaining gates

Before activation: pass the full Node 22 suite, isolated PostgreSQL RLS/privilege
checks, desktop/narrow inventory checks and native compilation. Then verify an
actual signed/notarised bootstrap and upgrade on a canary: signature/feed refusal,
Keychain retention, build report, safe quit/relaunch and hosted diagnostic access.
Keep a previous signed package available for deliberate rollback. Sparkle does
not constitute a tested automatic post-launch rollback mechanism.

After activation: observe actual installations for the approved people, with the
developer exclusions still explicit. Devices with unknown OS/install state stay
unverified. Sending IT instructions, targeting Intune groups and distributing
packages are recorded delivery steps; none is implied by a local fixture test.

Sources: [Sparkle setup](https://sparkle-project.org/documentation/),
[automatic-update and verification settings](https://sparkle-project.org/documentation/customization/).
