import {
  revisionStoreModeEnabled,
  revisionStoreProvider,
} from "./active-brain-store.js";
import { artifactStoreProvider } from "./active-artifact-store.js";

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export interface RuntimeStatus {
  transport: "http" | "stdio";
  revisionStore: "filesystem" | "file" | "postgres";
  artifactStore: "filesystem" | "supabase";
  gitHotPath: "disabled" | "filesystem";
  autoSyncEnabled: boolean;
}

export function runtimeStatus(): RuntimeStatus {
  return {
    transport: process.env.TRANSPORT === "http" ? "http" : "stdio",
    revisionStore: revisionStoreProvider(),
    artifactStore: artifactStoreProvider(),
    gitHotPath: revisionStoreModeEnabled() ? "disabled" : "filesystem",
    autoSyncEnabled: truthy(process.env.BRAIN_AUTO_SYNC),
  };
}

export function assertHttpRuntimeConfig(): void {
  const status = runtimeStatus();
  const missing: string[] = [];

  if (status.revisionStore === "postgres") {
    if (!process.env.BRAIN_REVISION_DATABASE_URL) {
      missing.push("BRAIN_REVISION_DATABASE_URL");
    }
    if (status.artifactStore !== "supabase") {
      throw new Error(
        "Hosted Postgres runtime requires BRAIN_ARTIFACT_STORE=supabase so source artifacts do not fall back to local filesystem storage"
      );
    }
  }

  if (status.artifactStore === "supabase") {
    if (!process.env.BRAIN_SUPABASE_URL) missing.push("BRAIN_SUPABASE_URL");
    if (!process.env.BRAIN_SUPABASE_SERVICE_ROLE_KEY) {
      missing.push("BRAIN_SUPABASE_SERVICE_ROLE_KEY");
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing hosted runtime configuration: ${missing.join(", ")}`
    );
  }
}
