# 2026-09-30 Sync Network-Outage Resilience Savepoint

**Status:** complete checkpoint — fix shipped, verified and pushed; no hosted deployment was required or made
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server`, public `main`; verified baseline `e865c0a` (this savepoint is the commit after it)
**Record of decision:** the commit message of `e865c0a`; operator behaviour in [`docs/hosted-cockpit.md`](../hosted-cockpit.md) (supervisor section)
**Hosted state:** unchanged — nothing touched Fly, Supabase schema or hosted secrets; hosted `/health` and `postgres_summary` passed throughout

## Incident

Brain Monitor showed both JEM and ERS in fail. Between 05:29 and 05:46 UTC, sleep/DarkWake cycles made each sync worker exit on `getaddrinfo ENOTFOUND aws-1-eu-west-2.pooler.supabase.com`. Every exit spent one of the supervisor's three restarts, so both profiles parked in `needs_attention` ("Sync needs intervention") even after the network returned. That produced `launchd` fail plus stale `sync_health` / `sync_heartbeat` on each Brain.

## What shipped (`e865c0a`)

- `src/sync/supervisor.ts`: on a nonzero worker exit, the supervisor reads that worker's own PID-bound final health report. Transient network/database errors (mirroring the doctor's resolution, connectivity and timeout classes, including `Connection terminated due to connection timeout` and `Query read timeout`) now trigger `network_wait`: state `backoff`, reason `network_unavailable`, retry after 15/30/60/120s and then every 300s, **without spending the fault budget**. Cycle deadline (`sync_cycle_timeout`), signals and unrecognised errors still spend it. Success resets the network backoff.
- `test/sync-supervisor.test.mjs`: new fixture shows four mixed network failures recovering under a two-restart budget (fails on the old code).
- `docs/hosted-cockpit.md`: supervisor paragraph documents the behaviour and this incident.

## Live recovery performed

Sent SIGUSR1 (the same signal as the menu's **Retry Sync Recovery**) to both supervisors, waited for the budgets to reset, then SIGTERM'd them. Monitor respawned both from `dist/` running the new code, and a fresh doctor passed on both profiles at about 06:56 UTC. No native Monitor app rebuild was needed, because the supervisor runs straight from the repo's `dist/`.

## Verified

- `npm test` on the committed code: 593 tests, 582 pass, 11 skipped (optional Postgres integration), 0 fail.
- Live: both supervisors `running`, attempts 0, doctor all-pass after the restart.

## State at close (07:35 UTC) and open items

- The Mac is on an iPhone Personal Hotspot (gateway `172.20.10.1`). Since ~06:50 both workers intermittently hit 5s Postgres connect timeouts, yet read-only `sync summary` runs succeed in under 1s between drops. The new supervisor is behaving as intended: it logs `network_wait`, recovers, and never parks. The doctor's `sync_health` escalates to **fail** after three consecutive failed observations, which is an honest signal, not a code defect. Expect it to clear on a stable connection without intervention.
- Optional if hotspot use is common: raise `BRAIN_PG_CONNECTION_TIMEOUT_MS` (default 5000) in the Monitor profiles. This is untested and not yet decided; change it only after watching whether the failures persist on a stable network.
- Carried forward from the [2026-09-19 savepoint](2026-09-19-recovery-prune-and-profile-binding.md): the optional first real `sync:recovery:prune --apply`, and the colleague-machine identity-based sync backlog item.
- Access: the `brain-ers` Claude connector needed re-authorisation in claude.ai connector settings at session start. It was not needed for this work.
- Smallest unresolved decision: none blocking.
