import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReportItemSchema } from "../schemas/tools.js";
import {
  autoSyncMessage,
  maybeAutoSync,
} from "../services/auto-sync.js";
import {
  activeBrainStore,
  revisionStoreModeEnabled,
} from "../services/active-brain-store.js";
import {
  appendIntakeItemToTasks,
  TASKS_FILE,
} from "../services/task-intake.js";
import {
  assertWriteRole,
  authorIdentity,
  revisionActor,
  resolveToolBrain,
} from "../services/request-context.js";

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "brain_report_item",
    "Capture a temporary Brain intake/handoff item in TASKS.md before triage into the canonical project backlog or project-management system.",
    ReportItemSchema.shape,
    async ({ brain_id, kind, title, source, target, details, urgency }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        let existing = "";
        try {
          existing = await activeBrainStore().readFile(ctx.brainId, TASKS_FILE);
        } catch (error) {
          if (!String(error).includes("not found")) throw error;
          existing = "# TASKS\n";
        }

        const next = appendIntakeItemToTasks(existing, {
          kind,
          title,
          source,
          target,
          details,
          urgency,
        });
        const result = await activeBrainStore().writeFile(
          ctx.brainId,
          TASKS_FILE,
          next,
          "replace",
          undefined,
          revisionActor(ctx)
        );
        const sync = revisionStoreModeEnabled()
          ? ""
          : await maybeAutoSync(
              ctx.brainId,
              autoSyncMessage("UPDATE", TASKS_FILE),
              authorIdentity(ctx)
            );
        return {
          content: [
            {
              type: "text",
              text:
                `Captured ${kind} in TASKS.md Inbox / Handoff Queue for ${ctx.brainId}.\n` +
                result +
                sync,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
