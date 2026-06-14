import type {
  SourceArtifactKind,
  SourceArtifactRetentionStatus,
  StoredArtifactRef,
} from "../artifacts/index.js";

export interface SourceRecord {
  id: string;
  brainId: string;
  category: string;
  label: string;
  status: "pending" | "processed" | "blocked" | "archived";
  sourceDate: string | null;
  provenanceNote: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSourceInput {
  brainId: string;
  category: string;
  label: string;
  status?: SourceRecord["status"];
  sourceDate?: string | null;
  provenanceNote?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SourceArtifactRecord {
  id: string;
  sourceId: string;
  artifactKind: SourceArtifactKind;
  storageBucket: string | null;
  storagePath: string | null;
  externalUrl: string | null;
  externalProvider: string | null;
  externalId: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  contentSha256: string | null;
  retentionStatus: SourceArtifactRetentionStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecordSourceArtifactInput {
  sourceId: string;
  artifactKind: SourceArtifactKind;
  storageBucket?: string | null;
  storagePath?: string | null;
  externalUrl?: string | null;
  externalProvider?: string | null;
  externalId?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  contentSha256?: string | null;
  retentionStatus?: SourceArtifactRetentionStatus;
  metadata?: Record<string, unknown>;
}

export interface RecordArtifactTextInput {
  artifactId: string;
  textFormat: "plain_text" | "markdown" | "ocr_text";
  content: string;
  language?: string | null;
}

export interface SourceMetadataStore {
  createSource(input: CreateSourceInput): Promise<SourceRecord>;
  recordArtifact(input: RecordSourceArtifactInput): Promise<SourceArtifactRecord>;
  recordStoredArtifact(
    sourceId: string,
    artifact: StoredArtifactRef,
    retentionStatus?: SourceArtifactRetentionStatus
  ): Promise<SourceArtifactRecord>;
  recordArtifactText(input: RecordArtifactTextInput): Promise<void>;
  listArtifacts(sourceId: string): Promise<SourceArtifactRecord[]>;
  listSourcePaths(brainId: string, category?: string): Promise<string[]>;
}
