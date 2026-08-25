import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  buildEntraAuthorizationUrl,
  createEntraAuthorizationContext,
  handleEntraCallback,
  resetEntraCachesForTests,
} = await import(path.join(__dirname, "..", "dist", "oauth", "entra.js"));

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OID = "33333333-3333-4333-8333-333333333333";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
const { privateKey: invalidPrivateKey } = await generateKeyPair("RS256");

const config = {
  issuer: "https://brain.example.test",
  resourceUri: "https://brain.example.test/mcp",
  identityProviders: ["entra"],
  identityDefaultProvider: "entra",
  authCodeTtlSec: 600,
  oauthStateTtlSec: 600,
  entra: {
    tenantId: TENANT,
    clientId: CLIENT,
    callbackUrl: "https://brain.example.test/authorize/entra/callback",
    adminCallbackUrl: "https://brain.example.test/admin/oauth/callback",
    localClientSecret: "local-test-secret",
    adminGraphEnabled: false,
    roleGroupIds: {},
  },
};

function stateWithSession(key, nonce) {
  const values = new Map([
    [`oauth_states:${key}`, {
      upstream_provider: "entra",
      upstream_nonce: nonce,
      upstream_code_verifier: "v".repeat(64),
      client_id: "mcp-client",
      redirect_uri: "http://127.0.0.1:43111/callback",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      resource: config.resourceUri,
      scope: "mcp:tools",
      state: "client-state",
    }],
  ]);
  return {
    async get(store, key2) { return values.get(`${store}:${key2}`) || null; },
    async put(store, key2, value) { values.set(`${store}:${key2}`, value); return value; },
    async del(store, key2) { return values.delete(`${store}:${key2}`); },
    async consumeOnce(store, key2) { const k = `${store}:${key2}`; const value = values.get(k) || null; values.delete(k); return value; },
    async listAll(store) { return Object.fromEntries([...values].filter(([key2]) => key2.startsWith(`${store}:`)).map(([key2, value]) => [key2.slice(store.length + 1), value])); },
  };
}

async function token(claims, nonce, times = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tid: TENANT,
    oid: OID,
    nonce,
    roles: ["Brain.Owner"],
    preferred_username: "owner@ers.example",
    name: "ERS Owner",
    ...claims,
  })
    .setProtectedHeader({
      alg: "RS256",
      ...(times.kid === null ? {} : { kid: times.kid || "test-key" }),
    })
    .setIssuer(times.issuer || ISSUER)
    .setAudience(times.audience || CLIENT)
    .setIssuedAt(times.iat ?? now)
    .setNotBefore(times.nbf ?? now - 1)
    .setExpirationTime(times.exp ?? now + 300)
    .sign(times.privateKey || privateKey);
}

