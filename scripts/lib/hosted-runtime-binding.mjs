import fs from "node:fs/promises";
import path from "node:path";

const MONITOR_PROFILE_ENV_KEYS = [
  "BRAIN_ID",
  "BRAIN_PROFILE_NAME",
  "BRAIN_DIR",
  "BRAIN_INBOX_DIR",
  "BRAIN_REVISION_STORE",
  "BRAIN_REVISION_DATABASE_URL",
  "BRAIN_EXPECTED_SUPABASE_PROJECT_REF",
  "BRAIN_HOSTED_BASE_URL",
  "BRAIN_FLY_APP",
  "BRAIN_SYNC_STATE_FILE",
  "BRAIN_SYNC_LOCK_FILE",
  "BRAIN_SYNC_HEALTH_FILE",
  "BRAIN_SYNC_LOG_DIR",
  "BRAIN_SYNC_SUPERVISOR",
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
];

export function projectRefFromDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const suffix = decodeURIComponent(url.username).split(".").at(-1);
  if (suffix && suffix !== "postgres" && /^[a-z0-9]{12,32}$/.test(suffix)) {
    return suffix;
  }
  return url.hostname.match(/^db\.([a-z0-9]{12,32})\.supabase\.co$/)?.[1] || null;
}

export function assertHostedRuntimeBinding(env, operation = "Hosted operator command") {
  const databaseUrl = env.BRAIN_REVISION_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return {
      brainId: env.BRAIN_ID?.trim() || null,
      hostedBaseUrl: env.BRAIN_HOSTED_BASE_URL?.trim() || null,
      expectedProjectRef: null,
      actualProjectRef: null,
      databaseBound: false,
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

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(hostedBaseUrl);
  } catch {
    throw new Error(`${operation} requires a valid BRAIN_HOSTED_BASE_URL`);
  }
  if (parsedBaseUrl.protocol !== "https:") {
    throw new Error(`${operation} requires an HTTPS BRAIN_HOSTED_BASE_URL`);
  }

  const actualProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (!actualProjectRef) {
    throw new Error(`${operation} could not derive a Supabase project ref from the database URL`);
  }
  if (actualProjectRef !== expectedProjectRef) {
    throw new Error(
      `${operation} refuses cross-project access: BRAIN_REVISION_DATABASE_URL does not match ` +
        "BRAIN_EXPECTED_SUPABASE_PROJECT_REF"
    );
  }

  return {
    brainId,
    hostedBaseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    expectedProjectRef,
    actualProjectRef,
    databaseBound: true,
  };
}

export async function applyBrainMonitorProfileEnv(
  env,
  { defaultBrainId = "ai-brain-jem" } = {}
) {
  const configFile = env.BRAIN_MONITOR_CONFIG_FILE?.trim();
  if (!configFile) return { source: "environment", profile: null };

  const requestedBrainId = env.BRAIN_ID?.trim() || defaultBrainId;
  const resolvedConfigFile = path.resolve(configFile);
  const configStat = await fs.stat(resolvedConfigFile);
  if (!configStat.isFile()) {
    throw new Error("BRAIN_MONITOR_CONFIG_FILE must name a regular file");
  }
  if (process.platform !== "win32" && (configStat.mode & 0o077) !== 0) {
    throw new Error("BRAIN_MONITOR_CONFIG_FILE must be owner-only (mode 0600)");
  }
  const config = JSON.parse(await fs.readFile(resolvedConfigFile, "utf8"));
  const profiles = Array.isArray(config.brains) ? config.brains : [config];
  const profile = profiles.find((candidate) => candidate?.brainId === requestedBrainId);
  if (!profile) {
    throw new Error(`Brain Monitor profile not found for ${requestedBrainId}`);
  }

  const profileEnv = profile.env || profile.syncProcess?.env || {};
  const profileBrainId = profileEnv.BRAIN_ID || profile.brainId;
  if (profileBrainId !== requestedBrainId) {
    throw new Error(`Brain Monitor profile identity mismatch for ${requestedBrainId}`);
  }
  for (const key of MONITOR_PROFILE_ENV_KEYS) {
    if (profileEnv[key] !== undefined && profileEnv[key] !== null) {
      env[key] = String(profileEnv[key]);
    }
  }
  env.BRAIN_ID = requestedBrainId;
  return {
    source: "brain_monitor",
    profile: requestedBrainId,
    configFile: resolvedConfigFile,
  };
}
