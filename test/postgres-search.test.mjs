import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { PostgresRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "postgres-revision-store.js")
);

test("Postgres revision search uses FTS, deterministic ranking, and pre-ranking scope filters", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          {
            id: "rev-1",
            brain_id: "ai-brain-jem",
            filename: "knowledge.md",
            parent_revision_id: null,
            content: "alpha strategy",
            content_sha256: "a".repeat(64),
            deleted: false,
            metadata: null,
            origin: "hosted_mcp",
            actor_provider: null,
            actor_id: null,
            actor_name: null,
            actor_email: null,
            created_at: new Date("2026-07-17T00:00:00Z"),
            search_rank: 0.25,
          },
        ],
      };
    },
  };
  const store = new PostgresRevisionStore(pool);
  const results = await store.searchFiles("ai-brain-jem", "alpha strategy", {
    visibleFiles: ["knowledge.md"],
  });

  assert.equal(results[0].filename, "knowledge.md");
  assert.ok(results[0].score > 100);
  assert.match(calls[0].sql, /websearch_to_tsquery\('simple'/i);
  assert.match(calls[0].sql, /ts_rank_cd/i);
  assert.match(calls[0].sql, /archive\/%/i);
  assert.deepEqual(calls[0].params[4], ["knowledge.md"]);
});

test("Postgres revision search falls back to deterministic normalization when FTS has no line hit", async () => {
  const calls = [];
  const row = {
    id: "rev-1",
    brain_id: "ai-brain-jem",
    filename: "identity.md",
    parent_revision_id: null,
    content: "Academic access uses CNetID.",
    content_sha256: "a".repeat(64),
    deleted: false,
    metadata: null,
    origin: "hosted_mcp",
    actor_provider: null,
    actor_id: null,
    actor_name: null,
    actor_email: null,
    created_at: new Date("2026-07-17T00:00:00Z"),
    search_rank: 0,
  };
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return {
          rows: [{ ...row, filename: "noise.md", content: "c term\nnet term\nid term" }],
        };
      }
      return { rows: [row] };
    },
  };
  const store = new PostgresRevisionStore(pool);
  const results = await store.searchFiles("ai-brain-jem", "c net id");

  assert.equal(calls.length, 2);
  assert.equal(results[0].filename, "identity.md");
  assert.equal(results[0].mechanism, "normalized_phrase");
});

test("Postgres revision search retains exact queries made only of ranking stop words", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          {
            id: "rev-1",
            brain_id: "ai-brain-jem",
            filename: "identity.md",
            parent_revision_id: null,
            content: "John",
            content_sha256: "a".repeat(64),
            deleted: false,
            metadata: null,
            origin: "hosted_mcp",
            actor_provider: null,
            actor_id: null,
            actor_name: null,
            actor_email: null,
            created_at: new Date("2026-07-17T00:00:00Z"),
            search_rank: 0.5,
          },
        ],
      };
    },
  };
  const store = new PostgresRevisionStore(pool);
  const results = await store.searchFiles("ai-brain-jem", "John");

  assert.equal(calls[0].params[1], "john");
  assert.equal(results[0].filename, "identity.md");
});
