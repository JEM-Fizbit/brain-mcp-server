import { createHash } from "node:crypto";
import type { RevisionContent, RevisionProposal } from "../sync/types.js";
import { contentHash } from "../sync/hash.js";
import { assertKnowledgeWrite, isInternalWrite, policyDigest, WritePolicyError, type BrainWritePolicy } from "./write-policy.js";
import { writePolicyForBrain } from "./write-policy-runtime.js";
export function operationHash(input: RevisionProposal): string {
    return createHash("sha256").update(JSON.stringify({
        brain: input.brainId, filename: input.filename, base: input.baseRevisionId,
        content: input.content, actor: input.actor,
        context: input.writeContext && { operation_id: input.writeContext.operation_id,
            kind: input.writeContext.kind, reason: input.writeContext.reason, maintenance: input.writeContext.maintenance, evidence: input.writeContext.evidence.map(({ verification, ...e }) => e) }
    })).digest("hex");
}
export function assertReplay(input: RevisionProposal, revision: RevisionContent): void {
    if (revision.writeContext?.request_hash !== operationHash(input)) {
        throw new WritePolicyError("operation_identity_conflict", input.brainId, "This operation id already belongs to a different request; inspect its original change record.");
    }
}
export async function admitRevision(input: RevisionProposal, before: string, read: (filename: string) => Promise<RevisionContent>): Promise<BrainWritePolicy | undefined> {
    const policy = await writePolicyForBrain(input.brainId);
    assertKnowledgeWrite(input.brainId, policy, input.filename, before, input.content, input.writeContext);
    if (!policy || policy.mode !== "enforce" || before === input.content || isInternalWrite(input.writeContext))
        return undefined;
    const context = { ...input.writeContext!, evidence: input.writeContext!.evidence.map(e => ({ ...e })) };
    if (context.maintenance) {
        try {
            await read(context.maintenance.brain_target);
        }
        catch {
            throw new WritePolicyError("brain_scope_required", input.brainId, "The maintenance target must exist in this Brain.");
        }
    }
    for (const evidence of context.evidence) {
        if (evidence.method === "hosted_source") {
            if (!/^[a-zA-Z0-9_./-]+\.md$/.test(evidence.reference) || evidence.reference.split("/").includes("..")) {
                throw new WritePolicyError("source_evidence_required", input.brainId, "Hosted source evidence must identify a readable path in this Brain.");
            }
            let actual: RevisionContent;
            try {
                actual = await read(evidence.reference);
            }
            catch {
                throw new WritePolicyError("source_unavailable", input.brainId, "Read the current authorised source before correcting this fact.");
            }
            if (actual.deleted || (evidence.revision && evidence.revision !== actual.revisionId) ||
                (evidence.sha256 && evidence.sha256 !== contentHash(actual.content)) ||
                !actual.content.includes(evidence.excerpt)) {
                throw new WritePolicyError("stale_write_context", input.brainId, "The current source no longer matches the observed revision, hash or supporting passage; re-read and reconsider.");
            }
            evidence.verification = "retrieved";
        }
        else {
            // Connector/local bytes and direct human instructions are attributed observations,
            // never silently promoted to independently retrieved server evidence.
            evidence.verification = "agent_observed";
        }
    }
    input.writeContext = { ...context, request_hash: operationHash(input), verification: "applied", policy_digest: policyDigest(policy), policy_version: policy.version };
    return policy;
}
export function changeRecord(revision: RevisionContent, prior: RevisionContent | null) {
    return { brain_id: revision.brainId, filename: revision.filename, revision_id: revision.revisionId,
        prior_revision_id: revision.parentRevisionId, observed_at: revision.updatedAt,
        actor: revision.actor, context: revision.writeContext || null, before: prior?.content || "", after: revision.content,
        note: "Read-back status describes the original operation. Later edits are not overwritten; manual review is optional." };
}
