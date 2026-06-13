# 001 - Brain Platform Phase 1+2

**Status:** in-progress
**Source:** BACKLOG.md line "Brain Platform Phase 1+2 (cloud, multi-tenant): HTTP transport + `BrainStore`/`BrainSemanticSearch` + `brain_id` + OAuth (GitHub IdP) + Tier 1 vector. Lift substrate from `~/Projects/slack-mcp-server/`. Kickoff: `~/Projects/claude-ops/plans/brain-platform/2026-06-13.md` -> spec `docs/specs/001-*`."
**Roadmap link:** `ai-brain-jem/docs/PLAN_brain_roadmap.md`, JEM Phase 1+2
**Decisions impact:** proposes the Phase 2 hosting target and locks the first GitHub IdP shape if approved
**Related:** `docs/brain-platform-kickoff-prompt.md`; `ai-brain-jem/docs/SPEC_brain_mcp_server.md`; `ai-brain-jem/docs/SPEC_brain_platform.md`

## Problem

`brain-mcp-server` is currently a single-Brain, stdio-only MCP server backed by local Markdown files at `BRAIN_DIR`. It works well for local Claude and Codex clients, but it cannot serve remote-only clients such as Claude mobile or ChatGPT Developer Mode, cannot route across Brains with one namespace, and has no hosted OAuth identity layer.

Phase 1+2 evolves this repo in place into the first hosted Brain Platform build for `ai-brain-jem`: keep stdio working, add HTTP MCP behind a flag, add `brain_id` and substrate abstractions, lift the proven OAuth 2.1/transport/state pattern from `~/Projects/slack-mcp-server`, swap Slack OTP for GitHub OAuth federation, and ship a read-only Tier 1 vector index over `sources/`.

This spec is the design gate. No implementation should start until John signs off on this draft.

## Acceptance Criteria

- stdio mode remains the default and preserves the existing 13 Brain tools and behavior for a single configured Brain.
- HTTP mode exposes `GET /health`, OAuth metadata endpoints, DCR, GitHub-backed `/authorize`, `/token`, and authenticated `POST /mcp`.
- OAuth behavior is lifted from `slack-mcp-server`: RFC 9728 protected-resource metadata, RFC 8414 auth-server metadata, RFC 7591 DCR, RFC 7636 PKCE S256, RFC 8707 audience binding, HS256 access tokens, refresh-token rotation, and `WWW-Authenticate` discovery on unauthenticated `/mcp`.
- GitHub federation authenticates the human, maps the GitHub principal to registry access, embeds stable identity claims in JWTs, and derives commit author identity from the authenticated request context.
- Every existing Brain tool accepts optional `brain_id`; single-Brain sessions resolve automatically, while ambiguous multi-Brain sessions return a clear "choose a Brain" error with accessible Brain IDs.
- `BrainStore` and `BrainSemanticSearch` interfaces exist, and current filesystem behavior is implemented through `FilesystemBrainStore`.
- Tier 1 semantic search indexes only `sources/` and exposes read-only retrieval. It must not auto-distill or mutate Brain Markdown.
- The deployed Phase 2 host uses a git-capable persistent filesystem runtime for Brain working copies. OAuth/state code remains runtime-agnostic enough to reuse the Cloudflare D1/KV pattern later.
- Build and test commands are documented and must pass before implementation sign-off: `npm run build` and `npm test`.

## Out of Scope

- Tier 2/3 Karpathy automation, Wiki Compiler, memory metabolism, and proactive reconciliation.
- Edge, ERS, federation mechanics, Postgres substrate, pgvector, and RLS.
- Multi-Brain provisioning UI. `brain_create` can be specified but does not need to ship in this Phase 1+2 window unless it is trivial after registry work.
- Cross-Brain search or lint. `scope="all"` remains within one `brain_id`.
- Replacing Markdown as the canonical Brain representation.
- Renaming existing files or generating variant filenames.

## Technical Constraints

