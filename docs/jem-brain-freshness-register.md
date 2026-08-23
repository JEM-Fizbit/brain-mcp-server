# JEM Brain Freshness Register

**Status:** active development-pilot control
**Last reviewed:** 2026-08-23
**Owner:** John / JEM Brain content maintainer
**Scope:** `ai-brain-jem` only; do not copy classifications into `ers-brain`

This register classifies the complete 39-file JEM Brain corpus by how it becomes
stale. It complements lint: the Brain records the review date, owner, cadence
and event trigger; lint reports when that declared cadence has expired. A recent
mechanical modification does not reset an older explicit review date.

## Cadence-controlled content

| Cadence | Files | Canonical comparison / trigger |
|---|---|---|
| Weekly | `NOW.md` | Current priorities and operating posture; overwrite after a material priority change. |
| Monthly + event | `04_active_roles.md`, `05_projects.md`, `09_tools_stack.md`, `11_next_chapter_framework.md`, `BUSINESS_IDEAS.md`, `edge_biotech.md` | Owning project/workspace, career workspace, `jem-registry`, or a settled lifecycle/authority change. Live actions and volatile plans stay outside Brain. |
| Quarterly + event | `01_identity.md`, `02_expertise.md` | Primary role, public biography, publication, capability, or identity change. |

Every file in this table must carry `Last reviewed`, `Review owner`, and
`Review cadence` near the top. Supported cadence prefixes are `Weekly`,
`Monthly`, `Quarterly`, `Annual`/`Annually`/`Yearly`, or `Every N days`. Lint
uses the declared cadence before its filename-tier fallback.

## Event-reviewed durable knowledge

Review these when ingestion or a settled fact changes them; lint's default
180-day tier remains a backstop where no shorter cadence is declared:

- `03_work_style.md`, `06_writing_voice.md`, `07_interests_learning.md`,
  `08_personal.md`, `10_mental_models.md`;
- `ers_genomics.md`, `nbgi.md`, `nitec.md`, `quanta.md`;
- `ref_ai_adoption_ladder.md`, `ref_capital_deals.md`,
  `ref_career_chronology.md`, `REF_nbgi_track_record.md`,
  `ref_psychometric_assessments.md`, and `ref_publications_media.md`.

Do not stamp these merely to clear lint. Review the claims or retain the older
date so the outstanding review stays visible.

## Operational and structural content

- Structural/routing: `00_loader.md`, `12_brain_operations.md`, `README.md`,
  `Reference_ERS_Brain_Context/README.md`, `SOURCES.md`, `working/INDEX.md`.
  Review on protocol, authority, source-index, or workspace-routing change.
- Queue/state: `TASKS.md` has its own bounded Capture / Triage Queue checks;
  completed items are handled only by the governed mechanical-fix workflow.
- Working cutover notes: `working/hosted-brain-openai-cutover-status.md` and
  `working/hosted-cutover-canary.md` are operational records, not current
  project authority. Archive or index them after maintainer review; do not
  auto-link them merely to silence graph lint.
- Append/rotate: `LOG.md`, `JOURNAL.md`, `archive/INDEX.md`,
  `archive/JOURNAL-2026-01.md`, `archive/LOG-2026-01.md`, and
  `archive/tasks-done.md` use append/rotation/retention rules rather than
  semantic freshness stamps.

## Maintenance loop

1. Refresh lint in Cockpit. User-approvable task mechanics remain separate from
   semantic freshness and graph diagnostics.
2. For each due cadence-controlled file, open its named canonical workspace and
   classify each claim: retain, update, demote to historical/dormant, or remove
   as volatile duplication.
3. Update the content and review metadata in one reviewed write. Record the
   trigger in the file when it matters to future interpretation.
4. Run strict source-link and semantic-destination audits, routing regressions,
   hosted lint, and sync-status checks. A review closes only with current
   content, a new review date, and zero sync conflicts.
5. Ingestion of a substantive source, a project/role lifecycle change, a tool
   migration, or a canonical-workspace move triggers the relevant file review
   immediately; it does not wait for the calendar.

## 2026-08-23 baseline closure

The first systematic pass classified all 39 files and refreshed the nine
cadence-controlled content areas above. `05_projects.md`, `04_active_roles.md`,
`11_next_chapter_framework.md`, `edge_biotech.md`, and `NOW.md` were materially
rewritten against their current authorities; NanoRenal/iHemo was demoted to
dormant, Edge now routes to its live Dropbox workspace, and obsolete project
status was removed or routed to the owning workspace. Identity, expertise,
tools and business-idea surfaces received explicit review controls. Hosted lint
no longer flags the priority pages as stale or bloated.
