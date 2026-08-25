import type { BrainRole } from "./registry.js";
import type { ToolBrainContext } from "./request-context.js";

export const TOOL_MINIMUM_ROLES = {
  brain_list_brains: "reader",
  brain_describe: "reader",
  brain_load_context: "reader",
  brain_read_file: "reader",
  brain_list_files: "reader",
  brain_list_sources: "reader",
  brain_search: "reader",
  brain_sync_status: "reader",
  brain_list_conflicts: "reader",
  brain_read_log: "reader",
  brain_lint: "reader",
  brain_scan_inbox: "reader",
  brain_prepare_ingest: "reader",
  brain_semantic_search: "reader",
  brain_update_file: "member",
  brain_commit: "member",
  brain_log: "member",
  brain_capture_item: "member",
  brain_report_item: "member",
  brain_ingest: "member",
  brain_ingest_complete: "member",
  brain_semantic_index: "member",
  brain_delete_file: "admin",
  brain_rename_file: "admin",
  brain_restore_file: "admin",
  brain_resolve_conflict: "admin",
} as const satisfies Record<string, BrainRole>;

export type BrainToolName = keyof typeof TOOL_MINIMUM_ROLES;

const ROLE_RANK: Record<BrainRole, number> = {
  reader: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleAllows(actual: BrainRole, required: BrainRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function assertToolRole(
  ctx: ToolBrainContext,
  tool: BrainToolName,
  minimumOverride?: BrainRole
): void {
  const required = minimumOverride || TOOL_MINIMUM_ROLES[tool];
  if (roleAllows(ctx.role, required)) return;
  throw new Error(
    `${tool} access denied for Brain ${ctx.brainId}: requires ${required}, current role is ${ctx.role}`
  );
}
