import {
  isProtectedStructuralFile,
  type BrainStore,
  type FileMetadata,
} from "./brain-store.js";
import type { RevisionActor } from "../sync/types.js";
import type { BrainRole } from "./registry.js";
import { findInboundLinkFiles, rewriteInboundLinks, type FileEntry } from "./wikilinks.js";

/** Read every live brain-scope file's content into {name, content} entries. */
export async function gatherBrainFiles(
  store: BrainStore,
  brainId: string
): Promise<FileEntry[]> {
  const metas = (await store.listFiles(brainId, "brain")) as FileMetadata[] | string[];
  const names = metas.map((m) => (typeof m === "string" ? m : m.name));
  const files: FileEntry[] = [];
  for (const name of names) {
    try {
      files.push({ name, content: await store.readFile(brainId, name) });
    } catch {
      // Skip anything unreadable (e.g. a race with concurrent deletion).
    }
  }
  return files;
}

/**
 * After an atomic rename has already moved `from` -> `to`, rewrite inbound
 * [[wikilinks]] across the brain. Returns how many files were updated and
 * whether any basename collision forced ambiguous links to be skipped.
 */
export async function rewriteLinksAfterRename(
  store: BrainStore,
  brainId: string,
  from: string,
  to: string,
  actor?: RevisionActor,
  role?: BrainRole
): Promise<{ updated: number; ambiguous: boolean; protectedSkipped: string[] }> {
  const files = await gatherBrainFiles(store, brainId);
  const { updates, ambiguous } = rewriteInboundLinks(files, from, to);
  const protectedSkipped: string[] = [];
  for (const update of updates) {
    if (
      isProtectedStructuralFile(update.name) &&
      role !== "owner" &&
      role !== "admin"
    ) {
      protectedSkipped.push(update.name);
      continue;
    }
    await store.writeFile(
      brainId,
      update.name,
      update.content,
      "replace",
      undefined,
      actor,
      role
    );
  }
  return {
    updated: updates.length - protectedSkipped.length,
    ambiguous,
    protectedSkipped,
  };
}

/** Files that contain an inbound wikilink resolving to `filename` (for a delete warning). */
export async function countInboundLinkers(
  store: BrainStore,
  brainId: string,
  filename: string
): Promise<string[]> {
  const files = await gatherBrainFiles(store, brainId);
  return findInboundLinkFiles(files, filename);
}
