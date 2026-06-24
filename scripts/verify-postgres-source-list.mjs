import assert from "node:assert/strict";
import { RevisionBrainStore } from "../dist/services/revision-brain-store.js";
import { PostgresSourceMetadataStore } from "../dist/sources/postgres-source-store.js";
import { PostgresRevisionStore } from "../dist/sync/index.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it before verifying source listings."
  );
  process.exit(2);
}

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const expectedSourceCount = Number(process.env.BRAIN_EXPECTED_SOURCE_COUNT || 70);
const expectedCategoryCounts = Object.fromEntries(
  (process.env.BRAIN_EXPECTED_CATEGORY_COUNTS ?? "assessments=8,photos=12")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [category, count] = pair.split("=");
      return [category.trim(), Number(count)];
    })
    .filter(([category, count]) => category && Number.isFinite(count))
);
const revisionStore = new PostgresRevisionStore(databaseUrl);
const sourceStore = new PostgresSourceMetadataStore(databaseUrl);
const store = new RevisionBrainStore(revisionStore, sourceStore);

try {
  const all = await store.listSources(brainId);
  const categoryCounts = {};
  for (const category of Object.keys(expectedCategoryCounts)) {
    categoryCounts[category] = (await store.listSources(brainId, category)).length;
  }

  assert.equal(all.length, expectedSourceCount);
  for (const [category, expectedCount] of Object.entries(expectedCategoryCounts)) {
    assert.equal(categoryCounts[category], expectedCount, `${category} source count`);
  }

  console.log(
    JSON.stringify(
      {
        brainId,
        allSources: all.length,
        expectedSourceCount,
        categoryCounts,
        sample: all.slice(0, 5),
      },
      null,
      2
    )
  );
  console.log("[source-list] PASS: Postgres-backed source listing verified");
} finally {
  await Promise.allSettled([revisionStore.close(), sourceStore.close()]);
}
