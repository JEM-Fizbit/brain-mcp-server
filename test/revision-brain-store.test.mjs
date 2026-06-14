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
    async listSourceManifests() {
      return Object.entries(pathsByCategory).flatMap(([category, paths]) =>
        paths.map((sourcePath, index) => ({
          source: {
            id: `${category}-${index}`,
            brainId: "ai-brain-jem",
            category,
            label: sourcePath,
            status: "processed",
            sourceDate: null,
            provenanceNote: null,
            metadata: {},
            createdAt: "2026-06-14T00:00:00.000Z",
            updatedAt: "2026-06-14T00:00:00.000Z",
          },
          artifacts: [
            {
              id: `${category}-${index}-artifact`,
              sourceId: `${category}-${index}`,
              artifactKind: "original",
              storageBucket: "brain-artifacts",
              storagePath: `brains/ai-brain-jem/${sourcePath}`,
              externalUrl: null,
              externalProvider: null,
              externalId: null,
              originalFilename: path.basename(sourcePath),
              mimeType: "application/octet-stream",
              byteSize: 123,
              contentSha256: "a".repeat(64),
              retentionStatus: "active",
              metadata: { local_path: `sources/${sourcePath}` },
              createdAt: "2026-06-14T00:00:00.000Z",
            },
          ],
          paths: [sourcePath],
        }))
      );
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

test("RevisionBrainStore reads hosted source manifests from metadata", async () => {
  const store = new RevisionBrainStore(
    new MemoryRevisionStore(),
    sourceStore({
      photos: ["photos/headshot.jpg"],
    })
  );

  const manifest = await store.readFile(
    "ai-brain-jem",
    "sources/photos/headshot.jpg",
    "sources"
  );
  assert.match(manifest, /# Source Manifest: photos\/headshot\.jpg/);
  assert.match(manifest, /storage_bucket: brain-artifacts/);
  assert.match(manifest, /original_filename: headshot\.jpg/);
  assert.match(manifest, /metadata only/);
});
