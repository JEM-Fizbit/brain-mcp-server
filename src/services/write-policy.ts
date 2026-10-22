import { createHash, randomUUID } from "node:crypto";
import type { RevisionActor } from "../sync/types.js";
export interface BrainWritePolicy {
    version: 1;
    mode: "observe" | "enforce";
    intake: "retired" | "brain_scoped" | "legacy";
    capture_route: string;
    task_paths?: string[];
    review_base_url?: string;
    max_receipt_chars?: number;
}
export interface WriteEvidence {
    brain_id: string;
    reference: string;
    observed_at: string;
    method: "hosted_source" | "connector_read" | "local_read" | "user_instruction";
    verification: "agent_observed" | "retrieved";
    revision?: string;
    sha256?: string;
    excerpt: string;
}
export interface BrainWriteContext {
    operation_id: string;
    kind: "source_backed" | "user_directed";
    reason: string;
    evidence: WriteEvidence[];
    maintenance?: {
        kind: "content_gap" | "source_ingestion" | "link_repair" | "lint_finding";
        brain_target: string;
    };
    /** Computed by the trusted tool adapter; never accepted by request schemas. */
    tool_request_hash?: string;
    request_hash?: string;
    verification?: "applied" | "verified" | "verification_failed";
    policy_digest?: string;
    policy_version?: number;
}
const internalWrite = Symbol("trusted-workflow");
export function internalWriteContext(reason: string): BrainWriteContext {
    return Object.assign({ operation_id: randomUUID(), kind: "user_directed" as const, reason, evidence: [] }, { [internalWrite]: true });
}
export function isInternalWrite(context?: BrainWriteContext): boolean {
    return Boolean(context && (context as unknown as Record<symbol, unknown>)[internalWrite]);
}
export class WritePolicyError extends Error {
    constructor(readonly code: string, readonly brainId: string, readonly next: string) {
        super(code + ": " + next);
        this.name = "WritePolicyError";
    }
}
export function validateWritePolicy(value: BrainWritePolicy | undefined): void {
    if (value === undefined)
        return;
    if (!value || value.version !== 1 || !["observe", "enforce"].includes(value.mode) ||
        !["retired", "brain_scoped", "legacy"].includes(value.intake) ||
        !/^[a-z][a-z0-9_-]*$/.test(value.capture_route))
        throw new Error("Invalid write_policy");
    if (value.task_paths && (!Array.isArray(value.task_paths) ||
        value.task_paths.some(p => !/^[a-zA-Z0-9_./-]+\.md$/.test(p) || p.split("/").includes("..")))) {
        throw new Error("Invalid write_policy.task_paths");
    }
    if (value.review_base_url) {
        const url = new URL(value.review_base_url);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
            throw new Error("Invalid write_policy.review_base_url");
        }
    }
    if (value.max_receipt_chars !== undefined &&
        (!Number.isInteger(value.max_receipt_chars) || value.max_receipt_chars < 500 || value.max_receipt_chars > 10000)) {
        throw new Error("Invalid write_policy.max_receipt_chars");
    }
}
export function policyDigest(policy: BrainWritePolicy): string {
    return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}
