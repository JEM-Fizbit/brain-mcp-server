# Working Decisions Log

> Locked design decisions for this project, with rationale. Append-only — when a decision is reversed, add a new entry referencing the prior one. Do not delete history.

Each entry captures: **what was decided**, **why** (the constraint or insight), **when**, and **what alternatives were rejected**. This is the durable answer to "why did we do it this way?" months from now.

Format: newest entries at the top.

---

## 2026-06-13 — Pilot hosted Brain on Fly with filesystem git storage

**Decision:** Use Fly.io plus a persistent volume as the first hosted Brain MCP runtime, preserving the current Markdown filesystem and git working-copy model.

**Why:** The current server edits Markdown files in a real git checkout and relies on commit/push behavior, so a Node runtime with durable filesystem state is the fastest low-regression path to remote MCP access. This requires a repo-scoped deploy key on the host; revisit whether a cloud database/content-store backend would provide a better long-term security and operations model after the hosted pilot proves the product flow.

**Alternatives rejected:** Cloudflare Workers + D1/KV as the first host because the Brain needs filesystem git operations in Phase 2. Cloud database as source of truth deferred because it would change the storage model and local Markdown/git workflows.

**Related:** `docs/specs/001-brain-platform-phase-1-2.md`; `BACKLOG.md` item "Revisit Brain Platform storage architecture after hosted Fly pilot".

---

<!-- Template for a new entry. Copy-paste, fill in, leave the divider. -->

<!--
## YYYY-MM-DD — <Short title of the decision>

**Decision:** <One sentence — what was locked in.>

**Why:** <The constraint, insight, or trade-off that drove it. The reasoning that future-you needs to evaluate whether this still applies.>

**Alternatives rejected:** <What else was on the table. One line each.>

**Related:** <Spec NNN, PR link, audit reference, or the conversation that produced it.>

---
-->
