# Ownership & Product Lifecycle

> **Canonical** statement of who owns what across the Brain MCP estate, and the intended product lifecycle from personal beta to a dedicated ERS service. This is the source of truth — other docs and the asset registers point here, not the other way around.
>
> **Last reviewed:** 2026-06-23

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

## Pointers

- **Asset registers:** `jem-registry/personal-assets.md` (Fly.io, Supabase, `brain-mcp-server` rows) and `ers-registry/ers-assets.md` (Brain MCP row).
- **Roadmap / architecture:** [`docs/ROADMAP.md`](ROADMAP.md) (canonical), `ai-brain-jem/docs/SPEC_brain_platform.md`. (`ai-brain-jem/docs/PLAN_brain_roadmap.md` is superseded/historical.)
- **Locked decision:** [`docs/DECISIONS.md`](DECISIONS.md) — 2026-06-23 ownership-model entry.
- **Fork work item:** [`BACKLOG.md`](../BACKLOG.md) — "ERS Brain MCP fork / cutover".
