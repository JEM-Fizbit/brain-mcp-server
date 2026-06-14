export type SourceArtifactKind =
  | "original"
  | "markdown_conversion"
  | "ocr_text"
  | "extracted_text"
  | "thumbnail"
  | "derived";

export type SourceArtifactRetentionStatus =
  | "active"
  | "snapshot"
  | "pointer_only"
  | "deleted";

export interface ArtifactPutBaseInput {
  brainId: string;
  sourceId: string;
  artifactKind: SourceArtifactKind;
  originalFilename: string;
  mimeType?: string;
  cacheControl?: string;
  metadata?: Record<string, unknown>;
  storagePath?: string;
}

export interface ArtifactPutBytesInput extends ArtifactPutBaseInput {
  body: Buffer | Uint8Array | string;
}

export interface ArtifactPutFileInput extends ArtifactPutBaseInput {
  filePath: string;
}

export interface StoredArtifactRef {
  storageBucket: string;
  storagePath: string;
  artifactKind: SourceArtifactKind;
  originalFilename: string;
  mimeType: string | null;
  byteSize: number;
  contentSha256: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ArtifactStore {
  putBytes(input: ArtifactPutBytesInput): Promise<StoredArtifactRef>;
  putFile(input: ArtifactPutFileInput): Promise<StoredArtifactRef>;
}
