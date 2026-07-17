# Hosted Client Cutover Runbook

**Status:** active operator guide
**Last updated:** 2026-07-17

This runbook covers the JEM Brain move from hosted pilot to normal remote-client usage.

Cutover does not replace the local Markdown Brain. Local stdio `brain` remains the fast local and recovery path. Hosted `brain-hosted` is the normal path for clients or sessions that need remote HTTPS access.

## Current Gate

The live JEM hosted test drive passed on 2026-06-16 at 16:38 Asia/Ho_Chi_Minh:

- hosted files: 50;
- open conflicts: 0;
- final sync cycle: 1090;
- final sync activity: pushed 0, pulled 1, conflicts 0;
- user-facing read latency: 412 ms;
- user-facing write latency: 1.7 s;
- user-facing sync wait latency: 6.4 s.

The first sandboxed run failed only because the command could not resolve Fly/Supabase hosts from the restricted shell. The network-approved run passed.

The real hosted client shadow rehearsal also passed on 2026-06-16. Post-rehearsal cockpit doctor at 17:16 Asia/Ho_Chi_Minh reported:

- hosted files: 50;
- open conflicts: 0;
- sync cycle: 1421;
- sync conflicts: 0;
- latest hosted update: 2026-06-16 17:13:57 Asia/Ho_Chi_Minh.

The spec 013 server-foundation rollout and fenced-example graph-parser correction passed on 2026-07-17 at release `v1.3.2`. `/health` reported version `1.3.2` with Postgres revisions, Supabase artifacts, Postgres OAuth state and the git hot path disabled. Deployed read-only checks reported 35 JEM files and 46 ERS files, zero open conflicts for both Brains, ranked search results for both Brains, the two adjudicated JEM graph-shadow findings, and no graph-shadow enforcement for legacy-mode ERS. A one-off read-only ERS graph calculation confirmed both template descriptors reachable and left only the intentionally unreachable fork-signoff file. The rollout did not migrate either Brain's content or introduce the task-context compiler.

The separately approved JEM content release passed on 2026-07-17 at `v1.4.0` (`0115afb`). JEM now has 39 hosted files, zero open conflicts and a 1,851-token bootstrap, with all routing, policy, signpost and search evaluations unchanged from the pre-migration baseline. Its local mirror hash-matched the migrated payloads after sync resumed. JEM remains in advisory `graph_shadow` for real-use observation; ERS remains unmodified at 46 hosted files, zero open conflicts and `legacy` mode. No schema, compiler, ERS migration or hosted-principal change was included.

After a bounded JEM content/health audit and all four ERS gates passed, the separately approved ERS content migration shipped in `v1.4.1` (`23c209d`) on 2026-07-17. ERS now has 50 hosted files, zero open conflicts, a 1,600-token bootstrap, zero graph-unreachable files and three deliberate rotated-history exemptions. Its local OneDrive mirror matches the hosted content after clean sync convergence. Fly machine version 49 serves `1.4.1`; both JEM and ERS remain in advisory `graph_shadow`. No schema, compiler, team-access, hosted-principal or dedicated-infrastructure change was included.

An optional interactive read-only test-drive was deliberately stopped after Chrome supplied the unregistered `jemilad-ers` GitHub session and the server rejected it. For this personal-owned John-only pilot, complete GitHub OAuth as `JEM-Fizbit`, including when John accesses `ers-brain`; an ERS work-account principal is not currently registered. Do not widen the principal registry as connector troubleshooting.

## Cutover Decision

Hosted MCP is promoted as the normal remote JEM Brain path.

The promotion gate passed:

- `npm run hosted:test-drive` passes on the same day as the client change;
- a real client can enroll or reuse OAuth without manual database work;
- hosted client reads work for `brain_list_brains`, `brain_describe`, `brain_load_context`, `brain_list_files`, `brain_sync_status`, and a normal `brain_read_file`;
- one narrow hosted write syncs back to the local Markdown mirror;
- `npm run hosted:doctor` reports open conflicts `0` after the client write;
- local stdio `brain` remains configured and working as fallback.

For remote-only Claude/Codex usage, prefer hosted `brain-hosted`. For local filesystem-heavy work on this Mac, local stdio `brain` remains acceptable and faster, especially for recovery, source-file handling, and direct Markdown work.

## OpenAI Client Cutover

Provider-level ChatGPT/Codex connector recovery is canonicalized in `~/Projects/ai-knowledge/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md`. Use that protocol after hosted MCP OAuth-state, Dynamic Client Registration, callback, or tool-surface changes; this page keeps the Brain-specific connector URL, account notes, and verification commands.

