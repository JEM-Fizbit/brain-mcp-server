# 015 — Compiled Source Ingestion And Artifact Identity

**Status:** implemented — JEM development pilot (2026-08-22)
**Source:** John-approved implementation plan, 2026-08-22
**Roadmap link:** source/provenance foundation before spec 014 activation
**Decisions impact:** records the canonical source-reference identity contract
**Related:** [`013-brain-context-architecture.md`](013-brain-context-architecture.md); [`014-task-context-compiler.md`](014-task-context-compiler.md); [`../DECISIONS.md`](../DECISIONS.md)

## Problem

Brain ingestion records source labels, paths and artifacts, but the human and
machine navigation contract is inconsistent. Source paths are commonly written
as backticks, local absolute paths are not portable, Dropbox identity and exact
revision are not first-class fields, and a Brain claim cannot reliably name the
source/artifact revision that supports it.

The result is weak traceability for models and unnecessary friction for a human
opening the same Markdown in Obsidian or another viewer.

## Acceptance criteria

- Define and validate one versioned source-reference manifest with a stable
  source id, evidence tier, provenance note, reviewed Brain links and one or
  more artifacts.
- Artifact identity supports provider, provider file id, provider revision,
  HTTPS web URL, registered local-root alias, safe root-relative path, content
  hash and observation time without making a machine-specific absolute path
  canonical.
- Compile a source companion deterministically from the manifest. The companion
  contains ordinary Markdown hyperlinks for humans and one bounded embedded
  machine manifest for LLM/tool use.
- The compiler is dry-run by default, rejects path traversal and unsafe URLs,
  writes atomically only with an explicit apply flag, and returns a receipt with
  output hash and referenced Brain files.
- Extend the existing private Postgres source/artifact schema additively. The
  runtime role receives access; no public, `anon` or `authenticated` grants are
  introduced.
- Existing source manifests remain readable when the new fields are null.
- JEM is the first and only deployment canary. ERS schema, content, deployment
  and credentials remain untouched.
- A multi-profile local sync process fails closed unless each Postgres profile
  explicitly binds its database URL to the expected Supabase project ref;
  ambient repo `.env.local` files cannot select a different deployment.

## Out of scope

- Automatically deciding which durable Brain claims a source supports.
- Copying Dropbox bytes into Brain or making an existing private file public.
- Generating public shared links.
- Activating the spec 014 task-context compiler.
- ERS rollout.

## Technical constraints

- Reuse `brain.sources`, `brain.source_artifacts` and
  `brain.source_artifact_text`; do not create a second provenance database.
- `external_id` remains the provider-issued stable identity and `external_url`
  remains the human web locator. New provider revision/root/path fields are
  nullable and additive.
- A root alias resolves through runtime configuration. Its absolute local path
  is never emitted into a hosted manifest or persisted as canonical identity.
- Markdown remains canonical content. The embedded machine block is JSON in an
  HTML comment so ordinary viewers degrade cleanly.
- Source links are reviewed facts. The compiler may format declared links but
  may not infer new semantic relationships.

## Test plan

- Unit tests for manifest validation, deterministic compilation, safe link
  rendering, receipt hashes, traversal rejection and legacy-null fields.
- Schema tests for columns, constraints, indexes, runtime grants and private RLS.
- Postgres source-store tests for new field mapping and backwards compatibility.
- Compile a non-sensitive JEM fixture containing a real Dropbox id/revision and
  verify the generated companion without changing Dropbox.

## Data files touched

- One additive migration under `db/migrations/`.
- JEM pilot manifest/companion only after local verification.
- No ERS data files.

## Verification commands

- `npm run build`
- focused `node --test` source-reference and source-store tests
- `npm test`
- `git diff --check`

## Assumptions

- Dropbox provider ids and revisions are available at ingestion time when the
  connector can inspect the file; otherwise the manifest may remain local-path
  only and the audit will report reduced traceability.
- A source may have more than one artifact, but one reviewed companion path.

## JEM pilot evidence

- Applied `2026-08-22_001_source_reference_identity.sql` only to personal
  project `gfipcidoyrtgngauzijy`. The migration preserved all 70 existing
  sources and 70 artifacts; all 16 Brain tables retained RLS and public/client
  Brain grants remained zero.
- Compiled and reviewed one private radiology-writing-context companion. The
  compiler produced a stable SHA-256 receipt and ordinary reciprocal Markdown
  hyperlinks without persisting a laptop absolute path.
- Persisted one pointer-only Dropbox artifact identity and one declared
  `supports` link. The post-canary store has 71 sources, 71 artifacts, and one
  reviewed link row. A database-side identity digest matched every declared
  source, artifact, revision, locator, hash, and relationship field; no source
  bytes or extracted content were uploaded.
- Created a dedicated `brain_jem_sync_user` login inheriting only
  `brain_runtime`; it is non-superuser, non-role-creating, non-database-creating,
  non-replicating, and non-RLS-bypassing. The local Monitor profile is bound to
  the personal project ref and successfully pulled the known personal hosted
  revision. ERS data, schema, credential, and deployment were unchanged.
- Fresh Supabase Security Advisor verdict after the migration, credential, and
  canary: 0 errors, 0 warnings, 0 suggestions.
- Released the implementation as annotated tag `v1.5.0` at commit `379b965`
  and deployed it only to the personal `jem-brain-mcp` Fly app (release v64).
  The live health endpoint reports server version `1.5.0`, Postgres revisions,
  Supabase artifacts, Postgres OAuth state, metadata-only artifact access, and
  the Git hot path disabled. A real hosted `brain_read_file` source read
  returned the canary's exact portable identity and reviewed relationship while
  withholding source bytes.
- The final release suite passed 381 tests (376 passed, five intentionally
  skipped, zero failed), the dependency audit reported zero vulnerabilities,
  and both JEM and ERS local Monitor profiles remained healthy and
  conflict-free. ERS deployment and data were not changed.
- The subsequent JEM content pass added a dry-run-first, project-ref-guarded
  transactional backfill for legacy source companions. It parses only explicit
  `## Brain links` declarations, validates every Brain target, preserves
  compiler-owned relationships, and updates artifact hashes only for
  pointer-only artifacts without immutable Storage objects. The personal JEM
  registry now has 45 companion paths and 46 reviewed relationships across the
  current 45-companion corpus; a repeat apply is idempotent. ERS remains
  untouched.
