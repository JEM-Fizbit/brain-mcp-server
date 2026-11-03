import type { BrainDefinition } from "../services/registry.js";

export function hostedIngestionAvailable(brain:BrainDefinition,env=process.env):boolean {
  return brain.storage_backend==='postgres' && env.BRAIN_REVISION_STORE==='postgres' &&
    (env.BRAIN_HOSTED_INGESTION_BRAINS||'').split(',').map(x=>x.trim()).includes(brain.id) &&
    env.BRAIN_ID===brain.id && Boolean(env.BRAIN_REVISION_DATABASE_URL && env.BRAIN_EXPECTED_SUPABASE_PROJECT_REF &&
      env.BRAIN_SUPABASE_URL && env.BRAIN_SUPABASE_SERVICE_ROLE_KEY);
}