export function taskPath(policy: BrainWritePolicy, filename: string): boolean {
    const normal = filename.normalize("NFKC").replace(/\\/g, "/").toLowerCase();
    return (policy.task_paths || ["TASKS.md"]).some(p => p.toLowerCase() === normal);
}
export function activeQueueBlocks(content: string): string[] {
    // Compare complete paragraphs/records, including nested details, and retain
    // multiplicity. Heading changes and repeated copies do not unlock new intake.
    return content.replace(/\r/g, "").replace(/\n(?=[ \t]*[-*+][ \t]+(?!(?:Source:|Route hint:|Urgency:|Details:|Routing receipt:)))/gi, "\n\n").split(/\n\s*\n/).map(block => block.split("\n")
        .filter(line => !/^\s*(?:#{1,6}\s|---\s*$)/.test(line)).join("\n").trim())
        .filter(block => block && !/^(?:[-*+]\s*)?(?:\[[xX]\]|Transferred\b|Filed\b|Closed\b|Historical\b)/i.test(block));
}
export function assertQueuePolicy(brainId: string, policy: BrainWritePolicy | undefined, filename: string, before: string, after: string): void {
    if (!policy || policy.intake !== "retired" || !taskPath(policy, filename) || before === after)
        return;
    const previous = new Map<string, number>();
    for (const block of activeQueueBlocks(before))
        previous.set(block, (previous.get(block) || 0) + 1);
    if (activeQueueBlocks(after).some(block => { const count = previous.get(block) || 0; previous.set(block, count - 1); return count < 1; })) {
        throw new WritePolicyError("general_intake_retired", brainId, "Use " + policy.capture_route + " or the owning project; no new Brain intake was saved.");
    }
}
export function assertCapturePolicy(brainId: string, policy: BrainWritePolicy | undefined, scope?: string, target?: string): void {
    if (!policy || policy.intake === "legacy")
        return;
    if (policy.intake === "retired")
        throw new WritePolicyError("general_intake_retired", brainId, "Use " + policy.capture_route + " for general intake; no Brain write occurred.");
    if (scope !== "brain_maintenance" || !target || !/^[a-zA-Z0-9_./-]+\.md$/.test(target) ||
        target.split("/").includes("..")) {
        throw new WritePolicyError("brain_scope_required", brainId, "Only explicit Brain maintenance with a Brain target belongs here; use " + policy.capture_route + " for other work.");
    }
}
export function addedLines(before: string, after: string): string[] {
    const remaining = new Map<string, number>();
    for (const line of before.split("\n"))
        remaining.set(line, (remaining.get(line) || 0) + 1);
    return after.split("\n").filter(line => {
        const n = remaining.get(line) || 0;
        if (n) {
            remaining.set(line, n - 1);
            return false;
        }
        return true;
    });
}
export function assertKnowledgeWrite(brainId: string, policy: BrainWritePolicy | undefined, filename: string, before: string, after: string, context?: BrainWriteContext): void {
    assertQueuePolicy(brainId, policy, filename, before, after);
    if (!policy || policy.mode !== "enforce" || before === after || isInternalWrite(context))
        return;
    if (policy.intake === "brain_scoped" && taskPath(policy, filename) && addedLines(before, after).some(l => l.trim())) {
        const scope = context?.maintenance;
        if (!scope || !["content_gap", "source_ingestion", "link_repair", "lint_finding"].includes(scope.kind) ||
            !context?.evidence?.some(e => e.reference === scope.brain_target && e.brain_id === brainId)) {
            throw new WritePolicyError("brain_scope_required", brainId, "TASKS accepts evidenced Brain content, source, link or lint maintenance with a concrete Brain target; route operational work to " + policy.capture_route + ".");
        }
    }
    const added = addedLines(before, after).join("\n");
    if (/^(?:.*\/)?(?:LOG|JOURNAL)\.md$/i.test(filename)) {
        assertReceipt(policy, brainId, added);
        if (/^(?:.*\/)?LOG\.md$/i.test(filename))
            throw new WritePolicyError("receipt_tool_required", brainId, "Use brain_log for a concise operation receipt. Automatic knowledge corrections already create their own LOG entry.");
        if (addedLines(after, before).some(line => line.trim()))
            throw new WritePolicyError("history_rewrite_requires_workflow", brainId, "Preserve historical log bytes; append a concise correction or use the separately authorised history workflow.");
    }
    // High-confidence transport/task scaffolding only; not a semantic truth classifier.
    if (/^(?:user|assistant|system|developer):\s/m.test(added) ||
        /^\s*[-*+]\s+\[\s\]\s/m.test(added) && !taskPath(policy, filename)) {
        throw new WritePolicyError("transient_work_route", brainId, "Keep transcripts and open work in " + policy.capture_route + " or its project home.");
    }
    if (!context || !/^[A-Za-z0-9_-]{8,160}$/.test(context.operation_id) ||
        !["source_backed", "user_directed"].includes(context.kind) ||
        !context.reason?.trim() || !context.evidence?.length) {
        throw new WritePolicyError("source_evidence_required", brainId, "Read the authoritative source and provide write_context; source-backed updates remain automatic.");
    }
    for (const e of context.evidence) {
        if (e.brain_id !== brainId)
            throw new WritePolicyError("source_domain_mismatch", brainId, "Use only this Brain's authorised source evidence.");
        if (!e.reference?.trim() || !e.excerpt?.trim() || !Number.isFinite(Date.parse(e.observed_at)) ||
            !["hosted_source", "connector_read", "local_read", "user_instruction"].includes(e.method) ||
            !["agent_observed", "retrieved"].includes(e.verification) ||
            !(e.revision?.trim() || /^[a-f0-9]{64}$/.test(e.sha256 || "") || e.method === "user_instruction")) {
            throw new WritePolicyError("source_evidence_required", brainId, "Evidence needs an actual observed source, supporting passage and revision/hash (or direct user instruction).");
        }
        if (/^https?:\/\//.test(e.reference)) {
            const u = new URL(e.reference);
            if (u.username || u.password)
                throw new WritePolicyError("unsafe_evidence_reference", brainId, "Source references must not contain credentials.");
        }
    }
}
export function assertReceipt(policy: BrainWritePolicy | undefined, brainId: string, summary: string): void {
    if (!policy || policy.mode !== "enforce")
        return;
    if (/^\s*[-*+]\s+\[\s\]/m.test(summary)) throw new WritePolicyError("transient_work_route",brainId,"Keep open work in "+policy.capture_route+" or the project home; LOG is an operation receipt, not another intake queue.");
    if (summary.length > (policy.max_receipt_chars || 2000) || /^(?:user|assistant|system|developer):\s/m.test(summary)) {
        throw new WritePolicyError("receipt_requires_summary", brainId, "Use a concise operation receipt; keep full source/chat/diagnostic evidence at its owner.");
    }
}
export function policyFailure(error: unknown) {
    if (error instanceof WritePolicyError) {
        const result = { code: error.code, brain_id: error.brainId, next: error.next, effect: "not_applied", routing_receipt: null };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: { error: result }, isError: true };
    }
    return { content: [{ type: "text" as const, text: String(error) }], isError: true };
}
const safe = (s: string, n = 600) => s.replace(/\r/g, "").replace(/\n/g, " ↵ ").slice(0, n);
export function formatAutomaticChange(brainId: string, filename: string, before: string, after: string, context: BrainWriteContext, actor: RevisionActor | undefined, revisionId: string, policy: BrainWritePolicy): string {
    const removed = addedLines(after, before).join("\n");
    const added = addedLines(before, after).join("\n");
    const base = policy.review_base_url?.replace(/\/$/, "");
    const link = base ? "[Full change and prior text](" + base + "/monitor/changes/" + encodeURIComponent(revisionId) + "?brain_id=" + encodeURIComponent(brainId) + ")" :
        "Read full change with brain_read_change (revision_id: " + revisionId + ")";
    const lines = [
        (context.kind === "user_directed" ? "User-directed knowledge update — " : "Automatic source-backed update — ") + new Date().toISOString() + "; " + brainId,
        "Agent: " + safe(actor?.name || actor?.id || "unattributed", 80) + "; file: " + safe(filename, 150),
        "Why: " + safe(context.reason, 180),
        "Before: " + safe(removed || "(no removed text)", 220),
        "After: " + safe(added || "(no added text)", 220),
        ...context.evidence.slice(0, 2).map(e => "Source: " + safe(e.reference, 100) + "; observed " + e.observed_at +
            "; " + e.verification + " via " + e.method + "; revision/hash " + safe(e.revision || e.sha256 || "direct instruction", 70)),
        ...(context.evidence.length > 2 ? ["Additional sources in full change record."] : []),
        "Result: applied; read-back status in change record. Manual review is optional.",
        link
    ];
    const limit = policy.max_receipt_chars || 2000;
    const footer = lines.slice(-2).join("\n");
    return lines.slice(0, -2).join("\n").slice(0, Math.max(0, limit - footer.length - 1)) + "\n" + footer;
}
