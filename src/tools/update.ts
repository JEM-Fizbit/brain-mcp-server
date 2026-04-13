import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UpdateFileSchema, CommitSchema } from "../schemas/tools.js";
import * as brain from "../services/brain.js";
import * as git from "../services/git.js";

export function registerUpdateTools(server: McpServer): void {
  server.tool(
    "brain_update_file",
    "Update a Brain file. Writes to disk but does NOT auto-commit — call brain_commit separately after edits.",
    UpdateFileSchema.shape,
    async ({ filename, content, mode, old_content }) => {
      try {
        const result = await brain.updateFile(filename, content, mode, old_content);
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
    async ({ message, push }) => {
      try {
        const result = await git.commit(message, push);
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
