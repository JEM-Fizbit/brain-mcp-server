# Endpoint capabilities and reviewed writes

**Status:** implemented in v1.9.0; deployment acceptance is tracked in spec 020.
**Date:** 2026-09-10


## Spec 023 write admission

Policy and authority are separate. Capability manifest v2 adds each operation's
policy reason and same-domain route. The deployment may supply a registry
`write_policy`, or `BRAIN_WRITE_POLICY_CONFIG` naming a deployment-owned
`{version:1, brains:[{id,write_policy}]}` JSON file outside served Markdown.
`BRAIN_REQUIRED_WRITE_POLICY` lists enrolled Brain IDs; an absent/invalid
required policy refuses writes rather than silently reverting to legacy intake.
Generic unconfigured deployments report legacy compatibility explicitly.

JEM's policy retires both capture aliases and protects `TASKS.md` and
`capture-queue.md` (case/NFKC canonicalised) across all update modes, imports,
restore, rename and sync. New active records are compared as complete blocks,
including adjacent/nested records and duplicate multiplicity. Historical
Transferred/closed rows remain readable and can receive narrow sourced pointer
corrections. Arbitrary prose disguised as history still needs agent judgement;
this is not a universal semantic classifier.

A normal factual correction requires no new human approval:

```json
{
  "brain_id": "selected-brain",
  "filename": "CONTEXT.md",
  "mode": "replace",
  "expected_revision": "revision-from-reviewed-read",
  "content": "The selected durable correction.",
  "write_context": {
    "operation_id": "one-stable-operation-id",
    "kind": "source_backed",
    "reason": "Correct the canonical project link from its owner document.",
    "evidence": [{
      "brain_id": "selected-brain",
      "reference": "PROJECT.md",
      "observed_at": "2026-10-22T12:00:00Z",
      "method": "hosted_source",
      "verification": "agent_observed",
      "revision": "revision-from-source-read",
      "excerpt": "The exact supporting passage."
    }]
  }
}
```

`hosted_source` rechecks current same-Brain revision/hash and passage under the
write transaction. Connector/local reads carry their observed provider revision
or SHA-256 and a bounded passage; the server labels them agent-observed rather
than independently retrieved. Direct instructions use `user_directed` with
`method:user_instruction` and the actual instruction reference/passage.
None of these labels grants wider authority or proves semantic entailment.
Do not ingest a whole document merely to correct one fact.

Existing reviewed ingestion, deterministic lint/link maintenance, explicit
restore and reviewed conflict resolution retain their own gates. Their internal
workflow identity cannot be supplied through request JSON. The queue fence
always applies, including those workflows.

ERS-style `brain_scoped` TASKS writes additionally require
`write_context.maintenance: {kind,brain_target}`, with `kind` one of
`content_gap`, `source_ingestion`, `link_repair`, `lint_finding`, and
evidence referencing the existing same-Brain target. The capture tools also
require `scope:brain_maintenance` and matching `brain_target`. A scope label
does not prove that an operational task is Brain maintenance; the writing agent
must route general work to Capture/Asana/project home.

Automatic corrections publish their bounded LOG index and private evidence as
one Postgres transaction. Audit failure rolls back the correction. Exact replay
returns the original revision/receipt, even after later edits, without another
log. Applied and read-back verification states remain distinct. Unread logs do
not block the next update. `brain_read_change({brain_id,revision_id})` and the
authenticated `/monitor/changes/:revisionId?brain_id=...` page expose exact
before/after text, evidence and actual verification status. Every page request
rechecks the current Brain role. No new approval inbox or notification exists.

Generic updates cannot rewrite LOG; use the bounded brain_log receipt workflow. Automatic knowledge corrections already log themselves. JOURNAL appends preserve historical bytes; existing rotation/curation workflows retain their gates.

New free-text log receipts are limited to 2,000 characters by the enrolled
profiles; full diffs/evidence stay in revision history. This is a receipt limit,
not a blanket knowledge/source length limit. Historical logs are preserved.
Filesystem mode uses a private fsynced intent journal and existing recoverable
CAS publication; interruption reports applied-but-incomplete recovery truthfully
and never replays over later content. It does not claim a database-style
multi-file transaction.

