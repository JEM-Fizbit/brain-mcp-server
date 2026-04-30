# Manual Setup Steps

These steps require human action in client UIs and cannot be automated by Claude or scripts.

---

## Claude Desktop / claude.ai — User Preferences

**Where:** Settings → Profile → User preferences

**Add this text** (append to any existing preferences):

```
I prefer communication that is clear, concise, objective and evidence-based. Don't just agree with me to be agreeable; it's more important to be intellectually grounded.

I maintain an AI Brain (personal knowledge system) accessible via MCP. Load it when the conversation benefits from personal context — skip it for generic tasks.

Load Brain context proactively (don't wait to be asked) when:
- Writing on my behalf (emails, posts, bios, articles)
- Career, job search, applications, or professional positioning
- Work or company context (your employer, current role, ongoing initiatives)
- My software projects
- Strategy, advice, or decisions requiring my background
- Anything requiring my voice, preferences, expertise, or personal context
- I reference "my Brain," "my context," or ask you to load it

Skip Brain loading when:
- Generic technical questions with no personal dimension
- General knowledge or research
- Pure coding help on unfamiliar codebases
- I explicitly say not to load it

Load sequence (when loading):
1. Fetch tools (if deferred):
ToolSearch(query="select:mcp__brain__brain_load_context,mcp__brain__brain_read_file,mcp__brain__brain_search,mcp__brain__brain_list_files,mcp__brain__brain_list_sources,mcp__brain__brain_update_file,mcp__brain__brain_commit,mcp__brain__brain_log,mcp__brain__brain_read_log,mcp__brain__brain_lint,mcp__brain__brain_ingest,mcp__brain__brain_ingest_complete,mcp__brain__brain_scan_inbox")
2. Call brain_load_context (returns loader navigation table + current priorities + nudges for overdue lint or pending inbox files)
3. Call brain_read_file for task-relevant files per the navigation table
4. If brain_load_context flags a lint nudge, run brain_lint before accuracy-sensitive work

Reading source archives:
- brain_read_file and brain_search accept a `scope` parameter: "brain" (default, vault only), "sources" (source archives only), or "all" (both; search only).
- Use scope="sources" or "all" when the brain vault pointer references a source file, or when you need the full original document (bio variants, CVs, meeting notes, etc.).
- Use brain_list_sources to enumerate available source files by category.

Ingestion and inbox protocols are documented in the Brain loader (00_loader.md) — follow the checklist items there.
```

---

## Why This Is Manual

Claude Desktop and claude.ai read user preferences from their respective settings UIs, not from `~/.claude/CLAUDE.md`. There is no file-based or API-based way to set these preferences — they must be entered through the UI.

Claude Code and Cowork read `~/.claude/CLAUDE.md`, which is already configured automatically (see README Step 2).

---

## Verification Checklist

After completing all setup (automated + manual), test with two conversations:

**Test 1 — Should load Brain:**
1. Start a new conversation
2. Ask: "Help me draft a LinkedIn post about AI in biotech"
3. Claude should automatically fetch Brain tools and call `brain_load_context`
4. Claude should reference your writing voice and expertise from Brain files

**Test 2 — Should NOT load Brain:**
1. Start a new conversation
2. Ask: "What's the difference between TCP and UDP?"
3. Claude should answer directly without loading Brain context

---

## What's Already Automated

These are handled by the README setup and do not need manual action:

| Step | Where | Status |
|------|-------|--------|
| MCP server config | `~/.claude/settings.json` | Automated (JSON config) |
| Tool pre-authorisation | `~/.claude/settings.json` → `permissions.allow` | Automated (JSON config) |
| Conditional auto-load directive (Claude Code / Cowork) | `~/.claude/CLAUDE.md` | Automated (file edit) |
| Conditional auto-load directive (Claude Desktop / web) | User preferences UI | **Manual** |