- Current repo is TypeScript ESM, Node 22 compatible, with MCP SDK stdio transport in `src/index.ts`.
- Current service code imports `BRAIN_DIR` and `SOURCES_ROOT` directly. The implementation must move direct path resolution behind `FilesystemBrainStore` and a per-request `BrainContext`.
- Existing path safety must be preserved: no absolute paths, no `..`, Markdown-only Brain/source reads, and scoped roots for `brain/`, `sources/`, `inbox/`, and `working/`.
- Current tests import built files from `dist/`, so new tests should keep the same `npm test` flow: `npm run build && node --test`.
- OAuth/auth is a hard gate. A clean build is not sufficient; real client enrollment must be verified before Phase 2 is considered done.
- Large ingest payloads are already risky over stdio and become riskier over HTTP. Phase 1+2 must keep existing guidance and may defer upload-url/multipart support.

## Hosting Decision

Use an alternative first Brain host: a Node runtime with a persistent volume, with Fly.io as the initial target unless implementation discovery finds a blocker.

Do not mirror `slack-mcp-server`'s Cloudflare Workers + D1 deployment as the first Brain host. The Slack server has no filesystem-backed tenant content; Brain Phase 2 needs a git-capable runtime with persistent working copies, local SQLite/vector index files, outbound SSH to GitHub, and write serialization around a real repo. Cloudflare Workers + D1/KV remains the reference for OAuth state and an optional future edge deployment, but it is awkward as the primary filesystem-backed Brain host without adding Durable Objects/R2 or a separate git worker.

First-host target shape:

- Node HTTP server using the lifted runtime-agnostic router.
- Persistent volume mounted at a configurable root, for example `/data/brains`.
- Per-Brain working copy path from registry `storage_config.repo_path`.
- OAuth state stored via `FileStateProvider` on the same volume for the single-instance Phase 2 deployment.
- SQLite vector index stored beside the Brain working copy or under `/data/brain-platform/indexes/{brain_id}.sqlite`.
- Secrets provided by environment variables in the host runtime. Local development may use `.env` or macOS Keychain later, but implementation should not require Keychain.
- One running instance for Phase 2. Horizontal scaling is deferred until filesystem-backed multi-tenant load creates real pressure.

Cloudflare lift status:

- Lift OAuth, auth, router, state-provider interfaces, and tests.
- Port D1/KV provider only if it remains cheap after the Node path is working; otherwise document it as a Phase 2.5/Worker variant.
- Do not add `wrangler.toml` or Worker deployment files in Phase 1+2 unless John explicitly switches the hosting decision.

## File-By-File Lift Map