Codex has been fully cut over so the default `brain` MCP connector points at hosted:

```toml
[mcp_servers.brain]
url = "https://jem-brain-mcp.fly.dev/mcp"
oauth_resource = "https://jem-brain-mcp.fly.dev/mcp"
```

The local stdio fallback is retained as `brain-local`:

```toml
[mcp_servers.brain-local]
command = "node"
args = ["/Users/johnemilad/Projects/brain-mcp-server/dist/index.js"]

[mcp_servers.brain-local.env]
BRAIN_DIR = "/Users/johnemilad/Projects/ai-brain-jem/brain"
```

### Codex terminal / CLI recovery

The Codex terminal / CLI environment has its own local MCP entry in `~/.codex/config.toml`, plus OpenAI app-connector authorization and per-tool approval state. Verify both layers when the hosted Brain is updated, redeployed, or reinstalled.

First confirm the local MCP entry still points at hosted:

```bash
codex mcp list --json
codex mcp get brain --json
codex login status
codex doctor
```

Expected Brain entry:

```text
name: brain
type: streamable_http
url: https://jem-brain-mcp.fly.dev/mcp
auth_status: o_auth
```

If the CLI shows stale OAuth symptoms such as `invalid_grant`, `invalid_client`, `unknown_client_id`, or `OAuth authorization required`, reset only the hosted Brain CLI credentials:

```bash
/Applications/Codex.app/Contents/Resources/codex mcp logout brain
/Applications/Codex.app/Contents/Resources/codex mcp login brain
```

After OAuth succeeds, run one interactive terminal Codex session and approve the read-only `brain.brain_sync_status` call with **Always allow**. This is required because non-interactive `codex exec` runs without an approval surface; without a persisted approval, read-only hosted Brain checks can fail as `user cancelled MCP tool call` even when OAuth is healthy.

Then verify both permitted Brains from the CLI without using `brain-local`:

```bash
/Applications/Codex.app/Contents/Resources/codex exec --ephemeral --sandbox read-only -C /Users/johnemilad/Projects/brain-mcp-server "Verification only. Use the hosted Brain MCP server named brain. Do not use brain-local and do not edit files. Call brain_sync_status for brain_id ai-brain-jem and brain_id ers-brain. Report only provider, hosted file count, open conflicts, and latest cursor for each Brain. Do not print Brain file contents."
```

Verification passed on 2026-06-25 UTC:

| Brain | Provider | Hosted files | Open conflicts | Latest cursor |
| --- | --- | ---: | ---: | --- |
| `ai-brain-jem` | `revision` | 52 | 0 | `2026-06-24T23:45:23.762Z` |
| `ers-brain` | `revision` | 40 | 0 | `2026-06-24T18:58:19.307Z` |

Unrelated MCP OAuth warnings for other connectors, such as `supabase` or `slack-claude-jembot`, are not Brain failures. Reauth them separately if those CLI connectors are needed.

ChatGPT connectors are configured through ChatGPT settings rather than a local `~/.codex` file. Create the hosted Brain connector in ChatGPT with:

```text
Connector name: Brain
Description: Hosted JEM Brain MCP for personal context, Brain file reads/writes, sync status, source metadata, and maintenance nudges.
Connector URL: https://jem-brain-mcp.fly.dev/mcp
```

Use ChatGPT Settings -> Connectors -> Create. After creation, start a new ChatGPT conversation, add the Brain connector from the composer tools menu, authenticate through GitHub OAuth when prompted, and verify `brain_sync_status` reports the hosted/revision provider with open conflicts `0`.

ChatGPT generates connector-specific OAuth callbacks under `https://chatgpt.com/connector/oauth/<id>`. The hosted Brain OAuth server accepts that documented ChatGPT callback path automatically, along with loopback redirects, the built-in Claude callback, and ChatGPT's legacy `https://chatgpt.com/connector_platform_oauth_redirect` callback. Use `MCP_OAUTH_ALLOWED_REDIRECT_URIS` only for other exact non-loopback client callbacks.

If ChatGPT shows `Authorization failed` after a hosted OAuth-state migration, tool-surface change, or redeploy that invalidates dynamic client registrations, check the cockpit Operation Log for `oauth_token` failures such as `unknown_client_id` or `invalid_client`. For ChatGPT, **do not rely on disconnect/reconnect**: it can preserve the stale connector registration and repeat the authorization failure. Fully delete/remove the old Brain connector from the affected ChatGPT account or workspace, then create it again from scratch so ChatGPT performs fresh dynamic client registration and receives a new `client_id`.

