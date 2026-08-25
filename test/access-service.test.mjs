import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { AccessAdministrationService, AccessReconciliationError } = await import(path.join(__dirname, "..", "dist", "admin", "access-service.js"));

const tenantId = "11111111-1111-4111-8111-111111111111";
const target = { id: "22222222-2222-4222-8222-222222222222", displayName: "Target" };
const groups = {
  reader: "33333333-3333-4333-8333-333333333333",
  member: "44444444-4444-4444-8444-444444444444",
  admin: "55555555-5555-4555-8555-555555555555",
  owner: "66666666-6666-4666-8666-666666666666",
};
const actor = { provider: "entra", providerTenantId: tenantId, providerUserId: "77777777-7777-4777-8777-777777777777" };

function harness(current, options = {}) {
  const order = [];
  const grants = {
    async getGrant() { return current; },
    async applyMutation(input) { order.push(`local:${input.role}:${input.status}`); if (options.localFails) throw new Error("db failed"); return { ...input, providerUserId: input.target.providerUserId, version: 1 }; },
    async recordReconciliation(input) { order.push(`audit:${input.graphOutcome}`); },
  };
  const graph = {
    async getUser() { return target; },
    async setRole(_id, role) { order.push(`graph:set:${role}`); if (options.graphFails) throw new Error("graph failed"); return { requestIds: ["request-1"], removedRoles: [], addedRole: role }; },
    async removeAllRoles() { order.push("graph:remove"); if (options.graphFails) throw new Error("graph failed"); return { requestIds: ["request-2"], removedRoles: [] }; },
  };
  const service = new AccessAdministrationService("ers-brain", { tenantId, roleGroupIds: groups }, grants);
  service.graph = () => graph;
  return { service, order };
}

test("new grants and elevations commit Graph before local access becomes usable", async () => {
  const { service, order } = harness(null);
  await service.mutate(actor, "token", { target, role: "member", status: "active", confirmed: true });
  assert.deepEqual(order, ["graph:set:member", "local:member:active"]);

  const reconcile = harness({ role: "member", status: "active" });
  await reconcile.service.mutate(actor, "token", { target, role: "member", status: "active", confirmed: true });
  assert.deepEqual(reconcile.order, ["graph:set:member", "local:member:active"]);
});

test("downgrades and revocations restrict local access before Graph", async () => {
  const current = { role: "admin", status: "active" };
  const downgrade = harness(current);
  await downgrade.service.mutate(actor, "token", { target, role: "reader", status: "active", confirmed: true });
  assert.deepEqual(downgrade.order, ["local:reader:active", "graph:set:reader", "audit:success"]);

  const revoke = harness(current);
  await revoke.service.mutate(actor, "token", { target, role: "admin", status: "revoked", confirmed: true });
  assert.deepEqual(revoke.order, ["local:admin:revoked", "graph:remove", "audit:success"]);
});

test("Graph failure after local restriction is an explicit fail-closed reconciliation incident", async () => {
  const { service, order } = harness({ role: "admin", status: "active" }, { graphFails: true });
  await assert.rejects(
    () => service.mutate(actor, "token", { target, role: "reader", status: "active", confirmed: true }),
    (error) => error instanceof AccessReconciliationError && error.phase === "local_committed_graph_failed"
  );
  assert.deepEqual(order, ["local:reader:active", "graph:set:reader", "audit:failed"]);
});

test("unconfirmed changes and caller-supplied invalid roles fail before mutation", async () => {
  const { service, order } = harness(null);
  await assert.rejects(() => service.mutate(actor, "token", { target, role: "reader", status: "active", confirmed: false }), /confirmation/);
  await assert.rejects(() => service.mutate(actor, "token", { target, role: "superuser", status: "active", confirmed: true }), /invalid brain role/i);
  assert.deepEqual(order, []);
});
