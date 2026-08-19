# 007 - Brain Cockpit UX Redesign

**Status:** in-progress
**Source:** BACKLOG.md line "Complete Brain Cockpit UX redesign phase 2 (spec 007): translate Checks into a prioritized operator view with human labels, summaries, actions, and progressive technical detail; make high-volume Maintenance fixes scannable and safely selectable; simplify overlapping Activity/Latency views and compress empty states; and finish narrow-navigation/accessibility coverage across healthy JEM and warning-heavy ERS states. Overview hierarchy, navigation framing, Operation Log readability, actionable warnings, Maintenance execution, and Raw Output removal are shipped. Excludes new telemetry and latency-threshold semantics."
**Roadmap link:** ad-hoc operator hardening
**Decisions impact:** 2026-08-19 decision to remove Raw Output from the operator cockpit
**Related:** `scripts/hosted-cockpit.mjs`; `e2e/cockpit.playwright.mjs`; `docs/hosted-cockpit.md`

**2026-08-19 update:** The Raw Output tab was removed. It duplicated the same doctor payload already rendered in operator-focused views and had no distinct user job. Exact JSON remains available to developers through `/api/doctor` and the per-profile doctor output file.

## Reconciliation - 2026-08-19

### Shipped and verified

- Slices 1-5 are complete: Overview hierarchy, grouped operational signals, primary/secondary navigation, compact non-Overview context, and Operation Log readability.
- Warnings now use an actionable operator contract and route resolvable work into Maintenance.
- Maintenance can run lint and inbox scans and apply selected safe mechanical fixes.
- Raw Output was removed from the operator surface; developer diagnostics remain available through `/api/doctor` and the doctor output file.
- The live JEM healthy state and ERS warning-heavy state render without horizontal page overflow on desktop and at 390px.

### Remaining evidence-based gaps

- **Checks is still developer-facing.** It exposes snake-case check IDs and unfiltered key/value payloads. Warnings and failures are not visually prioritized over passing checks, and the three table headers collide at 390px.
- **Maintenance does not scale to a large proposal set.** The lint and inbox summaries are useful, but 34 proposed fixes expand into one long list of verbose task text. Operators need concise rows, grouped sections, progressive detail, and a compact review summary before applying changes.
- **Activity has redundant low-value states.** Auth renders a six-row zero-value table when clear, Recent Brain Activity repeats identical source/actor labels, and Cockpit Watch can be a one-event panel without a distinct operator decision.
- **Latency is comprehensive but insufficiently prioritized.** Five nested views repeat the same operation samples at different aggregations, Operation Trends enumerates every tool including zero-sample entries, and DB details dominate before the operator has a concise answer about current health and top offenders.
- **Narrow navigation is functional but unfinished.** Five primary tabs form a 2/2/1 stack with an orphaned final row. Dense tables need an intentional narrow treatment rather than compressed desktop columns.

### Reconciliation decisions

- Keep this specification open, but replace the original broad backlog wording with the concrete completion slices below.
- Do not add a persistent action banner. Overview already owns the full Needs Action panel, while non-Overview tabs retain status and action count in the compact context strip; another banner would duplicate state without adding a new action.
- Preserve technical detail through progressive disclosure and developer endpoints. The operator surface should lead with meaning, relevance, and the next action.
- Treat new telemetry and latency-threshold semantics as separate work. This specification may improve how those signals are presented but does not redefine them.

## Problem

The Brain Cockpit has accumulated the right operational signals but presents too much of them at the same visual weight. The first viewport makes the primary status, action-required state, and secondary metrics compete in one dense band. That makes it harder to answer the operator's first questions:

- Which Brain am I looking at?
- Is it safe to use?
- Is there anything I need to act on?
- Which secondary signals explain the current state?

The dashboard needs a top-to-bottom UX pass that keeps it data-rich while making the priority path obvious.

## Acceptance criteria

### Shipped criteria

- The active Brain identity remains prominent in the header with the profile selector nearby.
- The first dashboard row contains only the primary health summary and the "Needs Action" panel.
- The primary health summary and "Needs Action" panel have stronger visual weight than secondary metric cards.
- Secondary metrics move into a clearly labeled section below the priority row.
- Desktop and narrow viewports have no horizontal page overflow.
- Cockpit end-to-end tests assert the section hierarchy and responsive layout.

### Completion criteria

- Checks presents human-readable names and one-line outcomes, orders current warnings/failures before passing checks, routes resolvable findings to their action, and keeps raw fields behind progressive disclosure.
- Checks remains readable at 390px without header collisions or compressed desktop-table semantics.
- Maintenance keeps selection and application explicit while making 30+ proposed fixes scannable through grouped, concise rows and expandable detail.
- Activity and Latency each retain only views with a distinct operator job; redundant or zero-value content is removed, collapsed, or summarized.
- Empty, loading, success, warning, failure, and high-volume states have deliberate copy and hierarchy instead of raw absence or repeated zero values.
- Primary and nested navigation have a deliberate narrow layout and retain keyboard, focus, ARIA, and panel visibility behavior.
- Deterministic end-to-end coverage exercises both a healthy state and a warning-heavy state on desktop and at 390px.

## Out of scope

- Adding new hosted metrics, charts, or backend telemetry.
- Changing SLO thresholds or the semantics of existing latency findings.
- Changing cockpit write behavior; the cockpit remains read-only.
- Reworking the menu-bar app dropdown.

## Technical constraints

- The cockpit is generated by `scripts/hosted-cockpit.mjs`; keep the current data IDs because refresh logic updates those elements directly.
- Existing operator copy, doctor payload parsing, profile switching, and tab behavior should remain intact.
- Layout changes must remain usable in the local cockpit browser surface and in the Playwright deterministic fixture.
- Avoid decorative redesign work that reduces scanability; this is an operator dashboard.

