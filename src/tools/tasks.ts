import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { CaptureItemSchema, ReportItemSchema } from "../schemas/tools.js";
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
  INTAKE_HEADING,
  TASKS_FILE,
  type IntakeItem,
} from "../services/task-intake.js";
import {
  assertWriteRole,
  authorIdentity,
  revisionActor,
  resolveToolBrain,
} from "../services/request-context.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification> | undefined;
interface CaptureToolArgs extends IntakeItem {
  brain_id?: string;
}

async function captureItem(
  { brain_id, kind, title, source, target, route_hint, details, urgency }: CaptureToolArgs,
  extra: ToolExtra
) {
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
      route_hint,
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
          type: "text" as const,
          text:
            `Captured ${kind} in TASKS.md ${INTAKE_HEADING.replace(/^##\s+/, "")} for ${ctx.brainId}.\n` +
            result +
            sync,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: String(error) }],
      isError: true,
    };
  }
}

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "brain_capture_item",
    "Capture a temporary Brain item in TASKS.md Capture / Triage Queue before triage into the canonical destination.",
    CaptureItemSchema.shape,
    captureItem
  );

  server.tool(
    "brain_report_item",
    "Compatibility alias for brain_capture_item. Capture a temporary Brain item in TASKS.md Capture / Triage Queue before triage.",
    ReportItemSchema.shape,
    captureItem
  );
}
