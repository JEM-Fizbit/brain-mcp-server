import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  BRAIN_DIR,
  GITHUB_REPO,
  INBOX_DIR,
  LOADER_FILE,
  NOW_FILE,
  SOURCE_CATEGORIES,
  SOURCES_ROOT,
} from "../constants.js";
import { runtimeBrainId } from "./runtime-env.js";

export type BrainRole = "owner" | "admin" | "member" | "reader";
export type BrainType = "personal" | "shared";
export type IntegrationMode = "vertical" | "aggregation" | "hybrid";
export type StorageBackend = "filesystem" | "postgres";
export type BrainLintReachabilityMode = "legacy" | "graph_shadow" | "graph";

export interface BrainLintConfig {
  reachability_mode?: BrainLintReachabilityMode;
  graph_roots?: string[];
  relative_parent_scope?: "disabled" | "within_brain";
  sharepoint_url_mappings?: Array<{
    url_prefix: string;
    brain_path_prefix: string;
  }>;
  exempt_globs?: string[];
}

export interface BrainStorageConfig {
  repo_path?: string;
  brain_dir?: string;
  sources_dir?: string;
  inbox_dir?: string;
  remote?: string;
  github_repo?: string;
  [key: string]: unknown;
}

export interface BrainDefinition {
  id: string;
  type: BrainType;
  template_used: string;
  integration_mode: IntegrationMode;
  storage_backend: StorageBackend;
  storage_config: BrainStorageConfig;
  vector_backend?: string | null;
  vector_scope?: string[];
  source_categories?: string[];
  created_at?: string;
  metadata?: Record<string, unknown>;
  lint?: BrainLintConfig;
}

export interface RegistryPrincipal {
  provider: string;
  provider_user_id?: string;
  login?: string;
  email?: string;
  name?: string;
  roles: Record<string, BrainRole>;
}

export interface BrainRegistry {
  version: number;
  default_brain_id?: string;
  brains: BrainDefinition[];
  principals?: RegistryPrincipal[];
}

export interface BrainPrincipal {
  provider: string;
  providerUserId: string;
  login?: string;
  email?: string;
  name?: string;
}

export interface BrainPaths {
  brainDir: string;
  sourcesRoot: string;
  inboxDir: string;
  repoPath: string;
  githubRepo: string;
}

const BRAIN_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const BRAIN_ROLES = new Set<BrainRole>(["owner", "admin", "member", "reader"]);
const LINT_MODES = new Set<BrainLintReachabilityMode>([
  "legacy",
  "graph_shadow",
  "graph",
]);
const SOURCE_CATEGORY_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isBrainRole(value: unknown): value is BrainRole {
  return typeof value === "string" && BRAIN_ROLES.has(value as BrainRole);
}

function isLintMode(value: unknown): value is BrainLintReachabilityMode {
  return typeof value === "string" && LINT_MODES.has(value as BrainLintReachabilityMode);
}

function defaultConfigPath(): string {
  return path.join(os.homedir(), ".config", "brain-platform", "registry.json");
}

export function isValidBrainId(value: string): boolean {
  return BRAIN_ID_RE.test(value);
}

export function validateBrainId(value: string): void {
  if (!isValidBrainId(value)) {
    throw new Error(
      `Invalid brain_id: ${value}. Use lowercase letters, numbers, and hyphens.`
    );
  }
}

function defaultBrainId(): string {
  return runtimeBrainId();
}

function defaultRepoPath(): string {
  if (existsSync(path.join(BRAIN_DIR, ".git"))) return BRAIN_DIR;
  const base = path.basename(BRAIN_DIR);
  return base === "brain" ? path.dirname(BRAIN_DIR) : BRAIN_DIR;
}

