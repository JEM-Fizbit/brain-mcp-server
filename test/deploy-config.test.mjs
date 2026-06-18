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

test("hosted OAuth smoke caches refresh grants without logging access tokens", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")
  );
  const script = await fs.readFile(
    path.join(repoRoot, "scripts", "smoke-hosted-oauth.mjs"),
    "utf-8"
  );
  const latencySummary = await fs.readFile(
    path.join(repoRoot, "scripts", "lib", "latency-summary.mjs"),
    "utf-8"
  );

  assert.equal(packageJson.scripts["smoke:hosted:oauth"], "node scripts/smoke-hosted-oauth.mjs");
  assert.match(script, /token_endpoint_auth_method: "none"/);
  assert.match(script, /code_challenge_method", "S256"/);
  assert.match(script, /Bearer \$\{accessToken\}/);
  assert.match(script, /HOSTED_OAUTH_WRITE_SMOKE\.md/);
  assert.match(script, /BRAIN_SYNC_INCLUDE_FILES: smokeFilename/);
  assert.match(script, /BRAIN_HOSTED_OAUTH_TOKEN_CACHE/);
  assert.match(script, /hosted-oauth-token\.json/);
  assert.match(script, /refresh_token/);
  assert.match(script, /grant_type: "refresh_token"/);
  assert.match(script, /shouldReauth/);
  assert.match(script, /chmod\(tokenCacheFile, 0o600\)/);
  assert.match(script, /BRAIN_HOSTED_MCP_LATENCY_FILE/);
  assert.match(script, /hosted-mcp-latency\.json/);
  assert.match(script, /buildLatencySnapshot/);
  assert.match(script, /BRAIN_HOSTED_MCP_LATENCY_HISTORY_LIMIT/);
  assert.match(script, /operationLatencies/);
  assert.match(script, /writeLatencySnapshot/);
  assert.match(latencySummary, /latestReadLatencyMs/);
  assert.match(latencySummary, /latestWriteLatencyMs/);
  assert.match(latencySummary, /operationSummaries/);
  assert.match(script, /brain-hosted-oauth-conflict-/);
  assert.match(script, /brain_resolve_conflict/);
  assert.match(script, /fs\.writeFile\(localPath, expectedContent, "utf-8"\)/);
  assert.doesNotMatch(script, /accessToken.*fs\.writeFile|fs\.writeFile.*accessToken/);
  assert.doesNotMatch(script, /appendFile|localStorage/);
  for (const line of script.split("\n")) {
    assert.doesNotMatch(line, /console\.log.*access_token|access_token.*console\.log/);
  }
});

test("hosted doctor is non-destructive and redacts database credentials", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")
  );
  const script = await fs.readFile(
    path.join(repoRoot, "scripts", "hosted-doctor.mjs"),
    "utf-8"
  );

  assert.equal(packageJson.scripts["hosted:doctor"], "node scripts/hosted-doctor.mjs");
  assert.match(script, /hosted_health/);
  assert.match(script, /postgres_summary/);
  assert.match(script, /recent_activity/);
  assert.match(script, /brain_file_revisions/);
  assert.match(script, /timedCheck/);
  assert.match(script, /latencyMs/);
  assert.match(script, /user_operation_latency/);
  assert.match(script, /BRAIN_HOSTED_MCP_LATENCY_FILE/);
  assert.match(script, /latestReadLatencyMs/);
  assert.match(script, /latestWriteLatencyMs/);
  assert.match(script, /operationSummaries/);
  assert.match(script, /summarizeLatencyHistory/);
  assert.match(script, /lint_nudge/);
  assert.match(script, /BRAIN_LINT_NUDGE_DAYS/);
  assert.match(script, /lastLintAt/);
  assert.match(script, /inbox/);
  assert.match(script, /pendingFiles/);
  assert.match(script, /buildOperatorActions/);
  assert.match(script, /actions: buildOperatorActions/);
  assert.match(script, /local_sync_state/);
  assert.match(script, /sync_health/);
  assert.match(script, /sync_lock/);
  assert.match(script, /launchd/);
  assert.match(script, /fly_status/);
  assert.match(script, /databaseUrl: "set"/);
  assert.doesNotMatch(script, /databaseUrl[,}]/);
  assert.doesNotMatch(script, /insert into|update brain|delete from|brain_update_file|brain_resolve_conflict/i);
});

