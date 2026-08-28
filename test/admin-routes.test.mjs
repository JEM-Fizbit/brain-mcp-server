import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { handleAdminRequest } = await import(path.join(__dirname, "..", "dist", "admin", "routes.js"));
const { AdminSessionStore } = await import(path.join(__dirname, "..", "dist", "admin", "session.js"));

const oldBrainId = process.env.BRAIN_ID;
after(() => {
  if (oldBrainId === undefined) delete process.env.BRAIN_ID;
  else process.env.BRAIN_ID = oldBrainId;
});

const identity = {
  provider: "entra",
  providerTenantId: "11111111-1111-4111-8111-111111111111",
  providerUserId: "22222222-2222-4222-8222-222222222222",
  upstreamRole: "Brain.Owner",
  name: "Owner",
};
const config = {
  issuer: "https://brain.example.test",
  identityProviders: ["entra"],
  adminSessionSecret: "x".repeat(64),
  adminSessionTtlSec: 900,
  entra: {
    adminGraphEnabled: true,
    adminCallbackUrl: "https://brain.example.test/admin/oauth/callback",
  },
};

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
    end(body = "") { this.body += body; },
  };
}

function request(method = "GET", headers = {}, body = "") {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function context(role = "owner", graphRoles = ["owner"]) {
  const sessions = new AdminSessionStore(config);
  const created = sessions.create(identity, "delegated-token", 600);
  return {
    cookie: created.cookie.split(";", 1)[0],
    session: created.session,
    ctx: {
      config,
      state: {},
      sessions,
      grants: { async listAuditEvents() { return []; } },
      service: {
        async list() { return []; },
        async mutate() { return { grant: {}, graph: { requestIds: [] } }; },
        graph() {
          return {
            async searchUsers() { return []; },
            async rolesForUser() { return graphRoles; },
          };
        },
      },
      rolesForPrincipal: async () => ({ "ers-brain": role }),
    },
  };
}

test("admin routes are absent from the JEM deployment profile", async () => {
  process.env.BRAIN_ID = "ai-brain-jem";
  const { ctx } = context();
  const res = response();
  await handleAdminRequest(request(), res, new URL("https://brain.example.test/admin/access"), ctx);
  assert.equal(res.statusCode, 404);
});

test("ERS hosted access page is available but its APIs require a current Owner", async () => {
  process.env.BRAIN_ID = "ers-brain";
  const owner = context();
  const page = response();
  await handleAdminRequest(request(), page, new URL("https://brain.example.test/admin/access"), owner.ctx);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Access & Roles/);
  assert.match(page.body, /ERS Brain role guide/);
  assert.match(page.body, /What does “Review &amp; reconcile” mean/);
  assert.match(page.body, /system never chooses a role automatically/);
  assert.match(page.body, /GitHub fallback · not managed here/);
  assert.match(page.body, /Review & reconcile/);
  assert.match(page.body, /roleHelp/);

  const admin = context("admin");
  const denied = response();
  await handleAdminRequest(
    request("GET", { cookie: admin.cookie }),
    denied,
    new URL("https://brain.example.test/admin/api/access"),
    admin.ctx
  );
  assert.equal(denied.statusCode, 401);

  const removedUpstream = context("owner", []);
  const removedDenied = response();
  await handleAdminRequest(
    request("GET", { cookie: removedUpstream.cookie }),
    removedDenied,
    new URL("https://brain.example.test/admin/api/access"),
    removedUpstream.ctx
  );
  assert.equal(removedDenied.statusCode, 401);
});

test("admin mutations enforce same-origin, CSRF, confirmation, and server-controlled scope", async () => {
  process.env.BRAIN_ID = "ers-brain";
  const owner = context();
  const baseHeaders = {
    cookie: owner.cookie,
    "content-type": "application/json",
    "x-brain-csrf": owner.session.csrfToken,
  };
  const payload = JSON.stringify({
    brainId: "ai-brain-jem",
    target: { id: "33333333-3333-4333-8333-333333333333" },
    role: "reader",
    status: "active",
    confirmed: true,
  });

  const wrongOrigin = response();
  await handleAdminRequest(
    request("POST", { ...baseHeaders, origin: "https://evil.example" }, payload),
    wrongOrigin,
    new URL("https://brain.example.test/admin/api/access"),
    owner.ctx
  );
  assert.equal(wrongOrigin.statusCode, 400);
  assert.match(wrongOrigin.body, /Same-origin/);

  const scoped = response();
  await handleAdminRequest(
    request("POST", { ...baseHeaders, origin: "https://brain.example.test" }, payload),
    scoped,
    new URL("https://brain.example.test/admin/api/access"),
    owner.ctx
  );
  assert.equal(scoped.statusCode, 400);
  assert.match(scoped.body, /server-controlled/);

  owner.ctx.service.mutate = async () => {
    throw new Error("token secret must never reach the browser");
  };
  const sanitized = response();
  await handleAdminRequest(
    request(
      "POST",
      { ...baseHeaders, origin: "https://brain.example.test" },
      JSON.stringify({
        target: { id: "33333333-3333-4333-8333-333333333333" },
        role: "reader",
        status: "active",
        confirmed: true,
      })
    ),
    sanitized,
    new URL("https://brain.example.test/admin/api/access"),
    owner.ctx
  );
  assert.equal(sanitized.statusCode, 400);
  assert.match(sanitized.body, /Identity provider request failed/);
  assert.doesNotMatch(sanitized.body, /token secret/);
});
