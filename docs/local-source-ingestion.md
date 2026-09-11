# Resumable local source ingestion

**Version:** 1.0 — 11 September 2026
**Release:** v1.11.0; owner-specific migration and acceptance results are recorded separately

This operator command ingests one explicitly selected local original. It never scans an inbox, moves a file, starts a watcher, reads Graph or changes access. Manual local inbox custody remains independent of MCP roles. Use the existing owner-bound database profile and existing local Storage administration credential; do not distribute those credentials to colleagues or place them in a viewer.

## Working sequence

1. Create a spec 015 source-reference manifest. Supply the intended Brain, permanent source UUID, an original artifact UUID, provider and stable provider ID, registered local root alias and safe relative path. The manifest must have exactly one original and explicit reviewed Brain links. For a local-only source, `provider: "local"` plus a permanent UUID as `providerId` works. Preserve that identity after a rename. Use a new artifact UUID when the original bytes change. Keep `contentMarkdown` empty during preparation.
2. Run `dry-run` with that manifest and an explicit absolute local root. It reads the entire selected regular file, refuses symlinks, traversal, changed bytes and supplied hash/size mismatches, and prints its hash and manifest. It performs no database or Storage operation.
3. Run `prepare` with the same selection and owner profile. It creates or reuses the durable job, uploads without replacement, downloads and verifies exact original bytes, extracts supported text, and stops at review. A repeat with the same source content returns the same job; the first preparation's manifest remains the durable record. Renaming the local file does not create another source. Material manifest corrections require explicit review of the existing record rather than silently replacing preparation metadata.
4. Use `status --job … --out …` to export the private job and extracted text. Write the reviewed source content in a local Markdown file. `review` takes that file and optionally a JSON array of explicit semantic-file changes, each with `filename`, `expectedRevision` from the read used for review (`new` for creation), and exact proposed `content`. It produces a review bundle containing previous/proposed bytes, source identity and a digest. It does not infer claims or links from extracted text.
5. Review that bundle, then `approve --digest …` to approve exactly those changes. `apply` re-verifies the original and checks every target revision under transaction locks. All proposed Brain writes, source metadata and the attributable completion receipt commit together. A stale target writes nothing, clears approval and returns `needs_review`. Read/review again before approving; never just replace an old revision token with the current one.
6. After interruption, use `resume` for preparation/extraction or repeat `apply` for an approved job. An expired lease can be reclaimed; an older worker cannot checkpoint over the new worker. A completed apply returns its existing receipt and does not reapply bytes, even when subsequent edits have changed the Brain.

## Commands

Build under Node 22 first. These examples use placeholders; select a real source and profile explicitly. The command never loads the repository's ambient `.env.local`.

```bash
node scripts/ingest-local-source.mjs dry-run --brain BRAIN_ID --manifest /absolute/manifest.json --root /absolute/source-root

node scripts/ingest-local-source.mjs prepare --brain BRAIN_ID --profile /absolute/owner-config.json --manifest /absolute/manifest.json --root /absolute/source-root

node scripts/ingest-local-source.mjs status --brain BRAIN_ID --profile /absolute/owner-config.json --job JOB_UUID --out /absolute/job-review.json

node scripts/ingest-local-source.mjs review --brain BRAIN_ID --profile /absolute/owner-config.json --job JOB_UUID --review-content /absolute/reviewed-content.md --out /absolute/approval-bundle.json

node scripts/ingest-local-source.mjs approve --brain BRAIN_ID --profile /absolute/owner-config.json --job JOB_UUID --digest REVIEW_DIGEST

node scripts/ingest-local-source.mjs apply --brain BRAIN_ID --profile /absolute/owner-config.json --job JOB_UUID
```

`--changes /absolute/changes.json` adds explicit Brain-file changes to `review`; the source companion is included automatically. Output files are created exclusively with mode 0600 to avoid overwriting an existing review. They contain source or proposed Brain content: keep them under operator custody. The CLI prints only job/status/digest/receipt metadata unless `dry-run` explicitly requests the manifest. Failure after preparation includes the job ID so it can be recovered.

The selected profile binds `BRAIN_ID`, HTTPS endpoint and `BRAIN_EXPECTED_SUPABASE_PROJECT_REF` to the database URL before connecting. Storage additionally requires existing `BRAIN_ARTIFACT_BYTE_ACCESS=admin` and `BRAIN_SUPABASE_SERVICE_ROLE_KEY` in the operator process environment. `BRAIN_SUPABASE_URL`, if provided, must match that exact project; legacy service-key project/role claims are checked before transmission. The bucket uses existing `BRAIN_SUPABASE_STORAGE_BUCKET`, default `brain-artifacts`. No secret is printed. The operating-system username records local operator attribution; it is not presented as an independently verified remote identity or the original source author.

## Bounds and failure behavior

Originals are limited to 20 MiB. UTF-8 text/Markdown, CSV, JSON, HTML, XML and YAML use deterministic extraction; PDF uses the existing `pdftotext` executable with a 30-second timeout. Extracted text and total proposed content are each limited to 2 MiB, as is the combined review baseline. Review supports at most 20 targets including the companion. Unsupported/bad extraction retains the verified original in the durable job and reports a stable error. It creates no processed source or semantic Brain claim.

Storage calls have a 30-second timeout and downloads stop at the original-size limit. Upload retries reuse the same immutable object path and verify full hashes; they never request upsert. A missing previously verified original or corrupt bytes refuse progress. Once approved, `apply` verifies original bytes again. Storage is a separate system: there is no distributed transaction guaranteeing future object availability. Existing retention protections and provider recovery requirements still apply.

The worker uses at most two database connections, a two-minute fenced job lease and a five-second transaction lock timeout. Source identity and preparation are serialized. The Brain revision store's existing per-file advisory locks and CAS are reused inside one transaction, so concurrent sync/MCP edits remain safe. There is no automatic retry of an unreviewed replacement. CLI errors expose stable codes; raw SQL/provider errors are suppressed.

## Migration and acceptance

Apply `db/migrations/20260911113912_resumable_local_ingestion.sql` through the owner-specific administration path, then rerun the [Supabase security gate](security/hosted-brain-supabase-security-gate.md). It adds one private RLS-protected job table and one source index, granting access only to the existing `brain_runtime` role. No public/client role or user grant changes. The migration is additive; the hosted runtime does not depend on the table until this operator command is used.

`test/ingestion-postgres.test.mjs` uses a disposable loopback PostgreSQL fixture under the actual `brain_runtime` role. It proves identity/owner isolation, replay, lease expiry/fencing, lost upload acknowledgement, unsupported extraction, exact approval, stale refusal, corrupt-original refusal, atomic rollback and receipt recovery after a lost completion response. `test/ingestion.test.mjs` verifies local-path/text bounds and the actual Supabase SDK streaming/no-upsert adapter against controlled responses.

No production corpus is selected by these tests. The first real source needs explicit operator selection and a working existing Storage credential; retain that job's original hash, review and receipt as live acceptance evidence. Direct SharePoint/Graph reads, scheduling, OCR/Office conversion, new permissions and new spending remain later work.
