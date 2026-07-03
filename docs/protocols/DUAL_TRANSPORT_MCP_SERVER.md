# Protocol — Dual-Transport MCP Server (stdio local fallback + hosted HTTP default)

> Reusable pattern for running one MCP tool registry over two transports — local stdio (fast, filesystem-backed, zero network dependency) and hosted HTTP (multi-client, durable, promoted default) — from the same codebase, with an explicit promotion gate and a permanent named fallback rather than a one-way local→hosted migration.

**Applies to:** Any MCP server that starts as a personal local stdio tool and later needs multi-client/remote reach, but where the local path remains valuable (recovery, offline work, zero-dependency debugging) rather than being fully retired.
**Last Updated:** 2026-07-03
**Version:** 1.0
**Reference implementation:** `~/Projects/brain-mcp-server/` — `src/index.ts` (transport switch), `src/mcp-server.ts` (shared tool registry), `src/services/active-brain-store.ts` (storage-backend selection), `docs/hosted-client-cutover.md` (promotion runbook).

---

## When to use this pattern

You're building an MCP server that:

- started (or could start) as a single-user local stdio tool, where local filesystem access is fast and requires no network/auth setup;
- needs to grow into a remote-reachable, multi-client, or multi-user service (see [`REMOTE_MCP_SERVICE_PATTERN.md`](REMOTE_MCP_SERVICE_PATTERN.md) for the OAuth/transport mechanics of that hosted side);
- should **keep the local path alive** as a fast/offline/recovery fallback rather than deprecating it once hosted ships — local stdio has no network dependency, no OAuth flow, and is the only path that still works if the hosted service is down or mid-incident.

**Don't use this pattern** if the local path has no ongoing value once hosted ships (e.g. a pure ops-notification bot with no meaningful "local" mode) — just build [`REMOTE_MCP_SERVICE_PATTERN.md`](REMOTE_MCP_SERVICE_PATTERN.md) directly and skip the dual-transport complexity.

---

## Core shape: one tool registry, two entry points

Keep exactly one function that builds the MCP server and registers every tool (e.g. `createBrainMcpServer()` → `registerAllTools(server)`). Both transports call it identically — do not fork the tool registry per transport. The entry point (`src/index.ts` equivalent) is a thin switch:

```ts
async function main(): Promise<void> {
  if (process.env.TRANSPORT === "http") {
    const { startHttpServer } = await import("./http/server.js");
    await startHttpServer(); // builds the server via the same createBrainMcpServer()
    return;
  }
  const server = createBrainMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

This guarantees tool behavior, schemas, and names never drift between the two deployment shapes — a tool added for hosted use is automatically available locally, and vice versa. The only thing that differs between transports is *how a request reaches the registry* (stdio subprocess vs. HTTP+OAuth) and *which storage backend the tool handlers write through* (see next section).

---

## Storage-backend abstraction — interface-segregate the substrate, not the tools

If the hosted side has a materially different data substrate than local (e.g. Postgres instead of the filesystem), don't let tool handlers branch on transport. Define one interface (e.g. `BrainStore`) that both a filesystem-backed implementation and a hosted/DB-backed implementation satisfy, and resolve the active implementation once, behind a single accessor function, driven by environment config:

```ts
export interface BrainStore { /* read/write/list operations tool handlers call */ }

class FilesystemBrainStore implements BrainStore { /* local fast path */ }
class RevisionBrainStore implements BrainStore { /* hosted Postgres-backed path */ }

// Resolved once per process, cached by config key so it survives repeated calls
// without repeatedly opening a new DB pool.
export function activeBrainStore(): BrainStore {
  const key = activeStoreCacheKey(); // derived from env config, not from transport
  if (cachedStore?.key === key) return cachedStore.store;
  const store = /* pick FilesystemBrainStore or RevisionBrainStore from env */;
  cachedStore = { key, store };
  return store;
}
```

Tool handlers call `activeBrainStore()` and never know or care which transport they're being invoked through. This is the piece that lets the same `registerAllTools()` call be transport-agnostic: the transport switch happens once at process entry, the storage switch happens once behind one accessor, and everything in between is shared code.

**Anti-pattern:** `if (isHosted) { ... } else { ... }` scattered across individual tool handlers. That's the tell that the storage abstraction boundary is in the wrong place — push the branch down into one factory function, not out across every handler.

---

## Client-side connector naming: promoted default + permanent named fallback

Once hosted is stable, promote it to the **default** connector name (e.g. `brain`) across every MCP client surface (Claude Code, Claude Desktop, Cowork, Codex, ChatGPT). Register the local stdio server under an explicit fallback name (e.g. `brain-local`) rather than removing it. This is a **permanent naming convention**, not a temporary migration artifact — keep both entries configured indefinitely:

```toml
# Codex example — hosted is the default `brain`, local stdio is the explicit fallback
[mcp_servers.brain]
url = "https://your-hosted-mcp.example/mcp"
oauth_resource = "https://your-hosted-mcp.example/mcp"

