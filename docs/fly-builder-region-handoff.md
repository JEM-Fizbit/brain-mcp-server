# Fly image-builder region — handoff report

**Status:** ERS build boundary and London acceptance build complete; residual vendor-processing questions and the separate JEM review remain
**Date:** 14 September 2026
**Origin:** ERS AI governance review, 14 September 2026 (Brain Approval Review decision D3; Fly evidence action FLY-14-03)
**Owner of the follow-up:** brain-mcp-server project (John), with the outcome reported back to the ERS governance record
**Scope:** both owner-isolated deployments — the ERS Fly organisation `ers-genomics` (app `ers-brain-mcp`) is the one the governance question is about; check the personal org (`jem-brain-mcp`) at the same time

This document captures the complete state of knowledge about *where Fly builds this server's Docker image* and the options for moving that build out of the United States. It deliberately makes no design decision and proposes no spec. Pick it up, verify the facts against the live account, choose, do, and record.

## ERS acceptance build completed — 18 September 2026

Annotated public release **v1.11.2** (tag object `05b79816bb8d12baf025dbf6d440646bb241411e`, source `20761feccb6ad50bb1791e870d58b6af445c27a2`) carried the tested `.dockerignore` allow-list through the protected ERS intake. The ERS overlay `dc79d818f5fc96fd1e909958b6d679b09a3cc3d3` has no protected-path divergence from that tag. Public, private-intake and guarded-release suites each passed 554 tests: 543 pass, 11 existing fixture/dependency skips and zero failures.

The guarded release built with Depot and reported an **806.81 kB** context, then deployed Fly release **26** / image `registry.fly.io/ers-brain-mcp:deployment-01M2T4WQ8X3VFYY5PYYRJDKSG8` at `2026-09-18T11:38:24.938Z`. Immediately after that completed build, the authenticated ERS **Organization → Settings → App Builders** page showed the organisation's shared global builder as **LHR — London, United Kingdom — 4 CPU, 4 GB RAM**. The guarded command does not request an app-isolated builder, so the post-build shared-builder readback is the location evidence for this build. The deployed machine is also in LHR, runs the exact image above and returned healthy MCP version **1.11.2** with Postgres revisions/OAuth, Supabase artifacts and the Git hot path disabled.

The first guarded attempt stopped before a build because the normal CLI session belonged to the separate personal Fly account. A temporary isolated Fly configuration was authenticated to the existing ERS account and used for the successful run; the normal personal session remained unchanged. No password, token, runtime secret, permission, database, Brain content or workforce enrolment was changed.

The two engineering evidence items are closed: the build-input restriction is in the protected ERS release, and a subsequent real build is evidenced against the London builder. FLY-14-03 can treat the build-location/input subtask as complete. Registry replication, build-cache/log retention, control-plane/support processing, dependencies and historical copies remain matters for Mike's vendor-processing disposition; this engineering result does not grant governance clearance. JEM remains a separate owner/account review and was not changed.

## ERS builder move completed — 14 September 2026

John explicitly approved moving the shared ERS builder to London at unchanged hardware. At approximately **21:09 UTC / 22:09 BST**, the authenticated Fly Settings page returned “Builder configuration updated successfully” and showed **ers-genomics — LHR, London, United Kingdom — 4 CPU, 4 GB RAM**. The operation recreates the shared builder and discards cached layers; no Brain or BDR runtime deployment was invoked. An initial form submission retained IAD; the region was then explicitly selected and the final London result verified. No credentials, access permissions or subscription were changed.

Both ERS and JEM public health endpoints returned HTTP 200 after the change. This confirms endpoint availability; it is not a fresh client/role acceptance run. The later v1.11.2 intake and acceptance build are recorded above.

**FLY-14-03:** the builder-location and input-boundary engineering evidence is complete. Outstanding registry/cache/log-retention or historical-copy evidence remains for Mike's disposition under **D3**. The move does not establish UK/EU-only registry, control-plane, support or subprocessor handling and does not clear the joint vendor-review gate. Personal JEM builder review remains separate; no JEM infrastructure change is approved by this ERS move.

## Engineering follow-up — 14 September 2026

*Pre-move investigation; the completed action above supersedes its pending-state statements.*

This section supersedes the original handoff's assumptions below. No builder, deployment, credential or permission was changed during this investigation.

### Recommendation and live findings

Use the existing **Configure → Region → London, United Kingdom** control on the ERS organisation's App Builders page, retaining **4 CPU / 4 GB RAM**. The authenticated administrator UI now supports an explicit region selection; the older public announcement and section 3's claim that no selector exists are outdated. The form warns that updating creates a new builder and loses cached layers. It was inspected without submitting. The current shared builder remains **IAD / Ashburn, Virginia**. No new CI service, local-build dependency for releases, or deprecated classic-builder workaround is needed. No new spec is warranted for this small build-boundary correction and operator configuration change.

