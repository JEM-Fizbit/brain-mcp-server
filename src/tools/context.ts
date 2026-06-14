import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LoadContextSchema, ReadFileSchema } from "../schemas/tools.js";
import {
  activeBrainStore,
  loadContextFromActiveStore,
} from "../services/active-brain-store.js";
import { resolveToolBrain } from "../services/request-context.js";

export function registerContextTools(server: McpServer): void {
  server.tool(
    "brain_load_context",
    "Load the Brain loader (navigation table) and NOW.md — the entry point for every session. Returns the minimum context needed to orient and determine which additional files to request.",
    LoadContextSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const content = await loadContextFromActiveStore(ctx.brainId);
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_read_file",
    'Read a specific file. By default reads from the Brain vault (scope="brain"). Pass scope="sources" to read from the sources/ archive (bios, assessments, meeting notes, writing samples, etc.) when the original ingested material is needed rather than a Brain summary.',
    ReadFileSchema.shape,
    async ({ brain_id, filename, scope }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const content = await activeBrainStore().readFile(
          ctx.brainId,
          filename,
          scope
        );
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
