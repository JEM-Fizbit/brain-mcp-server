import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { AdminSessionStore } = await import(path.join(__dirname, "..", "dist", "admin", "session.js"));

const config = {
  issuer: "https://brain.example.test",
  adminSessionSecret: "x".repeat(64),
  adminSessionTtlSec: 900,
};
const identity = {
  provider: "entra",
  providerTenantId: "11111111-1111-4111-8111-111111111111",
  providerUserId: "22222222-2222-4222-8222-222222222222",
  upstreamRole: "Brain.Owner",
  name: "Owner",
};

test("admin cookie is opaque, signed, secure, HttpOnly and contains no Graph token", () => {
  const store = new AdminSessionStore(config);
  const created = store.create(identity, "graph-access-token-secret", 600);
  assert.match(created.cookie, /HttpOnly/);
  assert.match(created.cookie, /SameSite=Lax/);
  assert.match(created.cookie, /Secure/);
  assert.match(created.cookie, /Path=\/admin/);
  assert.ok(!created.cookie.includes("graph-access-token-secret"));
  assert.ok(!created.cookie.includes(identity.providerUserId));
  assert.equal(store.get(created.cookie.split(";", 1)[0]).identity.providerUserId, identity.providerUserId);
  assert.equal(store.get(`${created.cookie.split(";", 1)[0]}x`), null);
});

test("weak admin-session secrets are rejected", () => {
  assert.throws(() => new AdminSessionStore({ ...config, adminSessionSecret: "weak" }), /at least 32/);
});

test("a fresh owner login invalidates that owner's prior admin session", () => {
  const store = new AdminSessionStore(config);
  const first = store.create(identity, "first-token", 600);
  const second = store.create(identity, "second-token", 600);
  assert.equal(store.get(first.cookie.split(";", 1)[0]), null);
  assert.equal(store.get(second.cookie.split(";", 1)[0]).graphAccessToken, "second-token");
});

test("admin sessions expire with the bounded upstream token lifetime", () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const store = new AdminSessionStore(config);
    const created = store.create(identity, "short-token", 60);
    const cookie = created.cookie.split(";", 1)[0];
    assert.ok(store.get(cookie));
    now += 61_000;
    assert.equal(store.get(cookie), null);
  } finally {
    Date.now = originalNow;
  }
});