For OpenAI surfaces, refresh ChatGPT/app-connector state first and Codex last. Codex can see the hosted Brain through the same OpenAI app connector backend, and existing Codex threads can retain a stale tool manifest even after the server has been redeployed. After deleting/recreating the ChatGPT custom MCP app and completing OAuth, start a fresh Codex chat/session and verify tool discovery there; avoid treating Codex as the first recovery surface unless the failure is limited to Codex's local `~/.codex/config.toml` MCP entry.

External corroboration checked 2026-06-24:

- OpenAI's ChatGPT app-auth docs state that, on the DCR path, ChatGPT calls the server's registration endpoint once for the connector instance, receives a generated `client_id`, and reuses that client for the instance. This matches the stale-connector failure mode after server-side OAuth-state resets. Source: <https://developers.openai.com/apps-sdk/build/auth>.
- OpenAI's developer-mode docs say OAuth app creation scans tools, completes authorization, and then creates the app under Workspace Settings -> Apps / Settings -> Apps; the same page advises recreating the app when refresh-token/OAuth metadata needs to be refetched. Source: <https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt>.
- OpenAI's app-maintenance docs say deploying server changes does not update the app snapshot; changed tools or metadata require a new scan/version flow. For this private custom-app workflow, delete/recreate is the practical reset when the UI does not expose a clean rescan/reauth path. Source: <https://developers.openai.com/apps-sdk/deploy/submission>.
- OpenAI's Codex plugin docs say bundled apps can remain installed and must be managed in ChatGPT, which supports the observed cross-surface ChatGPT/Codex connector-state coupling. Source: <https://developers.openai.com/codex/plugins>.
- OpenAI Developer Community reports show similar OAuth/action-refresh failure modes where users could not retrigger auth or refresh actions cleanly without disconnecting/reconnecting or deleting/recreating the connector. Representative thread: <https://community.openai.com/t/cannot-refresh-actions-after-oauth-authentication/1368841>.

### ChatGPT Business / ERS workspace recovery

ChatGPT Business custom MCP apps are not reliably manageable from the desktop app. Use the browser client. For the ERS Business workspace, the app is managed under **Workspace settings -> Apps**, not only under the individual user's connector settings.

When a ChatGPT Business Brain connector is stale after a hosted MCP update, OAuth-state reset, or tool-surface change:

1. Open ChatGPT in a browser and switch to the ERS Business workspace.
2. Go to **Workspace settings -> Apps**.
3. Find the old Brain custom MCP app.
4. Disable it.
5. Delete/remove it from the workspace.
6. Create a new custom app with the hosted MCP URL: `https://jem-brain-mcp.fly.dev/mcp`.
7. Complete GitHub OAuth as `JEM-Fizbit`.
8. After the workspace app exists, complete the separate final connection step in the individual ERS ChatGPT account in the browser. This step is not surfaced clearly in the desktop app.
9. Start a fresh ChatGPT conversation and verify both Brains explicitly:

```text
brain_sync_status({ "brain_id": "ai-brain-jem" })
brain_sync_status({ "brain_id": "ers-brain" })
```

10. Start a fresh Codex chat/session last and verify the hosted Brain tool list is current there too. Do not use an already-open Codex thread as the source of truth for post-reinstall tool discovery.

This browser/workspace delete-and-recreate flow restored ChatGPT Business ERS on 2026-06-24 after reconnect attempts failed with `Authorization failed`; a later fresh Codex session then saw the full hosted Brain tool surface. By contrast, Claude account reconnects were straightforward and did not require deleting the connector.

OpenAI account cutover verification passed on 2026-06-16 for both ERS and personal ChatGPT accounts:

- `brain_id`: `ai-brain-jem`;
- provider: `revision`;
- hosted file count: 51;
- open conflicts: 0;
- latest cursor: `2026-06-16T11:05:57.337Z`.

Claude account cutover verification passed on 2026-06-17 for both the personal Max account and the ERS account. This is John-only, user-scope access to hosted Brain; it is not an ERS team rollout. The original verifications used `ai-brain-jem` with the hosted/revision provider, hosted file count `52` or higher, open conflicts `0`, and no Brain file contents printed during the smoke.

