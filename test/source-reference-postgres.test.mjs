import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { persistSourceReference } = await import(
  path.join(__dirname, "..", "dist", "source-references", "index.js")
);

const input = {
  schema: "brain.source-reference/v1",
  brainId: "ai-brain-jem",
  sourceId: "11111111-1111-4111-8111-111111111111",
  label: "Test source",
  category: "research",
  status: "processed",
  evidenceTier: "analysis",
  provenanceNote: "Reviewed test provenance.",
  companionPath: "sources/research/test.md",
  sourceUrls: [{ label: "Source", url: "https://example.com/source" }],
  artifacts: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "original",
      label: "Original",
      provider: "dropbox",
      providerId: "id:fixture",
      providerRevision: "rev-1",
      webUrl: "https://example.com/source",
      rootAlias: "dropbox_personal",
      relativePath: "Research/test.md",
      contentSha256: "a".repeat(64),
      observedAt: "2026-08-22T12:00:00.000Z",
    },
  ],
  brainLinks: [{ filename: "07_interests_learning.md", relation: "context" }],
};

test("persistSourceReference upserts source, artifact identity, and reviewed Brain links", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [{ id: values?.[0] }] };
    },
  };
  const receipt = await persistSourceReference(client, input);
  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /insert into brain\.sources/i);
  assert.match(calls[0].sql, /companion_path/i);
  assert.equal(calls[0].values[0], input.sourceId);
  assert.match(calls[1].sql, /insert into brain\.source_artifacts/i);
  assert.equal(calls[1].values[6], "rev-1");
  assert.equal(calls[1].values[7], "dropbox_personal");
  assert.match(calls[2].sql, /delete from brain\.source_brain_links/i);
  assert.match(calls[2].sql, /jsonb_to_recordset/i);
  assert.equal(calls[2].values[0], input.sourceId);
  assert.deepEqual(JSON.parse(calls[2].values[2]), [
    {
      brain_filename: "07_interests_learning.md",
      relation: "context",
      anchor: "",
    },
  ]);
  assert.match(calls[3].sql, /insert into brain\.source_brain_links/i);
  assert.deepEqual(receipt.artifactIds, [input.artifacts[0].id]);
  assert.deepEqual(receipt.brainFiles, ["07_interests_learning.md"]);
});

test("persistSourceReference refuses an id collision owned by another Brain or source", async () => {
  const client = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };
  await assert.rejects(() => persistSourceReference(client, input), /different source or Brain/);
});