| Slack source | Brain target | Phase 1+2 action |
|---|---|---|
| `lib/crypto.js` | `src/http/crypto.ts` | Port to TypeScript. Required by JWT, PKCE, token IDs, and constant-time comparisons. Keep WebCrypto-friendly implementation. |
| `lib/oauth/config.js` | `src/oauth/config.ts` | Port and generalize names from Slack to Brain. Keep loopback redirect exception, resource normalization, scope validation, TTLs, issuer/resource construction, and signing-secret checks. |
| `lib/oauth/metadata.js` | `src/oauth/metadata.ts` | Port nearly unchanged. Update docs URLs and service names to Brain. |
| `lib/oauth/register.js` | `src/oauth/register.ts` | Port nearly unchanged. Keep DCR validation and `client_secret_basic`, `client_secret_post`, and `none`. |
| `lib/oauth/pkce.js` | `src/oauth/pkce.ts` | Port unchanged except types. |
| `lib/oauth/jwt.js` | `src/oauth/jwt.ts` | Port and rename identity-specific claims. Replace `slack_user_id` with generic provider claims such as `provider`, `provider_user_id`, `github_login`, `email`, and `name`. Keep HS256 for Phase 2. |
| `lib/oauth/authorize.js` | `src/oauth/authorize.ts` | Port request validation, fatal vs redirectable OAuth errors, and auth-code minting. Replace Slack email/OTP pages with GitHub redirect and callback handlers. |
| `lib/oauth/identity.js` | `src/oauth/github-identity.ts` | Replace with GitHub identity client. Resolve GitHub user ID/login/name/email, cache briefly, and map to registry principal. |
| `lib/oauth/otp.js` | none | Do not port. The GitHub OAuth callback replaces Slack-DM OTP proof. |
| `lib/oauth/token.js` | `src/oauth/token.ts` | Port authorization-code and refresh-token grants. Keep PKCE, audience binding, refresh rotation, and identity-claim backfill. Generalize stored fields away from Slack. |
| `lib/mcp-auth.js` | `src/http/mcp-auth.ts` | Port almost unchanged. Validate JWT bearer, issuer, expiry, and exact audience, then expose a Brain identity context. |
| `lib/router.js` | `src/http/router.ts` | Port the runtime-agnostic request/response shape. Remove Slack `/slack/actions` and `/slack/events`. Keep `/health`, well-known metadata, `/register`, `/authorize`, `/authorize/github/callback`, `/token`, and `/mcp`. |
| `lib/mcp.js` | `src/http/mcp.ts` | Port JSON-RPC dispatcher shape. Replace Slack tools with Brain tool definitions. Reuse shared Brain handlers so stdio and HTTP do not fork behavior. |
| `lib/state/provider.js` | `src/state/provider.ts` | Port interface. Stores needed now: `clients`, `auth_codes`, `refresh_tokens`, `sessions`, and optional `oauth_states`. |
| `lib/state/file.js` | `src/state/file.ts` | Port for local HTTP and first hosted Node/Fly deployment. Ensure atomic write and `consumeOnce` behavior remain covered by tests. |
| `lib/state/kv-d1.js` | `src/state/kv-d1.ts` | Defer unless Cloudflare is selected. Keep as known future port for Worker/D1 deployment because D1 is valuable for atomic OAuth stores. |
| `lib/secrets/provider.js` | `src/secrets/provider.ts` | Port interface. |
| `lib/secrets/workers.js` | `src/secrets/env.ts` | Use env-backed provider first. It covers Fly and local dev. Worker-specific env provider can be restored if Cloudflare is selected. |
| `lib/secrets/keychain.js` | `src/secrets/keychain.ts` | Optional local-development nicety only. Do not make it required for Phase 1+2. |
| `src/index.js` and `bin/serve.js` | `src/index.ts`, `src/http/server.ts`, optional `src/stdio.ts` | Preserve stdio default. Add transport selector: `TRANSPORT=stdio|http`. HTTP mode starts Node server and delegates to lifted router. |
| `migrations/0001_init.sql` | `migrations/oauth-state.sql` or none for Phase 2 | Not needed for file-state/Fly Phase 2. If D1 is ported, generalize columns from Slack identity to provider identity. |
| `wrangler.toml` | none | Do not port for the selected Node/Fly host. |

Slack-specific modules not to lift: `slack-client.js`, `slack-verify.js`, `approval-card.js`, `events.js`, `conversation.js`, `scope.js`, and Slack registration helpers. Their multi-user authorization lessons inform Brain registry access checks, but their Slack surfaces are out of scope.

## GitHub IdP Swap

The Brain server remains the MCP OAuth authorization server. GitHub is only the upstream identity provider used during `/authorize`.

### Endpoints

- `GET /authorize`: validate MCP OAuth request exactly like the Slack reference, store the original request in `sessions` or `oauth_states`, then redirect to GitHub.
- `GET /authorize/github/callback`: exchange GitHub `code`, fetch identity, check registry access, mint local MCP auth code, and redirect back to the MCP client `redirect_uri`.
- `POST /token`: unchanged MCP OAuth token exchange. The MCP client never receives the GitHub access token.

### GitHub Flow

1. MCP client starts OAuth using the advertised authorization endpoint.
2. Server validates DCR client, redirect URI, PKCE S256 challenge, requested scopes, and RFC 8707 `resource`.
3. Server creates an opaque state record with the validated MCP request fields and redirects to GitHub OAuth.
4. Callback verifies state, exchanges GitHub code, fetches user profile and verified email if available.
5. Server maps GitHub principal to Brain registry access.
6. Server writes a single-use MCP auth-code record with identity fields and redirects to the original MCP client callback.
7. `/token` consumes the MCP auth code, verifies PKCE, issues an audience-bound Brain access token, and stores a rotated refresh token.

### Required Secrets And Config

