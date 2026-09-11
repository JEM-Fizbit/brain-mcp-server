# 022 — Resumable operator-side source ingestion

**Status:** implemented and tested; production job-table migration awaits explicit approval — John approved 2026-09-11
**Source:** staged ingestion design in `docs/production-engineering-followthrough.md`
**Decisions impact:** retries preserve original bytes and require exact review before Brain replacement

## Contract

Provide an explicit-source local operator command: dry-run manifest, prepare durable job, verify immutable original upload, bounded extraction, produce reviewable candidate, approve exact changes, apply and report receipt. Persist owner/Brain-bound identity, stage, attempts, lease and receipts in private Postgres. Reuse source/artifact identity from spec 015 and existing configured byte custody. Never scan an implicit root, move/delete manual inbox items, invent reviewed semantic claims, or automatically retry a stale reviewed replacement.

Identity includes source/provider identity and revision/content hash, not filename alone. Stable source IDs survive rename. Only fully read, unchanged bytes enter a job. Reject symlinks/path traversal and changed/placeholder inputs. A interrupted worker can reclaim an expired lease; competing workers cannot advance the same job. Reconciliation after upload/metadata/write success must recognize identical completed effects rather than duplicate them. Verify downloaded original bytes before checkpointing; source metadata alone is insufficient.

The first adapter handles explicit local files. Text/Markdown extraction is deterministic; existing supported document converters may be invoked with bounded time/output. Unsupported extraction preserves the original and produces an actionable refusal. A reviewed candidate records exact target hashes/revisions. Apply only those bytes; stale targets return to review. Persist attributable completion receipts. CLI status/retry stays operator-side; MCP preflight continues to report its actual capabilities.

## Acceptance

Use isolated Postgres and artifact adapters for duplicates, changed bytes, rename/stable identity, competing/expired leases, interrupted upload/metadata/extraction/write stages, replay after approval, stale rejection, corruption, unsupported extraction and cross-owner refusal. Prove existing public-role grants remain absent after the migration. No production document corpus is ingested without an explicit source selection.

## Exclusions

Graph permissions/adapter, scheduled hosted worker, new identity, paid extraction or infrastructure, automatic claim synthesis and deletion/retention changes remain later work.

## Delivered workflow

The explicit local CLI, private job table and atomic reviewed-write receipt are implemented. Original bytes are uploaded without replacement and read back before extraction and before apply. Source/artifact metadata, all approved Brain revisions and the completion receipt commit in one Postgres transaction using the shared revision-store CAS. The exact review bundle includes previous and proposed bytes. [Runbook and limits](../local-source-ingestion.md).
