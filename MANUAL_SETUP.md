# Manual Setup Steps

These steps require human action in client UIs and cannot be automated by Claude or scripts.

---

## Claude Desktop — User Preferences

**Where:** Claude Desktop → Settings → Profile → User preferences

**Add this text:**

```
I maintain an AI Brain (personal knowledge system) accessible via MCP. At the start of each
conversation, load context by calling brain_load_context, then selectively load additional files
based on the task per the navigation table in the loader. Do not wait to be asked.
```

---

## claude.ai (Web) — User Preferences

**Where:** claude.ai → Settings → Profile → User preferences

**Add the same text as above.**

---

## Verification Checklist

After completing all setup (automated + manual), verify each client:

1. Start a new conversation
2. Claude should automatically call `brain_load_context` without being asked
3. Claude should reference your current priorities from NOW.md
4. Ask Claude to search for something in your Brain — it should use `brain_search`

If Claude doesn't auto-load, check that the user preference text was saved correctly.

---

## What's Already Automated

These are handled by the README setup and do not need manual action:

| Step | Where | Status |
|------|-------|--------|
| MCP server config | `~/.claude/settings.json` | Automated (JSON config) |
| Tool pre-authorisation | `~/.claude/settings.json` → `permissions.allow` | Automated (JSON config) |
| Auto-load directive (Claude Code / Cowork) | `~/.claude/CLAUDE.md` | Automated (file edit) |
| Auto-load directive (Claude Desktop / web) | User preferences UI | **Manual** |
