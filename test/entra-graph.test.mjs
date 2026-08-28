import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { EntraGraphClient } = await import(path.join(__dirname, "..", "dist", "admin", "entra-graph.js"));

const groups = {
  reader: "11111111-1111-4111-8111-111111111111",
  member: "22222222-2222-4222-8222-222222222222",
  admin: "33333333-3333-4333-8333-333333333333",
  owner: "44444444-4444-4444-8444-444444444444",
};
const target = "55555555-5555-4555-8555-555555555555";
const entra = { roleGroupIds: groups };

test("Graph adapter checks direct managed-group membership and flags multiple roles", async () => {
  const calls = [];
  const client = new EntraGraphClient(entra, "delegated-token", async (url, init) => {
    calls.push({ url: String(url), init });
    const groupId = Object.values(groups).find((id) => String(url).includes(`/groups/${id}/`));
    return Response.json({ value: groupId === groups.reader || groupId === groups.owner ? [{ id: target }] : [] });
  });
  assert.deepEqual(await client.rolesForUser(target), ["reader", "owner"]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => /\/groups\/[0-9a-f-]+\/members/.test(call.url)));
  assert.ok(calls.every((call) => new URL(call.url).searchParams.get("$select") === "id"));
  assert.ok(calls.every((call) => call.init.headers.Authorization === "Bearer delegated-token"));
});

test("Graph adapter follows only bounded same-origin membership pages", async () => {
  let readerCalls = 0;
  const client = new EntraGraphClient(entra, "delegated-token", async (url) => {
    if (String(url).includes(`/groups/${groups.reader}/members`)) {
      readerCalls += 1;
      return Response.json(
        readerCalls === 1
          ? { value: [], "@odata.nextLink": `https://graph.microsoft.com/v1.0/groups/${groups.reader}/members?$skiptoken=safe` }
          : { value: [{ id: target }] }
      );
    }
    return Response.json({ value: String(url).includes(groups.admin) ? [{ id: target }] : [] });
  });
  assert.deepEqual(await client.rolesForUser(target), ["reader", "admin"]);
  assert.equal(readerCalls, 2);

  const unsafe = new EntraGraphClient(entra, "delegated-token", async (url) =>
    Response.json(
      String(url).includes(groups.reader)
        ? { value: [], "@odata.nextLink": "https://attacker.example/steal" }
        : { value: [] }
    )
  );
  await assert.rejects(() => unsafe.rolesForUser(target), /unsafe managed-group continuation URL/);
});

test("Graph adapter reads each fixed group once for a batch of users", async () => {
  const second = "77777777-7777-4777-8777-777777777777";
  let calls = 0;
  const client = new EntraGraphClient(entra, "delegated-token", async (url) => {
    calls += 1;
    if (String(url).includes(groups.reader)) return Response.json({ value: [{ id: target }, { id: second }] });
    if (String(url).includes(groups.owner)) return Response.json({ value: [{ id: second }] });
    return Response.json({ value: [] });
  });
  const result = await client.rolesForUsers([target, second, target.toUpperCase()]);
  assert.deepEqual(result.get(target), ["reader"]);
  assert.deepEqual(result.get(second), ["reader", "owner"]);
  assert.equal(calls, 4);
});

test("Graph role mutation adds one fixed group and removes every other fixed group", async () => {
  const calls = [];
  const client = new EntraGraphClient(entra, "delegated-token", async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: init.method === "POST" ? 204 : 404, headers: { "request-id": `r-${calls.length}` } });
  });
  const result = await client.setRole(target, "member");
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, new RegExp(`/groups/${groups.member}/members/\\$ref$`));
  assert.deepEqual(JSON.parse(calls[0].init.body), { "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${target}` });
  assert.ok(calls.slice(1).every((call) => Object.values(groups).some((id) => call.url.includes(id))));
  assert.deepEqual(result.addedRole, "member");
});

test("partial cleanup never removes a desired membership that predated the request", async () => {
  const calls = [];
  const client = new EntraGraphClient(entra, "delegated-token", async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") return new Response(null, { status: 400 });
    if (String(url).includes(`/groups/${groups.member}/members`)) {
      return Response.json({ value: [{ id: target }] });
    }
    if (init.method === undefined) {
      return Response.json({ value: [] });
    }
    return new Response(null, { status: 503 });
  });
  await assert.rejects(() => client.setRole(target, "member"), /HTTP 503/);
  assert.equal(
    calls.filter((call) => call.init.method === "DELETE" && call.url.includes(groups.member)).length,
    0
  );
});

test("directory search bounds mutable input and returned profile fields", async () => {
  let requested;
  const client = new EntraGraphClient(entra, "delegated-token", async (url) => {
    requested = new URL(String(url));
    return Response.json({ value: [{ id: target, displayName: "Person", mail: "person@example.test", ignored: "secret" }] });
  });
  const users = await client.searchUsers('Pe"rson\\ignored');
  assert.equal(users.length, 1);
  assert.deepEqual(Object.keys(users[0]).sort(), ["displayName", "id", "mail", "userPrincipalName", "userType"].sort());
  assert.equal(requested.searchParams.get("$select"), "id,displayName,mail,userPrincipalName,userType");
  assert.ok(!requested.searchParams.get("$search").includes("\\"));
});

test("exact user lookup returns bounded Graph-owned display metadata", async () => {
  const client = new EntraGraphClient(entra, "delegated-token", async () =>
    Response.json({ id: target, displayName: "Person", mail: "person@example.test", ignored: "caller-cannot-set" })
  );
  assert.deepEqual(await client.getUser(target), {
    id: target,
    displayName: "Person",
    mail: "person@example.test",
    userPrincipalName: undefined,
    userType: undefined,
  });
});
