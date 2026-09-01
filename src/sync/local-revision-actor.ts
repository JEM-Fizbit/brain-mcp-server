import type { RevisionActor } from "./types.js";

export type LocalEditSurface = "local_filesystem" | "sharepoint";

export function parseLocalEditSurface(
  value: string | undefined
): LocalEditSurface {
  if (!value || value === "local_filesystem") return "local_filesystem";
  if (value === "sharepoint") return value;
  throw new Error(
    `BRAIN_SYNC_LOCAL_EDIT_SURFACE must be local_filesystem or sharepoint (received ${value})`
  );
}

export function revisionActorForLocalEdit(
  surface: LocalEditSurface,
  operatorName: string | undefined
): RevisionActor {
  if (surface === "sharepoint") {
    return {
      provider: "sharepoint_file_plane",
      id: "editor-unresolved",
      name: "SharePoint/OneDrive manual edit (editor in version history)",
    };
  }

  const operator = operatorName || "local";
  return {
    provider: "local_sync_cli",
    id: operator,
    name: operator,
  };
}
