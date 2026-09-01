# Ownership & Product Lifecycle

> **Canonical** statement of who owns what across the Brain MCP estate, and the intended product lifecycle from personal beta to a dedicated ERS service. This is the source of truth — other docs and the asset registers point here, not the other way around.
>
> **Last reviewed:** 2026-09-01

## Why this doc exists

The reusable Brain MCP codebase is a **personal open-source asset**, while JEM
and ERS operate permanently separate, owner-scoped deployments. This page
records the code, infrastructure, data and identity boundaries so deployment
parity is not mistaken for shared custody.

## Ownership (current)

| Asset | Owner | Notes |
|-------|-------|-------|
| JEM Brain — `ai-brain-jem` content | **Personal** | John's personal knowledge system. |
| JEM Brain connector | **Personal** | John-only hosted connector; serves only `ai-brain-jem` through GitHub authentication. |
| Brain MCP server code (this repo) | **Personal** | Reusable MIT-licensed upstream. ERS consumes reviewed annotated tags through its private mirror; no ERS secrets or identities belong in public source. |
| Fly.io app `jem-brain-mcp` + personal Supabase project | **Personal** | Permanent JEM runtime and data plane. Hosts only `ai-brain-jem`. |
| ERS Brain — `01_ers-brain` content | **ERS** | Canonical SharePoint/OneDrive Markdown asset and local mirror. |
| ERS private mirror + Fly app `ers-brain-mcp` + ERS Supabase project | **ERS** | Permanent ERS runtime and data plane. Hosts only `ers-brain`; live Entra-only on guarded v1.8.8. |
| ERS Brain connector and Entra app/role groups | **ERS** | Workforce identity and role plane; governed by Spec 018 and the ERS access runbook. |
| Brain alerting credentials | **Owner-scoped** | Each deployment retains only its own alert destinations and secrets in its hosting secret store. |

## Product lifecycle

**Phase 0 — Personal beta (complete).** The JEM deployment proved the hosted
MCP, local-first sync and multi-Brain routing patterns. The temporary ERS data
on the personal pilot was removed after the dedicated ERS stack passed parity.

**Phase 1 — Dedicated owner-scoped stacks (complete).** ERS now operates its
own private tag-tracking mirror, Fly app, Supabase project, custom hostname,
connector and Entra identity plane. JEM remains a separate personal deployment.
The two stacks share released source code only.

**Phase 2 — Controlled ERS workforce rollout (current).** ERS is live on
guarded v1.8.8 in Entra-only mode. The John/Cillian/Jeronimo technical and role
acceptance checks passed. The final item-14 governance decision remains the
gate before broader workforce enrolment.

### Fork scope (Phase 0 → Phase 1, completed)

- Stand up **separate Fly.io instance(s)** for the ERS service.
- Migrate the **Supabase DB** (`brain-platform-pilot`) to **ERS control** (ERS-owned org/project).
- **Audit + migrate all other dependencies**: OAuth / GitHub IdP, the `claude-jembot` Slack bot + token, Supabase Storage, Fly secrets, and anything else the audit surfaces.
- Re-home the forked service's asset rows to **ERS-owned** in the ERS register; the personal rows stay personal.

### Fork trigger (met)

The trigger was met when ERS required company-owned infrastructure and access
for Cillian and later Jeronimo. The dedicated stack has been live since
2026-07-21 and is no longer a personal-hosted or dual-registered runtime.

**Exit-hygiene note (updated 2026-09-01):** the completed split keeps the
personal and ERS estates cleanly separable. Preserve that boundary: ERS content,
identities and credentials must not return to the personal stack, and JEM data
must never enter the ERS stack.

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

1. ERS runs a **private tag-tracking mirror in the ERS-Genomics GitHub org** on fully ERS-owned infra — not a deployment pulling mutable public `main` — so there is nothing to disentangle at exit.
2. The **personal stack stays pristine** (zero ERS dependencies); beta convenience must not leak ERS config/keys/identities into it.
3. **IP / licensing hygiene** (flag, not legal advice — confirm with appropriate counsel): "take the server with me" is cleanest when ownership is unambiguous. Because the server is being built partly during ERS tenure, the low-cost hygiene is (a) the existing permissive MIT licence on the repo, and (b) a brief written acknowledgment that `brain-mcp-server` is John's personal open-source project that ERS *deploys under licence*, not ERS work product. The completed owner-scoped split makes that posture operationally durable.

## Pointers

- **Asset registers:** `jem-registry/personal-assets.md` (Fly.io, Supabase, `brain-mcp-server` rows) and `ers-registry/ers-assets.md` (Brain MCP row).
- **Roadmap / architecture:** [`docs/ROADMAP.md`](ROADMAP.md) (canonical), `ai-brain-jem/docs/SPEC_brain_platform.md`. (`ai-brain-jem/docs/PLAN_brain_roadmap.md` is superseded/historical.)
- **Locked decision:** [`docs/DECISIONS.md`](DECISIONS.md) — 2026-06-23 ownership-model entry.
- **ERS access rollout:** [`docs/specs/018-ers-production-identity-and-rollout.md`](specs/018-ers-production-identity-and-rollout.md) and [`docs/ers-entra-access-runbook.md`](ers-entra-access-runbook.md).