On 2026-06-24 the hosted registry was expanded for the John-only ERS Brain pilot. `ers-brain` is seeded into Supabase revisions and private source/artifact storage, but it remains John-only pilot traffic until hosted client smoke and the ERS local sync LaunchAgent are verified. See [`docs/ers-brain-hosted-pilot.md`](ers-brain-hosted-pilot.md).

## Claude Client Cutover

Claude has been cut over so the default `brain` MCP connector points at hosted across local Claude Code surfaces, and the Claude personal Max and ERS custom connectors have been activated and verified for John's personal use. The naming convention matches Codex: hosted is the default `brain`, local stdio is retained as `brain-local`.

> **Tenancy — single-user / multi-Brain pilot (important).** The hosted runtime is still **single-user**: John is the only authorized user, and access is gated by GitHub OAuth plus the hosted registry. It now serves `ai-brain-jem` and the John-only pilot `ers-brain`. This is **not** ERS team access. When adding the connector in the **ERS Teams** account, add it at **user/personal scope, not org/workspace-wide**, so it is not surfaced to other ERS users. The ERS-owned Supabase / dedicated ERS MCP fork remains required before production or multi-user ERS rollout.

When more than one Brain is visible, pass `brain_id` explicitly. Use `ai-brain-jem` for JEM/personal context and `ers-brain` for ERS Brain work.

### Claude Code (`~/.claude.json`, top-level `mcpServers`)

```json
{
  "brain": {
    "type": "http",
    "url": "https://jem-brain-mcp.fly.dev/mcp"
  },
  "brain-local": {
    "type": "stdio",
    "command": "node",
    "args": ["/Users/johnemilad/Projects/brain-mcp-server/dist/index.js"],
    "env": { "BRAIN_DIR": "/Users/johnemilad/Projects/ai-brain-jem/brain" }
  }
}
```

Allow-list in `~/.claude/settings.json` so `mcp__brain` tools never re-prompt: `mcp__brain__*` (hosted, default) and `mcp__brain-local__*` (fallback). Config changes load on the next Claude Code session.

#### Claude Code CLI stale-client recovery

The Claude Code CLI caches its own hosted-Brain OAuth Dynamic Client Registration separately from ChatGPT/Codex and from Claude Desktop/web. That cache can outlive a server-side OAuth-state migration, so a CLI surface that was never re-authorized after the June 2026 migration will fail even while every other surface works.

Symptom: the authorize page at `https://jem-brain-mcp.fly.dev/authorize?...` fails immediately with:

```text
Authorization failed
invalid_client: unknown client_id
```

The `client_id` in the failing URL is a stale registration the durable Postgres `clients` store no longer has. Re-running the in-session `authenticate` tool does not fix it — it reuses the same cached client. Confirm the server itself is healthy first (fresh DCR should succeed and metadata should resolve):

```bash
curl -sS -X POST https://jem-brain-mcp.fly.dev/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"probe","redirect_uris":["http://localhost:3118/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"response_types":["code"]}'
curl -sS https://jem-brain-mcp.fly.dev/.well-known/oauth-authorization-server
```

A `201` with a new `client_id` and a populated metadata document confirm the failure is client-side stale state, not a server outage.

Fix — force a fresh registration from the CLI:

