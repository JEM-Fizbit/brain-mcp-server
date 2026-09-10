import type { BrainDefinition, BrainRole } from "./registry.js";
import { roleAllows, TOOL_MINIMUM_ROLES, type BrainToolName } from "./tool-authority.js";

export interface StoreCapabilities { revisions: boolean }
export interface OperationCapability {
  supported: boolean;
  reason_code: "supported" | "operator_surface_required" | "revision_store_required";
  execution_surface: "endpoint" | "operator_workspace" | "revision_endpoint";
  custody: "brain_store" | "operator_filesystem";
  effects: string[];
  authorization: { required_role: BrainRole; role_allowed: boolean; recheck_at_execution: true };
  preconditions: string[];
}

export function operationCapability(
  brain: BrainDefinition, role: BrainRole, store: StoreCapabilities,
  tool: BrainToolName, variant: "default" | "analysis" | "source_path" | "apply" = "default"
): OperationCapability {
  const local = brain.storage_backend === "filesystem";
  const filesystem = ["brain_scan_inbox", "brain_semantic_search", "brain_semantic_index", "brain_ingest", "brain_ingest_complete"];
  const sourceOperation = filesystem.includes(tool) && !(tool === "brain_ingest" && variant === "analysis");
  const needsRevision = ["brain_restore_file", "brain_resolve_conflict"].includes(tool);
  const supported = (!sourceOperation || local) && (!needsRevision || store.revisions);
  const required = tool === "brain_lint" && variant === "apply" ? "member" : TOOL_MINIMUM_ROLES[tool];
  // Effects are independent of role: read access does not define purity, and
  // a mutation's content, derived-state and Git effects are separate promises.
  const mutations: Partial<Record<BrainToolName, string[]>> = {
    brain_update_file: ["brain_write"], brain_log: ["brain_write"],
    brain_capture_item: ["brain_write"], brain_report_item: ["brain_write"],
    brain_delete_file: ["brain_delete"], brain_rename_file: ["brain_write", "brain_delete"],
    brain_restore_file: ["brain_write"], brain_resolve_conflict: ["brain_write", "conflict_resolution"],
    brain_ingest: ["operator_filesystem_write"],
    brain_ingest_complete: ["operator_filesystem_write", "brain_write", "inbox_cleanup_if_selected"],
    brain_semantic_index: ["derived_index_write"],
    brain_commit: store.revisions ? [] : ["git_commit", "git_push_if_requested"],
  };
  const effects = tool === "brain_ingest" && variant === "analysis" ? []
    : tool === "brain_lint" && variant === "apply" ? ["brain_write"] : [...(mutations[tool] ?? [])];
  if (local && !store.revisions && effects.some(effect => ["brain_write", "brain_delete", "operator_filesystem_write"].includes(effect)) && !(tool === "brain_lint")) {
    effects.push("git_sync_if_configured");
  }
  const preconditions = tool === "brain_update_file" ? ["replace_requires_reviewed_revision_or_new", "structural_files_require_admin"]
    : tool === "brain_resolve_conflict" ? ["current_reviewed_revision", "open_conflict", "reviewed_local_state_for_reconciliation"]
    : tool === "brain_semantic_search" ? ["existing_index_required"]
    : tool === "brain_commit" && store.revisions ? ["revision_store_no_git_commit"] : [];
  return { supported, reason_code: supported ? "supported" : sourceOperation ? "operator_surface_required" : "revision_store_required",
    execution_surface: supported ? "endpoint" : needsRevision ? "revision_endpoint" : "operator_workspace",
    custody: sourceOperation ? "operator_filesystem" : "brain_store", effects,
    authorization: { required_role: required, role_allowed: roleAllows(role, required), recheck_at_execution: true }, preconditions };
}

export function describeCapabilities(brain: BrainDefinition, role: BrainRole, store: StoreCapabilities) {
  const operations = Object.fromEntries((Object.keys(TOOL_MINIMUM_ROLES) as BrainToolName[]).map(tool =>
    [tool, operationCapability(brain, role, store, tool)]));
  return { version: 1, brain_id: brain.id, backend: brain.storage_backend, operations,
    variants: {
      "brain_ingest.analysis": operationCapability(brain, role, store, "brain_ingest", "analysis"),
      "brain_ingest.source_path": operationCapability(brain, role, store, "brain_ingest", "source_path"),
      "brain_lint.apply": operationCapability(brain, role, store, "brain_lint", "apply"),
    },
    manual_access: "Independent filesystem/SharePoint permissions; endpoint support does not govern manual access.",
    approval: "Client-controlled. Discovery does not authorize execution or suppress host approval prompts.",
    observation: "Not measured by discovery. Unsupported, unobserved and failed checks are not empty/healthy results." };
}

export class OperationUnavailableError extends Error {
  constructor(readonly result: Record<string, unknown>) { super(JSON.stringify(result)); }
}

export function capabilityFailure(error: unknown) {
  if (error instanceof OperationUnavailableError) return {
    content: [{ type: "text" as const, text: JSON.stringify(error.result) }],
    structuredContent: { error: error.result }, isError: true,
  };
  return { content: [{ type: "text" as const, text: String(error) }], isError: true };
}

export function assertOperationSupported(
  brain: BrainDefinition, role: BrainRole, store: StoreCapabilities, tool: BrainToolName,
  variant: "default" | "analysis" | "source_path" | "apply" = "default"
): OperationCapability {
  const capability = operationCapability(brain, role, store, tool, variant);
  if (!capability.supported) throw new OperationUnavailableError({ code: capability.reason_code, operation: tool,
    brain_id: brain.id, capability, observation: "unobserved",
    next: "Use brain_describe and brain_prepare_ingest to select the operator workflow. No writes occurred." });
  return capability;
}
