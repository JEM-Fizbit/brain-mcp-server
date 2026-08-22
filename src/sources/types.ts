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
  companionPath: string | null;
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
  companionPath?: string | null;
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
  providerRevision: string | null;
  rootAlias: string | null;
  relativePath: string | null;
  observedAt: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  contentSha256: string | null;
  retentionStatus: SourceArtifactRetentionStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SourceManifestRecord {
  source: SourceRecord;
  artifacts: SourceArtifactRecord[];
  brainLinks: SourceBrainLinkRecord[];
  paths: string[];
}

export type SourceBrainLinkRelation =
  | "supports"
  | "context"
  | "contradicts"
  | "derived_from"
  | "mentions";

export interface SourceBrainLinkRecord {
  id: string;
  sourceId: string;
  brainFilename: string;
  relation: SourceBrainLinkRelation;
  label: string | null;
  anchor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSourceBrainLinkInput {
  sourceId: string;
  brainFilename: string;
  relation: SourceBrainLinkRelation;
  label?: string | null;
  anchor?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceTextSearchResult {
  sourceId: string;
  sourceLabel: string;
  artifactId: string;
  path: string;
  textFormat: "plain_text" | "markdown" | "ocr_text";
  lineNumber: number;
  line: string;
}

export interface RecordSourceArtifactInput {
  sourceId: string;
  artifactKind: SourceArtifactKind;
  storageBucket?: string | null;
  storagePath?: string | null;
  externalUrl?: string | null;
  externalProvider?: string | null;
  externalId?: string | null;
  providerRevision?: string | null;
  rootAlias?: string | null;
  relativePath?: string | null;
  observedAt?: string | null;
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
  recordBrainLink(input: RecordSourceBrainLinkInput): Promise<SourceBrainLinkRecord>;
  recordStoredArtifact(
    sourceId: string,
    artifact: StoredArtifactRef,
    retentionStatus?: SourceArtifactRetentionStatus
  ): Promise<SourceArtifactRecord>;
  recordArtifactText(input: RecordArtifactTextInput): Promise<void>;
  listArtifacts(sourceId: string): Promise<SourceArtifactRecord[]>;
  listBrainLinks(sourceId: string): Promise<SourceBrainLinkRecord[]>;
  listSourcePaths(brainId: string, category?: string): Promise<string[]>;
  listSourceManifests(
    brainId: string,
    category?: string
  ): Promise<SourceManifestRecord[]>;
  searchArtifactText(
    brainId: string,
    query: string,
    maxResults: number
  ): Promise<SourceTextSearchResult[]>;
}
