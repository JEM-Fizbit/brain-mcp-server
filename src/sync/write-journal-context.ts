import fs from "node:fs/promises";
import path from "node:path";
import { WritePolicyError } from "../services/write-policy.js";
import { WriteContextSchema } from "../schemas/tools.js";
import { appendLogEntryToContent, formatLogEntry, LOG_HEADER } from "../services/log.js";
import { contentHash } from "./hash.js";
import type { BrainWriteContext } from "../services/write-policy.js";
import type { LocalSyncState, RevisionActor, RevisionStore } from "./types.js";
export async function readSidecarContext(stateFile:string,brainId:string,filename:string,base:string|null,resultHash:string) {
  let contexts:Record<string,any>={};
  try {
    contexts=JSON.parse(await fs.readFile(stateFile+".write-context.json","utf8"));
    if(!contexts || typeof contexts!=="object" || Array.isArray(contexts))throw new Error("invalid");
  } catch(error:any) {
    if(error.code!=="ENOENT")throw new WritePolicyError("write_context_invalid",brainId,"Correct the malformed sync write-context metadata; local bytes and the prior base are preserved.");
  }
  const candidate=contexts[filename];
  const parsed=candidate?.base_revision===base && candidate?.result_hash===resultHash ? WriteContextSchema.safeParse(candidate.context):null;
  return {candidate,context:parsed?.success ? parsed.data:undefined};
}
export interface LocalWriteJournal {
    brain_id: string;
    filename: string;
    prior_revision_id: string | null;
    after: string;
    observed_at: string;
    phase: string;
    summary: string;
    context: BrainWriteContext;
    actor?: RevisionActor;
}
export async function readWriteJournals(root: string, brainId: string): Promise<LocalWriteJournal[]> {
    const directory = path.join(root, ".brain-write-journal");
    let files: string[];
    try {
        files = await fs.readdir(directory);
    }
    catch (error: any) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
    const records: LocalWriteJournal[] = [];
    for (const file of files.filter(f => /^[A-Za-z0-9_-]{8,160}\.json$/.test(f))) {
        const record = JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
        if (record.brain_id === brainId && ["complete", "applied_audit_pending"].includes(record.phase) &&
            typeof record.after === "string" && typeof record.summary === "string")
            records.push(record);
    }
    return records.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
}
export function journalContext(records: LocalWriteJournal[], filename: string, resultHash: string, baseLocalHash: string | null) {
    const record = [...records].reverse().find(r => r.filename === filename && r.prior_revision_id === baseLocalHash && contentHash(r.after) === resultHash);
    if (!record)
        return null;
    const { operation_id, kind, reason, maintenance } = record.context;
    const evidence = record.context.evidence.map(e => {
        const next = { ...e };
        if (next.method === "hosted_source" && /^[a-f0-9]{64}$/.test(next.revision || "")) {
            next.sha256 = next.revision;
            delete next.revision;
        }
        return next;
    });
    const parsed = WriteContextSchema.safeParse({ operation_id, kind, reason, maintenance, evidence });
    return parsed.success ? { context: parsed.data, actor: record.actor } : null;
}
export async function generatedLogCandidate(root: string, brainId: string, state: LocalSyncState, store: RevisionStore, records: LocalWriteJournal[]) {
    if (!records.length)
        return null;
    const local = await fs.readFile(path.join(root, "LOG.md"), "utf8").catch((e: any) => { if (e.code === "ENOENT")
        return null; throw e; });
    if (local === null || contentHash(local) === state.files["LOG.md"]?.localHash)
        return null;
    const generated = records.filter(r => local.includes(r.summary));
    if (!generated.length)
        return null;
    const tracked = state.files["LOG.md"];
    const base = tracked?.revisionId ? await store.readRevision(brainId, tracked.revisionId) : null;
    let expected = base?.content || LOG_HEADER;
    for (const record of generated)
        expected = appendLogEntryToContent(expected, formatLogEntry("UPDATE", [record.filename], record.summary));
    // Only a fully recognised deterministic index can be refreshed automatically.
    // One extra manual line makes this fail; ordinary sync then preserves/holds it.
    return expected === local ? { local, records: generated } : null;
}
