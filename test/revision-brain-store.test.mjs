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

function metricHeadStore() {
  return {
    async getHead() {
      return null;
    },
    async readFile() {
      throw new Error("listFiles should not read file contents when head metrics exist");
    },
    async listFiles() {
      return [
        {
          brainId: "ai-brain-jem",
          filename: "00_loader.md",
          revisionId: "rev_1",
          contentHash: "a".repeat(64),
          lineCount: 3,
          byteCount: 42,
          updatedAt: "2026-06-14T00:00:00.000Z",
          origin: "local_agent",
          cursor: "1",
        },
      ];
    },
    async searchFiles() {
      return [];
    },
    async proposeRevision() {
      throw new Error("not implemented");
    },
    async listChanges() {
      return { changes: [], nextCursor: null };
    },
    async recordConflict() {
      throw new Error("not implemented");
    },
    async listConflicts() {
      return [];
    },
  };
}

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
    async searchArtifactText(_brainId, query, maxResults) {
      const rows = [
        {
          sourceId: "assessment-1",
          sourceLabel: "assessment.pdf",
          artifactId: "assessment-1-artifact",
          path: "assessments/profile.pdf",
          textFormat: "plain_text",
          lineNumber: 12,
          line: "The profile mentions greenhouse governance and risk controls.",
        },
      ];
      return rows
        .filter((row) => row.line.toLowerCase().includes(query.toLowerCase()))
        .slice(0, maxResults);
    },
  };
}

test("RevisionBrainStore lists hosted files without rereading content when head metrics exist", async () => {
  const store = new RevisionBrainStore(metricHeadStore());

  assert.deepEqual(await store.listFiles("ai-brain-jem"), [
    {
      name: "00_loader.md",
      lines: 3,
      bytes: 42,
      lastModified: new Date("2026-06-14T00:00:00.000Z"),
      staleDays: null,
    },
  ]);
});

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

  const results = await store.searchFiles("ai-brain-jem", "headshot", {
    scope: "sources",
    maxResults: 5,
  });
  assert.equal(results[0].filename, "sources/photos/headshot.jpg");
  assert.ok(results[0].score > 0);
});

