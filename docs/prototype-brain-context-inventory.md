# Prototype Brain Context Inventory

**Status:** read-only inventory complete; JEM `v1.4.0` observation active; downstream updates remain deferred until the JEM/ERS spec 013 content contract stabilises
**Last checked:** 2026-07-17
**Related:** [`specs/013-brain-context-architecture.md`](specs/013-brain-context-architecture.md); [`../BACKLOG.md`](../BACKLOG.md)

## Purpose

Prevent spec 013 from being copied mechanically into every folder that happens to use a loader, `NOW.md` or `JOURNAL.md`. The server contract applies to hosted or filesystem Brains. Brain-derived agents and ordinary project workspaces need narrower follow-up.

## Inventory classes

| Class | Examples | Spec 013 treatment |
|---|---|---|
| Operational Brains | JEM Brain; ERS Brain | Full contract: bootstrap budget, shallow graph, lint mode, structural roles, migration and rollback evidence. |
| Brain framework or template | Public AI Brain primer | Update the recommended architecture only after JEM and ERS prove the final content contract. Do not publish provisional migration details as general guidance. |
| Brain-derived agent | ERS onboarding prototype | Review its small phase loader and live-state surface against the shallow-routing principles. Server roles, hosted lint modes and MCP store gates do not apply unless it later becomes a served Brain. |
| Cowork project workspace | Edge and similar document/project workspaces | Do not add a `00_loader.md` or MCP governance mechanically. Preserve the established stable-contract + current-state + history pattern; update only stale Brain pointers, source-of-truth wording and access instructions. |
| Deprecated copy or backup | Explicitly deprecated Brain folders; dated recovery snapshots | Exclude from migration. Preserve for recovery/history and prevent agents from treating it as canonical. |

## Edge adjudication

Edge is currently a project document archive, not another operational Brain. Its stable contract routes strategy and durable personal context back to JEM Brain while keeping working documents and project state in the project workspace. The follow-up is therefore pointer reconciliation, not a second server-backed Brain migration.

The initial JEM content migration deliberately did not widen into non-Brain workspace reconciliation. References to an older standalone Edge Brain location therefore remain a later pointer review: update the canonical Edge hub and project-home wording together, then test the resulting JEM route through the routing evaluator. Keep this coupled to the broader downstream review rather than treating Edge as another server-backed Brain.

## Update order

1. Observe the deployed `v1.3.2` graph-parser correction without changing enforcement. Completed before JEM migration approval.
2. Complete the approved JEM content migration and observation gate. The migration shipped in `v1.4.0`; observation remains active in `graph_shadow`.
3. Complete the separately gated ERS migration and observation gate.
4. Update the public primer to the proven final contract.
5. Review the ERS onboarding prototype and Cowork project pointers, including Edge, without imposing server-only controls on non-Brain workspaces.

The task-context compiler remains outside this inventory and stays governed by spec 014's trigger.