function synthesizedRegistry(): BrainRegistry {
  const id = defaultBrainId();
  return {
    version: 1,
    default_brain_id: id,
    brains: [
      {
        id,
        type: "personal",
        template_used: "personal",
        integration_mode: "vertical",
        storage_backend: "filesystem",
        storage_config: {
          repo_path: defaultRepoPath(),
          brain_dir: BRAIN_DIR,
          sources_dir: SOURCES_ROOT,
          inbox_dir: path.resolve(BRAIN_DIR, "..", INBOX_DIR),
          github_repo: GITHUB_REPO,
        },
        vector_backend: null,
        vector_scope: ["sources"],
        source_categories: [...SOURCE_CATEGORIES],
        // A synthesized local profile stays legacy by default, but carries the
        // same graph grammar defaults as deployment registries so the explicit
        // BRAIN_LINT_MODE_OVERRIDES promotion gate produces meaningful graph
        // results instead of flagging rotated history as unreachable.
        lint: {
          graph_roots: [LOADER_FILE, NOW_FILE],
          relative_parent_scope: "disabled",
          exempt_globs: ["archive/JOURNAL-*.md", "archive/LOG-*.md"],
        },
        metadata: {},
      },
    ],
  };
}

function assertRegistryShape(registry: BrainRegistry): void {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.brains)) {
    throw new Error("Brain registry must be version 1 with a brains array.");
  }

  const seen = new Set<string>();
  for (const brain of registry.brains) {
    validateBrainId(brain.id);
    if (seen.has(brain.id)) {
      throw new Error(`Duplicate brain_id in registry: ${brain.id}`);
    }
    seen.add(brain.id);
    if (brain.storage_backend !== "filesystem" && brain.storage_backend !== "postgres") {
      throw new Error(`Unsupported storage_backend for ${brain.id}: ${brain.storage_backend}`);
    }
    if (brain.source_categories !== undefined) {
      if (
        !Array.isArray(brain.source_categories) ||
        brain.source_categories.length === 0 ||
        brain.source_categories.some(
          (category) =>
            typeof category !== "string" || !SOURCE_CATEGORY_RE.test(category)
        )
      ) {
        throw new Error(
          `Brain ${brain.id} source_categories must be a non-empty array of safe directory names.`
        );
      }
      if (new Set(brain.source_categories).size !== brain.source_categories.length) {
        throw new Error(`Brain ${brain.id} source_categories must not contain duplicates.`);
      }
    }
    const lint = brain.lint;
    if (lint?.reachability_mode !== undefined && !isLintMode(lint.reachability_mode)) {
      throw new Error(
        `Unsupported lint reachability_mode for ${brain.id}: ${String(lint.reachability_mode)}`
      );
    }
    if (
      lint?.relative_parent_scope !== undefined &&
      lint.relative_parent_scope !== "disabled" &&
      lint.relative_parent_scope !== "within_brain"
    ) {
      throw new Error(
        `Unsupported relative_parent_scope for ${brain.id}: ${String(lint.relative_parent_scope)}`
      );
    }
    for (const field of ["graph_roots", "exempt_globs"] as const) {
      const value = lint?.[field];
      if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
        throw new Error(`Brain ${brain.id} lint.${field} must be an array of strings.`);
      }
    }
    if (
      lint?.sharepoint_url_mappings !== undefined &&
      (!Array.isArray(lint.sharepoint_url_mappings) ||
        lint.sharepoint_url_mappings.some(
          (mapping) =>
            !mapping ||
            typeof mapping.url_prefix !== "string" ||
            !mapping.url_prefix.startsWith("https://") ||
            typeof mapping.brain_path_prefix !== "string"
        ))
    ) {
      throw new Error(
        `Brain ${brain.id} lint.sharepoint_url_mappings must contain HTTPS url_prefix and brain_path_prefix strings.`
      );
    }
  }

  if (registry.default_brain_id) {
    validateBrainId(registry.default_brain_id);
    if (!seen.has(registry.default_brain_id)) {
      throw new Error(
        `default_brain_id not found in registry: ${registry.default_brain_id}`
      );
    }
  }

  for (const principal of registry.principals || []) {
    if (!principal || typeof principal.provider !== "string" || !principal.roles) {
      throw new Error("Every registry principal must define provider and roles.");
    }
    for (const [brainId, role] of Object.entries(principal.roles)) {
      if (!seen.has(brainId)) {
        throw new Error(`Principal role references unknown brain_id: ${brainId}`);
      }
      if (!isBrainRole(role)) {
        throw new Error(
          `Unsupported Brain role for ${principal.provider}/${brainId}: ${String(role)}`
        );
      }
    }
  }
}

