import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UpdateFileSchema, CommitSchema } from "../schemas/tools.js";
import * as brain from "../services/brain.js";
import * as git from "../services/git.js";
import {
  assertWriteRole,
  authorIdentity,
  resolveToolBrain,
} from "../services/request-context.js";

export function registerUpdateTools(server: McpServer): void {
  server.tool(
    "brain_update_file",
    "Update a Brain file. Writes to disk but does NOT auto-commit — call brain_commit separately after edits.",
    UpdateFileSchema.shape,
    async ({ brain_id, filename, content, mode, old_content }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const result = await brain.updateFile(
          filename,
          content,
          mode,
          old_content,
          ctx.brainId
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

  server.tool(
    "brain_commit",
    "Commit current Brain changes to git, with an optional push to remote.",
    CommitSchema.shape,
    async ({ brain_id, message, push }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const result = await git.commit(
          message,
          push,
          ctx.brainId,
          authorIdentity(ctx)
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
