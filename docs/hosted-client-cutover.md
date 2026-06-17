# Hosted Client Cutover Runbook

**Status:** active operator guide
**Last updated:** 2026-06-16

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

ChatGPT connectors are configured through ChatGPT settings rather than a local `~/.codex` file. Create the hosted Brain connector in ChatGPT with:

```text
Connector name: Brain
Description: Hosted JEM Brain MCP for personal context, Brain file reads/writes, sync status, source metadata, and maintenance nudges.
Connector URL: https://jem-brain-mcp.fly.dev/mcp
```

Use ChatGPT Settings -> Connectors -> Create. After creation, start a new ChatGPT conversation, add the Brain connector from the composer tools menu, authenticate through GitHub OAuth when prompted, and verify `brain_sync_status` reports the hosted/revision provider with open conflicts `0`.

ChatGPT may generate a connector-specific OAuth callback such as `https://chatgpt.com/connector/oauth/<id>` during creation. If ChatGPT reports `invalid_redirect_uri`, add that exact callback to the deployed allowlist and retry connector creation:

```bash
flyctl secrets set \
  MCP_OAUTH_ALLOWED_REDIRECT_URIS="https://chatgpt.com/connector/oauth/<id>" \
  --app jem-brain-mcp
```

The hosted Brain OAuth server accepts loopback redirects automatically, plus the built-in Claude callback, but remote ChatGPT callbacks must be explicitly allowlisted.

OpenAI account cutover verification passed on 2026-06-16 for both ERS and personal ChatGPT accounts:

- `brain_id`: `ai-brain-jem`;
- provider: `revision`;
- hosted file count: 51;
- open conflicts: 0;
- latest cursor: `2026-06-16T11:05:57.337Z`.

Next client target: deploy and verify hosted Brain on Claude surfaces for both personal and ERS accounts. Use the same sync verification payload and require hosted/revision provider, hosted file count `51` or higher, open conflicts `0`, and no Brain file contents printed during the smoke.

## Claude Client Cutover

Claude has been cut over so the default `brain` MCP connector points at hosted across all local Claude surfaces. The naming convention matches Codex: hosted is the default `brain`, local stdio is retained as `brain-local`.

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

### Claude Desktop / Cowork (`~/Library/Application Support/Claude/claude_desktop_config.json`)

Same rename — hosted as `brain` (`"type": "http"`), local stdio retained as `brain-local`. Restart the Desktop app to reload. Cowork connectors managed in the cloud are configured through **Settings -> Connectors** in the app, not this file; add the hosted Brain there as a custom connector using the web/custom connector URL below.

### Claude web + mobile (custom connector, personal and ERS accounts)

Claude web and mobile share cloud-synced connectors per account. On current claude.ai builds, custom connectors live under **Customize -> Connectors** (`https://claude.ai/customize/connectors`), reached via the in-app "Connectors have moved to Customize" link in Settings — a direct deep-link can render a blank shell, so navigate from Settings. Add the hosted Brain once per account (personal Max, ERS Teams) via **Customize -> Connectors -> Add custom connector**:

```text
Name: brain
Remote MCP server URL: https://jem-brain-mcp.fly.dev/mcp
```

Authenticate through GitHub OAuth when prompted. Mobile inherits the connector from the same account, so no separate mobile step is required once the web connector is authorized. The hosted runtime allowlist controls access; loopback and the built-in Claude callback are accepted automatically. If Claude reports `invalid_redirect_uri` during connector creation, add the exact callback to the deployed allowlist and retry:

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

## Shadow Connector

For clients that still support multiple Brain connectors, hosted may remain registered as `brain-hosted` during testing. For Codex full cutover, hosted is now the default `brain` connector and local stdio is `brain-local`.

Codex `~/.codex/config.toml`:

```toml
[mcp_servers.brain-hosted]
url = "https://jem-brain-mcp.fly.dev/mcp"
oauth_resource = "https://jem-brain-mcp.fly.dev/mcp"
```

Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "brain-hosted": {
      "type": "http",
      "url": "https://jem-brain-mcp.fly.dev/mcp"
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
```

5. Exercise one narrow reviewed write. Prefer the established smoke file unless a real work update is already needed:

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

Hosted has been promoted as the normal remote JEM path for `ai-brain-jem`.

Ongoing operating rule:

- local stdio `brain` remains available for local filesystem work and recovery;
- hosted `brain-hosted` is preferred for remote-only clients;
- any open conflict or stale sync health should pause hosted writes until reviewed.
