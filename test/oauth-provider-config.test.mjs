import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { buildOauthConfig } = await import(
  path.join(__dirname, "..", "dist", "oauth", "config.js")
);

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const GROUPS = JSON.stringify({
  reader: "33333333-3333-4333-8333-333333333333",
  member: "44444444-4444-4444-8444-444444444444",
  admin: "55555555-5555-4555-8555-555555555555",
  owner: "66666666-6666-4666-8666-666666666666",
});

function withEnv(values, fn) {
  const keys = new Set([
    ...Object.keys(values),
    "BRAIN_IDENTITY_PROVIDERS",
    "BRAIN_IDENTITY_DEFAULT_PROVIDER",
    "MCP_OAUTH_PUBLIC_BASE",
    "MCP_OAUTH_DOCUMENTATION_URL",
    "MCP_OAUTH_SIGNING_SECRET",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "GITHUB_ALLOWED_LOGINS",
    "GITHUB_ALLOWED_EMAILS",
    "BRAIN_GITHUB_ALLOWED_FALLBACK",
    "ENTRA_TENANT_ID",
    "ENTRA_OAUTH_CLIENT_ID",
    "ENTRA_OAUTH_CLIENT_PRIVATE_KEY_PEM",
    "ENTRA_OAUTH_CLIENT_CERT_THUMBPRINT",
    "ENTRA_OAUTH_CLIENT_SECRET",
    "ENTRA_OAUTH_ALLOW_CLIENT_SECRET_LOCAL",
    "ENTRA_ADMIN_GRAPH_ENABLED",
    "ENTRA_ADMIN_SESSION_SECRET",
    "ENTRA_BRAIN_ROLE_GROUP_IDS",
    "ENTRA_ALLOWED_EMAILS",
    "ENTRA_ALLOWED_EMAIL_DOMAINS",
    "ENTRA_SELF_ENROLLMENT",
    "GITHUB_OAUTH_MOCK_LOGIN",
    "ENTRA_OAUTH_MOCK_OID",
  ]);
  const old = Object.fromEntries([...keys].map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    MCP_OAUTH_PUBLIC_BASE: "http://127.0.0.1:3000",
    MCP_OAUTH_DOCUMENTATION_URL: "https://docs.example.test/brain",
    MCP_OAUTH_SIGNING_SECRET: "s".repeat(64),
    ...values,
  });
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const github = {
  BRAIN_IDENTITY_PROVIDERS: "github",
  GITHUB_OAUTH_CLIENT_ID: "github-client",
  GITHUB_OAUTH_CLIENT_SECRET: "github-secret",
};
const entra = {
  BRAIN_IDENTITY_PROVIDERS: "entra",
  ENTRA_TENANT_ID: TENANT,
  ENTRA_OAUTH_CLIENT_ID: CLIENT,
  ENTRA_OAUTH_CLIENT_SECRET: "local-test-secret",
  ENTRA_OAUTH_ALLOW_CLIENT_SECRET_LOCAL: "1",
};

test("provider configuration supports GitHub-only without Entra credentials", () => {
  withEnv(github, () => {
    const config = buildOauthConfig();
    assert.deepEqual(config.identityProviders, ["github"]);
    assert.equal(config.identityDefaultProvider, "github");
    assert.equal(config.entra, undefined);
  });
});

test("provider configuration supports Entra-only without GitHub credentials", () => {
  withEnv(entra, () => {
    const config = buildOauthConfig();
    assert.deepEqual(config.identityProviders, ["entra"]);
    assert.equal(config.githubClientId, "");
    assert.equal(config.entra.tenantId, TENANT);
  });
});

test("dual provider mode requires both provider configurations", () => {
  withEnv({ ...github, ...entra, BRAIN_IDENTITY_PROVIDERS: "github,entra" }, () => {
    const config = buildOauthConfig();
    assert.deepEqual(config.identityProviders, ["github", "entra"]);
  });
  withEnv({ ...entra, BRAIN_IDENTITY_PROVIDERS: "github,entra" }, () => {
    assert.throws(() => buildOauthConfig(), /GITHUB_OAUTH_CLIENT_ID/);
  });
});

test("Entra configuration rejects generic authorities and authorization shortcuts", () => {
  withEnv({ ...entra, ENTRA_TENANT_ID: "organizations" }, () => {
    assert.throws(() => buildOauthConfig(), /exact GUID/);
  });
  withEnv({ ...entra, ENTRA_ALLOWED_EMAIL_DOMAINS: "ersgenomics.com" }, () => {
    assert.throws(() => buildOauthConfig(), /refuses email, domain/i);
  });
});

test("hosted Entra refuses a client secret and OAuth mock identities", () => {
  withEnv({ ...entra, MCP_OAUTH_PUBLIC_BASE: "https://brain.example.test" }, () => {
    assert.throws(() => buildOauthConfig(), /cannot be used by a hosted HTTPS profile/);
  });
  withEnv({ ...github, MCP_OAUTH_PUBLIC_BASE: "https://brain.example.test", GITHUB_OAUTH_MOCK_LOGIN: "mock" }, () => {
    assert.throws(() => buildOauthConfig(), /mock identities are forbidden/i);
  });
});

test("ERS admin configuration requires four distinct fixed groups and a strong session secret", () => {
  withEnv({
    ...entra,
    ENTRA_ADMIN_GRAPH_ENABLED: "1",
    ENTRA_BRAIN_ROLE_GROUP_IDS: GROUPS,
    ENTRA_ADMIN_SESSION_SECRET: "a".repeat(64),
  }, () => {
    const config = buildOauthConfig();
    assert.equal(config.entra.adminGraphEnabled, true);
    assert.equal(Object.keys(config.entra.roleGroupIds).length, 4);
  });
  withEnv({
    ...entra,
    ENTRA_ADMIN_GRAPH_ENABLED: "1",
    ENTRA_BRAIN_ROLE_GROUP_IDS: GROUPS,
    ENTRA_ADMIN_SESSION_SECRET: "short",
  }, () => assert.throws(() => buildOauthConfig(), /at least 32/));
});
