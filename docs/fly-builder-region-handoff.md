# Fly image-builder region — handoff report

**Status:** open — handoff for a coding agent; no design decision taken here
**Date:** 14 September 2026
**Origin:** ERS AI governance review, 14 September 2026 (Brain Approval Review decision D3; Fly evidence action FLY-14-03)
**Owner of the follow-up:** brain-mcp-server project (John), with the outcome reported back to the ERS governance record
**Scope:** both owner-isolated deployments — the ERS Fly organisation `ers-genomics` (app `ers-brain-mcp`) is the one the governance question is about; check the personal org (`jem-brain-mcp`) at the same time

This document captures the complete state of knowledge about *where Fly builds this server's Docker image* and the options for moving that build out of the United States. It deliberately makes no design decision and proposes no spec. Pick it up, verify the facts against the live account, choose, do, and record.

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
