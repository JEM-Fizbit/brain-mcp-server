// Ambient env loading plus Brain Monitor profile selection, one home in
// src/sync/runtime-binding.ts. Every operator script that loads ambient env
// therefore also honours BRAIN_MONITOR_CONFIG_FILE and its conflict rule.
import {
  loadLocalEnv as loadAmbientEnv,
  applyBrainMonitorProfileEnvSync,
} from "../../dist/sync/runtime-binding.js";

export function loadLocalEnv(rootDir = process.cwd()) {
  const ambientKeys = loadAmbientEnv(rootDir, process.env);
  applyBrainMonitorProfileEnvSync(process.env, { ambientKeys });
}
