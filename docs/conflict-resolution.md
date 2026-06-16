# Brain Sync Conflict Resolution

**Status:** active operator guide
**Last updated:** 2026-06-16

This guide explains how hosted Brain sync conflicts should be detected, surfaced, reviewed, resolved, and verified.

The operating principle is automation-first:

- routine checks should run through tools, scheduled commands, or client nudges;
- users should not have to inspect raw logs or database tables during normal operation;
- the system should ask for user judgement only when the right answer is semantic, such as deciding the final Markdown content;
- no tool should silently overwrite local or hosted Brain content to hide a conflict.

## What A Conflict Means

A sync conflict means the system refused to overwrite one side of the Brain because both sides had diverged.

There are two common cases:

- **Dirty local block:** hosted changed a file, but the local Markdown file had un-synced local edits. The local file is preserved and a conflict is recorded.
- **Stale local block:** local tried to push an edit based on an older hosted revision. Hosted is preserved and a conflict is recorded.

Both cases are success states for safety. The system chose not to guess.

## What Should Be Automated

These checks should be automated or proactively surfaced by clients:

- `npm run hosted:doctor` reports hosted health, sync health, hosted/local counts, and open conflicts.
- `brain_load_context` should continue surfacing lint, inbox, and maintenance nudges when the Brain context is loaded.
- `brain_sync_status` reports hosted sync provider state and open conflict count.
- `brain_list_conflicts` lists open conflicts without database access.
- Future client integrations should alert the user when conflicts or stale sync health appear, instead of relying on manual polling.

Manual work starts only after a conflict is detected and the final Markdown content needs judgement.

## Detection

Run:

```bash
npm run hosted:doctor
```

Important fields:

- `status`: should be `pass`.
- `postgres_summary.details.openConflicts`: should be `0`.
- `sync_health.status`: should be `pass`.
- `sync_health.details.conflicts`: should be `0`.
- `sync_health.details.conflictFiles`: should be empty.

If `openConflicts > 0`, use the MCP conflict listing:

```text
brain_list_conflicts({ "brain_id": "ai-brain-jem" })
```

The conflict listing returns the conflict id, filename, local/remote origins, hashes, base revision, remote head, and creation time.

## Review

For each conflict:

1. Identify the file from `brain_list_conflicts`.
2. Read the hosted head:

```text
brain_read_file({ "brain_id": "ai-brain-jem", "filename": "<file>.md" })
```

3. Inspect the local Markdown file in the local Brain checkout.
4. Decide the reviewed final Markdown content.

The decision can be:

- keep hosted content;
- keep local content;
- merge both;
- rewrite the content into a cleaner final version.

This judgement should be made by the user or by an agent acting with enough task context. The system should not blindly choose one side.

## Resolve

Resolve by writing the reviewed final Markdown content through:

```text
brain_resolve_conflict({
  "brain_id": "ai-brain-jem",
  "conflict_id": "<conflict id>",
  "content": "<reviewed final markdown>"
})
```

The tool writes the reviewed content as the new hosted head and marks that conflict `resolved` with the resolution revision id.

## Verify

After resolving:

```bash
npm run hosted:doctor
```

Expected result:

- `postgres_summary.details.openConflicts` returns to `0`;
- `sync_health.details.conflicts` returns to `0` after the local sync loop catches up;
- `brain_list_conflicts({ "brain_id": "ai-brain-jem" })` reports no open conflicts;
- `brain_read_file` returns the reviewed final content.

If the local file still differs, wait for the sync loop or run a bounded sync cycle for the file. The local file should converge to the reviewed final content unless it has been edited again.

## What Not To Do

Do not:

- create `_v2`, `_FINAL`, `_conflict`, or similar duplicate Brain files;
- edit `brain.sync_conflicts` manually in Supabase;
- delete conflict rows to make doctor green;
- overwrite local Markdown without reviewing the local content;
- overwrite hosted content without reviewing the hosted head;
- treat a conflict as a daemon failure if it is preserving divergent edits.

## Recovery Bias

If there is uncertainty about hosted state, prefer preserving local Markdown first.

Local Markdown remains the durable working surface and fallback. Hosted state can be reseeded from local Markdown if needed, but a lost local edit may represent user judgement that has not been captured elsewhere.

## Proactive User Messaging

When an agent or client detects a conflict, the message should be direct and actionable:

```text
Brain sync needs review: 1 conflict in NOW.md.
I preserved both sides and did not overwrite anything.
Next step: review local Markdown versus hosted head, then choose the final content for brain_resolve_conflict.
```

For stale sync health:

```text
Brain sync health is stale.
Hosted is still reachable, but the local sync loop has not reported a recent successful cycle.
Next step: run npm run hosted:doctor and restart the local sync daemon if needed.
```

For lint or inbox issues:

```text
Brain maintenance needs attention: lint is overdue or inbox files are pending.
This is not a sync failure, but the Brain may be less reliable until maintenance runs.
Next step: run brain_lint or process inbox items.
```

The product goal is that users see these prompts before they notice drift themselves.
