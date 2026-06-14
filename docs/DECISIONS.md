# Working Decisions Log

> Locked design decisions for this project, with rationale. Append-only — when a decision is reversed, add a new entry referencing the prior one. Do not delete history.

Each entry captures: **what was decided**, **why** (the constraint or insight), **when**, and **what alternatives were rejected**. This is the durable answer to "why did we do it this way?" months from now.

Format: newest entries at the top.

---

## 2026-06-14 — Put git-backed hosted Brain architecture under review

**Decision:** Do not treat the Fly + git working-copy pilot as the settled architecture. Further hosted Brain work must satisfy the local-first hosted sync contract before it is considered successful, and git's role must be re-derived from requirements rather than inherited from the local-only backup workflow.

**Why:** The pilot proved hosted OAuth/MCP reachability and hosted auto-commit/push, but exposed a product regression: remote writes did not automatically update John's primary local Markdown working surface, and local edits did not have a defined path back to the hosted server. GitHub was originally a backup/versioning layer; using it as live sync requires an explicit decision and complete bidirectional verification.

**Alternatives rejected:** Continuing to patch around local drift without revisiting storage/sync architecture. Treating GitHub as the hot path simply because it was already present. Blocking all hosted progress indefinitely; the interim host remains useful if it can meet the sync contract and stay portable to the future Mac mini.

**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-13 — Pilot hosted Brain on Fly with filesystem git storage".

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
