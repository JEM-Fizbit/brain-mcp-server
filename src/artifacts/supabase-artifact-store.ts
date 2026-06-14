import { createReadStream } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { artifactStoragePath, assertStoragePath } from "./path.js";
import { sha256Bytes, sha256File } from "./hash.js";
import type {
  ArtifactPutBaseInput,
  ArtifactPutBytesInput,
  ArtifactPutFileInput,
  ArtifactStore,
  StoredArtifactRef,
} from "./types.js";

const DEFAULT_SUPABASE_BUCKET = "brain-artifacts";
const DEFAULT_CACHE_CONTROL_SECONDS = "31536000";

export interface SupabaseArtifactStoreOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket?: string;
}

function metadataFor(
  input: ArtifactPutBaseInput,
  contentSha256: string
): Record<string, unknown> {
  return {
    ...input.metadata,
    brain_id: input.brainId,
    source_id: input.sourceId,
    artifact_kind: input.artifactKind,
    original_filename: input.originalFilename,
    content_sha256: contentSha256,
  };
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

export class SupabaseArtifactStore implements ArtifactStore {
  readonly client: SupabaseClient;
  readonly bucket: string;

  constructor(options: SupabaseArtifactStoreOptions) {
    this.bucket = options.bucket || DEFAULT_SUPABASE_BUCKET;
    this.client = createClient(options.supabaseUrl, options.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async putBytes(input: ArtifactPutBytesInput): Promise<StoredArtifactRef> {
    const contentSha256 = sha256Bytes(input.body);
    const storagePath = this.resolveStoragePath(input, contentSha256);
    const size =
      typeof input.body === "string" ? Buffer.byteLength(input.body) : input.body.byteLength;

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(storagePath, input.body, {
        cacheControl: input.cacheControl || DEFAULT_CACHE_CONTROL_SECONDS,
        contentType: input.mimeType || "application/octet-stream",
        upsert: false,
        metadata: metadataFor(input, contentSha256),
      });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

    return refFromInput(input, this.bucket, storagePath, contentSha256, size);
  }

  async putFile(input: ArtifactPutFileInput): Promise<StoredArtifactRef> {
    const { contentSha256, byteSize } = await sha256File(input.filePath);
    const storagePath = this.resolveStoragePath(input, contentSha256);

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(storagePath, createReadStream(input.filePath), {
        cacheControl: input.cacheControl || DEFAULT_CACHE_CONTROL_SECONDS,
        contentType: input.mimeType || "application/octet-stream",
        duplex: "half",
        upsert: false,
        metadata: metadataFor(input, contentSha256),
      });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

    return refFromInput(input, this.bucket, storagePath, contentSha256, byteSize);
  }

  private resolveStoragePath(input: ArtifactPutBaseInput, contentSha256: string): string {
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
    return storagePath;
  }
}
