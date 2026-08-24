# 017 — Hosted Ingestion Preflight And Backend Contract

**Status:** in-progress — approved by John 2026-08-24
**Source:** `BACKLOG.md` hosted-ingestion failure plus approval-gate preflight item
**Roadmap link:** source/provenance maintenance foundation before ERS semantic replay
**Decisions impact:** formalises the split between hosted Brain writes and operator-side source-byte/inbox custody
**Related:** [`012-ers-mcp-fork.md`](012-ers-mcp-fork.md); [`015-compiled-source-ingestion.md`](015-compiled-source-ingestion.md); [`../brain-content-linking-runbook.md`](../brain-content-linking-runbook.md)

## Problem

The ingest tools describe one filesystem workflow even when the selected Brain
uses Postgres revisions and has no server-side `inbox/` or `sources/` tree.
Agents therefore discover the backend refusal only after a host approval prompt
or, worse, after Brain-content writes have already landed. Tool descriptions
also advertise JEM categories to ERS, the filesystem guard incorrectly claims
hosted log append is unavailable, and a hosted inbox scan cannot distinguish an
empty inbox from an unseen operator-side inbox.

## Acceptance criteria

- Add a read-only, idempotent `brain_prepare_ingest` tool with explicit MCP
  annotations. It resolves the selected Brain before any write, returns the
  backend capability contract, the Brain's configured source categories, the
  current Brain-file inventory, and the exact completion/verification surface.
- Hosted Postgres analysis works without resolving filesystem paths.
- Every deployed Brain declares its own source-category list in the image-baked
  registry; registry validation rejects unsafe, duplicate or empty configured
  categories. Tool descriptions contain no JEM-only category examples.
- `brain_ingest` and `brain_ingest_complete` fail before any server-side write
  when the selected backend cannot perform their filesystem operation, with an
  explicit statement that no writes occurred and a route back to preflight.
- The Postgres workflow preserves one authority: operator-side source/inbox
  custody plus the existing Postgres/Storage inventory pipeline. Fly does not
  create an ephemeral filesystem, a second inbox, or a second provenance store.
- Hosted inbox output states that it is a capability result rather than inbox
  state and directs verification to the selected Brain's local Monitor/operator
  workspace.
- The filesystem guard names only operations that are genuinely unavailable;
  hosted `brain_log` remains supported through the revision store.
- JEM is deployed and verified first. ERS consumes one later annotated upstream
  release through the unchanged private-overlay release contract.

## Out of scope

- Uploading source bytes through MCP or exposing private artifact downloads.
- Making Fly the authority for Dropbox, SharePoint or local inbox state.
- Automating the ERS SharePoint/Graph ingestion pipeline.
- Semantic/vector retrieval or Spec 014 activation.
- Enabling the JEM Brain Library for ERS users.

## Technical constraints

- The preflight must use the shared `BrainStore`, not filesystem-only
  `listFileNames`.
- MCP tool annotations are advisory, but a dedicated read-only tool gives hosts
  a correct no-write surface before any mutation tool is considered.
- `source_categories` is deployment data in the registry. Upstream contains the
  personal profile only; ERS categories remain in the private overlay.
- Existing filesystem tools remain backward compatible. Their mutation
  semantics and source layout do not change.
- The private ERS fork retains zero divergence in `src/`, `db/`, `scripts/`,
  package files, lockfile and Dockerfile.

## Test plan

- Registry unit tests for configured/fallback categories and fail-closed
  validation.
- MCP harness tests proving Postgres preflight and dry-run analysis do not touch
  a filesystem, unsupported mutation calls report no writes, hosted inbox output
  is unambiguous, and `tools/list` exposes the read-only annotation.
- Deployment-profile test requiring an explicit safe category list.
- Telemetry regression classifying preflight as a read.
- Full `npm test`, Cockpit E2E, guarded JEM deployment and live JEM preflight.
- ERS overlay gates, migration/security gate, guarded deployment, cross-Brain
  isolation, hosted read/preflight and zero-conflict sync verification.

## Data files touched

- Public JEM deployment registry gains its personal source-category list.
- Private ERS registry later gains only the ERS-approved category list.
- No Brain content or hosted schema is changed by the preflight implementation.

## Verification commands

- `npm run build`
- focused `node --test` registry/source-schema/revision-MCP/telemetry tests
- `npm test`
- `npm run test:cockpit:e2e`
- `git diff --check`

## Assumptions

- Operator-side source custody remains acceptable for the development baseline;
  the Graph automation backlog is the route to removing its bus factor.
- A client that ignores explicit preflight instructions may still invoke a
  mutation tool and receive a host approval prompt. The server cannot change a
  third-party host's approval rendering; it can provide correct annotations,
  descriptions and fail-before-write behavior.
