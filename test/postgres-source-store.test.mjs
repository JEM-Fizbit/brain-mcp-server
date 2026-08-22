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
      if (sql.includes("from brain.source_brain_links")) return { rows: [] };
      return {
        rows: [
          {
            id: "source-1",
            brain_id: "ai-brain-jem",
            category: "photos",
            label: "headshot",
            status: "processed",
            source_date: null,
            provenance_note: null,
            companion_path: "sources/photos/headshot.md",
            metadata: {},
            source_created_at: new Date("2026-06-14T00:00:00.000Z"),
            source_updated_at: new Date("2026-06-14T00:00:00.000Z"),
            artifact_id: "artifact-1",
            source_id_row: "source-1",
            artifact_kind: "original",
            storage_bucket: "brain-artifacts",
            storage_path: "research/paper.pdf",
            external_url: null,
            external_provider: null,
            external_id: null,
            provider_revision: null,
            root_alias: null,
            relative_path: null,
            observed_at: null,
            original_filename: "headshot.jpg",
            mime_type: "image/jpeg",
            byte_size: 123,
            content_sha256: "a".repeat(64),
            retention_status: "active",
            artifact_metadata: { local_path: "sources/photos/headshot.jpg" },
            artifact_created_at: new Date("2026-06-14T00:00:00.000Z"),
          },
          {
            id: "source-2",
            brain_id: "ai-brain-jem",
            category: "photos",
            label: "draft",
            status: "processed",
            source_date: null,
            provenance_note: null,
            companion_path: "sources/photos/draft.md",
            metadata: {},
            source_created_at: new Date("2026-06-14T00:00:00.000Z"),
            source_updated_at: new Date("2026-06-14T00:00:00.000Z"),
            artifact_id: "artifact-2",
            source_id_row: "source-2",
            artifact_kind: "original",
            storage_bucket: "brain-artifacts",
            storage_path: "brain/working/draft.xlsx",
            external_url: null,
            external_provider: null,
            external_id: null,
            provider_revision: null,
            root_alias: null,
            relative_path: null,
            observed_at: null,
            original_filename: "draft.xlsx",
            mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byte_size: 456,
            content_sha256: "b".repeat(64),
            retention_status: "active",
            artifact_metadata: {},
            artifact_created_at: new Date("2026-06-14T00:00:00.000Z"),
          },
        ],
      };
    },
  });

  assert.deepEqual(await store.listSourcePaths("ai-brain-jem", "photos"), [
    "photos/headshot.jpg",
    "working/draft.xlsx",
  ]);
  assert.deepEqual(queries[0].values, ["ai-brain-jem", "photos"]);
});

test("PostgresSourceMetadataStore searches extracted source text with literal query matching", async () => {
  const queries = [];
  const store = new PostgresSourceMetadataStore({
    async query(sql, values) {
      queries.push({ sql, values });
      return {
        rows: [
          {
            source_id: "source-1",
            source_label: "profile.pdf",
            artifact_id: "artifact-1",
            display_path: "sources/assessments/profile.pdf",
            text_format: "plain_text",
            content: [
              "Opening paragraph",
              "Risk score is 50%_complete for this profile.",
              "Another risk line appears later.",
            ].join("\n"),
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await store.searchArtifactText("ai-brain-jem", "50%_complete", 5),
    [
      {
        sourceId: "source-1",
        sourceLabel: "profile.pdf",
        artifactId: "artifact-1",
        path: "assessments/profile.pdf",
        textFormat: "plain_text",
        lineNumber: 2,
        line: "Risk score is 50%_complete for this profile.",
      },
    ]
  );
  assert.ok(queries[0].sql.includes("and (t.content ilike $2 escape '\\'"));
  assert.ok(queries[0].sql.includes("or t.content ilike $3 escape '\\'"));
  assert.deepEqual(queries[0].values, [
    "ai-brain-jem",
    "%50\\%\\_complete%",
    "%complete%",
    20,
  ]);
});

test("PostgresSourceMetadataStore searches extracted source text with normalized lookup phrases", async () => {
  const queries = [];
  const store = new PostgresSourceMetadataStore({
    async query(sql, values) {
      queries.push({ sql, values });
      return {
        rows: [
          {
            source_id: "source-1",
            source_label: "tools.md",
            artifact_id: "artifact-1",
            display_path: "sources/research/tools.md",
            text_format: "markdown",
            content: [
              "Opening paragraph",
              "UChicago CNetID / Okta SSO: `jmilad@uchicago.edu`.",
            ].join("\n"),
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await store.searchArtifactText("ai-brain-jem", "my uchicago cnet ID", 5),
    [
      {
        sourceId: "source-1",
        sourceLabel: "tools.md",
        artifactId: "artifact-1",
        path: "research/tools.md",
        textFormat: "markdown",
        lineNumber: 2,
        line: "UChicago CNetID / Okta SSO: `jmilad@uchicago.edu`.",
      },
    ]
  );
  assert.deepEqual(queries[0].values, [
    "ai-brain-jem",
    "%my uchicago cnet ID%",
    "%uchicago%",
    "%cnet%",
    20,
  ]);
});
