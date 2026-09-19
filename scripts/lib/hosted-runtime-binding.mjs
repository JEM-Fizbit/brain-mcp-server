// Thin re-export: the binding rule has one home in src/sync/runtime-binding.ts.
export {
  MONITOR_PROFILE_ENV_KEYS,
  projectRefFromDatabaseUrl,
  assertHostedRuntimeBinding,
  applyBrainMonitorProfileEnv,
  applyBrainMonitorProfileEnvSync,
} from "../../dist/sync/runtime-binding.js";
