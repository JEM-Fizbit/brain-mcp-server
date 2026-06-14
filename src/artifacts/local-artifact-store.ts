import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import path from "node:path";
import { artifactStoragePath, assertStoragePath } from "./path.js";
import { sha256Bytes, sha256File } from "./hash.js";
import type {
  ArtifactPutBaseInput,
  ArtifactPutBytesInput,
  ArtifactPutFileInput,
  ArtifactStore,
  StoredArtifactRef,
} from "./types.js";

const DEFAULT_LOCAL_BUCKET = "local-brain-artifacts";

function normalizeBytes(body: Buffer | Uint8Array | string): Buffer | Uint8Array | string {
  if (typeof body === "string" || Buffer.isBuffer(body)) return body;
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

function byteSize(body: Buffer | Uint8Array | string): number {
  return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
}

function refFromInput(
  input: ArtifactPutBaseInput,
  storageBucket: string,
  storagePath: string,
  contentSha256: string,
  size: number
): StoredArtifactRef {
  return {
    storageBucket,
    storagePath,
    artifactKind: input.artifactKind,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType || null,
    byteSize: size,
    contentSha256,
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  };
}

export class LocalArtifactStore implements ArtifactStore {
  readonly rootDir: string;
  readonly bucket: string;

  constructor(rootDir: string, bucket = DEFAULT_LOCAL_BUCKET) {
    this.rootDir = rootDir;
    this.bucket = bucket;
  }

  async putBytes(input: ArtifactPutBytesInput): Promise<StoredArtifactRef> {
    const body = normalizeBytes(input.body);
    const contentSha256 = sha256Bytes(body);
    const storagePath =
      input.storagePath ||
      artifactStoragePath({
        brainId: input.brainId,
        sourceId: input.sourceId,
        artifactKind: input.artifactKind,
        contentSha256,
        originalFilename: input.originalFilename,
      });
    assertStoragePath(storagePath);

    const destination = path.join(this.rootDir, storagePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.writeFile(destination, body, { flag: "wx" });
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }

    return refFromInput(input, this.bucket, storagePath, contentSha256, byteSize(body));
  }

  async putFile(input: ArtifactPutFileInput): Promise<StoredArtifactRef> {
    const { contentSha256, byteSize: size } = await sha256File(input.filePath);
    const storagePath =
      input.storagePath ||
      artifactStoragePath({
        brainId: input.brainId,
        sourceId: input.sourceId,
        artifactKind: input.artifactKind,
        contentSha256,
        originalFilename: input.originalFilename,
      });
    assertStoragePath(storagePath);

    const destination = path.join(this.rootDir, storagePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.copyFile(input.filePath, destination, fsConstants.COPYFILE_EXCL);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(destination);
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.resume();
      });
    }

    return refFromInput(input, this.bucket, storagePath, contentSha256, size);
  }
}
