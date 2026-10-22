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
import { authorIdentity, revisionActor, resolveToolBrain } from "../services/request-context.js";
import { assertToolRole } from "../services/tool-authority.js";
import { policyFailure, assertCapturePolicy, internalWriteContext } from "../services/write-policy.js";
import { writePolicyForBrain } from "../services/write-policy-runtime.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification> | undefined;
interface CaptureToolArgs extends IntakeItem {
  scope?:string;
  brain_target?:string;
  write_context?: import("../services/write-policy.js").BrainWriteContext;
  brain_id?: string;
}

async function captureItem(
  { brain_id, kind, title, source, target, route_hint, details, urgency, scope, brain_target, write_context }: CaptureToolArgs,
  extra: ToolExtra
) {
  try {
    const ctx = await resolveToolBrain(brain_id, extra);
    assertToolRole(ctx, "brain_capture_item");
    const policy=await writePolicyForBrain(ctx.brainId);
    assertCapturePolicy(ctx.brainId,policy,scope,brain_target);
    if(policy?.intake==="brain_scoped" && (!write_context?.maintenance || write_context.maintenance.brain_target!==brain_target)) {
      throw new (await import("../services/write-policy.js")).WritePolicyError("brain_scope_required",ctx.brainId,"Supply maintenance kind, actual Brain target and current evidence; general work belongs in "+policy.capture_route+".");
    }
    if(brain_target) await activeBrainStore().readFile(ctx.brainId,brain_target);
    let existing = "";
    let expectedRevision: string | null = null;
    try {
      const snapshot = await activeBrainStore().readFileSnapshot(ctx.brainId, TASKS_FILE);
      existing = snapshot.content;
      expectedRevision = snapshot.revisionId;
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
      revisionActor(ctx),
      ctx.role,
      expectedRevision,
      policy?.intake==="brain_scoped" ? write_context : internalWriteContext("legacy compatible intake")
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
      ...policyFailure(error),
    };
  }
}

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "brain_capture_item",
    "Policy-scoped Brain maintenance only where configured. General JEM intake is retired: use capture-personal. ERS general work uses ERS Capture/Asana. Read brain_describe for the selected Brain; a refusal saves nothing.",
    CaptureItemSchema.shape,
    captureItem
  );

  server.tool(
    "brain_report_item",
    "Compatibility alias for brain_capture_item with identical per-Brain restrictions. Never a bypass for retired general intake.",
    ReportItemSchema.shape,
    captureItem
  );
}
