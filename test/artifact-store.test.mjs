import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("artifact storage paths are immutable, content addressed, and safe", async () => {
  const { artifactStoragePath } = await import(
    path.join(__dirname, "..", "dist", "artifacts", "index.js")
  );
  const sha = "a".repeat(64);

  const storagePath = artifactStoragePath({
    brainId: "ai-brain-jem",
    sourceId: "7f1ffcf9-4745-4d32-9241-4f95334e79b8",
    artifactKind: "original",
    contentSha256: sha,
    originalFilename: "../June Contract FINAL!!.pdf",
  });

  assert.equal(
    storagePath,
    "brains/ai-brain-jem/sources/7f1ffcf9-4745-4d32-9241-4f95334e79b8/original/aaaaaaaaaaaaaaaa_June-Contract-FINAL.pdf"
  );
  assert.equal(storagePath.includes(".."), false);
});

test("LocalArtifactStore writes byte artifacts by checksum path", async () => {
  const { LocalArtifactStore } = await import(
    path.join(__dirname, "..", "dist", "artifacts", "index.js")
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-artifacts-"));
  const body = Buffer.from("source artifact body\n");
  const expectedHash = createHash("sha256").update(body).digest("hex");
  const store = new LocalArtifactStore(root);

  const artifact = await store.putBytes({
    brainId: "ai-brain-jem",
    sourceId: "source-1",
    artifactKind: "original",
    originalFilename: "note.txt",
    mimeType: "text/plain",
    body,
  });

  assert.equal(artifact.storageBucket, "local-brain-artifacts");
  assert.equal(artifact.contentSha256, expectedHash);
  assert.equal(artifact.byteSize, body.length);
  assert.match(
    artifact.storagePath,
    new RegExp(
      `^brains/ai-brain-jem/sources/source-1/original/${expectedHash.slice(0, 16)}_note.txt$`
    )
  );
  assert.equal(
    await fs.readFile(path.join(root, artifact.storagePath), "utf-8"),
    "source artifact body\n"
  );
});

test("LocalArtifactStore copies file artifacts without mutable names", async () => {
  const { LocalArtifactStore } = await import(
    path.join(__dirname, "..", "dist", "artifacts", "index.js")
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-artifacts-"));
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-source-"));
  const sourcePath = path.join(sourceDir, "scan.pdf");
  await fs.writeFile(sourcePath, Buffer.from("%PDF fake\n"));
  const store = new LocalArtifactStore(root, "artifact-bucket");

  const artifact = await store.putFile({
    brainId: "ai-brain-jem",
    sourceId: "source-2",
    artifactKind: "original",
    originalFilename: "scan.pdf",
    mimeType: "application/pdf",
    filePath: sourcePath,
  });

  assert.equal(artifact.storageBucket, "artifact-bucket");
  assert.equal(artifact.byteSize, 10);
  assert.match(artifact.storagePath, /\/original\/[a-f0-9]{16}_scan\.pdf$/);
  assert.deepEqual(
    await fs.readFile(path.join(root, artifact.storagePath)),
    Buffer.from("%PDF fake\n")
  );
});