export function sourceCategoriesForBrain(brain: BrainDefinition): readonly string[] {
  return brain.source_categories?.length
    ? brain.source_categories
    : SOURCE_CATEGORIES;
}

function applyLintModeOverrides(registry: BrainRegistry): BrainRegistry {
  const raw = process.env.BRAIN_LINT_MODE_OVERRIDES?.trim();
  if (!raw) return registry;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `BRAIN_LINT_MODE_OVERRIDES must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BRAIN_LINT_MODE_OVERRIDES must be a JSON object keyed by brain_id.");
  }

  const overrides = parsed as Record<string, unknown>;
  const known = new Set(registry.brains.map((brain) => brain.id));
  for (const [brainId, mode] of Object.entries(overrides)) {
    if (!known.has(brainId)) {
      throw new Error(`BRAIN_LINT_MODE_OVERRIDES references unknown brain_id: ${brainId}`);
    }
    if (!isLintMode(mode)) {
      throw new Error(
        `BRAIN_LINT_MODE_OVERRIDES has unsupported mode for ${brainId}: ${String(mode)}`
      );
    }
  }

  return {
    ...registry,
    brains: registry.brains.map((brain) => {
      const mode = overrides[brain.id];
      if (mode === undefined) return brain;
      return {
        ...brain,
        lint: {
          ...brain.lint,
          reachability_mode: mode as BrainLintReachabilityMode,
        },
      };
    }),
  };
}

export async function loadRegistry(): Promise<BrainRegistry> {
  const configPath = process.env.BRAIN_PLATFORM_CONFIG || defaultConfigPath();
  let registry: BrainRegistry;

  try {
    const raw = await fs.readFile(configPath, "utf-8");
    registry = JSON.parse(raw) as BrainRegistry;
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Failed to read Brain registry ${configPath}: ${error.message}`);
    }
    registry = synthesizedRegistry();
  }

  assertRegistryShape(registry);
  registry = applyLintModeOverrides(registry);
  assertRegistryShape(registry);
  return registry;
}

function normalise(value?: string): string | undefined {
  return value ? value.trim().toLowerCase() : undefined;
}

