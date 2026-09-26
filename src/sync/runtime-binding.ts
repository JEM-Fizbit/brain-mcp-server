import fs from "node:fs";
import path from "node:path";

/**
 * One home for "which Brain does this process act on, with which credential".
 * Ambient repo env files (.env.local, .env) may only fill keys the process did
 * not set. A Brain Monitor profile, selected by an explicit BRAIN_ID, may
 * override ambient values but never an explicit conflicting environment value.
 * The scripts-side module `scripts/lib/hosted-runtime-binding.mjs` re-exports
 * this so the rule cannot drift between the CLI and operator scripts.
 */

export type EnvMap = Record<string, string | undefined>;

export const MONITOR_PROFILE_ENV_KEYS = [
  "BRAIN_ID",
  "BRAIN_PROFILE_NAME",
  "BRAIN_DIR",
  "BRAIN_INBOX_DIR",
  "BRAIN_SYNC_CYCLE_TIMEOUT_MS",
  "BRAIN_REVISION_STORE",
  "BRAIN_REVISION_DATABASE_URL",
  "BRAIN_EXPECTED_SUPABASE_PROJECT_REF",
  "BRAIN_HOSTED_BASE_URL",
  "BRAIN_FLY_APP",
  "BRAIN_SYNC_STATE_FILE",
  "BRAIN_SYNC_LOCK_FILE",
  "BRAIN_SYNC_HEALTH_FILE",
  "BRAIN_SYNC_STORE_FILE",
  "BRAIN_SYNC_LOG_DIR",
  "BRAIN_SYNC_SUPERVISOR",
  "BRAIN_SYNC_LOCAL_EDIT_SURFACE",
  "BRAIN_MONITOR_STACK_FILE",
  "BRAIN_COCKPIT_URL",
  "BRAIN_COCKPIT_PROFILES_JSON",
  "BRAIN_DOCTOR_OPERATION_CACHE_FILE",
  "BRAIN_DOCTOR_OPERATION_REFRESH_MS",
  "BRAIN_DOCTOR_DB_TIMEOUT_MS",
  "BRAIN_HOSTED_MCP_LATENCY_FILE",
  "BRAIN_LINT_REPORT_FILE",
  "BRAIN_LINT_MODE_OVERRIDES",
  "FLY_CONFIG_DIR",
] as const;

export function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equals = trimmed.indexOf("=");
  if (equals === -1) return null;
  const key = trimmed.slice(0, equals).trim();
  let value = trimmed.slice(equals + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/** Keys the most recent loadLocalEnv call filled from an ambient file. */
let lastAmbientKeys = new Set<string>();

/**
 * Fill missing keys from `.env.local` then `.env` under `rootDir`. Returns the
 * keys it set, so a later profile application knows which values are ambient.
 * BRAIN_LOAD_LOCAL_ENV=0 disables loading for explicitly configured supervisors.
 */
export function loadLocalEnv(rootDir: string = process.cwd(), env: EnvMap = process.env): Set<string> {
  const ambient = new Set<string>();
  if (env.BRAIN_LOAD_LOCAL_ENV === "0") { lastAmbientKeys = ambient; return ambient; }
  for (const filename of [".env.local", ".env"]) {
    const envPath = path.join(rootDir, filename);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (env[key] === undefined) { env[key] = value; ambient.add(key); }
    }
  }
  lastAmbientKeys = ambient;
  return ambient;
}

export function projectRefFromDatabaseUrl(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl);
    const suffix = decodeURIComponent(url.username).split(".").at(-1);
    if (suffix && suffix !== "postgres" && /^[a-z0-9]{12,32}$/.test(suffix)) return suffix;
    return url.hostname.match(/^db\.([a-z0-9]{12,32})\.supabase\.co$/)?.[1] || null;
  } catch {
    return null;
  }
}

export interface HostedRuntimeBinding {
  brainId: string | null;
  hostedBaseUrl: string | null;
  expectedProjectRef: string | null;
  actualProjectRef: string | null;
  databaseBound: boolean;
}