- `MCP_OAUTH_PUBLIC_BASE`: public HTTPS base, for example `https://brain.example.com`.
- `MCP_OAUTH_SIGNING_SECRET`: HS256 signing secret.
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_PATH`: default `/authorize/github/callback`.
- `GITHUB_ALLOWED_LOGINS`: comma-separated allowlist for Phase 2 JEM deployment.
- Optional later: `GITHUB_ALLOWED_ORGS`, `GITHUB_ALLOWED_EMAILS`, or a GitHub App installation mapping.

### GitHub Scopes

Use the minimum required GitHub scopes for identity:

- `read:user`
- `user:email`

Do not request `repo` in Phase 2. Filesystem git access should use the server's deploy key or SSH key, not the human's OAuth token. If later authorization needs org or repo membership, add that explicitly in a future spec or approved revision.

### JWT Identity Claims

Access tokens should carry stable provider identity at issue time so `/mcp` does not call GitHub on every tool call:

```json
{
  "iss": "https://brain.example.com",
  "aud": "https://brain.example.com/mcp",
  "sub": "github:123456",
  "client_id": "mcp_client_...",
  "scope": "mcp:tools",
  "provider": "github",
  "provider_user_id": "123456",
  "github_login": "johnemilad",
  "email": "john@example.com",
  "name": "John Milad",
  "iat": 0,
  "exp": 0,
  "jti": "..."
}
```

`sub` should be stable and provider-qualified. Email is useful for git attribution but should not be the primary identity key because GitHub email visibility can change.

### Commit Attribution

`brain_commit` in authenticated HTTP mode derives author from request identity:

- Prefer GitHub verified primary email plus display name.
- If no usable email is available, use GitHub noreply style based on login or provider user ID.
- Store/return the author identity used.
- stdio mode can preserve current git behavior because there is no authenticated HTTP principal.

## `brain_id` Schema Change

Add a common optional `brain_id` field to every existing tool schema. Single-Brain mode must not require callers to pass it.

```typescript
const BrainIdField = z.object({
  brain_id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,62}$/)
    .optional()
    .describe("Brain identifier. Optional when you have access to exactly one Brain."),
});
```

Apply this to:

- `brain_load_context`
- `brain_read_file`
- `brain_update_file`
- `brain_commit`
- `brain_list_files`
- `brain_list_sources`
- `brain_search`
- `brain_log`
- `brain_read_log`
- `brain_lint`
- `brain_ingest`
- `brain_ingest_complete`
- `brain_scan_inbox`

New registry tools specified for the platform:

- `brain_list_brains()`
- `brain_describe(brain_id)`
- `brain_create(...)` as deferred or admin-only unless implementation makes it cheap.

Recommended Phase 2 semantic-search tool:

- `brain_semantic_search(brain_id?, query, top_k?, scope="sources")`

Keep `brain_search` keyword behavior unchanged by default. A separate semantic tool has a clearer result shape and avoids surprising callers that expect substring search.

## Registry Schema

Use a config-file registry for Phase 1+2. Default path:

- `BRAIN_PLATFORM_CONFIG`
- fallback `~/.config/brain-platform/registry.json`
- stdio compatibility fallback auto-derived from `BRAIN_DIR`, `BRAIN_SOURCES_DIR`, and `BRAIN_GITHUB_REPO` if no registry file exists

Recommended registry shape:

```json
{
  "version": 1,
  "default_brain_id": "ai-brain-jem",
  "brains": [
    {
      "id": "ai-brain-jem",
      "type": "personal",
      "template_used": "personal",
      "integration_mode": "vertical",
      "storage_backend": "filesystem",
      "storage_config": {
        "repo_path": "/data/brains/ai-brain-jem",
        "brain_dir": "/data/brains/ai-brain-jem/brain",
        "sources_dir": "/data/brains/ai-brain-jem/sources",
        "inbox_dir": "/data/brains/ai-brain-jem/inbox",
        "remote": "git@github-personal:JEM-Fizbit/ai-brain-jem.git"
      },
      "vector_backend": "sqlite-vec",
      "vector_scope": ["sources"],
      "created_at": "2026-06-13T00:00:00Z",
      "metadata": {}
    }
  ],
  "principals": [
    {
      "provider": "github",
      "provider_user_id": "123456",
      "login": "johnemilad",
      "email": "john@example.com",
      "roles": {
        "ai-brain-jem": "owner"
      }
    }
  ]
}
```

Resolution order:

1. Explicit `brain_id`.
2. Session pin, if implemented later.
3. Single accessible Brain fallback.
4. `default_brain_id` only in unauthenticated stdio/single-user local mode.

If none resolve, return an MCP tool error listing accessible Brain IDs. No fuzzy matching.

## Interfaces

Every Brain service operation should receive a resolved context rather than importing global paths.

```typescript
export type BrainRole = "owner" | "admin" | "member" | "reader";