[mcp_servers.brain-local]
command = "node"
args = ["/path/to/dist/index.js"]
[mcp_servers.brain-local.env]
YOUR_LOCAL_DATA_DIR = "/path/to/local/data"
```

Why keep both forever rather than fully cutting over:
- **Zero-dependency debugging.** When something looks wrong through the hosted path, the first diagnostic move is "does this reproduce against `-local`?" — isolates hosted-specific bugs (OAuth, sync propagation, Postgres) from tool-logic bugs in one step.
- **Recovery path.** If the hosted service is down, mid-incident, or mid-migration, local stdio keeps working with no network dependency.
- **Fast local-filesystem-heavy work.** Even after promotion, bulk local file operations are often faster and simpler through the local path than round-tripping through hosted sync.

---

## Promotion gate — explicit criteria before flipping the default

Don't silently or gradually shift client config to hosted. Define and pass an explicit gate first, and document the date/result. Minimum bar (adapt names to your service):

- an automated end-to-end smoke/test-drive script passes same-day as the change being promoted;
- a real client can enroll (or reuse existing OAuth) without manual database intervention;
- hosted reads work for a representative sample of tools spanning read, list, and search operations;
- at least one hosted write round-trips back to the local mirror/source of truth (if the architecture has one) with zero unresolved conflicts after;
- a health/doctor check reports clean state after the write;
- local stdio remains configured and verified working as fallback — the gate promotes hosted to default, it does not retire local.

Record the gate result (date, timezone, metrics) in an operator runbook doc — this is what future incident response references to know when/whether hosted became authoritative and what "known good" looked like at cutover.

---

## Anti-patterns

- **Forking the tool registry per transport.** Guarantees drift the moment someone adds a tool and forgets the other copy. One `registerAllTools()`, called from both entry points.
- **Branching on transport inside tool handlers.** Push the storage-backend decision into one factory/accessor resolved from config, not scattered `if (isHosted)` checks.
- **Treating the local fallback as temporary migration scaffolding.** It's a permanent recovery/debugging path — don't plan to delete it once hosted looks stable. Removing it removes your only network-independent recovery route.
- **Flipping the client default to hosted without a documented gate.** "It seems to work" is not a promotion criterion; define the gate before the day you intend to cut over, so a failed promotion has a clear rollback (stay on local default) rather than an ambiguous partial state.
- **Reusing the transport env var to also select the storage backend.** Keep them orthogonal — `TRANSPORT=http` selects the entry point; a separate config value (e.g. `REVISION_STORE=postgres`) selects the storage backend. Coupling them prevents ever running HTTP transport against a filesystem backend (useful for local HTTP testing) or stdio against a hosted backend (useful for one-off hosted debugging from a local shell).

---

## Cross-references

- [`REMOTE_MCP_SERVICE_PATTERN.md`](REMOTE_MCP_SERVICE_PATTERN.md) — the OAuth 2.1 / transport mechanics of the hosted HTTP side this protocol assumes as one of its two transports.
- [`MCP_SERVER_OPERATIONAL_TELEMETRY.md`](MCP_SERVER_OPERATIONAL_TELEMETRY.md) — the `source`/`timingLayer` telemetry fields that let you distinguish hosted-server-observed timings from client-observed timings, which matters more once a service has two transports to measure.
- **Reference implementation:** `~/Projects/brain-mcp-server/` `docs/hosted-client-cutover.md` — the actual promotion-gate runbook and client-config recipe this protocol generalizes from.

---

## Version history

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-07-03 | Initial extraction from brain-mcp-server: shared tool-registry-over-two-transports shape, storage-backend interface segregation (`BrainStore` pattern) resolved once behind a cached accessor, promoted-default + permanent-named-fallback client convention (`brain` / `brain-local`), and the explicit promotion-gate checklist from `hosted-client-cutover.md`. |
