import fs from "node:fs/promises";
import { PostgresAccessGrantStore } from "../dist/services/access-grants.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const brainId = process.env.BRAIN_ID || "";
if (brainId !== "ers-brain") throw new Error("BRAIN_ID=ers-brain is required");
if (process.env.BRAIN_ACCESS_BOOTSTRAP_CONFIRM !== "ers-brain") {
  throw new Error("Set BRAIN_ACCESS_BOOTSTRAP_CONFIRM=ers-brain for this one-time hosted write");
}
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
if (!databaseUrl) throw new Error("BRAIN_REVISION_DATABASE_URL is required");
const tenantId = process.env.ENTRA_TENANT_ID?.trim().toLowerCase();
if (!tenantId) throw new Error("ENTRA_TENANT_ID is required");
const ownerGroupId = process.env.ENTRA_OWNER_GROUP_ID?.trim().toLowerCase();
if (!ownerGroupId) throw new Error("ENTRA_OWNER_GROUP_ID is required");
if (!GUID_RE.test(tenantId) || !GUID_RE.test(ownerGroupId)) {
  throw new Error("ENTRA_TENANT_ID and ENTRA_OWNER_GROUP_ID must be exact GUIDs");
}
const inputPath = process.env.ENTRA_INITIAL_OWNERS_FILE;
if (!inputPath) throw new Error("ENTRA_INITIAL_OWNERS_FILE is required");

const owners = JSON.parse(await fs.readFile(inputPath, "utf-8"));
if (!Array.isArray(owners) || owners.length < 3) {
  throw new Error("The initial-owner file must contain at least three reviewed owners");
}
const normalizedOwners = owners.map((owner) => {
  if (!owner || typeof owner.oid !== "string" || typeof owner.name !== "string") {
    throw new Error("Every initial owner requires oid and name");
  }
  const oid = owner.oid.trim().toLowerCase();
  if (!GUID_RE.test(oid)) throw new Error("Every initial owner oid must be an exact GUID");
  const name = owner.name.trim().slice(0, 200);
  if (!name) throw new Error("Every initial owner requires a non-empty name");
  return {
    oid,
    name,
    email: typeof owner.email === "string" ? owner.email.trim().slice(0, 320) : undefined,
  };
});
if (new Set(normalizedOwners.map((owner) => owner.oid)).size !== normalizedOwners.length) {
  throw new Error("The initial-owner file contains a duplicate Entra object ID");
}

const store = new PostgresAccessGrantStore(databaseUrl);
try {
  for (const owner of normalizedOwners) {
    await store.applyMutation({
      brainId,
      target: {
        provider: "entra",
        providerTenantId: tenantId,
        providerUserId: owner.oid,
        name: owner.name,
        email: owner.email,
      },
      role: "owner",
      status: "active",
      roleSource: "initial_owner_bootstrap",
      upstreamRole: "Brain.Owner",
      upstreamGroupId: ownerGroupId,
      actor: {
        provider: "system",
        providerUserId: "entra-initial-owner-bootstrap",
        name: "Reviewed Entra initial-owner bootstrap",
      },
      reason: "Spec 018 reviewed initial Owner bootstrap",
      graphOutcome: "preverified",
    });
  }
  const count = await store.countActiveOwners(brainId, "entra", tenantId);
  if (count < 3) throw new Error("Initial Owner bootstrap did not produce three active Owners");
  process.stdout.write(`Verified ${count} active ERS Brain Owners.\n`);
} finally {
  await store.close();
}
