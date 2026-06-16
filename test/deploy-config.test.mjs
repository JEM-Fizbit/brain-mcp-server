import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

test("Fly config uses Supabase stores instead of the retired git hot path", async () => {
  const flyConfig = await fs.readFile(path.join(repoRoot, "fly.toml"), "utf-8");

  assert.match(flyConfig, /BRAIN_REVISION_STORE = "postgres"/);
  assert.match(flyConfig, /BRAIN_ARTIFACT_STORE = "supabase"/);
  assert.match(flyConfig, /BRAIN_ARTIFACT_BYTE_ACCESS = "metadata_only"/);
  assert.match(flyConfig, /BRAIN_SUPABASE_STORAGE_BUCKET = "brain-artifacts"/);
  assert.doesNotMatch(flyConfig, /BRAIN_AUTO_SYNC/);
  assert.doesNotMatch(flyConfig, /BRAIN_AUTO_PUSH/);
  assert.doesNotMatch(flyConfig, /BRAIN_GITHUB_REPO/);
  assert.doesNotMatch(flyConfig, /BRAIN_DEPLOY_KEY/);
  assert.doesNotMatch(flyConfig, /brain_deploy_key/);
  assert.doesNotMatch(flyConfig, /BRAIN_SUPABASE_SERVICE_ROLE_KEY/);
});

test("Fly image does not install or configure deploy-key SSH access", async () => {
  const dockerfile = await fs.readFile(path.join(repoRoot, "Dockerfile"), "utf-8");
  const entrypoint = await fs.readFile(
    path.join(repoRoot, "scripts", "fly-entrypoint.sh"),
    "utf-8"
  );

  assert.doesNotMatch(dockerfile, /openssh-client/);
  assert.doesNotMatch(dockerfile, /\bgit\b/);
  assert.doesNotMatch(entrypoint, /ssh-keyscan/);
  assert.doesNotMatch(entrypoint, /brain_deploy_key/);
  assert.match(entrypoint, /exec "\$@"/);
});

test("hosted OAuth smoke keeps temporary access tokens in memory", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")
  );
  const script = await fs.readFile(
    path.join(repoRoot, "scripts", "smoke-hosted-oauth.mjs"),
    "utf-8"
  );

  assert.equal(packageJson.scripts["smoke:hosted:oauth"], "node scripts/smoke-hosted-oauth.mjs");
  assert.match(script, /token_endpoint_auth_method: "none"/);
  assert.match(script, /code_challenge_method", "S256"/);
  assert.match(script, /Bearer \$\{accessToken\}/);
  assert.match(script, /HOSTED_OAUTH_WRITE_SMOKE\.md/);
  assert.match(script, /BRAIN_SYNC_INCLUDE_FILES: smokeFilename/);
  assert.match(script, /brain-hosted-oauth-conflict-/);
  assert.match(script, /brain_resolve_conflict/);
  assert.match(script, /fs\.writeFile\(localPath, expectedContent, "utf-8"\)/);
  assert.doesNotMatch(script, /appendFile|localStorage/);
  for (const line of script.split("\n")) {
    assert.doesNotMatch(line, /console\.log.*access_token|access_token.*console\.log/);
  }
});
