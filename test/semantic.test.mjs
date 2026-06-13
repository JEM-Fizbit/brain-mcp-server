import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-semantic-test-"));
const brainDir = path.join(tmpDir, "brain");
const sourcesDir = path.join(tmpDir, "sources");

process.env.BRAIN_DIR = brainDir;
process.env.BRAIN_SOURCES_DIR = sourcesDir;
delete process.env.BRAIN_PLATFORM_CONFIG;

const semantic = await import(
  path.join(__dirname, "..", "dist", "services", "semantic.js")
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFile(rel, content) {
  const full = path.join(tmpDir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

test("indexes markdown sources and returns semantic matches", async () => {
  await writeFile("brain/00_loader.md", "# Loader\n");
  await writeFile("brain/NOW.md", "# Now\n");
  await writeFile(
    "sources/research/2026-06-13_vector-search.md",
    [
      "# Vector Search Notes",
      "",
      "Semantic retrieval over source documents should find embeddings and chunks.",
      "The Brain Markdown stays canonical and unchanged.",
    ].join("\n")
  );
  await writeFile(
    "sources/travel/2026-06-13_hanoi.md",
    "# Hanoi\n\nCoffee shops and weekend walking routes.",
  );

  const indexed = await semantic.indexSources("ai-brain-jem");
  assert.equal(indexed.skipped, 0);
  assert.ok(indexed.indexed >= 2);

  const results = await semantic.semanticSearch(
    "ai-brain-jem",
    "embedding retrieval chunks",
    3
  );

  assert.ok(results.length > 0);
  assert.equal(results[0].filename, "research/2026-06-13_vector-search.md");
});
