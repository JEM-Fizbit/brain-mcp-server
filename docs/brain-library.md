# Brain Library

Brain Library is a separate, local-only reading surface for Brain Markdown and
source companions. It is not a Cockpit tab: Cockpit remains the operator health
and maintenance surface, while Library is for navigating content, provenance,
and reviewed source links.

## Pilot scope

- JEM-only during development validation (`ai-brain-jem`).
- Read-only HTTP on `127.0.0.1`; no public binding or hosted authentication.
- Markdown remains canonical. The Library does not edit Brain files, ingest
  sources, resolve conflicts, or perform hosted administration.
- Local artifact opening is disabled by default. Enabling it still requires a
  registered artifact id, an allowlisted root alias, containment after symlink
  resolution, a loopback Host header, and the page's per-process nonce.
- ERS rollout requires a separate review and approval after the JEM pilot.

## JEM validation status

The source-reference/runtime support is deployed to personal JEM in `v1.5.0`
(`379b965`). The live hosted MCP returned the pilot source's portable locator,
exact provider revision and reviewed Brain relationship without returning the
private source bytes. The Library itself remains a manually started local
development surface; it is not a Cockpit feature, login item, hosted service or
ERS deployment.

## Start the JEM pilot

```bash
BRAIN_LIBRARY_BRAIN_ID=ai-brain-jem \
BRAIN_LIBRARY_ROOT=/path/to/ai-brain-jem \
npm run brain:library
```

The default URL is `http://127.0.0.1:8797/`. Override it with
`BRAIN_LIBRARY_PORT` when needed.

To register local mirrors without making absolute paths canonical source
identity, map stable aliases to machine-local roots:

```bash
BRAIN_LIBRARY_ROOTS_JSON='{"dropbox_personal":"/path/to/Dropbox"}' \
BRAIN_LIBRARY_ALLOW_LOCAL_OPEN=1 \
BRAIN_LIBRARY_BRAIN_ID=ai-brain-jem \
BRAIN_LIBRARY_ROOT=/path/to/ai-brain-jem \
npm run brain:library
```

Only the runtime configuration contains the absolute root. Source companions
and Postgres store the alias plus a safe root-relative path.

## Link behaviour

Compiled companions use ordinary Markdown links:

- Brain-to-source and source-to-Brain links are repository-relative, so they
  work in Obsidian and ordinary Markdown viewers that resolve local links.
- Source web links are HTTPS links, such as the provider's Dropbox page. The
  compiler never creates or changes sharing permissions.
- Original files outside the Brain repository use an artifact id plus root
  alias and relative path. The Library resolves that locator locally; portable
  Markdown does not embed a machine-specific `file://` URL.
- An embedded `brain.source-reference/v1` JSON block gives LLMs exact source,
  artifact, revision, hash, and reviewed-link identity while remaining hidden
  in normal Markdown rendering.

Links are declared provenance, not inferred semantics. The compiler formats
reviewed relationships; the audit reports thin, broken, index-only, and
non-clickable connections without inventing backlinks.

## Source-reference commands

```bash
# Validate and preview a manifest without writing
npm run sources:compile-reference -- --manifest /path/to/manifest.json --brain-root /path/to/brain

# Write the deterministic companion plus ignored receipt
npm run sources:compile-reference -- --manifest /path/to/manifest.json --brain-root /path/to/brain --apply

# Read-only cross-link audit
npm run sources:audit-links -- --brain-root /path/to/brain

# Dry-run reviewed companion backlinks against existing Postgres source ids
npm run sources:backfill-brain-links:postgres -- \
  --brain-root /path/to/brain \
  --brain-id ai-brain-jem

# Transactional Postgres persistence; JEM-only and project-ref guarded
npm run sources:persist-reference:postgres -- \
  --manifest /path/to/manifest.json \
  --brain-root /path/to/brain \
  --expected-project-ref <jem-project-ref> \
  --apply
```

Persistence replaces only the reviewed-link set declared by the same manifest
schema. It does not delete links owned by other workflows.

## Verification

```bash
npm run build
node --test test/brain-library.test.mjs test/source-reference.test.mjs test/source-reference-postgres.test.mjs
npm run test:brain-library:e2e
```