Filesystem correction journals are also consumed by sync when their before/result hashes match the tracked base. Recognised generated log receipts are reconciled only after the hosted operation is acknowledged; any extra manual LOG content remains local and held. This produces one hosted index entry without deleting local evidence.

For local sync, place matching context beside the configured state file:
`<stateFile>.write-context.json`, keyed by filename:

```json
{
  "CONTEXT.md": {
    "base_revision": "reviewed-hosted-revision",
    "result_hash": "sha256-of-complete-result",
    "context": {"operation_id":"same-operation-id","kind":"source_backed","reason":"...","evidence":[]}
  }
}
```

The illustrative empty evidence list must be replaced with actual evidence.
Public schemas reject caller-supplied internal workflow/hash fields. Held edits
retain local bytes and their tracked base, survive a changed hosted head, and
do not become ordinary conflicts. Unrelated edits continue. The health file,
Doctor and Monitor distinguish admission holds from a broken sync process.
A refusal provides a route; it does not create Capture custody or a receipt.
Use the actual same-domain Capture/project tool and verify its filing receipt.

## Select a workflow before approval

Call `brain_describe({brain_id})`. Its structured response contains `capabilities.version = 2`, per-operation support, execution surface, custody, effects, role requirement and preconditions. `variants` distinguishes ingestion analysis from source-path execution and lint inspection from apply. `brain_prepare_ingest` uses the same resolver for its read-only workflow advice. Actual handlers recheck support and authority when called.

| Operation | Filesystem endpoint | Hosted revision endpoint |
|---|---|---|
| Inbox scan and related nudge | Read the configured operator inbox; report a measured count or failed scan | Unsupported on this endpoint; local inbox remains unobserved |
| Semantic search / index | Existing local index / explicit derived-index write | Operator workspace required; no implicit hosted vector service |
| Ingest analysis | Read-only analysis | Read-only analysis |
| Ingest source path / complete | Configured local source workflow | Use operator source retention and receipt workflow |
| Conflict resolution / restore | Requires a revision provider | Revision-backed operation |

Support does not grant permission. Role authorization does not prove support. Approval remains the host client's decision, and discovery cannot suppress its prompts. Neither governs a person's independent Finder, editor, SharePoint or filesystem access. Local inbox custody was settled by spec 017. The existing Monitor scans it; another watcher or repeated permanent warning is not needed.

`brain_load_context` exposes inbox observation state independently from capability. An unsupported or failed scan is never count zero. Supported scans include count and observation time; permanent unsupported checks do not emit a text warning every session. Unsupported execution returns `isError` plus a structured reason and workflow pointer before mutation.

Semantic search never silently builds an index. A missing index returns `semantic_index_missing`; an explicit `brain_semantic_index` is a derived-index write.

## Preflight response parity (v1.11.1)

`brain_prepare_ingest.structuredContent` retains `capabilities` and `source_categories` and adds `files` (sorted Brain filenames), `file_count`, `authoritative_workflow` and `instructions`. The workflow and instructions are the same strings included in the text response, generated from the same read-only inventory. Both response consumers receive the completion/verification guidance; filenames are not source bodies or a local-inbox observation. Hosted source custody still belongs to the operator workspace. The input schema and role/revision requirements are unchanged.

## Preserve the review boundary

A Brain-scope `brain_read_file` response now supplies `revision_id`, `content_sha256` and `content` in `structuredContent`, with the revision/hash also visible in the text response. Source-scope reads retain their source-content format.

```text
brain_update_file({brain_id, filename, mode: "replace", content, expected_revision: "<revision_id from the reviewed read>"})
brain_update_file({brain_id, filename, mode: "replace", content, expected_revision: "new"})
brain_resolve_conflict({brain_id, conflict_id, content, expected_revision: "<reviewed hosted revision_id>"})
```

The server compares the supplied revision with the current head, then enforces the same base in its transaction. If another writer wins, it refuses without replacing that content or closing the reviewed conflict. Read again and reconsider the proposed content. Fetching a new token and replaying an old replacement automatically defeats the review boundary and is prohibited. Append and exact-text patch retain their own execution checks.

On a filesystem endpoint the read token is a content hash. Local replacement retains the displaced inode, so an editor's late save remains recoverable even after an installation succeeds. The sync agent surfaces retained late writes as conflicts and doctor warnings; see [conflict resolution](conflict-resolution.md).
