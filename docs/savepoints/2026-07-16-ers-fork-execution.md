# 2026-07-16 ERS Fork Execution Savepoint

**Status:** active handoff reference — execution kickoff
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server` (public; branch `main`, HEAD `ef67707` at savepoint)
**Plan of record:** [`docs/specs/012-ers-mcp-fork.md`](../specs/012-ers-mcp-fork.md) — read it in full before acting; this savepoint is the state snapshot, the spec is the plan
**Governance record:** `governance/brain-mcp-fork-signoff.md` in the ERS Brain (hosted `brain_id: ers-brain`; SharePoint mirror `…/01_ers-brain/brain/governance/`)
**Evidence base:** `~/Projects/claude-ops/plans/brain-platform/2026-07-12-ers-fork-dependency-audit.md` (13-surface audit, file:line refs — local-only, do NOT copy into this public repo)

Read this first if you are a fresh session executing the ERS Brain MCP fork (spec 012).

## TL;DR

Planning is 100% done; implementation is 0% done. All 16 decisions are resolved (spec §9 table + register). On 2026-07-13 John **ungated the migration** — the ELT memo is a record, not an approval; the standing ELT gate is rollout *beyond* the John+Cillian pilot (register item 14). Execute now: Phase 0 tidy → §1 upstream hardening → tag `v1.2.0` → mirror → M1 stand-up (ask-first per infra step) → M2 cutover → M3 enrollment + soak → M3b purge (CEO sign-off on evidence).

**Clock:** ELT comments due 22 Jul feed the rollout gate; the memo framing assumes the migration completes beforehand. Also verify the reported 28 Jul MCP stateless-spec migration date before scheduling cutover (unverified web claim — spec §12 risk 1).

## Locked decisions (do not re-litigate; detail in spec §9)

- Topology: deployment fork, not code fork — zero `src/` divergence ever. Private `ERS-Genomics/brain-mcp-server` mirror tracks upstream **tags** + carries a config overlay only.
- John's ERS principal: `jemilad-ers`, numeric id **259372947**, role **owner**. Never reuse 220941196 (JEM-Fizbit) on the ERS stack.
- Hostname: custom ERS domain, working name `brain.ersgenomics.online` (exact label confirmed at DNS-record creation, **before** the GitHub OAuth app exists — one-way door).
- Accounts: separate ERS Fly account + ERS Supabase org under `john.milad@ersgenomics.com`; Cillian McGorman = second admin/break-glass (provisioned at stand-up) and first pilot colleague (after the cross-tenant isolation test passes).
- PITR deferred; region lhr + eu-west-2; `BRAIN_DATE_TIME_ZONE=Europe/Dublin`; image-baked registry v1; operator-local guarded deploys; Slack alerting ON at cutover (rotated jembot token, explicit channel/DM env); personal stack goes alert-less; single-operator ingestion at launch (automated Graph-API pipeline is a captured BACKLOG fast-follower); `GITHUB_ALLOWED_*` hard-gated in code; tag `v1.2.0` at HEAD when §1 starts.

## Verified state at savepoint (2026-07-16)

| Check | Result |
|---|---|
| Spec 012 | Complete; all §9 decisions resolved; **header block stale** (still says `Status: draft` / "surfaced, not locked") — fix in Phase 0 |
| Git tags | **None** — `v1.2.0` not yet cut |
| §1 upstream hardening | **Not started** — no entrypoint fail-fast, no hard gate, no Slack-default removal, no test parameterization, no deploy script |
| ERS infra (mirror repo, Fly, Supabase, OAuth app, DNS) | **None exists** |
| DECISIONS.md | D2-reconciliation entry (promised "at approval") **not yet appended** |
| Gate-0 stragglers | OAuth-row purge predicate not written; MCP stateless-spec date (28 Jul) not verified |
| Register (2026-07-13) | Items 1–4, 8, 12, 13 resolved; 5 resolved-for-pilot; 6 + 11 GC-owned in parallel; 10 at cutover; 14 = standing rollout gate. Nothing blocks the migration |
| Incidental | `ef67707` fixed the menubar Node-pin fragility the audit flagged (not fork work) |

## Execution order

**Phase 0 — tidy (repo-only, no permission needed):** flip spec 012 header to `Status: approved` + correct the "Decisions impact" line; append the DECISIONS.md entry (migration ungated + D2 wording reconciled to "private ERS-org mirror tracking upstream tags + config overlay"; reference the 2026-07-06 entry, append-only).

**Phase 1 — §1 upstream hardening (repo-only, TDD, `npm test` gated; ~1 day agentic).** P0 items, all with file:line refs in spec §1: entrypoint registry fail-fast; deploy-config test parameterization (+ new `GITHUB_ALLOWED_*`-absent-from-fly.toml assertion); Slack channel/DM required-when-token-set (set both explicitly on `jem-brain-mcp` in the same change — it relies on code defaults today); `BRAIN_ID` fail-fast in HTTP mode; `BRAIN_FLY_APP` + script-default parameterization (upload/inventory/extract scripts currently default to the personal Supabase URL and `/Users/johnemilad` paths); guarded deploy script + provenance; category-enum relax. P1: OAuth metadata doc URLs env-driven; menubar per-profile env passthrough; S1-guard error-text rewrite; sync heartbeat event. Then tag `v1.2.0` at HEAD and push the tag.

**Phase 2 — mirror + M1 stand-up (spec §§2–3): EVERY infra step is ask-first.** Private ERS-Genomics mirror (use the `jemilad-ers` identity / `github-work` SSH alias per `ai-knowledge` GITHUB_MULTI_ACCOUNT protocol); then M1 steps 1–10 in order (Fly account, Supabase org, DNS label, OAuth app, migrations ×5 + advisors, `brain_runtime` login on `:6543`, ERS registry + production seed, fresh secrets — never `GITHUB_ALLOWED_*`, deploy at tag, empty-stack smokes, register assets).

**Phase 3 — M2/M3 (spec §§4–6, checklist §10):** pre-flight `pg_dump` checkpoint (needs a PG17-compatible dump path or Docker — currently uninstalled), re-seed (md = live count on the day; sources `BRAIN_EXPECTED_SOURCE_COUNT=125`, never 128), parity + restore rehearsal on the ERS project, sync re-point (atomic with connector flip), enrollment (ChatGPT Business delete/recreate first, Codex last), 2–3-day soak, then the purge — **CEO sign-off on the verification evidence first** (register item 10); write the OAuth-row purge predicate before cutover day.

## Hard rules

- Repo is **public**: nothing ERS-identifying (registry, staff GitHub ids, internal URLs/runbooks) is ever committed upstream — mirror-only.
- Ask-first for every ERS-infra-mutating or hosted-mutating command; classify with `docs/TOOLING.md`. The personal stack (`jem-brain-mcp`, pilot Supabase) stays untouched except the explicitly listed steps (Slack env explicit-set, registry shrink, purge, jembot unset).
- `BRAIN_REVISION_DATABASE_URL` always transaction pooler `:6543` (session pooler re-triggers the EMAXCONNSESSION outage).
- No force-push; never edit synced `docs/protocols/` copies.

## Verification commands

`npm run build` · `npm test` (Phase 0–1); per-phase gates embedded in spec §§3–7; docs-only changes `git diff --check`.