1. Run `/mcp`, select `brain`.
2. **Disable** it, then **re-enable** it (this build's menu has no "Clear authentication" item; disable/enable is the equivalent reset). Re-enable triggers a fresh OAuth flow that registers a new `client_id` instead of reusing the stale one.
3. Complete the browser authorization. If the post-approval `http://localhost:<port>/callback?...` page fails to load, that is harmless — the tool completes the handshake on the callback.
4. If disable/enable alone does not force fresh registration, fully remove and re-add the connector (`claude mcp remove brain`, then re-add with `https://jem-brain-mcp.fly.dev/mcp`).

Verified 2026-07-05: disable/enable restored the Claude Code CLI `brain` connector after `invalid_client: unknown client_id`. Post-recovery read-only smoke via `brain_sync_status` — `ai-brain-jem` (revision, 34 files, 0 conflicts) and `ers-brain` (revision, 41 files, 0 conflicts). Unlike ChatGPT (which needs full delete/recreate), the CLI did not require removing the connector; the disable/enable cycle was sufficient.

### Claude Desktop / Cowork (`~/Library/Application Support/Claude/claude_desktop_config.json`)

**Important — Desktop does NOT accept the `{ "type": "http", "url": ... }` shape that Claude Code uses.** `claude_desktop_config.json` only loads local stdio (`command`) servers; a bare `type: http` entry is rejected with "Some MCP servers could not be loaded ... were skipped: brain". So the hosted Brain does **not** go in this file.

**Recommended (robust) — add hosted `brain` as a custom connector.** Use the app's **Settings -> Connectors -> Add custom connector** (Name `brain`, URL `https://jem-brain-mcp.fly.dev/mcp`, then GitHub OAuth). This is first-party (no `npx`/`mcp-remote` bridge, no PATH or package-drift risk), uses native in-app auth, and is **cloud-synced — one addition per account covers Desktop + web + mobile**. This is done for personal Max and ERS Teams at John/user scope only. Keep only `brain-local` (local stdio) in `claude_desktop_config.json` as the recovery fallback:

```json
{
  "brain-local": {
    "command": "node",
    "args": ["/Users/johnemilad/Projects/brain-mcp-server/dist/index.js"],
    "env": { "BRAIN_DIR": "/Users/johnemilad/Projects/ai-brain-jem/brain" }
  }
}
```

**Config-managed alternative (only if you want `brain` defined in the file rather than a connector)** — bridge the remote server through `mcp-remote` so it loads as a stdio command, keeping the `brain` name. This adds an `npx` + `mcp-remote` dependency and a separate token cache, and is local to this machine's Desktop only:

```json
{
  "brain": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://jem-brain-mcp.fly.dev/mcp"]
  }
}
```

Quit and reopen the Desktop app after editing the file. Cowork connectors are managed the same way through **Settings -> Connectors**, not this file.

### Claude web + mobile (custom connector, personal and ERS accounts)

Claude web and mobile share cloud-synced connectors per account. On current claude.ai builds, custom connectors live under **Customize -> Connectors** (`https://claude.ai/customize/connectors`), reached via the in-app "Connectors have moved to Customize" link in Settings — a direct deep-link can render a blank shell, so navigate from Settings. Add the hosted Brain once per account via **Customize -> Connectors -> Add custom connector**. Personal Max and ERS Teams are already activated and verified for John-only use:

```text
Name: brain
Remote MCP server URL: https://jem-brain-mcp.fly.dev/mcp
```

Authenticate through GitHub OAuth when prompted. Mobile inherits the connector from the same account, so no separate mobile step is required once the web connector is authorized. The hosted runtime allowlist controls access; loopback and the built-in Claude callback are accepted automatically. If mobile silently loses access while web/desktop still look configured, check the cockpit Operation Log for `hosted_mcp_auth` rows such as `invalid_grant`, `token_expired`, or `missing_bearer`; those indicate stale/disconnected client credentials and the practical fix is to disconnect/reconnect the connector under **Customize -> Connectors**. If Claude reports `invalid_redirect_uri` during connector creation, add the exact callback to the deployed allowlist and retry:

```bash
flyctl secrets set \
  MCP_OAUTH_ALLOWED_REDIRECT_URIS="<callback-from-error>" \
  --app jem-brain-mcp
```

### Claude account cutover verification

Run the read-only smoke from a Claude surface after authorizing (no Brain file contents printed):

```text
brain_sync_status({ "brain_id": "ai-brain-jem" })
brain_load_context({ "brain_id": "ai-brain-jem" })
```

Require: `brain_id` `ai-brain-jem`, provider `revision`, hosted file count `52` or higher, open conflicts `0`.

Status as of 2026-06-17:

- Claude personal Max: activated and verified.
- Claude ERS account: activated and verified, 2026-06-17 (provider `revision`, hosted files 52, open conflicts 0; PP slim v2026.06.17-1 deployed same day).

## Shadow Connector

For clients that still support multiple Brain connectors, hosted may remain registered as `brain-hosted` during testing. For Codex full cutover, hosted is now the default `brain` connector and local stdio is `brain-local`.

Codex `~/.codex/config.toml`:

```toml
[mcp_servers.brain-hosted]
url = "https://jem-brain-mcp.fly.dev/mcp"
oauth_resource = "https://jem-brain-mcp.fly.dev/mcp"
```

Claude Desktop `claude_desktop_config.json` (bridge remote servers through `mcp-remote` — Desktop rejects the bare `type: http` shape; see the Claude Client Cutover section above):

```json
{
  "mcpServers": {
    "brain-hosted": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://jem-brain-mcp.fly.dev/mcp"]
    }
  }
}
```

For Claude web/custom connectors, use:

```text
https://jem-brain-mcp.fly.dev/mcp
```

Authenticate through GitHub OAuth when prompted. The hosted runtime allowlist controls access.

## Rehearsal

This section remains the regression rehearsal before future client changes, OAuth changes, or deployment changes.

1. Run the readiness gate:

```bash
npm run hosted:test-drive
```

2. Add or enable `brain-hosted` in the target client.

3. Start a new client session so MCP config reloads.

4. Exercise hosted reads:

```text
brain_list_brains()
brain_describe({ "brain_id": "ai-brain-jem" })
brain_load_context({ "brain_id": "ai-brain-jem" })
brain_list_files({ "brain_id": "ai-brain-jem" })
brain_sync_status({ "brain_id": "ai-brain-jem" })
brain_read_file({ "brain_id": "ai-brain-jem", "filename": "NOW.md" })
brain_describe({ "brain_id": "ers-brain" })
brain_sync_status({ "brain_id": "ers-brain" })
brain_load_context({ "brain_id": "ers-brain" })
brain_list_sources({ "brain_id": "ers-brain" })
brain_lint({ "brain_id": "ers-brain" })
```

5. Exercise one narrow reviewed write against the intended Brain. Prefer the established JEM smoke file unless a real work update is already needed; for ERS, use an ERS-specific smoke file only after the ERS local sync LaunchAgent is running:

```text
brain_update_file({
  "brain_id": "ai-brain-jem",
  "filename": "HOSTED_OAUTH_WRITE_SMOKE.md",
  "mode": "append",
  "content": "\n- Hosted client rehearsal passed at <local timestamp>.\n"
})
```

6. Verify local mirror catch-up:

```bash
npm run hosted:doctor
```

Expected:

- `status` is `pass`;
- hosted file count and local tracked file count are stable;
- open conflicts are `0`;
- sync health is fresh;
- the local Markdown file contains the hosted write after the sync loop catches up.

## Watch Cockpit

During the client rehearsal, run:

```bash
npm run hosted:cockpit
```

Open:

```text
http://127.0.0.1:8787/
```

If port `8787` is already occupied, cockpit prints the next local port it selected, such as `http://127.0.0.1:8788/`.

Watch:

- overall doctor status;
- open conflicts;
- recent Brain activity;
- latest user-facing read/write/sync latency;
- sync health age and launchd status.

Cockpit is read-only and local-only. It should not be exposed publicly.

## Rollback

If hosted client rehearsal fails:

- keep local stdio `brain` as the active path;
- remove or disable `brain-hosted` from the client config;
- run `npm run hosted:doctor`;
- if conflicts are open, follow `docs/conflict-resolution.md`;
- if sync health is stale, restart or inspect the local sync daemon before trying hosted again.

Do not manually edit hosted database rows to hide a client rehearsal failure.

## Promote

Hosted `brain` is the promoted default for `ai-brain-jem` across **all** Claude (and Codex) surfaces — reads and writes. Local stdio `brain-local` is retained only as a deliberate break-glass fallback, and physically exists only where a local subprocess can run.

### Surface matrix

| Surface | Hosted `brain` | Local `brain-local` fallback |
|---|---|---|
| Claude Code (Mac) | default (reads + writes) | available — prompt-on-use |
| Claude Desktop / Cowork (Mac) | default (reads + writes) | available — needs-approval |
| Codex (Mac) | default | available as `brain-local` |
| Claude / ChatGPT web | default | not available (no local process) |
| Claude / ChatGPT mobile | default | not available |

### Ongoing operating rule

- **Hosted `brain` is the single primary path for normal use — all reads and all writes.** Route every Brain operation through it by default.
- **`brain-local` is break-glass only** — used deliberately when hosted is unreachable (offline, Fly/Supabase outage), and only on the Mac surfaces that can run it (Claude Code, Desktop, Codex). It is never the default and should not be the silent target of a write. Keep it available (not blocked) so it can still write during a hosted outage; a write made to local while hosted is down syncs up cleanly when hosted returns (hosted did not move meanwhile).
- Do **not** run independent writes through both paths in the same window — local Markdown is hosted's bidirectional sync mirror, so two concurrent writers can manufacture a "stale local block" conflict (no data loss; the system preserves both sides and records a conflict per `docs/conflict-resolution.md`).
- Any open conflict or stale sync health should pause hosted writes until reviewed.

To keep hosted the default in practice: in Claude Code, allow-list only `mcp__brain__*` (hosted) — leave `mcp__brain-local__*` un-allowed so local use prompts. In Claude Desktop, set the hosted `brain` connector tools to Allow and leave `brain-local` at Needs-approval.