test("hosted cockpit is local-only and read-only", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")
  );
  const script = await fs.readFile(
    path.join(repoRoot, "scripts", "hosted-cockpit.mjs"),
    "utf-8"
  );

  assert.equal(packageJson.scripts["hosted:cockpit"], "node scripts/hosted-cockpit.mjs");
  assert.equal(
    packageJson.scripts["hosted:cockpit:launchd:plist"],
    "node scripts/write-cockpit-launchd-plist.mjs"
  );
  assert.equal(
    packageJson.scripts["hosted:cockpit:launcher:install"],
    "node scripts/install-cockpit-launcher.mjs"
  );
  assert.match(script, /BRAIN_COCKPIT_HOST \|\| "127\.0\.0\.1"/);
  assert.match(script, /requestedPort \|\| 8787/);
  assert.match(script, /BRAIN_COCKPIT_PORT_FALLBACK/);
  assert.match(script, /BRAIN_COCKPIT_PORT_ATTEMPTS/);
  assert.match(script, /EADDRINUSE/);
  assert.match(script, /trying \$\{portToTry \+ 1\}/);
  assert.match(script, /hosted-doctor\.mjs/);
  assert.match(script, /\/api\/doctor/);
  assert.match(script, /role="tablist"/);
  assert.match(script, /panel-overview/);
  assert.match(script, /panel-activity/);
  assert.match(script, /panel-latency/);
  assert.match(script, /panel-checks/);
  assert.match(script, /panel-raw/);
  assert.match(script, /activateTab/);
  assert.match(script, /User-Facing Operations/);
  assert.match(script, /Infrastructure Checks/);
  assert.match(script, /read-op-latency/);
  assert.match(script, /write-op-latency/);
  assert.match(script, /sync-wait-latency/);
  assert.match(script, /renderUserOperationLatencies/);
  assert.match(script, /renderLatencySummaryCards/);
  assert.match(script, /renderSparkline/);
  assert.match(script, /hosted-latency/);
  assert.match(script, /doctor-latency/);
  assert.match(script, /payload\.actions/);
  assert.match(script, /formatDuration/);
  assert.match(script, /Recent Brain Activity/);
  assert.match(script, /Watch Log/);
  assert.match(script, /localDateTime/);
  assert.match(script, /operationLog/);
  assert.doesNotMatch(script, /insert into|update brain|delete from|brain_update_file|brain_resolve_conflict/i);
});

test("hosted test drive runs the operator rehearsal with a readable verdict", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")
  );
  const script = await fs.readFile(
    path.join(repoRoot, "scripts", "hosted-test-drive.mjs"),
    "utf-8"
  );

  assert.equal(packageJson.scripts["hosted:test-drive"], "node scripts/hosted-test-drive.mjs");
  assert.match(script, /Hosted Brain Test Drive/);
  assert.match(script, /Preflight hosted doctor/);
  assert.match(script, /Hosted MCP client smoke/);
  assert.match(script, /Final hosted doctor/);
  assert.match(script, /smoke-hosted-oauth\.mjs/);
  assert.match(script, /--write/);
  assert.match(script, /--verify-local/);
  assert.match(script, /--local-write/);
  assert.match(script, /--verify-hosted/);
  assert.match(script, /--conflict/);
  assert.match(script, /--read-only/);
  assert.match(script, /--skip-conflict/);
  assert.match(script, /User-facing latency/);
  assert.match(script, /Next Action/);
  assert.match(script, /finalDoctor\.actions/);
  assert.match(script, /brain_resolve_conflict/);
});
