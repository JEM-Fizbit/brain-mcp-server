import { PostgresAccessGrantStore } from "../dist/services/access-grants.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const brainId = process.env.BRAIN_ID || "";
const tenantId = process.env.ENTRA_TENANT_ID?.trim().toLowerCase() || "";
const objectId = process.env.ENTRA_TARGET_OBJECT_ID?.trim().toLowerCase() || "";
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (brainId !== "ers-brain") throw new Error("BRAIN_ID=ers-brain is required");
if (!GUID_RE.test(tenantId) || !GUID_RE.test(objectId)) {
  throw new Error("Exact ENTRA_TENANT_ID and ENTRA_TARGET_OBJECT_ID GUIDs are required");
}
if (!databaseUrl) throw new Error("BRAIN_REVISION_DATABASE_URL is required");
if (process.env.BRAIN_ACCESS_EMERGENCY_CONFIRM !== `ers-brain:${objectId}`) {
  throw new Error("BRAIN_ACCESS_EMERGENCY_CONFIRM must exactly identify ers-brain and the target object ID");
}

const store = new PostgresAccessGrantStore(databaseUrl);
try {
  const target = {
    provider: "entra",
    providerTenantId: tenantId,
    providerUserId: objectId,
  };
  const current = await store.getGrant(brainId, target);
  if (!current) throw new Error("No current ERS Brain grant exists for that Entra object ID");
  await store.applyMutation({
    brainId,
    target: { ...target, name: current.name, email: current.email },
    role: current.role,
    status: "suspended",
    roleSource: current.roleSource || "emergency_local_suspension",
    upstreamRole: current.upstreamRole,
    upstreamGroupId: current.upstreamGroupId,
    actor: {
      provider: "system",
      providerUserId: "emergency-access-operator",
      name: "Emergency access operator",
    },
    reason: (process.env.BRAIN_ACCESS_EMERGENCY_REASON || "Emergency local suspension pending Entra reconciliation").slice(0, 500),
    graphOutcome: "pending_manual_reconciliation",
  });
  process.stdout.write("ERS Brain access is locally suspended. Remove the identity from all four managed Entra groups and verify the audit row.\n");
} finally {
  await store.close();
}