The builder is organisation-shared, so a reset can affect build cache for the BDR app too. Obtain approval for that shared infrastructure/cache change before submitting. Runtime machines are not selected by this form; the ERS dashboard currently reports **one** Brain machine in LHR and two BDR machines in FRA, correcting the original handoff's two-Brain-machine statement. No build or deploy should be running during the change.

Personal CLI authentication was verified independently: `jem-brain-mcp` belongs to John E Milad's `personal` organisation. Its Depot region is **not verified**: the organisation CLI output does not expose it; Chrome is signed into the separate ERS account and the in-app browser requires personal sign-in. Do not infer a personal region from the ERS setting, runtime location, or the CLI's legacy remote-builder image field. No account switch or credential change was attempted.

### What can reach the builder

`Dockerfile` copies the package manifests, TypeScript configuration/source, deployment registries, public CA certificate, README, licence and entrypoint; npm and apt fetch dependencies. The build stage produces `dist/`; the final image carries the compiled server, production dependencies and configuration. `config/brain-platform.*.json` contains bootstrap identity/role identifiers and deployment metadata, so the image is **not a claim of zero personal or organisational data**. There is no Dockerfile source for external Brain inboxes, stored source bytes or hosted Brain documents. `buildFlyDeployArgs` supplies only `GIT_SHA` and `APP_VERSION`; neither Dockerfile nor either current Fly build configuration supplies a build-secret mount or runtime-secret build argument. Fly control-plane authentication and runtime secret injection remain distinct from Docker build inputs.

The original `.dockerignore` was a deny-list: it excluded `.env*`, Git, dependencies and tests, but admitted `tmp/`, reports, deployment provenance and arbitrary new files. A file need not appear in a final-image `COPY` to be eligible for context transfer. Therefore the original handoff's unconditional “no Brain content or secrets” expectation was not justified for historical builds. Existing provenance records give app/tag/commit/time, not builder region or a context manifest; they cannot prove historical transfer or deletion. This investigation does not assert that protected material actually transferred.

The prepared `.dockerignore` now denies everything except the exact build input classes above, including only TypeScript under `src`, named registry patterns and the public certificate under `config`, and the one entrypoint under `scripts`. No parent-directory include admits arbitrary children. This prevents unrelated operator files from silently joining future build contexts; reviewed source/config must still be kept free of secrets. The ERS checkout must receive this protected upstream file through a reviewed annotated release, not an ad hoc overlay exception.

### Verification and remaining closure

Docker's actual context exporter passed a synthetic test: all 10 required sample inputs included, all 15 forbidden samples excluded, including nested credentials, PDFs, inbox bytes, reports and future directories. Applying the candidate ignore file to the actual checkouts exported **121 files / 798,553 bytes for JEM** and **122 files / 800,666 bytes for ERS**, before this follow-up documentation was written. No excluded directory appeared. The Node 22 deployment/release checks passed **28 tests**, with one existing profile-specific skip. Both restricted contexts also built the unchanged hosted Dockerfile successfully for `linux/amd64` using Docker 29.6.1. [Machine-readable verification summary](fly-build-context-evidence.json). Local evidence is retained under `/tmp/brain-build-boundary-gtgbmvmi`; nothing was pushed to an image registry by these checks.

After approval: set and read back ERS London at unchanged hardware, record cache recreation, verify a subsequent guarded build's actual region, and check the personal builder through its own authenticated account. Adopt explicit configured region as the operating rule in [deploy-fly.md](deploy-fly.md); operator geography is not a substitute. Do not silently reset or accept a different region if the configured choice is unavailable.

Keep FLY-14-03 and D3 open until the actual outcome and residual map are recorded. Moving this builder only removes this identified US build location: registry storage/replication, build logs/cache retention and historical copies, control-plane/support processing and dependencies are not established as UK/EU-only here. Mike retains the decision on whether any remaining evidence gap is a launch condition or a dated follow-up. The older statement below that a builder move makes D3 “collapse to a note” must not be used as automatic legal clearance.

## Original handoff — retained for provenance

## 1. What was observed

