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
  assert.match(flyConfig, /BRAIN_OAUTH_STATE_STORE = "postgres"/);
  assert.match(flyConfig, /MCP_OAUTH_REFRESH_REUSE_GRACE_SEC = "15"/);
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

test("Fly image carries the John-only JEM and ERS pilot registry", async () => {
  const flyConfig = await fs.readFile(path.join(repoRoot, "fly.toml"), "utf-8");
  const dockerfile = await fs.readFile(path.join(repoRoot, "Dockerfile"), "utf-8");
  const entrypoint = await fs.readFile(
    path.join(repoRoot, "scripts", "fly-entrypoint.sh"),
    "utf-8"
  );
  const registry = JSON.parse(
    await fs.readFile(
      path.join(repoRoot, "config", "brain-platform.john-ers-pilot.json"),
      "utf-8"
    )
  );

  assert.match(
    flyConfig,
    /BRAIN_PLATFORM_CONFIG = "\/app\/config\/brain-platform\.john-ers-pilot\.json"/
  );
  assert.match(dockerfile, /COPY config \.\/config/);
  assert.match(entrypoint, /\/data\/config\/registry\.json/);
  assert.equal(registry.version, 1);
  assert.equal(registry.default_brain_id, "ai-brain-jem");
  assert.deepEqual(
    registry.brains.map((brain) => brain.id).sort(),
    ["ai-brain-jem", "ers-brain"]
  );
  assert.ok(
    registry.brains.every((brain) => brain.storage_backend === "postgres")
  );
  const john = registry.principals.find((principal) => principal.login === "johnemilad");
  assert.ok(john);
  assert.equal(john.provider_user_id, "220941196");
  assert.equal(john.roles["ai-brain-jem"], "owner");
  assert.equal(john.roles["ers-brain"], "owner");
  assert.doesNotMatch(JSON.stringify(registry), /secret|token|postgresql:\/\//i);
});

test("ERS Brain pilot seed is data-only and private by default", async () => {
  const seed = await fs.readFile(
    path.join(repoRoot, "db", "seeds", "2026-06-24_001_bootstrap_ers_brain_pilot.sql"),
    "utf-8"
  );

  assert.match(seed, /insert into brain\.brains/i);
  assert.match(seed, /'ers-brain'/);
  assert.match(seed, /'shared'/);
  assert.match(seed, /john-only-pilot/);
  assert.match(seed, /production_cutover_requires_ers_owned_project/);
  assert.doesNotMatch(seed, /\bgrant\b/i);
  assert.doesNotMatch(seed, /\bcreate policy\b/i);
  assert.doesNotMatch(seed, /\banon\b/i);
  assert.doesNotMatch(seed, /\bauthenticated\b/i);
  assert.doesNotMatch(seed, /\bpublic\b/i);
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
  assert.match(script, /BRAIN_REVISION_DATABASE_URL/);
  assert.match(script, /BRAIN_HOSTED_MCP_CLIENT_LATENCY_DB_WRITE/);
  assert.match(script, /BRAIN_HOSTED_MCP_SYNC_WAIT_DB_WRITE/);
  assert.match(script, /hosted_mcp_sync_wait/);
  assert.match(script, /hosted_mcp_client_e2e/);
  assert.match(script, /client_observed_tool_call/);
  assert.match(script, /brain\.sync_events/);
  assert.match(script, /HOSTED_MCP_LATENCY_EVENT_TYPE/);
  assert.match(script, /operationLatencies/);
  assert.match(script, /writeLatencySnapshot/);
  assert.match(latencySummary, /latestReadLatencyMs/);
  assert.match(latencySummary, /latestWriteLatencyMs/);
  assert.match(latencySummary, /operationSummaries/);
  assert.match(latencySummary, /latencyHistoryFromSyncEventRows/);
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
  assert.match(script, /oauthStateStore/);
  assert.match(script, /postgres_summary/);
  assert.match(script, /recent_activity/);
  assert.match(script, /brain_file_revisions/);
  assert.match(script, /timedCheck/);
  assert.match(script, /latencyMs/);
  assert.match(script, /user_operation_latency/);
  assert.match(script, /BRAIN_HOSTED_MCP_LATENCY_FILE/);
  assert.match(script, /brain\.sync_events/);
  assert.match(script, /HOSTED_MCP_LATENCY_EVENT_TYPE/);
  assert.match(script, /HOSTED_MCP_AUTH_EVENT_TYPE/);
  assert.match(script, /hosted_mcp_server/);
  assert.match(script, /sync_wait/);
  assert.match(script, /latestReadLatencyMs/);
  assert.match(script, /latestWriteLatencyMs/);
  assert.match(script, /operationSummaries/);
  assert.match(script, /clientOperationSummaries/);
  assert.match(script, /timingLayerSummaries/);
  assert.match(script, /toolSummaries/);
  assert.match(script, /slowestOperations/);
  assert.match(script, /diagnoseLatencyPerformance/);
  assert.match(script, /normalizeLatencySloThresholds/);
  assert.match(script, /BRAIN_SLO_SERVER_READ_P95_WARN_MS/);
  assert.match(script, /BRAIN_SLO_DB_MAX_SPAN_WARN_MS/);
  assert.match(script, /performanceStatus/);
  assert.match(script, /performanceFindings/);
  assert.match(script, /dbSpanTargets/);
  assert.match(script, /operationUsageRowsQuery/);
  assert.match(script, /eventLogWindowDays/);
  assert.match(script, /event_type = any\(\$2::text\[\]\)/);
  assert.match(script, /BRAIN_HOSTED_MCP_EVENT_LOG_LIMIT/);
  assert.match(script, /BRAIN_HOSTED_MCP_EVENT_LOG_DAYS/);
  assert.match(script, /count_24h/);
  assert.match(script, /count_7d/);
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

test("source list verifier supports non-JEM expected counts", async () => {
  const script = await fs.readFile(
    path.join(repoRoot, "scripts", "verify-postgres-source-list.mjs"),
    "utf-8"
  );

  assert.match(script, /BRAIN_EXPECTED_SOURCE_COUNT/);
  assert.match(script, /BRAIN_EXPECTED_CATEGORY_COUNTS/);
  assert.doesNotMatch(script, /assert\.equal\(all\.length,\s*70\)/);
});

test("local sync daemon bounds Postgres stalls and shutdown", async () => {
  const cli = await fs.readFile(path.join(repoRoot, "src", "sync", "cli.ts"), "utf-8");
  const store = await fs.readFile(
    path.join(repoRoot, "src", "sync", "postgres-revision-store.ts"),
    "utf-8"
  );
  const activeStore = await fs.readFile(
    path.join(repoRoot, "src", "services", "active-brain-store.ts"),
    "utf-8"
  );
  const sourceStore = await fs.readFile(
    path.join(repoRoot, "src", "sources", "postgres-source-store.ts"),
    "utf-8"
  );
  const oauthStore = await fs.readFile(
    path.join(repoRoot, "src", "oauth", "postgres-state.ts"),
    "utf-8"
  );

  assert.match(cli, /BRAIN_SYNC_CLOSE_TIMEOUT_MS/);
  assert.match(cli, /closeWithTimeout/);
  assert.match(cli, /Promise\.race\(\[close, timeoutPromise\]\)/);
  assert.match(cli, /Timed out closing sync store/);
  assert.match(store, /BRAIN_PG_CONNECTION_TIMEOUT_MS/);
  assert.match(store, /BRAIN_PG_QUERY_TIMEOUT_MS/);
  assert.match(store, /BRAIN_PG_STATEMENT_TIMEOUT_MS/);
  assert.match(store, /BRAIN_PG_IDLE_TIMEOUT_MS/);
  assert.match(store, /connectionTimeoutMillis/);
  assert.match(store, /query_timeout/);
  assert.match(store, /statement_timeout/);
  assert.match(activeStore, /postgresPoolOptions\(databaseUrl\)/);
  assert.match(sourceStore, /postgresPoolOptions\(poolOrConnectionString\)/);
  assert.match(oauthStore, /postgresPoolOptions\(poolOrConnectionString/);
  assert.match(oauthStore, /BRAIN_OAUTH_STATE_PG_POOL_MAX/);
});

test("hosted MCP server records tool latency without payload content", async () => {
  const server = await fs.readFile(path.join(repoRoot, "src", "mcp-server.ts"), "utf-8");
  const telemetry = await fs.readFile(
    path.join(repoRoot, "src", "services", "tool-telemetry.ts"),
    "utf-8"
  );
  const authTelemetry = await fs.readFile(
    path.join(repoRoot, "src", "services", "auth-telemetry.ts"),
    "utf-8"
  );

  assert.match(server, /instrumentToolLatency\(server\)/);
  assert.match(telemetry, /hosted_mcp_latency/);
  assert.match(telemetry, /hosted_mcp_server/);
  assert.match(telemetry, /server_tool/);
  assert.match(telemetry, /server_tool_handler/);
  assert.match(telemetry, /recordToolLatencyBestEffort/);
  assert.match(telemetry, /BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE/);
  assert.match(telemetry, /BRAIN_HOSTED_MCP_LATENCY_DB_WRITE/);
  assert.match(telemetry, /brain\.sync_events/);
  assert.match(telemetry, /dbTelemetry/);
  assert.match(telemetry, /brain_update_file/);
  assert.match(telemetry, /brain_resolve_conflict/);
  assert.match(telemetry, /tool_returned_error/);
  assert.match(authTelemetry, /hosted_mcp_auth/);
  assert.match(authTelemetry, /auth_failed|missing_bearer|token_expired/);
  assert.match(authTelemetry, /recordAuthEventBestEffort/);
  assert.match(authTelemetry, /BRAIN_HOSTED_MCP_AUTH_DB_WRITE/);
  assert.match(authTelemetry, /brain\.sync_events/);
  assert.doesNotMatch(authTelemetry, /req\.headers|rawBody|request body/i);
  assert.doesNotMatch(telemetry, /content:\s*input|input\.content|old_content|source_content/);
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
  assert.match(script, /Operation Log/);
  assert.match(script, /Usage/);
  assert.match(script, /ops-24h/);
  assert.match(script, /ops-7d/);
  assert.match(script, /ops-total/);
  assert.match(script, /renderOperationUsage/);
  assert.match(script, /renderOperationEvents/);
  assert.match(script, /Infrastructure Checks/);
  assert.match(script, /read-op-latency/);
  assert.match(script, /write-op-latency/);
  assert.match(script, /sync-wait-latency/);
  assert.match(script, /latency-subtab-trends/);
  assert.match(script, /latency-subtab-slo/);
  assert.match(script, /latency-subtab-slowest/);
  assert.match(script, /latency-subtab-samples/);
  assert.match(script, /latency-subtab-infra/);
  assert.match(script, /SLOs & Findings/);
  assert.match(script, /latency-slo-findings/);
  assert.match(script, /renderLatencySlo/);
  assert.match(script, /renderSloEvaluations/);
  assert.match(script, /DB Span Hotspots/);
  assert.match(script, /slowest-operation-latencies/);
  assert.match(script, /recent-operation-latencies/);
  assert.match(script, /renderUserOperationLatencies/);
  assert.match(script, /renderLatencySummaryCards/);
  assert.match(script, /renderSparkline/);
  assert.match(script, /hosted-latency/);
  assert.match(script, /doctor-latency/);
  assert.match(script, /payload\.actions/);
  assert.match(script, /formatDuration/);
  assert.match(script, /Recent Brain Activity/);
  assert.match(script, /Brain content state changes/);
  assert.match(script, /hosted MCP tool-call and auth metadata/);
  assert.match(script, /activity-subtab-operations/);
  assert.match(script, /activity-subtab-auth/);
  assert.match(script, /activity-subtab-brain/);
  assert.match(script, /activity-subtab-watch/);
  assert.match(script, /Auth Failures/);
  assert.match(script, /auth-failure-summary/);
  assert.match(script, /auth-failure-trend/);
  assert.match(script, /auth-failure-recent/);
  assert.match(script, /renderAuthFailures/);
  assert.match(script, /authFailureCheckSummary/);
  assert.match(script, /setupActivityViews/);
  assert.match(script, /setupSubtabGroup/);
  assert.match(script, /Client-Observed E2E/);
  assert.match(script, /Timing Layers/);
  assert.match(script, /Slowest Operations/);
  assert.match(script, /dbSummaryLabel/);
  assert.match(script, /renderOperationEventTable/);
  assert.match(script, /operation-log-table/);
  assert.match(script, /operation-table-wrap/);
  assert.match(script, /db-span-table/);
  assert.match(script, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(script, /data-label=\\"Operation\\"/);
  assert.match(script, /Local cockpit observations/);
  assert.match(script, /Cockpit Watch/);
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

test("Postgres integration test requires an explicit test database URL", async () => {
  const testFile = await fs.readFile(
    path.join(repoRoot, "test", "postgres-revision-store.test.mjs"),
    "utf-8"
  );

  assert.match(testFile, /BRAIN_POSTGRES_TEST_DATABASE_URL/);
  assert.match(testFile, /BRAIN_POSTGRES_TEST_ALLOW_RUNTIME_URL/);
  assert.doesNotMatch(
    testFile,
    /const databaseUrl = process\.env\.BRAIN_REVISION_DATABASE_URL;/
  );
});
