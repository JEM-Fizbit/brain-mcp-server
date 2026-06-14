import path from "node:path";
import type { SourceArtifactKind } from "./types.js";

const STORAGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || "";
}

export function safeArtifactFilename(value: string, fallback = "artifact"): string {
  const name = basename(value).trim() || fallback;
  const parsed = path.parse(name);
  const stem =
    parsed.name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || fallback;
  const ext = parsed.ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 20);
  return `${stem}${ext}`;
}

export function assertStorageSegment(value: string, label: string): void {
  if (!value || value.includes("..") || !STORAGE_SEGMENT_RE.test(value)) {
    throw new Error(`Invalid ${label} for artifact storage path: ${value}`);
  }
}

export function assertStoragePath(value: string): void {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid artifact storage path: ${value}`);
  }
}

export interface ArtifactStoragePathInput {
  brainId: string;
  sourceId: string;
  artifactKind: SourceArtifactKind;
  contentSha256: string;
  originalFilename: string;
}

export function artifactStoragePath(input: ArtifactStoragePathInput): string {
  assertStorageSegment(input.brainId, "brain_id");
  assertStorageSegment(input.sourceId, "source_id");
  assertStorageSegment(input.artifactKind, "artifact_kind");
  if (!SHA256_RE.test(input.contentSha256)) {
    throw new Error("content_sha256 must be a lowercase SHA-256 hex digest.");
  }

  const filename = safeArtifactFilename(input.originalFilename);
  const digestPrefix = input.contentSha256.slice(0, 16);
  const storagePath = [
    "brains",
    input.brainId,
    "sources",
    input.sourceId,
    input.artifactKind,
    `${digestPrefix}_${filename}`,
  ].join("/");
  assertStoragePath(storagePath);
  return storagePath;
}