test("RevisionBrainStore searches hosted source extracted text before path metadata", async () => {
  const store = new RevisionBrainStore(
    new MemoryRevisionStore(),
    sourceStore({
      assessments: ["assessments/profile.pdf"],
      photos: ["photos/headshot.jpg"],
    })
  );

  const results = await store.searchFiles("ai-brain-jem", "greenhouse", {
    scope: "sources",
    maxResults: 5,
  });
  assert.equal(results[0].filename, "sources/assessments/profile.pdf");
  assert.equal(results[0].lineNumber, 12);
  assert.match(results[0].line, /greenhouse governance/);
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

test("RevisionBrainStore appends LOG.md entries newest-first below the preamble", async () => {
  const store = new RevisionBrainStore(new MemoryRevisionStore());

  await store.appendLog("ers-brain", "UPDATE", ["first.md"], "first entry");
  await store.appendLog("ers-brain", "UPDATE", ["second.md"], "second entry");

  const content = await store.readFile("ers-brain", "LOG.md");
  const dividerIndex = content.indexOf("\n---\n");
  const firstIndex = content.indexOf("first entry");
  const secondIndex = content.indexOf("second entry");

  assert.ok(dividerIndex > -1, "LOG.md should keep the standard preamble");
  assert.ok(secondIndex > dividerIndex, "newest entry should be below preamble");
  assert.ok(firstIndex > -1, "older entry should exist");
  assert.ok(secondIndex < firstIndex, "newest entry should be above older entries");

  const latest = await store.readLog("ers-brain", 1);
  assert.match(latest, /second entry/);
  assert.doesNotMatch(latest, /first entry/);
});

test("RevisionBrainStore keeps LOG.md ordering isolated by brain_id", async () => {
  const store = new RevisionBrainStore(new MemoryRevisionStore());

  await store.appendLog("ai-brain-jem", "UPDATE", ["NOW.md"], "JEM log entry");
  await store.appendLog("ers-brain", "UPDATE", ["NOW.md"], "ERS log entry");

  assert.match(await store.readLog("ai-brain-jem", 1), /JEM log entry/);
  assert.doesNotMatch(await store.readLog("ai-brain-jem", 1), /ERS log entry/);
  assert.match(await store.readLog("ers-brain", 1), /ERS log entry/);
  assert.doesNotMatch(await store.readLog("ers-brain", 1), /JEM log entry/);
});

test("RevisionBrainStore protects always-loaded files at the store boundary", async () => {
  const revisionStore = new MemoryRevisionStore();
  for (const filename of ["00_loader.md", "NOW.md"]) {
    await revisionStore.proposeRevision({
      brainId: "ai-brain-jem",
      filename,
      baseRevisionId: null,
      origin: "local_agent",
      content: `# ${filename}\n`,
    });
  }
  const store = new RevisionBrainStore(revisionStore);

  for (const role of ["member", "reader", "editor", undefined]) {
    await assert.rejects(
      () =>
        store.writeFile(
          "ai-brain-jem",
          "00_loader.md",
          "# changed\n",
          "replace",
          undefined,
          undefined,
          role
        ),
      /owner or admin role required/i
    );
  }

  await assert.doesNotReject(() =>
    store.writeFile(
      "ai-brain-jem",
      "00_loader.md",
      "# admin changed\n",
      "replace",
      undefined,
      undefined,
      "admin"
    )
  );
  await assert.doesNotReject(() =>
    store.writeFile(
      "ai-brain-jem",
      "NOW.md",
      "# owner changed\n",
      "replace",
      undefined,
      undefined,
      "owner"
    )
  );
  await assert.doesNotReject(() =>
    store.writeFile(
      "ai-brain-jem",
      "ordinary.md",
      "# member content\n",
      "replace",
      undefined,
      undefined,
      "member"
    )
  );
});

test("RevisionBrainStore protects structural conflict resolution at the store boundary", async () => {
  const revisionStore = new MemoryRevisionStore();
  const seeded = await revisionStore.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: null,
    origin: "local_agent",
    content: "# NOW\n",
  });
  assert.equal(seeded.ok, true);
  const conflict = await revisionStore.recordConflict({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    localBaseRevisionId: seeded.head.revisionId,
    remoteHeadRevisionId: seeded.head.revisionId,
    localContentHash: "b".repeat(64),
    remoteContentHash: seeded.head.contentHash,
    localOrigin: "local_agent",
    remoteOrigin: "hosted_mcp",
  });
  const store = new RevisionBrainStore(revisionStore);

  for (const role of ["member", "reader", "editor", undefined]) {
    await assert.rejects(
      () =>
        store.resolveConflict(
          "ai-brain-jem",
          conflict.conflictId,
          "# member resolution\n",
          undefined,
          role
        ),
      /owner or admin role required/i
    );
  }

  await assert.doesNotReject(() =>
    store.resolveConflict(
      "ai-brain-jem",
      conflict.conflictId,
      "# admin resolution\n",
      undefined,
      "admin"
    )
  );
});

test("RevisionBrainStore protects structural rename targets at the store boundary", async () => {
  const revisionStore = new MemoryRevisionStore();
  await revisionStore.proposeRevision({
    brainId: "rename-brain",
    filename: "ordinary.md",
    baseRevisionId: null,
    origin: "local_agent",
    content: "# Ordinary\n",
  });
  const store = new RevisionBrainStore(revisionStore);

  await assert.rejects(
    () =>
      store.renameFile(
        "rename-brain",
        "ordinary.md",
        "NOW.md",
        undefined,
        "member"
      ),
    /owner or admin role required/i
  );
  await assert.doesNotReject(() =>
    store.renameFile(
      "rename-brain",
      "ordinary.md",
      "NOW.md",
      undefined,
      "owner"
    )
  );
});
