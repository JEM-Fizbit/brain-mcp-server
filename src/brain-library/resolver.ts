import fs from "node:fs/promises";
import path from "node:path";
import { isSafeRelativePath, type SourceReferenceArtifact } from "../source-references/index.js";

export interface ArtifactRegistration {
  sourceId: string;
  artifact: SourceReferenceArtifact;
}

export interface ResolvedArtifact {
  sourceId: string;
  artifactId: string;
  rootAlias: string;
  relativePath: string;
  absolutePath: string;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class ArtifactResolver {
  constructor(
    private readonly roots: Readonly<Record<string, string>>,
    private readonly registrations: ReadonlyMap<string, ArtifactRegistration>
  ) {}

  registration(artifactId: string): ArtifactRegistration | undefined {
    return this.registrations.get(artifactId);
  }

  async resolve(artifactId: string): Promise<ResolvedArtifact> {
    const registration = this.registrations.get(artifactId);
    if (!registration) throw new Error("Unknown artifact id");
    const { artifact } = registration;
    if (!artifact.rootAlias || !artifact.relativePath) {
      throw new Error("Artifact has no registered local locator");
    }
    if (!isSafeRelativePath(artifact.relativePath)) {
      throw new Error("Artifact relative path is unsafe");
    }
    const configuredRoot = this.roots[artifact.rootAlias];
    if (!configuredRoot) throw new Error("Artifact root alias is not registered");
    const canonicalRoot = await fs.realpath(configuredRoot);
    const lexicalCandidate = path.resolve(canonicalRoot, artifact.relativePath);
    if (!isWithin(canonicalRoot, lexicalCandidate)) {
      throw new Error("Artifact path escapes its registered root");
    }
    const canonicalCandidate = await fs.realpath(lexicalCandidate);
    if (!isWithin(canonicalRoot, canonicalCandidate)) {
      throw new Error("Artifact symlink escapes its registered root");
    }
    const stats = await fs.stat(canonicalCandidate);
    if (!stats.isFile()) throw new Error("Artifact does not resolve to a file");
    return {
      sourceId: registration.sourceId,
      artifactId: artifact.id,
      rootAlias: artifact.rootAlias,
      relativePath: artifact.relativePath,
      absolutePath: canonicalCandidate,
    };
  }
}
