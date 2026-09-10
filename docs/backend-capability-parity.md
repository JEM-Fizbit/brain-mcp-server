# Backend capability parity — the server knows what it cannot do, and does not say so

**Type:** problem report. **Pre-spec — do not promote straight to implementation.**
**Raised:** 2026-09-10, from a live failure in an unrelated routine.
**Requested disposition:** deep design review. A watcher, an alert, or a per-session warning is **not** an acceptable answer to this report; see § Non-answers.
**Related:** `BACKLOG.md` (cloud-run Brain health/inbox operations service; approval-gate capability probe) · [`specs/017-hosted-ingestion-preflight.md`](specs/017-hosted-ingestion-preflight.md) · [`specs/002-local-first-hosted-sync-contract.md`](specs/002-local-first-hosted-sync-contract.md)

> **Review disposition — 2026-09-10:** John accepted a shared capability contract,
> to be implemented after the broad production design audit. The original report
> below is retained as historical evidence, with these corrections: spec 017
> already settles operator-side inbox custody; the installed Monitor already
> schedules local inbox scans every 60 seconds, so the unwatched-folder/data-loss
> premise is not established; and ingestion preflight already partially addresses
> the approval case. Users' manual filesystem/SharePoint access is independent of
> MCP permissions. The cross-cutting declaration and guidance-propagation gaps
> remain. See the [accepted decision and closure criteria](DECISIONS.md#2026-09-10--declare-operational-capabilities-consistently-implement-after-the-production-design-audit).
> No implementation has been completed by this review; exact spec scope follows
> the audit. §§ 1, 3.3–3.4 and questions 4–5 below must be read with this correction.

---

## 1. One-paragraph statement

When a Brain runs on the Postgres-backed hosted deployment, several features designed for the filesystem backend are inoperable. The server detects this correctly — the incapability is modelled in the types and, in one case, returned in careful prose. It then **renders that state as silence**. The user cannot distinguish "checked, nothing there" from "could not check, and never will on this backend". At least three features are affected. The inbox case is the one with a live data-loss path; it is not the interesting one. The interesting one is that this is a *class*, and the system has no convention for declaring a capability it does not have.

## 2. What triggered this

An unrelated weekly routine (`intake-sweep`, a Claude scheduled task that drains intake surfaces) was written on the assumption that JEM Brain's `inbox/` was reachable from a cloud session, because `brain_scan_inbox` exists and is exposed on the hosted connector. It is not reachable. The tool answered:

> Server-side inbox state is not observable for Postgres-backed Brain `ai-brain-jem`.
> The hosted MCP server has no Fly-local inbox directory for this Brain.
> **This is a backend capability result, not evidence that the real inbox is empty or still pending.**

That third line is exactly right, and it is the only place in the system where this distinction is stated out loud. It exists because someone thought carefully at `src/tools/inbox.ts:29-30`. Everywhere else the same condition renders as nothing at all.

## 3. Evidence

### 3.1 The type knows; the output does not

`src/services/context-nudges.ts`:

```ts
/** Pending inbox file count, or null when the backend has no host inbox. */
inboxCount: number | null;
```

```ts
// Pending inbox files. Only when a count was actually obtained.
if (input.inboxCount !== null && input.inboxCount > 0) {
  parts.push("", `📥 ${input.inboxCount} file(s) pending in Brain inbox. …`);
}
```

`null` (cannot know) and `0` (nothing pending) are modelled as distinct states, documented as distinct in the doc-comment, and then **collapsed into the same rendered output: no line**. The information survives the type system and dies at the render.

The adjacent `lintKnown: boolean` — *"False when LOG.md could not be read at all — suppresses the lint nudge"* — is the same decision made deliberately for a different signal. So this is a **pattern in the code, not an oversight in one branch**. That is what makes it a design question rather than a bug fix.

### 3.2 The affordance is documented as working

`docs/PRIMER_building_your_ai_brain.md` in the `ai-brain-jem` repo describes the inbox as a live mechanism: *"Users can drop files there at any time… `brain_scan_inbox` lists pending files, and `brain_load_context` nudges when items are waiting."* Written for the filesystem backend, still current, never qualified after the hosted cutover.

### 3.3 The consuming Brain has no fallback

`ai-brain-jem`'s `brain/00_loader.md` contains **no reference to the inbox at all**. It relied entirely on the server-side nudge. So on the hosted path there is no discovery mechanism of any kind.

### 3.4 Current blast radius

`~/Projects/ai-brain-jem/inbox/` contains only `.DS_Store`; last cleared in commit `d402fe1`. Nothing is stranded today. But the folder is a live, documented drop-target that **no process can currently see**: not the nudge (no filesystem), not a cloud routine (not reachable), not a session start (loader is silent). A file dropped there is invisible until someone opens Finder.

### 3.5 It is not one feature

| Instance | Where | How it fails |
|---|---|---|
| Inbox scan + `load_context` nudge | `src/tools/inbox.ts`, `src/services/context-nudges.ts` | Tool returns an honest capability message; the nudge renders nothing |
| `brain_semantic_*` | per `BACKLOG.md` — "dead-on-Postgres… throws for non-filesystem backends" | Throws at call time |
| Backend precondition vs approval gate | per `BACKLOG.md`, repro 2026-08-01 | Capability checked *after* the human approval prompt, so an incapable call burns an approval and returns a misleading host-layer error |

Three features, three different failure shapes, one root: **capability varies by backend and the system has no uniform way to declare, discover, or surface that.**

## 4. The design questions

These are the questions the review must answer. They are ordered; later ones depend on earlier ones.

1. **What does the system owe a caller when a capability is absent by construction?** Silence, a one-time declaration, a per-call refusal, or a machine-readable capability manifest the client reads once? Note that "warn every session" is self-defeating for a *permanent* incapability — a warning that always fires trains the reader to ignore warnings. That failure mode is already observable in the sibling `lintKnown` suppression, which was presumably chosen for exactly that reason.
2. **Is capability a property of the backend, the Brain, the deployment, or the tool?** Today it is discovered ad hoc inside individual tools. `activeBrainStore`/`BrainStore` is the natural seam; whether capability belongs there is the architectural call.
3. **Where should capability be enforced relative to the approval gate?** The BACKLOG already carries this as a discrete item. It is the same question as (1) asked at a different layer, and the two should be answered together rather than patched separately.
4. **Does the local inbox survive at all?** Spec 017 *"formalises the split between hosted Brain writes and operator-side source-byte/inbox custody"* — so operator-side custody may already be the settled answer, in which case the loader's silence is a **known consequence that was never propagated to the content repo or the primer**, not a new defect. Establish which it is before designing anything. If the inbox is to remain a first-class drop folder (the BACKLOG item says preserve it), something local must watch it; if it is not, the folder and its documentation should be retired, because an unwatched documented drop-target is worse than no drop-target.
5. **Who owns the local half?** `com.jem.brain-monitor` (Brain Monitor.app) already runs as a LaunchAgent and the tool's own error message points the operator at "the local Monitor/operator workspace". Whether it already scans the inbox is unverified and should be established as a fact before any new component is proposed.

## 5. Non-answers

The following are the tempting fixes. Each is a fourth patch on the same seam and should be rejected unless the review concludes otherwise **with reasons**:

- **Add a watcher / scheduled job that alerts on inbox contents.** Adds a component, leaves the capability-declaration gap intact, and does nothing for the semantic-search or approval-gate instances.
- **Add a per-session "inbox unavailable" nudge.** A permanent condition rendered as a recurring warning. Corrodes every other nudge.
- **Make the cloud routine check it.** Already attempted; it is what surfaced the problem. The folder is on local disk and not reachable from a cloud session by any route.
- **Fix the primer wording.** Necessary, not sufficient — documentation drift is a symptom here, not the cause.

## 6. Constraints any design must respect

- **Personal and ERS deployments are permanently isolated** (`docs/OWNERSHIP_AND_LIFECYCLE.md`). ERS Brain's inbox lives on SharePoint and is reachable from a cloud session; JEM's is on local disk and is not. A design that assumes one topology will break the other. The asymmetry is a feature of the deployment model, not an inconsistency to normalise away.
- **Local-first remains the contract** (`specs/002`). Do not resolve this by declaring the hosted copy authoritative for operator-side state.
- **No new shared credential.** See the distributable-Cockpit BACKLOG item: the Postgres connection string bypasses Entra auth and the role model, and is the open question there too.
- **Silent-on-clean is the house standard** for routines (`ai-knowledge/protocols/AUDIT_ROUTINE_STANDARD.md`). Whatever surfaces capability gaps must not violate it.

## 7. What the review should produce

1. A decision on question (4) first — inbox retained or retired — because it is the only one with a live data-loss path and it gates the rest.
2. A stated principle for capability declaration, written down somewhere durable (`docs/DECISIONS.md` or a protocol), covering all three instances rather than the inbox alone.
3. Only then, a spec. If the answer is small, say so and skip the spec — most promotions should not be full specs, and this report existing does not oblige one.

## 8. How we would know it worked

- A caller on the hosted backend can determine, without trial and error, which tools are inoperable for that Brain — and can do so *before* spending an approval prompt.
- `brain_scan_inbox`, `brain_semantic_*` and the approval-gate case are all explained by the same rule, not three special cases.
- Either a file dropped in the local inbox reaches someone within a stated interval, or the drop-folder no longer exists and the primer no longer describes it.
- No recurring warning was introduced for a permanent condition.

## 9. Provenance

Found 2026-09-10 while building the `intake-sweep` scheduled task (`claude-ops/prompts/intake-sweep/`), which had wrongly claimed JEM Brain `inbox/` as cloud-reachable. That routine's own honesty guard — *report UNREACHABLE, never count an unread surface as clean* — is what surfaced it; the routine has since been corrected to sweep five surfaces and to name this one as out of scope by design. The sweep is **not** a fix for anything in this report and must not be treated as one.