export interface BrainPrincipal {
  provider: "github" | "stdio" | "system";
  providerUserId: string;
  login?: string;
  email?: string;
  name?: string;
}

export interface BrainContext {
  brainId: string;
  role: BrainRole;
  principal: BrainPrincipal;
  store: BrainStore;
  semanticSearch?: BrainSemanticSearch;
}

export interface FileMetadata {
  name: string;
  lines: number;
  bytes: number;
  lastModified: Date;
  staleDays: number | null;
}

export interface SearchResult {
  filename: string;
  line: number;
  text: string;
  scope: "brain" | "sources";
}

export type WriteMode = "replace" | "append" | "patch";

export interface CommitResult {
  ref: string;
  filesChanged: number;
  pushed: boolean;
  authorIdentity: string;
}

export interface BrainStore {
  brainExists(brainId: string): Promise<boolean>;
  readFile(brainId: string, filename: string, scope?: "brain" | "sources"): Promise<string>;
  listFiles(brainId: string, scope?: "brain" | "sources"): Promise<FileMetadata[]>;
  listSources(brainId: string, category?: SourceCategory): Promise<string[]>;
  searchFiles(
    brainId: string,
    query: string,
    scope?: "brain" | "sources" | "all",
    maxResults?: number
  ): Promise<SearchResult[]>;
  writeFile(
    brainId: string,
    filename: string,
    content: string,
    mode: WriteMode,
    oldContent?: string
  ): Promise<void>;
  appendLog(brainId: string, opType: LogOpType, filesTouched: string[], summary: string): Promise<string>;
  readLog(brainId: string, limit?: number): Promise<string>;
  commit(brainId: string, message: string, authorIdentity: string, push?: boolean): Promise<CommitResult>;
}

