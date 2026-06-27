# Protocol — OpenAI MCP Connector Recovery

> Operator runbook for recovering ChatGPT and Codex custom MCP connectors after hosted MCP server updates, OAuth-state migrations, tool-surface changes, or redeploys. Captures the June 2026 hosted Brain recovery so the next pass starts from known failure modes instead of rediscovering them.

**Last Updated:** 2026-06-25
**Version:** 1.0
**Scope:** OpenAI ecosystem surfaces: ChatGPT personal, ChatGPT Business / workspace Apps, Codex desktop/app sessions, and Codex terminal / CLI.

---

## Hard-earned rule

OpenAI's MCP connector state is split across surfaces and is not reliably reset by "disconnect / reconnect".

When a hosted MCP update invalidates dynamic client registrations, refresh tokens, callback metadata, or tool snapshots, assume stale connector state until proven otherwise. Full app deletion and recreation is often the fastest correct path.

This is especially true when the server logs show `unknown_client_id`, `invalid_client`, `invalid_grant`, or a tool-surface mismatch after the user has already approved OAuth.

---

## Use when

Use this protocol when any OpenAI surface shows:

- `Authorization failed` after an MCP OAuth approval page;
- repeated OAuth prompts that end in failure;
- stale or missing MCP tools after a server redeploy;
- a connector that appears "connected" but cannot call tools;
- Codex seeing an old tool manifest after ChatGPT has been updated;
- `codex exec` reporting `user cancelled MCP tool call` for a read-only tool;
- server-side auth telemetry showing `unknown_client_id`, `invalid_client`, `invalid_grant`, or stale refresh-token failures.

Do not spend more than one short diagnostic loop on reconnect-only fixes if the server has recently changed OAuth state, DCR storage, redirect handling, or the tool list. Move to full delete/recreate.

---

## Preflight

Before touching clients, verify the server is actually healthy:

1. Check the service-specific health/doctor page or command.
2. Confirm the MCP URL is the intended production URL.
3. Confirm OAuth state is durable in the production store, not a disposable local file.
4. Check auth-failure telemetry for reason codes and affected client IDs.
5. Confirm whether the change was state-invalidating: OAuth store migration, signing-secret rotation, DCR client reset, callback handling change, tool manifest change, or app metadata change.

Never print or store access tokens, refresh tokens, authorization headers, client secrets, PKCE verifiers, request bodies, or tool payload content while debugging.

---

## Recovery order

Recover OpenAI browser/app surfaces first, Codex last.

Rationale: ChatGPT custom MCP apps and Codex can share OpenAI-side app connector state. A ChatGPT delete/recreate can force fresh Dynamic Client Registration and refresh Codex's eventual tool surface. If Codex is repaired first, an older ChatGPT connector can keep reintroducing stale state or confusing symptoms.

Recommended order:

1. ChatGPT personal account.
2. ChatGPT Business / workspace app.
3. Fresh ChatGPT verification chats.
4. Fresh Codex app/chat session.
5. Codex terminal / CLI.

Claude/Anthropic surfaces have separate connector state and should be verified separately. Do not use Claude success as proof that OpenAI surfaces are clean.

---

## ChatGPT personal recovery

Use a browser if the desktop app hides the relevant settings.

1. Open ChatGPT settings for the target personal account.
2. Find the custom MCP connector/app.
3. If the symptom is stale OAuth, stale tool list, or `Authorization failed`, delete/remove the connector. Do not merely disconnect.
4. Create a new custom MCP connector with the production MCP URL.
5. Complete OAuth through the MCP server's authorization page.
6. Start a fresh ChatGPT conversation.
7. Add/select the connector from the composer tools menu if needed.
8. Run the service-specific read-only smoke test.

Expected result: a real MCP tool call succeeds, and server telemetry shows no fresh `unknown_client_id` or `invalid_client` errors for the new connector.

---

## ChatGPT Business / workspace recovery

ChatGPT Business custom MCP apps may be managed only from the browser workspace settings, not from the desktop app and not only from the individual user's connector screen.

1. Open ChatGPT in a browser.
2. Switch to the target Business workspace.
3. Go to **Workspace settings -> Apps**.
4. Find the stale custom MCP app.
5. Disable it.
6. Delete/remove it from the workspace.
7. Create a new custom MCP app with the production MCP URL.
8. Complete OAuth as the intended identity.
9. After the workspace app exists, complete the separate final connection step in the individual user account in the browser.
10. Start a fresh ChatGPT conversation in that workspace.
11. Run the service-specific read-only smoke test.

Important: reconnecting the existing workspace app can preserve the stale Dynamic Client Registration `client_id`. Delete/recreate is the reliable reset.

---

## Codex app/chat recovery

After ChatGPT personal and/or workspace recovery:

1. Start a fresh Codex chat/session.
2. Verify the custom MCP connector appears with the expected current tool surface.
3. Do not trust an already-open Codex session as the source of truth after a server redeploy or connector reinstall.
4. If the tool list is incomplete, restart the Codex app/session and re-check tool discovery before changing the server.