- On 14 September 2026 Cillian McGorman (ERS Fly Admin) inspected the ERS organisation's settings. Under **Organization → Settings → App Builders** the ERS org has one shared builder, named `ers-genomics`, described as managed by Depot, located in **IAD (Ashburn, Virginia, US)**, 4 CPU / 4 GB RAM, with a build cache. The UI describes it as packaging images, uploading to the Fly registry and holding a build cache. Evidence: `02_ai-transformation/09_vendor-agreements/fly-io/Fly_Admin_Evidence_14_September.md` on the ERS Systems & IT SharePoint (row "ERS Settings App Builders").
- Both ERS Brain runtime machines are in **lhr (London)**; `fly.toml` in this repo sets `primary_region = "lhr"`. The Supabase project is eu-west-2 (London). The builder is the only US component in the ERS Brain's processing chain that anyone has identified.
- Nobody has yet confirmed what actually passes through the builder for this repo. From the `Dockerfile` in this repo the honest expectation is: repository source, `package.json`/`package-lock.json` and the npm dependency graph, the compiled `dist/`, `config/*.json` (the Brain registry), `README.md`, `LICENSE`, the entrypoint script, and Docker layer cache — **no Brain content and no runtime secrets**. Secrets are Fly secrets injected at runtime; the only build args are `GIT_SHA` and `APP_VERSION` (see `scripts/lib/release-contract.mjs → buildFlyDeployArgs`). This expectation needs confirming, not assuming, before it is written into the governance record.

## 2. Why it matters (governance framing, not engineering)

The ERS Brain's hosted rollout is gated on a joint General Counsel / Commercial Operations clearance of Fly.io and Supabase (AI-DEC-2026-014 condition (i)). The Brain Approval Review v1.0 lists the Virginia builder under decision **D3 "Processing and transfers"**: confirm the processing map and lawful transfer basis; "any material unexplained flow is a release condition; pure evidence filing may be backlog only if Mike already has a sufficient basis to clear it." The related evidence action is **FLY-14-03**: map the Virginia build route and actual build inputs/cache/image retention; compare with approved processing; file any transfer analysis. If the build step moves to the UK/EU, D3 collapses to a note. If it stays, the map in §1 (once confirmed) is what Mike Arciero needs.

## 3. How Fly decides where the builder lives (verified 14 September 2026 against Fly's public material)

