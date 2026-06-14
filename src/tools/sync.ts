import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListConflictsSchema, SyncStatusSchema } from "../schemas/tools.js";
import { activeBrainStore } from "../services/active-brain-store.js";
import { resolveToolBrain } from "../services/request-context.js";
import type { ConflictRecord } from "../sync/types.js";

function shortHash(value?: string | null): string {
  return value ? value.slice(0, 12) : "-";
}

function formatConflict(conflict: ConflictRecord): string {
  return [
    `- ${conflict.conflictId} ${conflict.filename}`,
    `  status: ${conflict.status}`,
    `  local: ${conflict.localOrigin} ${shortHash(conflict.localContentHash)}`,
    `  remote: ${conflict.remoteOrigin || "-"} ${shortHash(conflict.remoteContentHash)}`,
    `  base: ${conflict.localBaseRevisionId || "-"}`,
    `  remote_head: ${conflict.remoteHeadRevisionId || "-"}`,
    `  created: ${conflict.createdAt}`,
  ].join("\n");
}

export function registerSyncTools(server: McpServer): void {
  server.tool(
    "brain_sync_status",
    "Show hosted sync status for the selected Brain: provider, hosted file count, open conflict count, and latest hosted cursor. Filesystem-only local Brain mode reports that no hosted sync state is configured.",
    SyncStatusSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const status = await activeBrainStore().syncStatus(ctx.brainId);
        const text = [
          `Brain: ${ctx.brainId}`,
          `Provider: ${status.provider}`,
          `Hosted files: ${status.hostedFiles}`,
          `Open conflicts: ${status.openConflicts}`,
          `Latest cursor: ${status.latestCursor || "-"}`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_list_conflicts",
    "List sync conflicts for the selected Brain. Defaults to open conflicts. Use this before resolving sync divergence; conflict resolution is intentionally explicit and separate.",
    ListConflictsSchema.shape,
    async ({ brain_id, status }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const conflicts = await activeBrainStore().listConflicts(
          ctx.brainId,
          status
        );
        const text =
          conflicts.length === 0
            ? `No ${status} sync conflicts for ${ctx.brainId}.`
            : `Sync conflicts for ${ctx.brainId} (${status}):\n${conflicts
                .map(formatConflict)
                .join("\n")}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
