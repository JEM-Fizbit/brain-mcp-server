# Preflight maintenance release

**Prepared:** 13 September 2026. **Version:** v1.11.1. **State:** verified release candidate; not yet deployed.

## Scope

Preflight already returned inventory and completion/verification guidance in text. Structured-only consumers received only capabilities and source categories. This additive patch exposes `files`, `file_count`, `authoritative_workflow` and `instructions`, generated from the same analysis and strings as text. Existing fields, inputs, role identifiers, permissions, custody and revision safeguards are unchanged.

The release guard accepts PNG/PDF/DOCX review artifacts only under `docs/reviews/`. Runtime paths, executable extensions, macro-enabled documents, traversal and artifacts outside that folder remain refused. Dockerfile does not copy these review artifacts into the runtime image.

## Verification

- Node 22 build and 32 focused HTTP MCP/release-contract tests passed with no skips.
- Full Node 22 suite: 554 tests, 543 passed, 11 existing fixture/dependency skips, zero failures, with live runtime credentials removed from test environment. The first sandbox run could not bind loopback sockets; the permitted run passed.
- Hosted-revision and actual-filesystem fixtures check JSON/text parity, exact inventory, completion guidance and unchanged store/files. Reader access is exercised in the filesystem case. Existing revision and authorization tests pass.
- Both live owner-bound doctors pass on the existing deployment. No new migration, source ingest, workforce grant, connector setting or operator installation is required by this patch. No UI layout changed.

## Delivery boundary

The agreed production client/role test set is complete on its recorded surfaces; private records retain the participant evidence. This does not certify untested combinations.

Publish annotated v1.11.1 and intake that exact tag into the ERS overlay. Verify protected paths equal upstream and run the overlay gate. After required maintenance approval, use `deploy:guarded` separately for each existing service; verify deployed versions, hosted preflight JSON/text fields, sync counts/conflicts and owner-bound doctors. Do not repeat synthetic write tests for this read-only addition unless evidence indicates a regression.

Company-wide enrolment and provider/governance clearance remain separate. Unrelated protocol migration, editor attribution and provider restore rehearsals retain their existing backlog priority. Deployment approval and owner-specific maintenance are recorded privately.
