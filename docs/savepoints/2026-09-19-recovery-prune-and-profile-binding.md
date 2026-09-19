# 2026-09-19 Recovery Prune And Profile Binding Savepoint

**Status:** complete checkpoint — both work units shipped, verified and pushed; no hosted deployment was required or made
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server`, public `main`; verified baseline `288343d` (this savepoint is the commit after it)
**Records of decision:** [`docs/DECISIONS.md`](../DECISIONS.md) entries dated 2026-09-19 (two); the commit messages of `cff2753` and `288343d` carry the evidence
**Hosted state:** unchanged — `jem-brain-mcp` and `ers-brain-mcp` still run the v1.11.2 images; nothing in this session touched Fly, Supabase schema or hosted secrets

## What shipped

1. **`sync:recovery:prune`** (`cff2753`). Replaces the backlog idea of an age-based archive of `.brain-sync-recovery/`. Dry-run by default; `--apply` deletes only records that completed, are older than `--older-than` days (default 7) and whose displaced bytes hosted revision history verifiably holds. Divergent records are retained until their conflict is resolved. A retention gauge (entries, bytes, percent of the tighter budget) is in `sync summary`/`status`, the watcher health file, the doctor's `sync_health` (warn at 70%) and a cockpit action. Live dry runs: JEM 17 redundant / 14 too recent, ERS 17 / 5, zero divergent. **No `--apply` has been run on either Brain.**
2. **Credentials keyed by Brain, not folder** (`288343d`). One rule in `src/sync/runtime-binding.ts`, re-exported to the script libs. The repo `.env.local` now holds only a `BRAIN_MONITOR_CONFIG_FILE` pointer and two local-dev keys; every command from the repo folder needs an explicit `BRAIN_ID`. A profile may replace ambient values but never an explicit conflicting shell value. `summary`, `status` and the prune dry run no longer take the sync lock. The retired env file (pilot credentials beside a personal expected ref) is at `~/Library/Application Support/Brain MCP/archive/2026-09-19-retired-repo-env-local/.env.local` (0600, not in Git, machine-local).

## Verified

- `npm test`: 558 pass, 11 skipped (Postgres integration tests need `BRAIN_POSTGRES_TEST_DATABASE_URL`).
- `BRAIN_ID=ai-brain-jem` and `BRAIN_ID=ers-brain` `node dist/sync/cli.js summary` and `hosted:doctor` bind through the Monitor profiles beside the running watchers; no `BRAIN_ID` and an explicit conflict both refuse with one-line messages.
- JEM watcher health kept cycling `ok` throughout (cycle 515 at 07:46Z).

## Outside this repo, same session

- Instruction stack `v2026.09.19-2` (verdicts ~150 words, plain English): CLI twin and Codex file deployed; **claude.ai pastes pending** in `~/Desktop/instruction-stack-2026-09-19/` (JEM Instructions for Claude; ERS Instructions for Claude and Cowork Global Instructions). Codex app: confirm Settings → Personal instructions shows the version line. Run `--mark-deployed <target>` when John confirms each paste.
- `jem-registry` `ec3cdbb`: Supabase row names `jem-brain-personal` (`gfipcidoyrtgngauzijy`) and credential custody. Assumption to confirm: the service-role key is in Dashlane.

## Open items

- Backlog: identity-based local sync for colleague machines (no Postgres login on laptops) — prerequisite for ERS multi-user rollout; see `BACKLOG.md`.
- Optional first real prune: `BRAIN_ID=ai-brain-jem npm run sync:recovery:prune`, review, then `-- --apply`; same for `ers-brain`. Local-state mutating; takes the sync lock, so the Monitor's watcher must be paused or the command retried when the lock is free.
- Smallest unresolved decision: none blocking.
