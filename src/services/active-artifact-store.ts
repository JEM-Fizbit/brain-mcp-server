import path from "node:path";
import os from "node:os";
import { LocalArtifactStore, SupabaseArtifactStore, type ArtifactStore } from "../artifacts/index.js";

export type ArtifactStoreProvider = "filesystem" | "supabase";

export function artifactStoreProvider(): ArtifactStoreProvider {
  return process.env.BRAIN_ARTIFACT_STORE === "supabase" ? "supabase" : "filesystem";
}

function defaultArtifactDir(): string {
  return path.join(os.homedir(), ".local", "share", "brain-platform", "artifacts");
}

export function activeArtifactStore(): ArtifactStore {
  if (artifactStoreProvider() === "supabase") {
    const supabaseUrl = process.env.BRAIN_SUPABASE_URL;
    const serviceRoleKey = process.env.BRAIN_SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "BRAIN_SUPABASE_URL and BRAIN_SUPABASE_SERVICE_ROLE_KEY are required when BRAIN_ARTIFACT_STORE=supabase"
      );
    }
    return new SupabaseArtifactStore({
      supabaseUrl,
      serviceRoleKey,
      bucket: process.env.BRAIN_SUPABASE_STORAGE_BUCKET,
    });
  }

  return new LocalArtifactStore(
    process.env.BRAIN_ARTIFACT_DIR || defaultArtifactDir(),
    process.env.BRAIN_ARTIFACT_BUCKET || "local-brain-artifacts"
  );
}

export function activeArtifactStoreStatus(): string {
  if (artifactStoreProvider() === "supabase") {
    return `Artifact store: Supabase Storage bucket ${
      process.env.BRAIN_SUPABASE_STORAGE_BUCKET || "brain-artifacts"
    }`;
  }
  return `Artifact store: filesystem ${
    process.env.BRAIN_ARTIFACT_DIR || defaultArtifactDir()
  }`;
}