Codex can lag because it has both local MCP configuration and OpenAI app-connector state. Treat old sessions as cached until a fresh session proves otherwise.

---

## Codex terminal / CLI recovery

The Codex CLI adds one more layer: local MCP config in `~/.codex/config.toml`, OAuth credentials, and persisted per-tool approvals.

Check local state:

```bash
codex mcp list --json
codex mcp get <server-name> --json
codex login status
codex doctor
```

If the CLI shows stale OAuth symptoms, reset only the affected MCP server:

```bash
/Applications/Codex.app/Contents/Resources/codex mcp logout <server-name>
/Applications/Codex.app/Contents/Resources/codex mcp login <server-name>
```

Then run one interactive terminal Codex session and approve the expected low-risk read-only smoke tool with **Always allow**. This matters because non-interactive `codex exec` has no approval UI; without persisted approval, a healthy OAuth setup can still fail as `user cancelled MCP tool call`.

Finally, run a service-specific hosted-only `codex exec --ephemeral --sandbox read-only ...` smoke. The smoke prompt should explicitly forbid local fallbacks and file edits.

Unrelated OAuth warnings for other MCP connectors are separate issues. Do not conflate them with the target MCP recovery.

---

## Verification matrix

For each OpenAI surface, record:

| Surface | Required proof |
| --- | --- |
| ChatGPT personal | Fresh conversation; connector selected; read-only smoke tool succeeds. |
| ChatGPT Business workspace | Fresh workspace conversation; workspace app recreated; individual connection complete; smoke succeeds. |
| Codex app/chat | Fresh session sees the current tool list; smoke succeeds through the hosted connector. |
| Codex CLI | `codex mcp get` points to the production URL; OAuth is fresh; read-only approval persisted; `codex exec` smoke succeeds. |
| Server telemetry | No fresh stale-client failures after the new connector's first successful call. |

For multi-brain or multi-tenant MCPs, verify every intended logical target explicitly. Do not infer that one target's success proves the others.

---

## Troubleshooting map

| Symptom | Likely cause | Fast path |
| --- | --- | --- |
| `Authorization failed` after approving OAuth | OpenAI broker still holds a stale DCR `client_id` | Delete/remove the app, recreate it, then re-OAuth. |
| `unknown_client_id` at `/token` | Client ID not present in durable `clients` store | Full connector/app removal and reinstall. |
| `invalid_grant` on refresh | Expired, rotated, or reset refresh token | Reauth; if repeated, delete/recreate. |
| Tools missing after redeploy | OpenAI app snapshot/session cached old tool list | Fresh chat/session; if still stale, delete/recreate app. |
| ChatGPT desktop has no management UI | Desktop app does not expose workspace app management cleanly | Use browser workspace settings. |
| Business account reconnect still fails | Individual reconnect did not recreate the workspace app's DCR client | Disable + delete at Workspace settings -> Apps, then create a new app. |
| Codex fresh chat works but `codex exec` fails | CLI lacks persisted tool approval | Run one interactive CLI session and choose Always allow for the smoke tool. |
| Codex shows stale tools | Existing session cached old manifest | Start a fresh Codex session after ChatGPT app recreation. |

---

## Documentation after recovery

For a state-invalidating MCP update, leave a short durable note in the service repo or operator runbook with:

- date and reason for the client recovery;
- surfaces reset and verified;
- whether delete/recreate was required;
- exact smoke tests used;
- expected tool count or tool families;
- any residual unrelated connector warnings;
- server-side auth reason codes observed, without secrets.

For architecture-level lessons about OAuth/DCR/state durability, update `REMOTE_MCP_SERVICE_PATTERN.md`. For service-specific endpoint, tool, and account details, update the service runbook.

---

## Related protocols and references

- [`REMOTE_MCP_SERVICE_PATTERN.md`](REMOTE_MCP_SERVICE_PATTERN.md) — architecture-level OAuth 2.1, DCR, durable state, and auth telemetry pattern.
- `~/Projects/brain-mcp-server/docs/hosted-client-cutover.md` — Brain-specific ChatGPT/Codex recovery commands and current verification matrix.
- `~/Projects/openai-ops/` — local OpenAI-side operational workspace for account-level settings, prompts, and snapshots.
- OpenAI Apps SDK auth docs: <https://developers.openai.com/apps-sdk/build/auth>
- OpenAI Developer Mode and MCP Apps help: <https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt>
- OpenAI Apps SDK deploy/submission docs: <https://developers.openai.com/apps-sdk/deploy/submission>
- OpenAI Codex plugins docs: <https://developers.openai.com/codex/plugins>

---

## Version history

| Version | Date | Changes |
| --- | --- | --- |
| 1.0 | 2026-06-25 | Initial protocol, extracted from hosted Brain recovery across ChatGPT personal, ChatGPT Business workspace, Codex app/chat, and Codex CLI. Captures delete/recreate over reconnect, ChatGPT-first/Codex-last ordering, workspace-app browser path, and Codex CLI approval-state requirements. |
