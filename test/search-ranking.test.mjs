import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { MemoryRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "memory-revision-store.js")
);
const { searchMarkdownFiles, sortSearchResults } = await import(
  path.join(__dirname, "..", "dist", "search-ranking.js")
);

async function seed(store, filename, content) {
  await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename,
    baseRevisionId: null,
    origin: "hosted_mcp",
    content,
  });
}

test("structured search ranks exact phrases deterministically", () => {
  const files = {
    "b.md": "alpha strategy beta",
    "a.md": "alpha strategy",
    "c.md": "strategy alpha",
  };
  const first = searchMarkdownFiles(files, "alpha strategy", { maxResults: 10 });
  const second = searchMarkdownFiles(files, "alpha strategy", { maxResults: 10 });
  assert.deepEqual(first, second);
  assert.equal(first[0].filename, "a.md");
  assert.equal(first[0].mechanism, "exact_phrase");
  assert.ok(first.every((result) => typeof result.score === "number"));
});

test("knowledge search excludes operational and history paths unless requested", async () => {
  const store = new MemoryRevisionStore();
  for (const filename of [
    "knowledge.md",
    "LOG.md",
    "JOURNAL.md",
    "archive/old.md",
    "working/draft.md",
  ]) {
    await seed(store, filename, "unique needle");
  }

  const defaultResults = await store.searchFiles("ai-brain-jem", "unique needle");
  assert.deepEqual(defaultResults.map((result) => result.filename), ["knowledge.md"]);

  const expanded = await store.searchFiles("ai-brain-jem", "unique needle", {
    includeOperational: true,
  });
  assert.deepEqual(
    new Set(expanded.map((result) => result.filename)),
    new Set([
      "knowledge.md",
      "LOG.md",
      "JOURNAL.md",
      "archive/old.md",
      "working/draft.md",
    ])
  );
});

test("visibility filtering happens before ranking", async () => {
  const store = new MemoryRevisionStore();
  await seed(store, "visible.md", "needle");
  await seed(store, "hidden.md", "needle needle");
  const results = await store.searchFiles("ai-brain-jem", "needle", {
    visibleFiles: ["visible.md"],
  });
  assert.deepEqual(results.map((result) => result.filename), ["visible.md"]);
});

test("pre-ranked store results merge without score inflation", () => {
  const results = sortSearchResults(
    [
      {
        filename: "brain.md",
        lineNumber: 1,
        line: "alpha",
        scope: "brain",
        score: 85,
        mechanism: "normalized_phrase",
      },
      {
        filename: "sources/source.md",
        lineNumber: 1,
        line: "alpha",
        scope: "sources",
        score: 100,
        mechanism: "exact_phrase",
      },
    ],
    5
  );

  assert.equal(results[0].filename, "sources/source.md");
  assert.equal(results[1].score, 85);
});
