# Fly Deployment

This is the Phase 2 hosted target for a single `ai-brain-jem` Brain. It gives remote MCP clients a public HTTPS URL while keeping the Brain repo, OAuth state, and semantic indexes on a persistent Fly volume.

## Shape

- App name: `jem-brain-mcp`
- Public base: `https://jem-brain-mcp.fly.dev`
- MCP endpoint: `https://jem-brain-mcp.fly.dev/mcp`
- GitHub OAuth callback: `https://jem-brain-mcp.fly.dev/authorize/github/callback`
- Persistent volume: `/data`
- Registry file: `/data/config/registry.json`
- OAuth state root: `/data/state`
- Brain working copy: `/data/brains/ai-brain-jem`

## Why Fly

The Brain server needs a git-capable Node runtime with durable filesystem state. Fly Volumes are mounted like ordinary directories and persist app state across deploys and restarts. For this Phase 2 deployment, run one Machine with one attached volume; Fly volumes are tied to a specific host and are not automatically replicated.

## One-Time Setup

Create or update a GitHub OAuth app for the hosted callback:

```text
Application name: Brain MCP Server
Homepage URL: https://jem-brain-mcp.fly.dev
Authorization callback URL: https://jem-brain-mcp.fly.dev/authorize/github/callback
Scopes requested by the server: read:user user:email
```

Create the Fly app and volume:

```bash
fly apps create jem-brain-mcp
fly volumes create brain_data --app jem-brain-mcp --region sin --size 10 --snapshot-retention 14
```

Set runtime secrets. Do not commit these values.

```bash
ssh-keygen -t ed25519 -C "brain-mcp-fly-deploy" -f /tmp/brain-mcp-fly-deploy-key -N ""
# Add /tmp/brain-mcp-fly-deploy-key.pub to JEM-Fizbit/ai-brain-jem as a read/write deploy key.

fly secrets set \
  MCP_OAUTH_SIGNING_SECRET="$(openssl rand -base64 48)" \
  GITHUB_OAUTH_CLIENT_ID="<hosted-github-oauth-client-id>" \
  GITHUB_OAUTH_CLIENT_SECRET="<hosted-github-oauth-client-secret>" \
  GITHUB_ALLOWED_LOGINS="JEM-Fizbit" \
  GITHUB_ALLOWED_EMAILS="johnemilad@hotmail.com" \
  BRAIN_DEPLOY_KEY="$(base64 -i /tmp/brain-mcp-fly-deploy-key)" \
  --app jem-brain-mcp
```

`BRAIN_DEPLOY_KEY` is mounted into the Machine with `[[files]]`; the container entrypoint copies it into `/root/.ssh/id_ed25519`, fixes permissions, and adds `github.com` to `known_hosts`.

## Volume Bootstrap

The volume must contain the Brain working copy and registry before hosted tool calls can work.

After the first deploy creates the Machine, open a shell:

```bash
fly ssh console --app jem-brain-mcp
```

Inside the Machine:

```bash
mkdir -p /data/brains /data/config /data/state

cd /data/brains
git clone git@github.com:JEM-Fizbit/ai-brain-jem.git ai-brain-jem
git -C ai-brain-jem config user.name "Brain MCP Server"
git -C ai-brain-jem config user.email "brain-mcp-server@users.noreply.github.com"
git -C ai-brain-jem config commit.gpgsign false
cat > /data/config/registry.json <<'JSON'
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
        "remote": "git@github.com:JEM-Fizbit/ai-brain-jem.git",
        "github_repo": "JEM-Fizbit/ai-brain-jem"
      },
      "vector_backend": "local-hash",
      "vector_scope": ["sources"],
      "metadata": {}
    }
  ],
  "principals": [
    {
      "provider": "github",
      "login": "JEM-Fizbit",
      "email": "johnemilad@hotmail.com",
      "roles": {
        "ai-brain-jem": "owner"
      }
    }
  ]
}
JSON
```

For private GitHub repo access, install an SSH deploy key or another host credential before cloning/pushing. The human GitHub OAuth token is only for identity; it is not used for repository access. Do not use laptop-only SSH host aliases such as `github-personal` inside the Fly Machine unless you also copy the matching SSH config.

## Deploy

```bash
npm test
fly deploy --app jem-brain-mcp
```

## Smoke Tests

```bash
curl -s https://jem-brain-mcp.fly.dev/health | jq .
curl -i https://jem-brain-mcp.fly.dev/.well-known/oauth-protected-resource/mcp
```

Then enroll a remote MCP client against:

```text
https://jem-brain-mcp.fly.dev/mcp
```

Expected first authenticated tool checks:

- `brain_list_brains`
- `brain_describe` with `brain_id=ai-brain-jem`
- `brain_load_context`

## Notes

- Keep `auto_stop_machines = "off"` for Phase 2. OAuth state and filesystem writes are simplest while one Machine stays warm.
- If the app name changes, update `app`, `MCP_OAUTH_PUBLIC_BASE`, and GitHub OAuth callback URL together.
- Add client callback URLs to `MCP_OAUTH_ALLOWED_REDIRECT_URIS` only when a client requires a non-loopback redirect that is not already trusted.
