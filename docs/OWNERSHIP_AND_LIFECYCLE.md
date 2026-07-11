# Ownership & Product Lifecycle

> **Canonical** statement of who owns what across the Brain MCP estate, and the intended product lifecycle from personal beta to a dedicated ERS service. This is the source of truth — other docs and the asset registers point here, not the other way around.
>
> **Last reviewed:** 2026-07-10

## Why this doc exists

The hosted Brain MCP is a **personal** asset currently **shared with ERS for beta hardening**. That straddles the personal/ERS boundary and keeps coming up. This page records the ownership boundaries and the lifecycle once, so it does not have to be re-explained each time.

## Ownership (current)

| Asset | Owner | Notes |
|-------|-------|-------|
| JEM Brain — `ai-brain-jem` content | **Personal** | John's personal knowledge system. |
| `mcp__brain__*` connector | **Personal** | The connector John uses to reach his Brain. |
| Hosted Brain MCP server (this repo) | **Personal-owned, ERS beta-shared** | Open-source MCP server. Personal-owned; ERS is beta-using it (John sole user) for hardening. Dual-registered (personal + ERS asset registers). |
| Fly.io app `jem-brain-mcp` (lhr) | **Personal** | Hosts the server. |
| Supabase `brain-platform-pilot` (ref `omnwbcdtmtvxasgdmvwr`, ERSG Prototypes org) | **Personal** | Personal-owned despite the org name (John's personal account owns that org); revision store + Storage bucket `brain-artifacts`. |
| `claude-jembot` Slack bot + token | **ERS-scoped** | Used for hosted auth-failure alerting; token lives in Fly secrets, not in any repo. |
| ERS Brain — `01_ers-brain` content | **ERS** | A separate ERS knowledge asset. Not the same thing as the MCP server. |

## Product lifecycle

**Phase 0 — Personal beta (now).** The hosted Brain MCP is personal-owned and is operated by John as the only user. It began with John's single JEM Brain and now includes a John-only ERS Brain pilot to prove multi-Brain routing before ERS production. ERS uses the server for beta testing and hardening, with John as the only user. It is dual-registered (personal + ERS) to reflect the shared use. The personal MCP and all its infrastructure stay personal.

**Phase 1 — Multi-tenant ERS cutover (future).** When the product graduates from John-only pilot use to an ERS production service, we **fork** this repo into a dedicated ERS MCP. The personal MCP/infra remains personal and unchanged; the ERS service is a separate deployment.

### Fork scope (Phase 0 → Phase 1)

- Stand up **separate Fly.io instance(s)** for the ERS service.
- Migrate the **Supabase DB** (`brain-platform-pilot`) to **ERS control** (ERS-owned org/project).
- **Audit + migrate all other dependencies**: OAuth / GitHub IdP, the `claude-jembot` Slack bot + token, Supabase Storage, Fly secrets, and anything else the audit surfaces.
- Re-home the forked service's asset rows to **ERS-owned** in the ERS register; the personal rows stay personal.

### Fork trigger

Move from Phase 0 to Phase 1 when ERS needs **more than John as a user** (real multi-user access), when ERS needs a production service/SLO owned by ERS, or when governance requires ERS-owned infrastructure for ERS Brain data. A John-only multi-Brain pilot on the personal MCP is allowed inside Phase 0 so the routing, sync, and fallback contracts can be proven before the fork. Until Phase 1, the asset stays personal-owned + dual-registered.

**Exit-hygiene note (2026-07-10):** the fork is not only a multi-user trigger — it is the primary way to keep the personal and ERS estates *cleanly separable* (see Destination state below). Because John intends to carry the server, connector, and JEM Brain content with him when he eventually leaves ERS, ERS content and ERS colleagues accumulating on the *personal* stack is future disentanglement debt incurred under exit-time pressure. **Prefer forking sooner rather than later**, and keep the personal stack free of ERS dependencies in the meantime.

## Destination state (final shape)

> Added 2026-07-10 to settle the recurring "one shared host vs. separate hosts?" question. **Answer: separate, owner-scoped stacks — permanently — off one codebase John owns. Never a common host.**

The Brain MCP is best understood as a **portable, personal, open-source server that John owns and carries across employers**, where each organisation runs its *own* owned deployment:

- **The server (code)** — John's personal open-source project. He keeps developing it and takes it everywhere. The tenant-agnostic discipline already required of the code (no private-org/project/path assumptions baked into code, migrations, or object paths — see `docs/specs/003-hosted-brain-sync-architecture.md`) is exactly what makes it deployable by ERS today *and* portable to a future employer.
- **John's personal deployment** — personal Fly + personal Supabase + `mcp__brain__*` connector + JEM Brain content. Always personal, travels with John, zero employer entanglement.
- **ERS's deployment** — an ERS-owned, ERS-operated instance (ERS GitHub-org fork, ERS Fly org, ERS Supabase org, ERS IdP). Serves `ers-brain` (team-shared) plus any ERS **work-personal** brains (John's ERS-work-personal brain and colleagues' brains — distinct from John's genuinely-personal JEM Brain, which never leaves the personal stack). This is where the multi-tenant code earns its keep.
- **Future-employer deployment** (later) — same pattern; John's personal stack is unaffected.