function envList(name: string): Set<string> {
  return new Set(
    (process.env[name] || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function principalMatches(record: RegistryPrincipal, principal: BrainPrincipal): boolean {
  if (record.provider !== principal.provider) return false;
  if (
    record.provider_user_id &&
    principal.providerUserId &&
    record.provider_user_id === principal.providerUserId
  ) {
    return true;
  }
  if (normalise(record.login) && normalise(record.login) === normalise(principal.login)) {
    return true;
  }
  if (normalise(record.email) && normalise(record.email) === normalise(principal.email)) {
    return true;
  }
  return false;
}

export function stdioPrincipal(): BrainPrincipal {
  return {
    provider: "stdio",
    providerUserId: process.env.USER || "local",
    login: process.env.USER || "local",
    name: process.env.USER || "local",
  };
}

export function principalFromAuthInfo(authInfo?: {
  extra?: Record<string, unknown>;
}): BrainPrincipal {
  const extra = authInfo?.extra || {};
  const provider = typeof extra.provider === "string" ? extra.provider : "stdio";
  const providerUserId =
    typeof extra.provider_user_id === "string"
      ? extra.provider_user_id
      : typeof extra.sub === "string"
        ? extra.sub
        : process.env.USER || "local";

  return {
    provider,
    providerUserId,
    login:
      typeof extra.github_login === "string"
        ? extra.github_login
        : typeof extra.login === "string"
          ? extra.login
          : undefined,
    email: typeof extra.email === "string" ? extra.email : undefined,
    name: typeof extra.name === "string" ? extra.name : undefined,
  };
}

export function accessibleRoles(
  registry: BrainRegistry,
  principal: BrainPrincipal
): Record<string, BrainRole> {
  if (principal.provider === "stdio" || principal.provider === "system") {
    return Object.fromEntries(registry.brains.map((brain) => [brain.id, "owner" as BrainRole]));
  }

  const record = registry.principals?.find((candidate) =>
    principalMatches(candidate, principal)
  );
  if (record?.roles) {
    for (const [brainId, role] of Object.entries(record.roles)) {
      if (!isBrainRole(role)) {
        throw new Error(`Unsupported Brain role for ${brainId}: ${String(role)}`);
      }
    }
    return record.roles;
  }

  if (principal.provider === "github" && registry.default_brain_id) {
    const allowedLogins = envList("GITHUB_ALLOWED_LOGINS");
    const allowedEmails = envList("GITHUB_ALLOWED_EMAILS");
    const login = normalise(principal.login);
    const email = normalise(principal.email);
    if (
      (login && allowedLogins.has(login)) ||
      (email && allowedEmails.has(email))
    ) {
      return { [registry.default_brain_id]: "owner" };
    }
  }

  return {};
}

export function listAccessibleBrains(
  registry: BrainRegistry,
  principal: BrainPrincipal
): { brain: BrainDefinition; role: BrainRole }[] {
  const roles = accessibleRoles(registry, principal);
  return registry.brains
    .filter((brain) => roles[brain.id])
    .map((brain) => ({ brain, role: roles[brain.id] }));
}

export async function resolveBrain(
  brainId: string | undefined,
  principal: BrainPrincipal = stdioPrincipal()
): Promise<{ registry: BrainRegistry; brain: BrainDefinition; role: BrainRole }> {
  const registry = await loadRegistry();
  const accessible = listAccessibleBrains(registry, principal);

  if (brainId) {
    validateBrainId(brainId);
    const match = accessible.find(({ brain }) => brain.id === brainId);
    if (!match) {
      const known = accessible.map(({ brain }) => brain.id).join(", ") || "(none)";
      throw new Error(`Brain not accessible: ${brainId}. Accessible Brains: ${known}`);
    }
    return { registry, brain: match.brain, role: match.role };
  }

  if (accessible.length === 1) {
    const [match] = accessible;
    return { registry, brain: match.brain, role: match.role };
  }

  if (
    (principal.provider === "stdio" || principal.provider === "system") &&
    registry.default_brain_id
  ) {
    const match = accessible.find(({ brain }) => brain.id === registry.default_brain_id);
    if (match) return { registry, brain: match.brain, role: match.role };
  }

  const known = accessible.map(({ brain }) => brain.id).join(", ") || "(none)";
  throw new Error(`brain_id is required. Accessible Brains: ${known}`);
}

export async function getBrainPaths(brainId?: string): Promise<BrainPaths> {
  const { brain } = await resolveBrain(brainId, stdioPrincipal());
  return pathsForBrain(brain);
}

export function pathsForBrain(brain: BrainDefinition): BrainPaths {
  // S1-guard: host-filesystem path resolution is only valid for filesystem-backed
  // Brains. On a non-filesystem backend (e.g. the hosted Postgres connector) the
  // FS-write tools (ingest, source save, inbox cleanup, git) must refuse cleanly
  // rather than resolve to a path that does not exist in the container — which
  // would otherwise silently write to ephemeral disk that no hosted read sees.
  if (brain.storage_backend !== "filesystem") {
    throw new Error(
      `Brain ${brain.id} uses the "${brain.storage_backend}" backend; host filesystem ` +
        `operations (ingest, source save, inbox cleanup, git) are unavailable here. Run these ` +
        `through the deployment's documented operator workflow against its authoritative ` +
        `revision/source stores; do not substitute a separate filesystem Brain for hosted state.`
    );
  }
  const brainDir = String(brain.storage_config.brain_dir || "");
  const repoPath = String(
    brain.storage_config.repo_path ||
      (brainDir ? path.resolve(brainDir, "..") : "")
  );
  if (!brainDir) {
    throw new Error(`Brain ${brain.id} is missing storage_config.brain_dir`);
  }

  return {
    brainDir,
    sourcesRoot: String(
      brain.storage_config.sources_dir || path.resolve(brainDir, "..", "sources")
    ),
    inboxDir: String(
      brain.storage_config.inbox_dir || path.resolve(brainDir, "..", INBOX_DIR)
    ),
    repoPath,
    githubRepo: String(brain.storage_config.github_repo || GITHUB_REPO),
  };
}