/** Fail before any network access unless the deployment tuple is explicit and consistent. */
export function assertHostedRuntimeBinding(env: EnvMap, operation = "Hosted operator command"): HostedRuntimeBinding {
  const databaseUrl = env.BRAIN_REVISION_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return {
      brainId: env.BRAIN_ID?.trim() || null,
      hostedBaseUrl: env.BRAIN_HOSTED_BASE_URL?.trim() || null,
      expectedProjectRef: null, actualProjectRef: null, databaseBound: false,
    };
  }
  const brainId = env.BRAIN_ID?.trim();
  const hostedBaseUrl = env.BRAIN_HOSTED_BASE_URL?.trim();
  const expectedProjectRef = env.BRAIN_EXPECTED_SUPABASE_PROJECT_REF?.trim();
  if (!brainId || !hostedBaseUrl || !expectedProjectRef) {
    throw new Error(
      `${operation} refuses an unbound database URL: set BRAIN_ID, ` +
        "BRAIN_HOSTED_BASE_URL, and BRAIN_EXPECTED_SUPABASE_PROJECT_REF, " +
        "or select an owner-only Brain Monitor profile with BRAIN_MONITOR_CONFIG_FILE"
    );
  }
  let parsedBaseUrl: URL;
  try { parsedBaseUrl = new URL(hostedBaseUrl); }
  catch { throw new Error(`${operation} requires a valid BRAIN_HOSTED_BASE_URL`); }
  if (parsedBaseUrl.protocol !== "https:") throw new Error(`${operation} requires an HTTPS BRAIN_HOSTED_BASE_URL`);
  const actualProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (!actualProjectRef) throw new Error(`${operation} could not derive a Supabase project ref from the database URL`);
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error(
      `${operation} refuses cross-project access: BRAIN_REVISION_DATABASE_URL does not match ` +
        "BRAIN_EXPECTED_SUPABASE_PROJECT_REF"
    );
  }
  return {
    brainId, hostedBaseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    expectedProjectRef, actualProjectRef, databaseBound: true,
  };
}

export interface ProfileSelection {
  source: "environment" | "brain_monitor";
  profile: string | null;
  configFile?: string;
}

export interface ProfileOptions {
  /** Keys whose current values came from an ambient file and may be overridden. Defaults to the last loadLocalEnv result. */
  ambientKeys?: Set<string>;
}

/**
 * Select the Brain Monitor profile named by BRAIN_MONITOR_CONFIG_FILE and
 * BRAIN_ID. With several profiles an explicit BRAIN_ID is mandatory: a default
 * Brain id beside a credential is the misrouting failure this module exists to
 * prevent. Profile values overwrite ambient values only; an explicit
 * environment value that disagrees with the profile is a refusal.
 */
export function applyBrainMonitorProfileEnvSync(env: EnvMap, options: ProfileOptions = {}): ProfileSelection {
  const configFile = env.BRAIN_MONITOR_CONFIG_FILE?.trim();
  if (!configFile) return { source: "environment", profile: null };
  const ambientKeys = options.ambientKeys ?? lastAmbientKeys;
  const resolvedConfigFile = path.resolve(configFile);
  const configStat = fs.statSync(resolvedConfigFile);
  if (!configStat.isFile()) throw new Error("BRAIN_MONITOR_CONFIG_FILE must name a regular file");
  if (process.platform !== "win32" && (configStat.mode & 0o077) !== 0) {
    throw new Error("BRAIN_MONITOR_CONFIG_FILE must be owner-only (mode 0600)");
  }
  const config = JSON.parse(fs.readFileSync(resolvedConfigFile, "utf8"));
  const profiles: any[] = Array.isArray(config.brains) ? config.brains : [config];
  const ids = profiles.map((candidate) => candidate?.brainId).filter(Boolean);
  const explicitBrainId = env.BRAIN_ID?.trim();
  if (!explicitBrainId && ids.length !== 1) {
    throw new Error(`Brain Monitor config holds ${ids.length} profiles; set BRAIN_ID to select one of: ${ids.join(", ")}`);
  }
  const requestedBrainId: string = explicitBrainId || String(ids[0]);
  const profile = profiles.find((candidate) => candidate?.brainId === requestedBrainId);
  if (!profile) throw new Error(`Brain Monitor profile not found for ${requestedBrainId}`);
  const profileEnv: EnvMap = profile.env || profile.syncProcess?.env || {};
  const profileBrainId = profileEnv.BRAIN_ID || profile.brainId;
  if (profileBrainId !== requestedBrainId) throw new Error(`Brain Monitor profile identity mismatch for ${requestedBrainId}`);
  for (const key of MONITOR_PROFILE_ENV_KEYS) {
    const value = profileEnv[key];
    if (value === undefined || value === null) continue;
    const next = String(value);
    const current = env[key];
    if (current !== undefined && current !== next && !ambientKeys.has(key) && key !== "BRAIN_ID") {
      throw new Error(`Brain Monitor profile ${requestedBrainId} conflicts with explicit ${key} in the environment; unset it or choose the other`);
    }
    env[key] = next;
  }
  env.BRAIN_ID = requestedBrainId;
  return { source: "brain_monitor", profile: requestedBrainId, configFile: resolvedConfigFile };
}

/** Async form kept for existing operator scripts. */
export async function applyBrainMonitorProfileEnv(env: EnvMap, options: ProfileOptions = {}): Promise<ProfileSelection> {
  return applyBrainMonitorProfileEnvSync(env, options);
}
