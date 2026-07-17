import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  UpdateFileSchema,
  CommitSchema,
  DeleteFileSchema,
  RenameFileSchema,
  RestoreFileSchema,
} from "../schemas/tools.js";
import {
  autoSyncMessage,
  maybeAutoSync,
} from "../services/auto-sync.js";
import * as git from "../services/git.js";
import {
  activeBrainStore,
  revisionStoreModeEnabled,
} from "../services/active-brain-store.js";
import {
  assertWriteRole,
  authorIdentity,
  revisionActor,
  resolveToolBrain,
} from "../services/request-context.js";
import {
  countInboundLinkers,
  rewriteLinksAfterRename,
} from "../services/link-maintenance.js";

export function registerUpdateTools(server: McpServer): void {
  server.tool(
    "brain_update_file",
    "Update a Brain file. Hosted deployments may auto-commit and push after successful writes; otherwise call brain_commit separately after edits.",
    UpdateFileSchema.shape,
    async ({ brain_id, filename, content, mode, old_content }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const result = await activeBrainStore().writeFile(
          ctx.brainId,
          filename,
          content,
          mode,
          old_content,
          revisionActor(ctx),
          ctx.role
        );
        const sync = revisionStoreModeEnabled()
          ? ""
          : await maybeAutoSync(
              ctx.brainId,
              autoSyncMessage("UPDATE", filename),
              authorIdentity(ctx)
            );
        return { content: [{ type: "text", text: result + sync }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_delete_file",
    "Delete a Brain file. Soft-delete — recoverable via brain_restore_file. Refuses the structural files 00_loader.md and NOW.md. Inbound [[wikilinks]] to the file will dangle after deletion.",
    DeleteFileSchema.shape,
    async ({ brain_id, filename }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const store = activeBrainStore();
        const linkers = await countInboundLinkers(store, ctx.brainId, filename);
        const result = await store.deleteFile(
          ctx.brainId,
          filename,
          revisionActor(ctx)
        );
        const warn = linkers.length
          ? ` ⚠️ ${linkers.length} file(s) still link to ${filename}; those links now dangle${
              linkers.length <= 5 ? ` (${linkers.join(", ")})` : ""
            }. Restore with brain_restore_file if unintended.`
          : "";
        const sync = revisionStoreModeEnabled()
          ? ""
          : await maybeAutoSync(
              ctx.brainId,
              autoSyncMessage("DELETE", filename),
              authorIdentity(ctx)
            );
        return { content: [{ type: "text", text: result + warn + sync }] };
      } catch (error) {
        return { content: [{ type: "text", text: String(error) }], isError: true };
      }
    }
  );

  server.tool(
    "brain_rename_file",
    "Rename/move a Brain file (atomic: creates the new path, tombstones the old). Refuses to rename 00_loader.md or NOW.md, or to overwrite a live target. Inbound [[wikilinks]] are updated where unambiguous.",
    RenameFileSchema.shape,
    async ({ brain_id, from, to }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const store = activeBrainStore();
        const result = await store.renameFile(
          ctx.brainId,
          from,
          to,
          revisionActor(ctx),
          ctx.role
        );
        const rewrite = await rewriteLinksAfterRename(
          store,
          ctx.brainId,
          from,
          to,
          revisionActor(ctx),
          ctx.role
        );
        const linkNote = rewrite.updated
          ? ` Updated ${rewrite.updated} inbound link(s).`
          : "";
        const ambigNote = rewrite.ambiguous
          ? ` Some [[basename]] links were ambiguous (name shared by another file) and left unchanged — review manually.`
          : "";
        const protectedNote = rewrite.protectedSkipped.length
          ? ` ${rewrite.protectedSkipped.join(", ")} contains inbound links but requires owner/admin review; no structural file was auto-edited.`
          : "";
        const sync = revisionStoreModeEnabled()
          ? ""
          : await maybeAutoSync(
              ctx.brainId,
              autoSyncMessage("UPDATE", `${from} -> ${to}`),
              authorIdentity(ctx)
            );
        return {
          content: [{ type: "text", text: result + linkNote + ambigNote + protectedNote + sync }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: String(error) }], isError: true };
      }
    }
  );

  server.tool(
    "brain_restore_file",
    "Restore a previously-deleted Brain file to its last content (hosted Brain only).",
    RestoreFileSchema.shape,
    async ({ brain_id, filename }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const result = await activeBrainStore().restoreFile(
          ctx.brainId,
          filename,
          revisionActor(ctx),
          ctx.role
        );
        const sync = revisionStoreModeEnabled()
          ? ""
          : await maybeAutoSync(
              ctx.brainId,
              autoSyncMessage("UPDATE", filename),
              authorIdentity(ctx)
            );
        return { content: [{ type: "text", text: result + sync }] };
      } catch (error) {
        return { content: [{ type: "text", text: String(error) }], isError: true };
      }
    }
  );

  server.tool(
    "brain_commit",
    "Commit current Brain changes to git, with an optional push to remote.",
    CommitSchema.shape,
    async ({ brain_id, message, push }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const result = revisionStoreModeEnabled()
          ? (
              await activeBrainStore().commit(
                ctx.brainId,
                message,
                authorIdentity(ctx),
                push
              )
            ).message
          : await git.commit(message, push, ctx.brainId, authorIdentity(ctx));
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