- Fly now builds images on **Depot-managed builders** by default (`fly deploy --depot` defaults to `auto`). The builders run as Fly Machines inside Depot's own Fly organisation; Fly states "Builds run inside Depot's Fly.io organization, but Depot has no access to your account information, email address, etc." Source: [Depot remote builders becoming the default](https://community.fly.io/t/depot-remote-builders-becoming-the-default/21756).
- The builder is created once per customer organisation and placed **near the machine or CI provider that runs the `flyctl deploy` command** at the time it is first created; it then persists in that region with its cache on a Fly volume. Depot: builders "can be launched into 18 of Fly's global regions … geographically near the machine or CI provider that executes the `flyctl deploy --depot` command"; "All cache data is persisted to Fly volumes". Source: [Fly builds, now with Depot](https://depot.dev/blog/fly-builds-powered-by-depot).
- There is **no explicit region setting today**. Fly lists "choosing the builder region explicitly" as a planned dashboard feature. What exists is a **Clear builder cache / reset** button on the App Builders page, and Fly's own guidance: "use it if you want your builder to start in another region (by deploying *from* that region)". Source: [Clearing your builder cache from the Fly dashboard](https://community.fly.io/t/clearing-your-builder-cache-from-the-fly-dashboard/22081).
- Working inference (not yet verified): the ERS builder landed in Virginia because the first deploy of `ers-brain-mcp` was run from a US-hosted environment — a Claude Code cloud session or a GitHub-hosted runner — rather than from a UK machine. Check the ERS overlay's deploy provenance (`.brain-deploy/provenance.jsonl` in the ERS mirror checkout, if kept) or the operator's memory of where the July 2026 first deploy ran.
- Relevant `fly deploy` flags, quoted from [fly deploy · Fly Docs](https://fly.io/docs/flyctl/deploy/): `--depot` "Deploy using depot to build the image (default "auto")"; `--depot-scope` "The scope of the Depot builder's cache to use (org or app)"; `--local-only` "Perform builds locally using the local docker daemon. The default is --remote-only."; `--remote-only` "Perform builds on a remote builder instance instead of using the local docker daemon. This is the default."; `--build-only` "Build but do not deploy"; `--push` "Push image to registry after build is complete"; `--image` "The Docker image to deploy".
- Fly has said the classic (non-Depot) remote builder path will stop being supported once the Depot migration is complete; `--depot=false` is a workaround with a shelf life. Source: the "becoming the default" thread above.

## 4. Options (captured, not chosen)

| # | Option | Mechanism | What it changes | Known costs / caveats |
|---|---|---|---|---|
| 1 | **Re-place the Depot builder in the UK/EU** | Clear/reset the builder on the ERS org's App Builders page, then run the next `fly deploy` from a machine physically in the UK/EU (e.g. John's Mac in Leamington Spa). Confirm the new region on the App Builders page. | Builder and its cache move to lhr or a nearby EU region. Deploy scripts unchanged. | First build after reset is slow (cold cache). Region is re-decided only when the builder is recreated, but a future deploy from a US-hosted runner *while the builder exists* does not move it; a future reset followed by a US-run deploy would. So the durable control is "deploys that (re)create the builder run from the UK/EU" — a rule to write down, not a setting. Applies per Fly organisation: do the personal org too if desired. |
| 2 | **Build locally, push the image** | `fly deploy --local-only` (needs Docker Desktop on the deploying Mac), or `--build-only --push` then `fly deploy --image …`. | No remote builder involved; the image is built on the operator's machine and pushed to `registry.fly.io`. | Slower on a laptop; deploy depends on the operator's machine having Docker; ties releases to one person's hardware. Where the Fly registry stores image bytes was **not** verified — check before claiming the whole chain is UK/EU. |
| 3 | **Classic Fly remote builder** | `fly deploy --depot=false` | Uses a `fly-builder-*` app inside our own org (region chosen by Fly at creation, historically near the deployer). | Fly has announced this path will be retired after the Depot migration; not a durable answer. |
| 4 | **Build in CI in an EU region, deploy the image** | GitHub Actions (or similar) job on an EU-located runner builds and pushes; `fly deploy --image` deploys. | Full control of build location and provenance; fits the guarded release flow. | New infrastructure and credentials to govern (registry auth, CI secrets); heavier than the problem warrants unless CI is wanted for other reasons. |
| 5 | **Leave it in Virginia and record the processing map** | Confirm §1's expectation of what the builder handles; file it under FLY-14-03; Mike decides D3 on that basis. | Nothing moves. | Requires the confirmation work anyway; leaves a US processing step in the map for a UK/EU-resident system, which will be asked about again at every review. |

Options 1 and 5 both require the same first step: confirm what the build actually carries (source, deps, `config/*.json`, layer cache; no Brain content; no secrets beyond the two build args). Option 1 additionally removes the question.

## 5. What "done" looks like from the governance side (for whoever picks this up)

Not a spec — just what the ERS record needs back:

1. A dated statement of where the ERS org's builder now lives (region code as shown on the App Builders page), or a decision to leave it, with the reason.
2. A one-paragraph confirmation of what the build step processes for this repo (inputs, cache, image contents; whether any Brain content or secret material can reach the builder). Cite the `Dockerfile` and `buildFlyDeployArgs`.
3. If moved: the operating rule adopted so it does not drift back (e.g. "builder-recreating deploys run from a UK/EU machine"; or "`--local-only` for ERS releases"), written into `docs/deploy-fly.md` and, for the ERS mirror, its overlay docs.
4. Hand the result to the ERS governance record: `Fly_Admin_Evidence_14_September.md` (close FLY-14-03), `Working_Note_Vendor_DPA_Review_Brain_Hosting.md`, Brain Approval Review D3, and register `ers-assets.md` row #12 (Fly.io) note. The governance workspace is `Systems & IT - Documents/03_ai-governance-risk/` on the ERS SharePoint.

## 6. Things that are *not* in scope of this handoff

- The Fly DPA (received 14 September 2026 via Dropbox Sign, pre-signed by Fly; under GC review and awaiting ERS signature) — separate action, ERS governance Action 34.
- Supabase clearance, MFA on Fly/Supabase admin accounts, backup/restore rehearsal — separate Brain Approval Review items (D2, D4, D5; B2, B3).
- Any change to the Brain's settled decisions on access model, read logging or ELT acceptance (AI-DEC-2026-014/015/016).

## 7. Sources

- ERS evidence: `02_ai-transformation/09_vendor-agreements/fly-io/Fly_Admin_Evidence_14_September.md`; `03_ai-governance-risk/ERSG_Brain_Approval_Review.docx` v1.0 (D3, B-items); `03_ai-governance-risk/Working_Note_Vendor_DPA_Review_Brain_Hosting.md` (14 September sections).
- This repo: `Dockerfile`; `fly.toml`; `scripts/deploy-guarded.mjs`; `scripts/lib/release-contract.mjs` (`buildFlyDeployArgs`); `docs/deploy-fly.md`.
- Fly / Depot public material, read 14 September 2026: [Depot remote builders becoming the default](https://community.fly.io/t/depot-remote-builders-becoming-the-default/21756) · [Fly builds, now with Depot](https://depot.dev/blog/fly-builds-powered-by-depot) · [Clearing your builder cache from the Fly dashboard](https://community.fly.io/t/clearing-your-builder-cache-from-the-fly-dashboard/22081) · [fly deploy · Fly Docs](https://fly.io/docs/flyctl/deploy/) · [Builders · Fly Docs](https://fly.io/docs/reference/builders/).
