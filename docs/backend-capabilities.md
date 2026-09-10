# Endpoint capabilities and reviewed writes

**Status:** implemented in v1.9.0; deployment acceptance is tracked in spec 020.
**Date:** 2026-09-10

## Select a workflow before approval

Call `brain_describe({brain_id})`. Its structured response contains `capabilities.version = 1`, per-operation support, execution surface, custody, effects, role requirement and preconditions. `variants` distinguishes ingestion analysis from source-path execution and lint inspection from apply. `brain_prepare_ingest` uses the same resolver for its read-only workflow advice. Actual handlers recheck support and authority when called.

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

## Preserve the review boundary

A Brain-scope `brain_read_file` response now supplies `revision_id`, `content_sha256` and `content` in `structuredContent`, with the revision/hash also visible in the text response. Source-scope reads retain their source-content format.

```text
brain_update_file({brain_id, filename, mode: "replace", content, expected_revision: "<revision_id from the reviewed read>"})
brain_update_file({brain_id, filename, mode: "replace", content, expected_revision: "new"})
brain_resolve_conflict({brain_id, conflict_id, content, expected_revision: "<reviewed hosted revision_id>"})
```

The server compares the supplied revision with the current head, then enforces the same base in its transaction. If another writer wins, it refuses without replacing that content or closing the reviewed conflict. Read again and reconsider the proposed content. Fetching a new token and replaying an old replacement automatically defeats the review boundary and is prohibited. Append and exact-text patch retain their own execution checks.

On a filesystem endpoint the read token is a content hash. Local replacement retains the displaced inode, so an editor's late save remains recoverable even after an installation succeeds. The sync agent surfaces retained late writes as conflicts and doctor warnings; see [conflict resolution](conflict-resolution.md).