test("ordinary Entra sign-in excludes Graph scopes while the admin flow requests only its delegated scopes", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/keys`,
  });
  resetEntraCachesForTests();
  try {
    const context = createEntraAuthorizationContext();
    assert.match(context.upstream_code_verifier, /^[a-f0-9]{64}$/);
    assert.match(context.upstream_code_challenge, /^[A-Za-z0-9_-]{43}$/);
    const ordinary = new URL(await buildEntraAuthorizationUrl("state", context, config));
    const admin = new URL(await buildEntraAuthorizationUrl("state", context, config, { admin: true }));
    assert.equal(ordinary.searchParams.get("scope"), "openid profile email");
    assert.equal(admin.searchParams.get("scope"), "openid profile email User.ReadBasic.All GroupMember.ReadWrite.All");
    assert.equal(ordinary.searchParams.get("code_challenge_method"), "S256");
    assert.equal(ordinary.searchParams.get("nonce"), context.upstream_nonce);
  } finally {
    globalThis.fetch = oldFetch;
    resetEntraCachesForTests();
  }
});

test("Entra callback validates signed tenant identity, preserves tenant claims, and consumes state once", async () => {
  const oldFetch = globalThis.fetch;
  const oldBrainId = process.env.BRAIN_ID;
  process.env.BRAIN_ID = "ers-brain";
  let activeToken = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
    }
    if (url.endsWith("/token")) return Response.json({ id_token: activeToken, access_token: "not-used" });
    if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  resetEntraCachesForTests();
  try {
    const nonce = "nonce-valid";
    activeToken = await token({}, nonce);
    const state = stateWithSession("state-valid", nonce);
    const result = await handleEntraCallback(
      new URLSearchParams({ code: "upstream-code", state: "state-valid" }),
      config,
      state,
      { rolesForPrincipal: async () => ({ "ers-brain": "owner" }) }
    );
    assert.equal(result.status, 302);
    const codes = Object.values(await state.listAll("auth_codes"));
    assert.equal(codes.length, 1);
    assert.equal(codes[0].provider, "entra");
    assert.equal(codes[0].provider_tenant_id, TENANT);
    assert.equal(codes[0].provider_user_id, OID);
    assert.equal(codes[0].entra_role, "Brain.Owner");

    const replay = await handleEntraCallback(
      new URLSearchParams({ code: "upstream-code", state: "state-valid" }),
      config,
      state,
      { rolesForPrincipal: async () => ({ "ers-brain": "owner" }) }
    );
    assert.equal(replay.status, 400);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBrainId === undefined) delete process.env.BRAIN_ID;
    else process.env.BRAIN_ID = oldBrainId;
    resetEntraCachesForTests();
  }
});

test("Entra callback fails closed for tenant, audience, nonce, role, time, and grant mismatches", async () => {
  const oldFetch = globalThis.fetch;
  const oldBrainId = process.env.BRAIN_ID;
  process.env.BRAIN_ID = "ers-brain";
  let activeToken = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
    if (url.endsWith("/token")) return Response.json({ id_token: activeToken });
    if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  resetEntraCachesForTests();
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ["wrong-tenant", { tid: "77777777-7777-4777-8777-777777777777" }, {}, "nonce", "owner"],
    ["wrong-audience", {}, { audience: "99999999-9999-4999-8999-999999999999" }, "nonce", "owner"],
    ["wrong-issuer", {}, { issuer: "https://login.microsoftonline.com/99999999-9999-4999-8999-999999999999/v2.0" }, "nonce", "owner"],
    ["invalid-signature", {}, { privateKey: invalidPrivateKey }, "nonce", "owner"],
    ["missing-key-id", {}, { kid: null }, "nonce", "owner"],
    ["wrong-nonce", {}, {}, "different", "owner"],
    ["missing-oid", { oid: null }, {}, "nonce", "owner"],
    ["multiple-roles", { roles: ["Brain.Owner", "Brain.Reader"] }, {}, "nonce", "owner"],
    ["expired", {}, { exp: now - 120 }, "nonce", "owner"],
    ["not-yet-valid", {}, { nbf: now + 300 }, "nonce", "owner"],
    ["future-issued-at", {}, { iat: now + 300 }, "nonce", "owner"],
    ["grant-mismatch", {}, {}, "nonce", "reader"],
  ];
  try {
    for (const [name, claims, times, tokenNonce, grantRole] of cases) {
      activeToken = await token(claims, tokenNonce, times);
      const state = stateWithSession(`state-${name}`, "nonce");
      const result = await handleEntraCallback(
        new URLSearchParams({ code: "upstream-code", state: `state-${name}` }),
        config,
        state,
        { rolesForPrincipal: async () => ({ "ers-brain": grantRole }) }
      );
      assert.equal(result.status, 403, name);
      assert.deepEqual(await state.listAll("auth_codes"), {}, name);
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBrainId === undefined) delete process.env.BRAIN_ID;
    else process.env.BRAIN_ID = oldBrainId;
    resetEntraCachesForTests();
  }
});

test("Entra token-endpoint failure cannot create a Brain authorization code", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
    if (url.endsWith("/token")) return Response.json({ error: "invalid_client", error_description: "do-not-render-upstream-detail" }, { status: 401 });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  resetEntraCachesForTests();
  try {
    const state = stateWithSession("endpoint-failure", "nonce");
    const result = await handleEntraCallback(
      new URLSearchParams({ code: "bad", state: "endpoint-failure" }),
      config,
      state,
      { rolesForPrincipal: async () => ({ "ers-brain": "owner" }) }
    );
    assert.equal(result.status, 403);
    assert.deepEqual(await state.listAll("auth_codes"), {});
    assert.doesNotMatch(result.body, /do-not-render-upstream-detail/);
  } finally {
    globalThis.fetch = oldFetch;
    resetEntraCachesForTests();
  }
});

test("Entra signing-key rollover retries one fresh tenant JWKS fetch", async () => {
  const oldFetch = globalThis.fetch;
  const oldBrainId = process.env.BRAIN_ID;
  process.env.BRAIN_ID = "ers-brain";
  const rotated = await generateKeyPair("RS256");
  const rotatedJwk = { ...(await exportJWK(rotated.publicKey)), kid: "rotated-key", use: "sig", alg: "RS256" };
  let activeToken = "";
  let activeKeys = [jwk];
  let jwksFetches = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
    if (url.endsWith("/token")) return Response.json({ id_token: activeToken });
    if (url.endsWith("/keys")) { jwksFetches += 1; return Response.json({ keys: activeKeys }); }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  resetEntraCachesForTests();
  try {
    activeToken = await token({}, "nonce-first");
    const first = await handleEntraCallback(
      new URLSearchParams({ code: "first", state: "first" }),
      config,
      stateWithSession("first", "nonce-first"),
      { rolesForPrincipal: async () => ({ "ers-brain": "owner" }) }
    );
    assert.equal(first.status, 302);

    activeKeys = [rotatedJwk];
    activeToken = await token({}, "nonce-rotated", { kid: "rotated-key", privateKey: rotated.privateKey });
    const second = await handleEntraCallback(
      new URLSearchParams({ code: "second", state: "second" }),
      config,
      stateWithSession("second", "nonce-rotated"),
      { rolesForPrincipal: async () => ({ "ers-brain": "owner" }) }
    );
    assert.equal(second.status, 302);
    assert.equal(jwksFetches, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBrainId === undefined) delete process.env.BRAIN_ID;
    else process.env.BRAIN_ID = oldBrainId;
    resetEntraCachesForTests();
  }
});

test("hosted-style Entra exchange uses certificate private_key_jwt and upstream PKCE", async () => {
  const oldFetch = globalThis.fetch;
  const oldBrainId = process.env.BRAIN_ID;
  process.env.BRAIN_ID = "ers-brain";
  const certificateConfig = {
    ...config,
    entra: {
      ...config.entra,
      localClientSecret: undefined,
      clientPrivateKeyPem: await exportPKCS8(privateKey),
      clientCertificateThumbprint: "ab".repeat(32),
    },
  };
  const activeToken = await token({}, "nonce-certificate");
  let tokenForm;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
    if (url.endsWith("/token")) {
      tokenForm = new URLSearchParams(init.body);
      return Response.json({ id_token: activeToken });
    }
    if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  resetEntraCachesForTests();
  try {
    const result = await handleEntraCallback(
      new URLSearchParams({ code: "certificate-code", state: "certificate-state" }),
      certificateConfig,
      stateWithSession("certificate-state", "nonce-certificate"),
      { rolesForPrincipal: async () => ({ "ers-brain": "owner" }) }
    );
    assert.equal(result.status, 302);
    assert.equal(tokenForm.get("code_verifier"), "v".repeat(64));
    assert.equal(tokenForm.has("client_secret"), false);
    assert.equal(tokenForm.get("client_assertion_type"), "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    const header = decodeProtectedHeader(tokenForm.get("client_assertion"));
    assert.equal(header.alg, "RS256");
    assert.equal(typeof header["x5t#S256"], "string");
    assert.equal(header["x5t#S256"].length, 43);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBrainId === undefined) delete process.env.BRAIN_ID;
    else process.env.BRAIN_ID = oldBrainId;
    resetEntraCachesForTests();
  }
});
