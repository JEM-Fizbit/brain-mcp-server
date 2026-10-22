import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getBrainPaths } from "./registry.js";
import { contentHash } from "../sync/hash.js";
import { mutateLocalFile } from "../sync/recoverable-file.js";
import type { RevisionProposal } from "../sync/types.js";
import { formatAutomaticChange, isInternalWrite, WritePolicyError, type BrainWriteContext, type BrainWritePolicy } from "./write-policy.js";
import { appendLogEntryToContent, formatLogEntry, LOG_HEADER } from "./log.js";
const queues = new Map<string, Promise<void>>();
export async function withFilesystemWrite<T>(root: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(root) || Promise.resolve()).then(fn);
    const tail = run.then(() => undefined, () => undefined);
    queues.set(root, tail);
    try {
        return await run;
    }
    finally {
        if (queues.get(root) === tail)
            queues.delete(root);
    }
}
function journalPath(root: string, id: string): string {
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(id))
        throw new Error("Invalid change id");
    return path.join(root, ".brain-write-journal", id + ".json");
}
async function save(file: string, record: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + ".tmp-" + randomUUID();
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
        await handle.writeFile(JSON.stringify(record, null, 2) + "\n");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), "r");
    try {
        await directory.sync();
    }
    finally {
        await directory.close();
    }
}
export function filesystemRequestHash(value: Record<string, any>): string {
    const context = value.writeContext;
    return createHash("sha256").update(JSON.stringify({ ...value, writeContext: context && {
            operation_id: context.operation_id, kind: context.kind, reason: context.reason, maintenance: context.maintenance,
            evidence: context.evidence.map(({ verification, ...e }: any) => e)
        } })).digest("hex");
}
export async function readFilesystemChange(brainId: string, revisionId: string): Promise<string> {
    const { brainDir } = await getBrainPaths(brainId);
    const record = JSON.parse(await fs.readFile(journalPath(brainDir, revisionId), "utf8"));
    if (record.brain_id !== brainId)
        throw new Error("Change not found in selected Brain");
    if (record.phase === "prepared") {
        const current = await fs.readFile(path.join(brainDir, record.filename), "utf8").catch(() => null);
        record.result = current === record.after ? "applied; audit recovery pending" :
            current === record.before ? "not applied; prepared intent retained" : "interrupted operation; current application state unverified";
    }
    return JSON.stringify(record, null, 2);
}
export async function filesystemReplay(root: string, brainId: string, context: BrainWriteContext | undefined, requestHash: string): Promise<string | null> {
    if (!context || isInternalWrite(context))
        return null;
    let record;
    try {
        record = JSON.parse(await fs.readFile(journalPath(root, context.operation_id), "utf8"));
    }
    catch (error: any) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
    if (record.brain_id !== brainId || record.context?.tool_request_hash !== requestHash)
        throw new WritePolicyError("operation_identity_conflict", brainId, "Inspect the original operation; this id belongs to another request.");
    if (record.owner_pid && record.owner_pid !== process.pid && ["prepared", "applied_audit_pending"].includes(record.phase)) {
        let live = true;
        try {
            process.kill(record.owner_pid, 0);
        }
        catch (error: any) {
            if (error.code === "ESRCH")
                live = false;
        }
        if (live)
            return "Operation " + context.operation_id + " is in progress in its original local process; inspect its change record for acknowledgement. No duplicate write.";
    }
    if (record.phase === "not_applied")
        return "Not applied " + record.filename + "; " + record.result + ". Re-read the preserved edit before a new operation.";
    if (record.phase === "prepared") {
        const actual = await fs.readFile(path.join(root, record.filename), "utf8").catch(() => null);
        if (actual === record.before)
            return null; // no applied effect; revalidate source and CAS
        if (actual === record.after) {
            record.phase = "applied_audit_pending";
            record.result = "applied; interrupted before audit completion";
            await save(journalPath(root, context.operation_id), record);
        }
        else
            return "Operation " + context.operation_id + " has interrupted recovery; original bytes and intent retained. Inspect brain_read_change; no replay or overwrite performed.";
    }
    if (record.phase === "applied_audit_pending") {
        const logPath = path.join(root, "LOG.md");
        const before = await fs.readFile(logPath, "utf8").catch((e: any) => { if (e.code === "ENOENT")
            return null; throw e; });
        if (!before?.includes(record.summary)) {
            const next = appendLogEntryToContent(before || LOG_HEADER, formatLogEntry("UPDATE", [record.filename], record.summary));
            const applied = await mutateLocalFile(root, "LOG.md", next, before === null ? null : contentHash(before));
            if (!applied.ok)
                return "Applied " + record.filename + "; audit recovery remains pending. Original operation retained; no content replay.";
        }
        record.phase = "complete";
        record.result = "applied; verification pending after interruption";
        await save(journalPath(root, context.operation_id), record);
    }
    return "Already applied " + record.filename + "; original change " + context.operation_id + "; " + record.result + ". No duplicate write.";
}
export async function applyFilesystemChange(root: string, input: RevisionProposal, before: string | null, policy: BrainWritePolicy): Promise<string> {
    const context = input.writeContext!;
    const file = journalPath(root, context.operation_id);
    const summary = formatAutomaticChange(input.brainId, input.filename, before || "", input.content, context, input.actor, context.operation_id, policy);
    const record = { brain_id: input.brainId, filename: input.filename, revision_id: context.operation_id,
        prior_revision_id: input.baseRevisionId, observed_at: new Date().toISOString(), actor: input.actor,
        context, before, after: input.content, summary, owner_pid: process.pid, phase: "prepared", result: "not yet applied" };
    const temporary = file + ".intent-" + randomUUID();
    await save(temporary, record);
    try {
        await fs.link(temporary, file);
    }
    catch (error: any) {
        if (error.code !== "EEXIST")
            throw error;
        const existing = JSON.parse(await fs.readFile(file, "utf8"));
        if (existing.context?.tool_request_hash !== context.tool_request_hash)
            throw new WritePolicyError("operation_identity_conflict", input.brainId, "This local operation id belongs to another request.");
        if (existing.phase !== "prepared" || existing.owner_pid !== process.pid)
            return "Operation " + context.operation_id + " already has a durable intent; inspect its original change record. No duplicate write.";
        await save(file, record);
    }
    finally {
        await fs.unlink(temporary);
    }
    const journalDirectory = await fs.open(path.dirname(file), "r");
    try {
        await journalDirectory.sync();
    }
    finally {
        await journalDirectory.close();
    }
    const applied = await mutateLocalFile(root, input.filename, input.content, input.baseRevisionId);
    if (!applied.ok) {
        record.phase = "not_applied";
        record.result = "concurrent local edit preserved";
        await save(file, record);
        throw new Error("Concurrent local edit preserved; no automatic replay.");
    }
    try {
        record.phase = "applied_audit_pending";
        record.result = "applied; audit pending";
        await save(file, record);
        await filesystemReplay(root, input.brainId, context, context.tool_request_hash!);
        const logged = JSON.parse(await fs.readFile(file, "utf8"));
        if (logged.phase !== "complete")
            return "Applied " + input.filename + "; audit recovery pending. Inspect brain_read_change " + context.operation_id + ".";
        let verified = false;
        try {
            verified = (await fs.readFile(path.join(root, input.filename), "utf8")) === input.content;
        }
        catch { }
        logged.context.verification = verified ? "verified" : "verification_failed";
        logged.result = verified ? "exact read-back verified" : "applied; verification failed";
        await save(file, logged);
        return "Updated " + input.filename + "; " + logged.result + ". Change " + context.operation_id + " in LOG.md; manual review is optional.";
    }
    catch {
        return "Applied " + input.filename + "; audit or verification completion unavailable. Durable intent " + context.operation_id + " retained for recovery; no content replay.";
    }
}
