# Preflight maintenance release

**Released:** 13 September 2026. **Version:** v1.11.1. **State:** deployed and verified on both existing owner-isolated services.

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

Annotated v1.11.1 (`24ddb85794fbe1095f762ea937a8e8925b8b687e`) was deployed through `deploy:guarded` to both existing services on 13 September. Each deployment reran 554 tests: 543 passed, 11 existing skips, zero failures. Live health reports v1.11.1; both existing authenticated connectors return all six structured preflight fields with matching text, workflow, instructions and file inventory. File counts and revision cursors are unchanged with zero conflicts. Both installed owner-bound cockpit doctor routes pass and observe v1.11.1. Unauthenticated MCP POST and monitoring APIs return 401; monitoring shells remain available. Credentials, permissions and enrolment were unchanged. No synthetic writes or new migration were needed. Private deployment provenance and owner decisions remain in the ERS overlay.

Company-wide enrolment and provider/governance clearance remain separate. Unrelated protocol migration, editor attribution and provider restore rehearsals retain their existing backlog priority. Deployment approval and owner-specific maintenance are recorded privately.
