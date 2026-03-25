# Manual Setup Steps

These steps require human action in client UIs and cannot be automated by Claude or scripts.

---

## Claude Desktop / claude.ai — User Preferences

**Where:** Settings → Profile → User preferences

**Add this text** (append to any existing preferences):

```
I maintain an AI Brain (personal knowledge system) accessible via MCP. At the start of every
conversation, before responding to my first message, execute this sequence:

1. Fetch Brain tools: ToolSearch(query="select:mcp__brain__brain_load_context,mcp__brain__brain_read_file,mcp__brain__brain_search") — required because Brain tools may be deferred.
2. Load context: Call brain_load_context — returns the loader (navigation table) and NOW.md (current priorities).
3. Load task-specific files: Based on my request and the navigation table in the loader, call brain_read_file for relevant files.

Do not wait to be asked. Do not skip this. If Brain tools are already available (not deferred), skip step 1 and go straight to step 2.
```

---

## Why This Is Manual

Claude Desktop and claude.ai read user preferences from their respective settings UIs, not from `~/.claude/CLAUDE.md`. There is no file-based or API-based way to set these preferences — they must be entered through the UI.

Claude Code and Cowork read `~/.claude/CLAUDE.md`, which is already configured automatically (see README Step 2).

---

## Verification Checklist

After completing all setup (automated + manual), verify each client:

1. Start a **new** conversation (preferences don't hot-reload mid-session)
2. Claude should automatically fetch Brain tools and call `brain_load_context` before responding
3. Claude should reference your current priorities from NOW.md in its first response
4. Ask Claude to search for something in your Brain — it should use `brain_search`

If Claude doesn't auto-load, check:
- Was the preferences text saved? (Re-open settings and verify it's there)
- Did you start a **new** conversation? (Changes don't apply to existing sessions)
- Are the Brain MCP tools in the deferred tools list? (Check the system reminder)

---

## What's Already Automated

These are handled by the README setup and do not need manual action:

| Step | Where | Status |
|------|-------|--------|
| MCP server config | `~/.claude/settings.json` | Automated (JSON config) |
| Tool pre-authorisation | `~/.claude/settings.json` → `permissions.allow` | Automated (JSON config) |
| Auto-load directive (Claude Code / Cowork) | `~/.claude/CLAUDE.md` | Automated (file edit) |
| Auto-load directive (Claude Desktop / web) | User preferences UI | **Manual** |
