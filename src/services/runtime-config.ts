import {
  revisionStoreModeEnabled,
  revisionStoreProvider,
} from "./active-brain-store.js";
import { artifactStoreProvider } from "./active-artifact-store.js";
import { assertHttpIdentityConfig } from "./runtime-env.js";

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export interface RuntimeStatus {
  transport: "http" | "stdio";
  revisionStore: "filesystem" | "file" | "postgres";
  artifactStore: "filesystem" | "supabase";
  oauthStateStore: "file" | "postgres";
  artifactByteAccess: "metadata_only" | "admin";
  gitHotPath: "disabled" | "filesystem";
  autoSyncEnabled: boolean;
}

export function oauthStateProvider(): RuntimeStatus["oauthStateStore"] {
  return process.env.BRAIN_OAUTH_STATE_STORE === "postgres" ? "postgres" : "file";
}

export function artifactByteAccessMode(): RuntimeStatus["artifactByteAccess"] {
  return process.env.BRAIN_ARTIFACT_BYTE_ACCESS === "admin"
    ? "admin"
    : "metadata_only";
}

export function runtimeStatus(): RuntimeStatus {
  return {
    transport: process.env.TRANSPORT === "http" ? "http" : "stdio",
    revisionStore: revisionStoreProvider(),
    artifactStore: artifactStoreProvider(),
    oauthStateStore: oauthStateProvider(),
    artifactByteAccess: artifactByteAccessMode(),
    gitHotPath: revisionStoreModeEnabled() ? "disabled" : "filesystem",
    autoSyncEnabled: truthy(process.env.BRAIN_AUTO_SYNC),
  };
}

export function assertHttpRuntimeConfig(): void {
  assertHttpIdentityConfig();
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

  if (status.oauthStateStore === "postgres" && !process.env.BRAIN_REVISION_DATABASE_URL) {
    missing.push("BRAIN_REVISION_DATABASE_URL");
  }

  if (status.artifactStore === "supabase") {
    if (!process.env.BRAIN_SUPABASE_URL) missing.push("BRAIN_SUPABASE_URL");
    if (
      status.artifactByteAccess === "admin" &&
      !process.env.BRAIN_SUPABASE_SERVICE_ROLE_KEY
    ) {
      missing.push("BRAIN_SUPABASE_SERVICE_ROLE_KEY");
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing hosted runtime configuration: ${missing.join(", ")}`
    );
  }
}
