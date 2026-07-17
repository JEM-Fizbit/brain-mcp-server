# 010 - Cockpit "Fixes" Tab (per-item approve + localhost write endpoint)

**Status:** implemented 2026-07-01; fix-kind set narrowed 2026-07-17 by spec 013 to ordinary task fixes only
**Source:** conversation request, 2026-07-01. The menubar dropdown + Objective-C modal from spec 009 is poor UX; a cockpit tab that lists each pending fix and lets the operator approve per item is better, and enables per-item (not all-or-nothing) approval.
**Roadmap link:** Brain quality hardening; operator ergonomics.
**Decisions impact:** Extends the 2026-07-01 decision — the cockpit gains **one localhost-only write endpoint**, a further scoped relaxation of the read-only invariant. Requires a `docs/DECISIONS.md` update.
**Related:** `scripts/hosted-cockpit.mjs`; `src/services/lint-fix.ts`; `src/services/lint-apply.ts`; `docs/specs/009-brain-lint-apply-mode.md`; `docs/hosted-cockpit.md`.

> Current contract: `orphan_index` and `reviewed_date` were removed by spec 013. The live Fixes tab can present only `task_relocate`, `done_stamp`, and `done_archive`; no plan or apply route may modify `00_loader.md` or `NOW.md`. Historical design details below describe the original 2026-07-01 shape.

## Problem

Spec 009 shipped the fix engine plus two apply surfaces: the CLI and a menubar "Apply Lint Fixes..." button whose confirmation is a cramped native modal, all-or-nothing. Operators want to *see* each pending fix and approve/skip them individually, in the cockpit they already have open.

## Design

A new **Fixes** tab in the cockpit (`scripts/hosted-cockpit.mjs`) backed by two routes on the existing per-profile loopback server:

- `GET /api/fixes/plan` — returns the current per-item dry-run plan (read-only; recomputed live). No writes.
- `POST /api/fixes/apply` — applies only the item ids the operator approved. The **one write endpoint**.

The tab lists each item with a checkbox (default checked), grouped by kind, showing exactly what changes. "Apply Selected" POSTs the approved ids; the result (applied/failed per item) renders inline, then the doctor refreshes.

### Per-item model

`planLintFixes(brainId, today)` returns `{ items: FixItem[] }`, where each `FixItem` is one atomic, independently-approvable change:

- `id` — stable key: hash of `kind` + `file` + the target line/text, so an approved id maps back to a freshly-recomputed item.
- `kind` — `orphan_index` | `task_relocate` | `done_stamp` | `done_archive` | `reviewed_date`.
- `file`, `summary`, `detail` — for display.

The fix kinds are line-independent within a run: a Done line is either undated (a `done_stamp` candidate) or dated-and-old (a `done_archive` candidate) — never both — so items never conflict on the same line. `reviewed_date` is gated: offered only if ≥1 other item exists, and applied only if ≥1 other item is actually approved.

`applyLintFixSelection(brainId, today, approvedIds, actor)` **re-reads current Brain state, recomputes the plan, and applies only items whose id is in `approvedIds` and still present** (stale ids are ignored, never applied). This honours "re-read before a consequential write" — a plan the operator sat on for minutes cannot apply against changed content. Returns a per-item outcome list + the files written.

Implementation: the pure transforms in `lint-fix.ts` gain an optional approved-key filter so the same functions produce both the full plan (all keys) and the selective apply (approved keys only). No second implementation of the rules.

## Security (localhost write endpoint)

A write endpoint on a loopback server is reachable by other local processes and — via DNS rebinding / CSRF — potentially by a malicious web page the operator visits. Mitigations, all required:

- **Loopback bind only** — server already binds `127.0.0.1` (unchanged).
- **Host-header allowlist** — reject any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`. Defeats DNS rebinding (a rebound hostname carries its own Host).
- **Per-process nonce** — the cockpit generates a random nonce (`crypto.randomBytes`) at startup, embeds it in the served page, and requires it in an `X-Cockpit-Nonce` header on `POST /api/fixes/apply`. A cross-origin attacker cannot read the nonce (no CORS headers are ever sent, so the browser blocks cross-origin reads), so it cannot forge the write.
- **JSON-only** — the POST requires `Content-Type: application/json`; combined with the custom header this forces a CORS preflight that the server never approves, blocking cross-site form/`fetch` writes.
- **No CORS** — the server sends no `Access-Control-Allow-*` headers, ever.
- **Confirm remains** — apply acts only on explicitly-approved ids; the plan endpoint is read-only.

`GET /api/fixes/plan` is read-only but gets the same Host-allowlist treatment for consistency.

## Acceptance criteria

- `GET /api/fixes/plan` returns the live per-item plan; never writes.
- `POST /api/fixes/apply` applies only approved, still-valid ids, re-reading current state first; returns per-item outcomes; is rejected (403) without a valid nonce, a loopback Host, and JSON content-type.
- The tab renders items grouped by kind with per-item checkboxes and an Apply Selected action; results render inline; the doctor refreshes after apply.
- Rules reuse `lint-fix.ts` — no duplicated logic.
- The menubar button and CLI from spec 009 remain as the no-GUI paths.
- `docs/DECISIONS.md` and `docs/hosted-cockpit.md` updated in the same change.

## Out of scope

- No auth beyond the localhost posture (this is a single-operator local tool).
- No cockpit editing of Brain content beyond these mechanical fixes.
- No changes to the hosted MCP server or public surface.
- No per-item undo (the fixes are already reversible via revision history/archive-is-a-move).

## Test plan

- Unit: `lint-fix.ts` transforms with an approved-key filter (stamp/relocate/orphan/archive apply only approved keys; stable ids match between plan and re-plan).
- Unit: `planLintFixes` enumerates one item per atomic change; `reviewed_date` only offered when other items exist.
- Integration (temp `BRAIN_DIR`): `applyLintFixSelection` with a subset applies only those items and writes only affected files; a stale/unknown id is ignored; re-read picks up external changes.
- Server: `POST /api/fixes/apply` rejected without nonce / wrong Host / non-JSON (403); accepted with all three; `GET /api/fixes/plan` never writes.

## Verification

QA tier: **Full** (Brain-mutating + a new network write path). Gate: `npm test`, `npm run build`, `git diff --check`. The cockpit e2e (`npm run test:cockpit:e2e`) covers the tab renders and the plan loads; the write path is covered by the server unit tests since e2e must not mutate a real Brain.

## Rollout

1. ✅ Refactor `lint-fix.ts` transforms to accept an approved-key filter + stable item ids (+ tests).
2. ✅ Add `planLintFixes` / `applyLintFixSelection` to `lint-apply.ts` (+ tests).
3. ✅ Add the two cockpit routes with the security posture (+ `test/cockpit-fixes.test.mjs`).
4. ✅ Add the Fixes tab UI (client fetch/render/per-item checkboxes + **Approve all** + Apply selected).
5. ✅ Update `docs/DECISIONS.md`, `docs/hosted-cockpit.md`; menubar modal is now the secondary path.
