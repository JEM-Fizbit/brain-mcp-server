import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { PostgresSourceMetadataStore } = await import(
  path.join(__dirname, "..", "dist", "sources", "postgres-source-store.js")
);

test("PostgresSourceMetadataStore lists source paths relative to sources root", async () => {
  const queries = [];
  const store = new PostgresSourceMetadataStore({
    async query(sql, values) {
      queries.push({ sql, values });
      return {
        rows: [
          { path: "sources/photos/headshot.jpg" },
          { path: "brain/working/draft.xlsx" },
          { path: "research/paper.pdf" },
          { path: "" },
          { path: null },
        ],
      };
    },
  });

  assert.deepEqual(await store.listSourcePaths("ai-brain-jem", "photos"), [
    "photos/headshot.jpg",
    "working/draft.xlsx",
    "research/paper.pdf",
  ]);
  assert.deepEqual(queries[0].values, ["ai-brain-jem", "photos"]);
});