## Implementation plan

### Slice 1 - First viewport hierarchy - shipped

- Add a Playwright regression check that the priority row contains the primary summary and "Needs Action" panels only.
- Add a Playwright regression check that secondary metrics live in a named section below the priority row.
- Move the metrics markup out of `.status-band` into a new operational signals section.
- Update CSS so the priority row has two prominent panels, while metric cards are organized as a lower grid.
- Verify desktop and narrow layouts through `npm run test:cockpit:e2e`.

### Slice 2 - Landing-page scan order - shipped

- Collapse long local path and cockpit URL details under `Local Diagnostics` so the first status card answers readiness before implementation detail.
- Group operational metric cards into `Content State`, `Activity`, `Latency`, and `Runtime` clusters.
- Rename the Overview tab's primary work area to `Operator Queue` and make it visually dominant over the secondary usage snapshot.
- Add Playwright checks for grouped signals, collapsed diagnostics, desktop primary-column width, and narrow viewport stacking.
- Verify desktop and narrow layouts through `npm run test:cockpit:e2e`.

### Slice 3 - Navigation hierarchy - shipped

- Redesign the top-level tab bar as a contained primary navigation strip with a filled active state.
- Contain Activity and Latency nested navigation inside each tab panel as compact secondary controls, rather than a second flat underline row.
- Preserve existing tab roles, IDs, keyboard behavior, and panel visibility semantics.
- Add Playwright checks for primary/secondary nav levels, active-state hierarchy, nested panel activation, and no horizontal overflow.
- Verify desktop and narrow layouts through `npm run test:cockpit:e2e`.

### Slice 4 - Tab-specific framing - shipped

- Make the Overview tab own the full dashboard context: current status, needs-action panel, operational signals, operator queue, and usage snapshot.
- Remove the full overview dashboard from the top of Activity, Latency, Checks, and Maintenance.
- Add a compact non-overview context strip with Brain, status, action count, last sync, and last doctor check.
- Preserve existing refresh IDs and tab keyboard behavior.
- Add Playwright checks that full dashboard blocks are descendants of `#panel-overview`, hidden on non-overview tabs, and replaced there by compact context.

### Slice 5 - Activity table readability - shipped

- Rebalance the Activity > Operation Log table columns so high-scan columns get deliberate width instead of equal truncation pressure.
- Render operation timestamps as two-line cells: date on the first row, time plus timezone on the second row.
- Allow tool, target, DB summary, and timestamp cells to wrap where useful while keeping latency, status, and source compact.
- Add Playwright checks for operation-log row structure, two-line timestamp cells, readable timestamp column width, and no page overflow.

### Slice 6 - Checks operator view

- Replace raw check IDs with human-readable names and one-line operator outcomes.
- Order failures and warnings first; collapse passing checks into a secondary healthy group.
- Route every resolvable warning/failure to its Cockpit action and label non-actionable checks as informational.
- Put diagnostic fields, process IDs, paths, and timings behind per-check progressive disclosure.
- Replace the compressed desktop table with a readable narrow treatment at 390px.

### Slice 7 - Maintenance at high volume

- Keep the standard selection model: one checkbox per fix, a select-all checkbox in the group header, and one explicit Apply selected action.
- Render concise fix rows with source, action type, and rationale; place full task text in expandable detail.
- Keep fix families grouped and allow large groups to start collapsed with selected/total counts visible.
- Add a compact pre-apply review summary and deliberate empty, loading, success, partial-failure, and stale-result states.

### Slice 8 - Activity and Latency information architecture

- Give each retained nested view one distinct operator question and merge or remove panels without a defensible user job.
- Compress healthy Auth into a concise success state instead of a table of empty time buckets.
- Remove redundant metadata from Recent Brain Activity and decide whether Cockpit Watch belongs inside another view.
- Make Latency lead with current SLO health and top offenders; move exhaustive per-tool and DB-span evidence behind drill-down.
- Remove zero-sample operation cards and avoid repeating the same samples across default views.

### Slice 9 - Narrow navigation, accessibility, and state matrix

- Replace the 2/2/1 primary-tab stack with an intentional narrow navigation pattern.
- Verify table/card labels, content order, wrapping, focus states, keyboard tab behavior, and ARIA selection semantics.
- Cover healthy JEM and warning-heavy ERS fixtures across desktop and 390px viewports.
- Verify that loading, empty, warning, failure, stale, and high-volume states remain readable and actionable.

## Test plan

- `e2e/cockpit.playwright.mjs` covers deterministic desktop and narrow cockpit render checks.
- Existing coverage asserts the shipped Overview hierarchy, navigation framing, Operation Log readability, Maintenance selection model, and no page overflow.
- Slice 6 adds warning-first ordering, human labels, disclosure behavior, action routing, and narrow-layout assertions.
- Slice 7 adds 30+ fix high-volume, select-all, pre-apply summary, success, stale, and partial-failure assertions.
- Slice 8 adds compressed healthy/empty states, removal of zero-sample content, and one-job-per-view assertions.
- Slice 9 adds the JEM healthy and ERS warning-heavy state matrix, keyboard/focus checks, and 390px visual-regression assertions.

## Data files touched

none

## Verification commands

- `npm run test:cockpit:e2e`
- `npm test`

## Assumptions

- Shipped slices should not be reopened without new evidence; phase 2 starts with the live gaps recorded in this reconciliation.
- The full backlog item remains open until slices 6-9 are complete and verified.
