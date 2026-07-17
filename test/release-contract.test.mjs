import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReleaseState,
  buildFlyDeployArgs,
  buildProvenanceRecord,
  buildReleaseTestEnv,
} from "../scripts/lib/release-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("release state requires a clean, annotated, version-matching tag", () => {
  assert.throws(
    () => assertReleaseState({ porcelain: " M src/index.ts", exactTag: "v1.2.0", tagType: "tag", packageVersion: "1.2.0" }),
    /working tree is not clean/i
  );
  assert.throws(
    () => assertReleaseState({ porcelain: "", exactTag: "", tagType: "", packageVersion: "1.2.0" }),
    /exact tag/i
  );
  assert.throws(
    () => assertReleaseState({ porcelain: "", exactTag: "v1.2.0", tagType: "commit", packageVersion: "1.2.0" }),
    /annotated tag/i
  );
  assert.throws(
    () => assertReleaseState({ porcelain: "", exactTag: "v1.2.1", tagType: "tag", packageVersion: "1.2.0" }),
    /package version/i
  );

  assert.equal(
    assertReleaseState({ porcelain: "", exactTag: "v1.2.0", tagType: "tag", packageVersion: "1.2.0" }),
    "v1.2.0"
  );
});

test("release state accepts a clean overlay on an annotated version-matching upstream tag", () => {
  const overlay = {
    upstreamTag: "v1.2.0",
    upstreamTagType: "tag",
    upstreamIsAncestor: true,
    changes: [
      { status: "A", path: "config/brain-platform.example.json" },
      { status: "M", path: "fly.toml" },
      { status: "M", path: "test/deploy-expectations.json" },
      { status: "A", path: "docs/example-deploy.md" },
    ],
  };

  assert.equal(
    assertReleaseState({
      porcelain: "",
      exactTag: "",
      tagType: "",
      packageVersion: "1.2.0",
      overlay,
    }),
    "v1.2.0"
  );

  assert.throws(
    () =>
      assertReleaseState({
        porcelain: "",
        exactTag: "",
        tagType: "",
        packageVersion: "1.2.0",
        overlay: { ...overlay, upstreamTagType: "commit" },
      }),
    /annotated tag/i
  );
  assert.throws(
    () =>
      assertReleaseState({
        porcelain: "",
        exactTag: "",
        tagType: "",
        packageVersion: "1.2.0",
        overlay: { ...overlay, upstreamTag: "v1.2.1" },
      }),
    /package version/i
  );
  assert.throws(
    () =>
      assertReleaseState({
        porcelain: "",
        exactTag: "",
        tagType: "",
        packageVersion: "1.2.0",
        overlay: { ...overlay, upstreamIsAncestor: false },
      }),
    /ancestor/i
  );
  assert.throws(
    () =>
      assertReleaseState({
        porcelain: "",
        exactTag: "",
        tagType: "",
        packageVersion: "1.2.0",
        overlay: {
          ...overlay,
          changes: [...overlay.changes, { status: "M", path: "src/index.ts" }],
        },
      }),
    /overlay path/i
  );
  assert.throws(
    () =>
      assertReleaseState({
        porcelain: "",
        exactTag: "",
        tagType: "",
        packageVersion: "1.2.0",
        overlay: {
          ...overlay,
          changes: overlay.changes.map((change) =>
            change.path === "docs/example-deploy.md" ? { ...change, status: "D" } : change
          ),
        },
      }),
    /change status/i
  );
  assert.throws(
    () =>
      assertReleaseState({
        porcelain: "",
        exactTag: "",
        tagType: "",
        packageVersion: "1.2.0",
        overlay: {
          ...overlay,
          changes: overlay.changes.filter((change) => change.path !== "fly.toml"),
        },
      }),
    /fly\.toml/i
  );
});

test("guarded deploy passes release identity as OCI build arguments", () => {
  assert.deepEqual(buildFlyDeployArgs({ app: "example-brain-mcp", sha: "abc123", version: "1.2.0" }), [
    "deploy",
    "--app",
    "example-brain-mcp",
    "--build-arg",
    "GIT_SHA=abc123",
    "--build-arg",
    "APP_VERSION=1.2.0",
  ]);
});

test("guarded deploy isolates tests from local hosted-runtime configuration", () => {
  assert.deepEqual(
    buildReleaseTestEnv({
      PATH: "/bin",
      HOME: "/tmp/home",
      BRAIN_REVISION_DATABASE_URL: "postgresql://live.example/brain",
      BRAIN_ID: "ai-brain-jem",
      MCP_OAUTH_SIGNING_SECRET: "secret",
      GITHUB_ALLOWED_LOGINS: "example",
      GITHUB_OAUTH_CLIENT_ID: "client",
      SUPABASE_ACCESS_TOKEN: "token",
    }),
    {
      PATH: "/bin",
      HOME: "/tmp/home",
    }
  );
});

test("deploy provenance records app, tag, sha, and date", () => {
  assert.deepEqual(
    buildProvenanceRecord({
      app: "example-brain-mcp",
      tag: "v1.2.0",
      sha: "abc123",
      deployedAt: new Date("2026-07-16T12:00:00.000Z"),
    }),
    {
      app: "example-brain-mcp",
      tag: "v1.2.0",
      sha: "abc123",
      deployed_at: "2026-07-16T12:00:00.000Z",
    }
  );
});

test("overlay deploy provenance records upstream and overlay identities", () => {
  assert.deepEqual(
    buildProvenanceRecord({
      app: "example-brain-mcp",
      tag: "v1.2.0",
      sha: "overlay123",
      upstreamSha: "upstream456",
      overlaySha: "overlay123",
      deployedAt: new Date("2026-07-17T12:00:00.000Z"),
    }),
    {
      app: "example-brain-mcp",
      tag: "v1.2.0",
      sha: "overlay123",
      upstream_sha: "upstream456",
      overlay_sha: "overlay123",
      deployed_at: "2026-07-17T12:00:00.000Z",
    }
  );
});

test("package and image expose the guarded release contract", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/JEM-Fizbit/brain-mcp-server.git",
  });
  assert.equal(packageJson.scripts["deploy:guarded"], "node scripts/deploy-guarded.mjs");
  assert.match(dockerfile, /ARG GIT_SHA/);
  assert.match(dockerfile, /ARG APP_VERSION/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(dockerfile, /org\.opencontainers\.image\.version/);
});
