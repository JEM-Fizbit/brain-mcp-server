import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { MemoryRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);
const { RevisionBrainStore } = await import(
  path.join(__dirname, "..", "dist", "services", "revision-brain-store.js")
);

function sourceStore(pathsByCategory) {
  return {
    async createSource() {
      throw new Error("not implemented");
    },
    async recordArtifact() {
      throw new Error("not implemented");
    },
    async recordStoredArtifact() {
      throw new Error("not implemented");
    },
    async recordArtifactText() {
      throw new Error("not implemented");
    },
    async listArtifacts() {
      return [];
    },
    async listSourcePaths(_brainId, category) {
      if (category) return pathsByCategory[category] || [];
      return Object.values(pathsByCategory).flat().sort();
    },
  };
}

test("RevisionBrainStore lists hosted source metadata when source store is present", async () => {
  const store = new RevisionBrainStore(
    new MemoryRevisionStore(),
    sourceStore({
      assessments: ["assessments/profile.pdf"],
      photos: ["photos/headshot.jpg"],
    })
  );

  assert.deepEqual(await store.listSources("ai-brain-jem", "assessments"), [
    "assessments/profile.pdf",
  ]);
  assert.deepEqual(await store.listFiles("ai-brain-jem", "sources"), [
    "assessments/profile.pdf",
    "photos/headshot.jpg",
  ]);
});

test("RevisionBrainStore searches hosted source paths from metadata", async () => {
  const store = new RevisionBrainStore(
    new MemoryRevisionStore(),
    sourceStore({
      assessments: ["assessments/profile.pdf"],
      photos: ["photos/headshot.jpg"],
    })
  );

  assert.equal(
    await store.searchFiles("ai-brain-jem", "headshot", "sources", 5),
    "sources:photos/headshot.jpg"
  );
});
