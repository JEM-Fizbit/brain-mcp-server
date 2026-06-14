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
const revisionStore = new PostgresRevisionStore(databaseUrl);
const sourceStore = new PostgresSourceMetadataStore(databaseUrl);
const store = new RevisionBrainStore(revisionStore, sourceStore);

try {
  const all = await store.listSources(brainId);
  const assessments = await store.listSources(brainId, "assessments");
  const photos = await store.listSources(brainId, "photos");

  assert.equal(all.length, 70);
  assert.equal(assessments.length, 8);
  assert.equal(photos.length, 12);

  console.log(
    JSON.stringify(
      {
        allSources: all.length,
        assessments: assessments.length,
        photos: photos.length,
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
