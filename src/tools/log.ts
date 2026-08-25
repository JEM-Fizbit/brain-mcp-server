import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LogSchema, ReadLogSchema } from "../schemas/tools.js";
import {
  autoSyncMessage,
  maybeAutoSync,
} from "../services/auto-sync.js";
import * as log from "../services/log.js";
import {
  activeBrainStore,
  revisionStoreModeEnabled,
} from "../services/active-brain-store.js";
import { authorIdentity, revisionActor, resolveToolBrain } from "../services/request-context.js";
import { assertToolRole } from "../services/tool-authority.js";

export function registerLogTools(server: McpServer): void {
  server.tool(
    "brain_log",
    "Append an entry to the Brain change log. Use after making updates to record what changed and why.",
    LogSchema.shape,
    async ({ brain_id, opType, filesTouched, summary }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertToolRole(ctx, "brain_log");
        const result = revisionStoreModeEnabled()
          ? await activeBrainStore().appendLog(
              ctx.brainId,
              opType,
              filesTouched,
              summary,
              revisionActor(ctx)
            )
          : await log.appendLog(opType, filesTouched, summary, ctx.brainId);
        const sync = revisionStoreModeEnabled()
          ? ""
          : await maybeAutoSync(
              ctx.brainId,
              autoSyncMessage("LOG", summary),
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
    "brain_read_log",
    "Read entries from the newest-first Brain change log. Use limit and offset to page through older entries.",
    ReadLogSchema.shape,
    async ({ brain_id, limit, offset }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const result = await activeBrainStore().readLog(
          ctx.brainId,
          limit,
          offset
        );
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
