import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { BRAIN_DIR, GITHUB_REPO, INBOX_DIR, SOURCES_ROOT } from "../constants.js";
import { runtimeBrainId } from "./runtime-env.js";

export type BrainRole = "owner" | "admin" | "member" | "reader";
export type BrainType = "personal" | "shared";
export type IntegrationMode = "vertical" | "aggregation" | "hybrid";
export type StorageBackend = "filesystem" | "postgres";

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
  created_at?: string;
  metadata?: Record<string, unknown>;
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
  }

  if (registry.default_brain_id) {
    validateBrainId(registry.default_brain_id);
    if (!seen.has(registry.default_brain_id)) {
      throw new Error(
        `default_brain_id not found in registry: ${registry.default_brain_id}`
      );
    }
  }
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
  if (record?.roles) return record.roles;

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
  // FS-write tools (ingest, source save, log append, git) must refuse cleanly
  // rather than resolve to a path that does not exist in the container — which
  // would otherwise silently write to ephemeral disk that no hosted read sees.
  if (brain.storage_backend !== "filesystem") {
    throw new Error(
      `Brain ${brain.id} uses the "${brain.storage_backend}" backend; host filesystem ` +
        `operations (ingest, source save, log append, git) are unavailable here. Run these ` +
        `via a local stdio server with a filesystem-backed Brain (set BRAIN_DIR).`
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
