import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { MemoryRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "memory-revision-store.js")
);

test("revision search matches lookup phrases across spacing and camel-case variants", async () => {
  const store = new MemoryRevisionStore();
  await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "09_tools_stack.md",
    baseRevisionId: null,
    origin: "hosted_mcp",
    content:
      "Academic Access\n" +
      "- UChicago CNetID / Okta SSO: `jmilad@uchicago.edu`. Use for paywalled articles.",
  });

  const results = await store.searchFiles("ai-brain-jem", "my uchicago cnet ID", {
    maxResults: 10,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].filename, "09_tools_stack.md");
  assert.equal(results[0].lineNumber, 2);
});
