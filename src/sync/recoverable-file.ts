import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contentHash } from "./hash.js";

interface Intent {
  version: 1;
  filename: string;
  expectedHash: string | null;
  replacementHash: string | null;
  complete: boolean;
}

export interface LocalMutationResult {
  ok: boolean;
  currentHash: string | null;
  recoveryPath: string;
}

async function hash(filename: string): Promise<string | null> {
  try { return contentHash(await fs.readFile(filename, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}

async function durableWrite(filename: string, content: string): Promise<void> {
  const handle = await fs.open(filename, "wx", 0o600);
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
}

async function syncDirectory(dir: string): Promise<void> {
  const handle = await fs.open(dir, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function saveIntent(dir: string, intent: Intent): Promise<void> {
  const temporary = path.join(dir, `intent-${randomUUID()}.tmp`);
  await durableWrite(temporary, JSON.stringify(intent));
  await fs.rename(temporary, path.join(dir, "intent.json"));
  await syncDirectory(dir);
}

function targetPath(root: string, filename: string): string {
  const target = path.resolve(root, filename);
  if (path.isAbsolute(filename) || !target.startsWith(path.resolve(root) + path.sep) ||
      filename.split(/[\\/]/).some(part => part.startsWith(".")) || !filename.endsWith(".md")) {
    throw new Error("Invalid local recovery target");
  }
  return target;
}

async function restoreIfAbsent(original: string, target: string): Promise<void> {
  try { await fs.link(original, target); }
  catch (error: any) { if (error.code !== "EEXIST" && error.code !== "ENOENT") throw error; }
}

const RECOVERY_ENTRY_LIMIT = 10000;
const RECOVERY_RECORD_FILES = ["original.md", "replacement.md", "intent.json"];

function recoveryByteLimit(): number {
  const maximum = Number(process.env.BRAIN_SYNC_RECOVERY_MAX_BYTES ?? 268435456);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid BRAIN_SYNC_RECOVERY_MAX_BYTES");
  return maximum;
}

async function recordBytes(dir: string): Promise<number> {
  let bytes = 0;
  for (const name of RECOVERY_RECORD_FILES) {
    try { bytes += (await fs.stat(path.join(dir, name))).size; }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
  return bytes;
}

export interface RecoveryUsage {
  entries: number;
  bytes: number;
  entryLimit: number;
  byteLimit: number;
  /** Percent of whichever budget (entries or bytes) is closer to exhaustion. */
  percent: number;
}

/** Retention budget usage of `.brain-sync-recovery/` under a Brain root. */
export async function recoveryUsage(root: string): Promise<RecoveryUsage> {
  const recoveryRoot = path.join(root, ".brain-sync-recovery");
  const byteLimit = recoveryByteLimit();
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(recoveryRoot, { withFileTypes: true }); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) bytes += await recordBytes(path.join(recoveryRoot, entry.name));
  }
  const percent = Math.ceil(Math.max(entries.length / RECOVERY_ENTRY_LIMIT, bytes / byteLimit) * 100);
  return { entries: entries.length, bytes, entryLimit: RECOVERY_ENTRY_LIMIT, byteLimit, percent };
}

async function assertRecoveryBudget(root: string, extraBytes: number): Promise<void> {
  const usage = await recoveryUsage(root);
  if (usage.entries >= usage.entryLimit) throw new Error("local_recovery_capacity: prune verified-redundant recovery records (sync:recovery:prune) before further local replacement");
  if (usage.bytes + extraBytes > usage.byteLimit) throw new Error("local_recovery_capacity: retained recovery bytes reached the safety budget; no file was displaced");
}

/**
 * Move the actual destination inode into retained custody, then install using
 * link's atomic no-replace semantics. An editor holding that inode can keep
 * writing it: its bytes remain in original.md, even after the destination moves.
 * Recovery copies are deliberately never silently pruned by the sync loop.
 */
export async function mutateLocalFile(
  root: string, filename: string, content: string | null, expectedHash: string | null
): Promise<LocalMutationResult> {
  const target = targetPath(root, filename);
  const recoveryRoot = path.join(root, ".brain-sync-recovery");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  let existingBytes = 0;
  try { existingBytes = (await fs.stat(target)).size; }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  await assertRecoveryBudget(root, existingBytes + Buffer.byteLength(content ?? "") + 1024);
  const dir = await fs.mkdtemp(path.join(recoveryRoot, "operation-"));
  const original = path.join(dir, "original.md");
  const replacement = path.join(dir, "replacement.md");
  const intent: Intent = {
    version: 1, filename, expectedHash,
    replacementHash: content === null ? null : contentHash(content), complete: false,
  };
  if (content !== null) await durableWrite(replacement, content);
  // Prove no-replace links work on this filesystem before displacing user bytes.
  const probeSource = path.join(dir, "link-probe");
  const probeTarget = path.join(path.dirname(target), `.brain-link-probe-${randomUUID()}`);
  await durableWrite(probeSource, "");
  try { await fs.link(probeSource, probeTarget); }
  finally { await fs.unlink(probeTarget).catch(error => { if (error.code !== "ENOENT") throw error; }); await fs.unlink(probeSource); }
  await syncDirectory(path.dirname(target));
  await saveIntent(dir, intent);
  await syncDirectory(recoveryRoot);
  let displaced = false;
  try {
    await fs.rename(target, original);
    displaced = true;
    await syncDirectory(path.dirname(target));
    await syncDirectory(dir);
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const displacedHash = displaced ? await hash(original) : null;
  if (displacedHash !== expectedHash) {
    await restoreIfAbsent(original, target);
    await saveIntent(dir, { ...intent, complete: true });
    return { ok: false, currentHash: displacedHash, recoveryPath: original };
  }
  if (content !== null) {
    try { await fs.link(replacement, target); }
    catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      await saveIntent(dir, { ...intent, complete: true });
      return { ok: false, currentHash: await hash(target), recoveryPath: original };
    }
  }
  await syncDirectory(path.dirname(target));
  // A new pathname or a late write through a displaced descriptor is a conflict.
  const lateOriginalHash = displaced ? await hash(original) : null;
  const currentHash = await hash(target);
  const ok = lateOriginalHash === expectedHash && currentHash === intent.replacementHash;
  if (!ok && currentHash === null) await restoreIfAbsent(original, target);
  await saveIntent(dir, { ...intent, complete: true });
  return { ok, currentHash: lateOriginalHash !== expectedHash ? lateOriginalHash : currentHash, recoveryPath: original };
}

export interface RecoveryObservation { filename: string; contentHash: string; recoveryPath: string }

/** Recover interruption without replacing any newly saved pathname; detect late
 * descriptor writes even if they arrived after a previous operation returned. */
export async function inspectLocalRecovery(root: string): Promise<RecoveryObservation[]> {
  const recoveryRoot = path.join(root, ".brain-sync-recovery");
  let entries;
  try { entries = await fs.readdir(recoveryRoot, { withFileTypes: true }); }
  catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
  const observations: RecoveryObservation[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("operation-")) continue;
    const dir = path.join(recoveryRoot, entry.name);
    let intent: Intent;
    try { intent = JSON.parse(await fs.readFile(path.join(dir, "intent.json"), "utf8")); }
    catch (error: any) {
      if (error.code === "ENOENT") continue; // no intent => no displacement started
      throw error;
    }
    if (intent.version !== 1) throw new Error("Unsupported local recovery intent version");
    const target = targetPath(root, intent.filename);
    const original = path.join(dir, "original.md");
    const originalHash = await hash(original);
    if (!intent.complete) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await restoreIfAbsent(original, target);
      await syncDirectory(path.dirname(target));
      await saveIntent(dir, { ...intent, complete: true });
    }
    if (originalHash !== null && originalHash !== intent.expectedHash) {
      observations.push({ filename: intent.filename, contentHash: originalHash, recoveryPath: original });
    }
  }
  return observations;
}

export type RecoveryVerdict = "redundant" | "retain";
export type RecoveryRetainReason =
  | "too_recent" | "incomplete" | "divergent_original" | "not_in_hosted_history"
  | "unreadable_intent" | "invalid_target";
export type RecoveryRedundantReason = "nothing_displaced" | "original_in_hosted_history";

export interface RecoveryPrunePlanEntry {
  operation: string;
  filename: string | null;
  verdict: RecoveryVerdict;
  reason: RecoveryRetainReason | RecoveryRedundantReason;
  bytes: number;
  ageMs: number | null;
}

export interface RecoveryPruneOptions {
  /** Records completed more recently than this are always retained. */
  olderThanMs: number;
  /** True when hosted revision history holds `hash` as a revision of `filename`. */
  hostedHas: (filename: string, hash: string) => boolean | Promise<boolean>;
  now?: number;
}

/**
 * Classify retained recovery records. A record is redundant only when its
 * operation completed, it is older than the threshold, and either nothing was
 * displaced or the displaced bytes still hash to `expectedHash` and hosted
 * history verifiably holds that revision. Every other record is retained: it
 * may be the only copy of an edit that never reached hosted.
 */
export async function planRecoveryPrune(root: string, options: RecoveryPruneOptions): Promise<RecoveryPrunePlanEntry[]> {
  const recoveryRoot = path.join(root, ".brain-sync-recovery");
  const now = options.now ?? Date.now();
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(recoveryRoot, { withFileTypes: true }); }
  catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
  const plan: RecoveryPrunePlanEntry[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !entry.name.startsWith("operation-")) continue;
    const dir = path.join(recoveryRoot, entry.name);
    const bytes = await recordBytes(dir);
    const retain = (reason: RecoveryRetainReason, filename: string | null, ageMs: number | null) =>
      plan.push({ operation: entry.name, filename, verdict: "retain", reason, bytes, ageMs });
    let intent: Intent; let ageMs: number;
    try {
      const intentPath = path.join(dir, "intent.json");
      intent = JSON.parse(await fs.readFile(intentPath, "utf8"));
      ageMs = now - (await fs.stat(intentPath)).mtimeMs;
      if (intent.version !== 1 || typeof intent.filename !== "string") throw new Error("bad intent");
    } catch { retain("unreadable_intent", null, null); continue; }
    try { targetPath(root, intent.filename); } catch { retain("invalid_target", intent.filename, ageMs); continue; }
    if (!intent.complete) { retain("incomplete", intent.filename, ageMs); continue; }
    if (ageMs < options.olderThanMs) { retain("too_recent", intent.filename, ageMs); continue; }
    const originalHash = await hash(path.join(dir, "original.md"));
    if (originalHash === null) {
      plan.push({ operation: entry.name, filename: intent.filename, verdict: "redundant", reason: "nothing_displaced", bytes, ageMs });
      continue;
    }
    if (originalHash !== intent.expectedHash) { retain("divergent_original", intent.filename, ageMs); continue; }
    if (!(await options.hostedHas(intent.filename, originalHash))) { retain("not_in_hosted_history", intent.filename, ageMs); continue; }
    plan.push({ operation: entry.name, filename: intent.filename, verdict: "redundant", reason: "original_in_hosted_history", bytes, ageMs });
  }
  return plan;
}

/** Remove the redundant records of a plan. Retained records are never touched. */
export async function applyRecoveryPrune(root: string, plan: RecoveryPrunePlanEntry[]): Promise<string[]> {
  const recoveryRoot = path.join(root, ".brain-sync-recovery");
  const removed: string[] = [];
  for (const entry of plan) {
    if (entry.verdict !== "redundant" || !entry.operation.startsWith("operation-")) continue;
    await fs.rm(path.join(recoveryRoot, entry.operation), { recursive: true, force: true });
    removed.push(entry.operation);
  }
  if (removed.length) await syncDirectory(recoveryRoot);
  return removed;
}
