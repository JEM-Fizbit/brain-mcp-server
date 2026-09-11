# Hosted Brain Recovery And Git Export

**Status:** active runbook
**Last reviewed:** 2026-09-11; observation dates and limits below
**Applies to:** independently owned `ai-brain-jem` and `ers-brain` deployments
**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; `docs/specs/006-brain-sync-architecture-simplification.md`; `docs/ROADMAP.md`; `docs/DECISIONS.md`

This runbook closes the normal-operations Git backup deprecation. Git is not a routine Brain operation. Hosted Brain reads/writes, local sync, doctor/cockpit checks, source artifact storage, and conflict handling operate through hosted MCP, Supabase Postgres, Supabase Storage, and the local sync monitor. Routine Brain operations have no manual commit/push/merge step.

Git remains available only as an async export, human-readable history, and emergency recovery lane until a later decision removes it entirely.

## Current Recovery Baseline

The former June 2026 shared-pilot observations are historical and do not establish backup coverage for the now separately owned deployments. Check each owner's database backup inventory and artifact recovery independently. Record evidence in the owning private operations record; never copy credentials or confidential source inventories into this public runbook.

Checks on 2026-09-11 confirmed both hosted revision services and local sync healthy, with zero open conflicts. The installed native `pg_dump` is now PostgreSQL 17.11; the old missing-binary limitation is resolved. No production export or restore was performed by that check. A completed backup listing, matching stored-text hash, or Storage metadata row is useful evidence, but none proves that original bytes can be restored.

Keep PITR status explicitly owner-specific and observed; do not infer it for one deployment from the other. No new backup purchase or recovery-time commitment is implied by this runbook. The isolated restore rehearsal remains deferred, non-blocking resilience work under the 2026-08-25 decision; it remains required before retiring the existing Git recovery lane.

Supabase's backup model matters for Brain recovery:

- Daily database backups cover Supabase Postgres on paid plans; PITR is an optional add-on that can restore to a selected point with seconds-level granularity.
- Supabase Storage objects are not included in database backups. Brain source artifacts stored in Supabase Storage need their own retention/export policy, even though their metadata rows live in Postgres.
- Restore-to-new-project creates a database-only copy and requires manual reconfiguration for Storage buckets/objects, settings, API keys, and other non-database resources.

References: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [Supabase PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery), [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project), and [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Normal Brain Operations

The v1.9.0 sync agent retains displaced local files and durable recovery intent under `.brain-sync-recovery/` within its configured sync root. Preserve this directory during incident investigation: it can contain a manual save that never entered hosted revision history, including a late save through an already-open descriptor. It is private recovery data, not a Git export input. Do not silently prune it or treat its existence as proof of off-device backup. Before restoring any retained version, review the current hosted revision and local bytes; use the guarded conflict/revision workflow rather than overwriting a newer head.

Do:

- use hosted Brain MCP with explicit `brain_id` when more than one Brain is visible;
- rely on local sync status, hosted doctor, cockpit, conflicts, and action indicators for operator state;
- use Supabase Postgres as the hosted revision/conflict/cursor/telemetry store;
- use Supabase Storage for private immutable source artifacts;
- use local Markdown and local stdio MCP as the fallback working surface.

Do not:

- run Git commit/push/merge as part of routine Brain reads, writes, ingest, lint, doctor, sync, or cockpit checks;
- require GitHub repo state to decide whether hosted Brain writes succeeded;
- use Git conflicts as the user-facing conflict model;
- ask ERS colleagues to understand Git for normal Brain operation.

## Async Git Export Cadence

Async Git export cadence for the current personal pilot:

- after major hosted cutovers or migration checkpoints;
- before destructive database, Storage, or sync-topology changes;
- before any ERS-owned infrastructure migration;
- monthly at most while the pilot remains single-operator, unless a specific incident calls for a fresh export.

The export is an operator checkpoint, not a sync prerequisite. A failed Git export must not block hosted MCP writes, local sync, conflict visibility, source ingestion, or doctor/cockpit health reporting. Treat export failure as a separate recovery-warning item.

## Restore rehearsal gate

Before Git is removed even as emergency recovery/history, run and record a restore rehearsal:

1. Confirm the Supabase backup inventory for the production/pilot project.
2. Decide whether PITR is needed; if yes, enable it deliberately and budget for the add-on.
3. Restore a physical backup or PITR point into a new Supabase project.
4. Recreate required non-database settings: runtime secrets, private Storage bucket configuration, API keys, and any project-level settings.
5. Restore or re-export Supabase Storage objects for `brain-artifacts`; database backup alone is insufficient.
6. Point a non-production hosted MCP runtime at the restored project.
7. Verify `brain_list_files`, `brain_read_file`, source list/search, conflict list, sync status, and hosted doctor for both `ai-brain-jem` and `ers-brain`.
8. Rehearse local Markdown reseed from the trusted local Brain checkout as the fallback path.

Until this gate passes, Git stays available as emergency history/export only. It still stays out of routine Brain operations.