**Why owner-scoped hosts, not a shared multi-tenant host:** the code *is* multi-tenant (`brain_id` + per-brain substrate + per-user OAuth + roles) and could technically serve everything from one host. But whoever owns a host holds the credentials to its database, so a shared host means one admin/service-role plane can read *both* JEM-private and ERS-owned data — a governance dealbreaker no amount of app-layer scoping fixes (RLS is currently `using(true)`; isolation is app-layer only). **The credential boundary must follow the ownership boundary.** The tempting middle — one compute host with two storage backends via the registry's per-brain `storage_config` — is rejected for the same reason: it collapses the admin/credential boundary back into a single host that can read both owners' data.

**John operates both connectors.** Because his ERS work-personal brain lives on the ERS stack and his private brain on the personal stack, John holds *both* the `brain` (personal) and a `brain-ers` connector — mirroring how he already runs JEM (Max) and ERS (Teams) on one Mac. Two connectors is the correct shape, not an accident.

### Exit portability (John leaves ERS)

Designed so that exit is a **non-event**, *provided the split is done cleanly before then*:

- ERS keeps its stack, untouched (its own repo, data, infra, IdP).
- John keeps his personal stack, untouched (server, connector, JEM Brain content).
- Someone offboards John's ERS identity from the ERS registry. That is the entire runbook.

**Prerequisites that make this true (tracked in `BACKLOG.md`):**

1. ERS runs a **fork in the ERS-Genomics GitHub org** on fully ERS-owned infra — not a deployment pulling from John's personal repo — so there is nothing to disentangle at exit.
2. The **personal stack stays pristine** (zero ERS dependencies); beta convenience must not leak ERS config/keys/identities into it.
3. **IP / licensing hygiene** (flag, not legal advice — confirm with appropriate counsel): "take the server with me" is cleanest when ownership is unambiguous. Because the server is being built partly during ERS tenure, the low-cost hygiene is (a) a permissive open-source licence (MIT/Apache) on the repo, and (b) a brief written acknowledgment that `brain-mcp-server` is John's personal open-source project that ERS *deploys under licence*, not ERS work product. The existing personal-owned + dual-registered posture points the right way; this makes it durable.

## Pointers

- **Asset registers:** `jem-registry/personal-assets.md` (Fly.io, Supabase, `brain-mcp-server` rows) and `ers-registry/ers-assets.md` (Brain MCP row).
- **Roadmap / architecture:** [`docs/ROADMAP.md`](ROADMAP.md) (canonical), `ai-brain-jem/docs/SPEC_brain_platform.md`. (`ai-brain-jem/docs/PLAN_brain_roadmap.md` is superseded/historical.)
- **Locked decision:** [`docs/DECISIONS.md`](DECISIONS.md) — 2026-06-23 ownership-model entry.
- **Fork work item:** [`BACKLOG.md`](../BACKLOG.md) — "ERS Brain MCP fork / cutover".