export interface SemanticSearchResult {
  filename: string;
  chunkId: string;
  score: number;
  text: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface BrainSemanticSearch {
  index(brainId: string, scope: "sources"): Promise<{ indexed: number; skipped: number }>;
  search(brainId: string, query: string, scope: "sources", topK?: number): Promise<SemanticSearchResult[]>;
}
```

Implementation notes:

- `FilesystemBrainStore` owns root resolution and path traversal protection.
- `services/brain.ts`, `services/log.ts`, `services/lint.ts`, `services/ingest.ts`, `services/inbox.ts`, and `services/git.ts` should either become methods on the store or accept a `BrainContext`.
- Preserve current result wording where possible to avoid surprising existing clients.
- For stdio mode, synthesize a `stdio` principal and single default Brain context.
- For HTTP mode, derive principal and role from JWT plus registry.

## Tier 1 Vector Index

Tier 1 is read-only retrieval over `sources/`. It does not modify Brain Markdown and does not replace curated Brain files.

Recommended implementation:

- `src/semantic/provider.ts`: `EmbeddingProvider` interface.
- `src/semantic/openai.ts`: optional OpenAI-compatible embedding provider gated by env config.
- `src/semantic/fake.ts`: deterministic fake provider for tests.
- `src/semantic/sqlite.ts`: SQLite-backed vector index implementation.
- `src/semantic/chunk.ts`: Markdown chunking by heading and size budget.
- `src/tools/semantic.ts`: `brain_semantic_search`; optional admin-only `brain_semantic_index` if automatic startup indexing is not enough.

Indexing policy:

- Scope is always `sources`.
- Include only `.md` source files.
- Store source path, content hash, chunk ordinal, heading path, embedding model ID, indexed timestamp, and embedding vector.
- Re-index changed files by content hash.
- Leave missing or unembeddable files out and report `skipped`.
- Initial Phase 2 may build the index via CLI/admin tool rather than on every request.

Open implementation choice for sign-off: exact embedding provider and model. The spec intentionally keeps this pluggable so the server remains generic and testable.

## Implementation Sequence

1. Extract shared Brain handlers so stdio and HTTP can call the same service logic.
2. Add registry loading and `BrainContext` resolution with stdio fallback.
3. Introduce `BrainStore` and port current filesystem operations into `FilesystemBrainStore`.
4. Add `brain_id` to schemas and wire existing tools through context resolution.
5. Add HTTP server/router with unauthenticated local smoke path if useful, then protect `/mcp`.
6. Port OAuth metadata, DCR, PKCE, JWT, token, and state providers from Slack.
7. Add GitHub IdP `/authorize` redirect/callback and registry access mapping.
8. Add Tier 1 semantic index/search.
9. Add deployment config for selected Node host.
10. Run unit, integration, and real client verification before marking implementation complete.

## Test Plan

Unit coverage:

- Registry loads valid config, rejects duplicate Brain IDs, rejects invalid `brain_id`, and synthesizes stdio fallback from env vars.
- Context resolver handles explicit `brain_id`, single-Brain fallback, inaccessible Brain, and ambiguous multi-Brain error.
- Filesystem store preserves existing path traversal, source scope, list, search, append/replace/patch, log, lint, ingest, inbox, and git behaviors.
- OAuth DCR accepts allowed redirects, including RFC 8252 loopback redirects, and rejects unsafe redirects.
- PKCE S256 accepts valid verifier/challenge and rejects malformed or mismatched values.
- `/token` accepts omitted token-exchange `resource` when the auth code is already resource-bound, and rejects explicit resource mismatch.
- Refresh tokens rotate and cannot be reused.
- JWT verification rejects malformed, expired, wrong issuer, and wrong audience tokens.
- GitHub callback tests use mocked GitHub responses for happy path, denied login, missing verified email, bad state, and failed code exchange.
- HTTP MCP dispatcher handles `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`, invalid JSON-RPC, unknown tool, and missing required args.
- Semantic index uses fake embeddings to prove changed-file reindexing and deterministic top-K ranking.

Integration coverage:

- `POST /mcp` without auth returns 401 plus `WWW-Authenticate` with `resource_metadata`.
- Metadata endpoints advertise the selected issuer/resource/token/register endpoints.
- Synthetic OAuth flow completes DCR -> authorize callback fixture -> token -> authenticated `tools/list`.
- Authenticated `brain_read_file` and `brain_load_context` work over HTTP for `ai-brain-jem`.
- `brain_commit` in HTTP mode uses authenticated author identity.
- stdio `brain_load_context`, `brain_read_file`, `brain_search`, and `brain_lint` continue to work with no `brain_id` argument.

End-to-end client verification:

- Local stdio client: existing MCP Inspector or configured Claude/Codex stdio entry still works.
- Local HTTP client: Codex CLI or MCP Inspector connects to `http://127.0.0.1:<port>/mcp` and completes loopback OAuth.
- Deployed Claude connector: claude.ai custom connector enrolls via GitHub OAuth and can call `brain_load_context`.
- Claude mobile: inherited connector appears and can call a read-only Brain tool.
- Codex HTTP: configured remote MCP endpoint can authenticate and call at least `brain_list_files`.
- ChatGPT Developer Mode: if account access is available, enroll connector and run read-only smoke call. If unavailable, record as a manual outstanding check rather than silently passing.
- Real GitHub API smoke: dev/staging credentials exercise actual GitHub code exchange and user/email calls before production deploy.

## Data Files Touched

Spec-only phase:

- `docs/specs/001-brain-platform-phase-1-2.md`

Expected implementation phase:

- Source files under `src/`.
- Test files under `test/`.
- New deployment/config examples.
- Optional `migrations/` only if D1/KV path is selected.
- No Brain content files should be modified by platform implementation unless explicitly part of a manual end-to-end test.

## Verification Commands

Implementation must pass:

```bash
npm run build
npm test
```

For doc-only drafting, these commands are not required, but they must be cited in this spec and used before implementation completion.

## Assumptions

- John approves a Node/persistent-volume host such as Fly.io for the first Brain deployment, rather than Cloudflare Workers + D1 as the primary host.
- Phase 2 is single-Brain hosted for `ai-brain-jem`; multi-Brain filesystem hosting remains Phase 2.5 unless it falls out naturally from the registry work.
- GitHub OAuth is used only for identity federation, not for runtime repository access.
- The server uses an SSH deploy key or equivalent host secret for filesystem git operations.
- `brain_semantic_search` as a separate tool is acceptable; if John prefers extending `brain_search` instead, update this spec before implementation.
- Embedding provider/model selection remains open until implementation sign-off. The code should expose an interface and test with deterministic fake embeddings.
- ChatGPT Developer Mode access may not be available during automated verification; if not, the test plan should record that specific gap.
