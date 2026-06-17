# Hosted Brain Cockpit

**Status:** active operator guide
**Last updated:** 2026-06-17

Brain Cockpit is the local read-only operator surface for the hosted JEM Brain pilot. It is meant to answer one question quickly: can hosted Brain be trusted right now, or does John need to intervene before using it?

## Current Recommendation

Use a local browser surface backed by a macOS LaunchAgent:

- cockpit stays bound to `127.0.0.1`;
- the stable local URL is `http://127.0.0.1:8787/`;
- checks continue to come from `npm run hosted:doctor`;
- local sync health, launchd state, local mirror state, lint freshness, inbox state, and local latency snapshots remain visible;
- no Brain writes or conflict resolutions are exposed from the cockpit.

Do not build a hosted persistent admin website yet. A hosted website would be useful later, but today it would hide the most important local-first signals: whether the Mac sync loop is alive, whether the local Markdown mirror is current, whether local credentials are configured, and whether the operator's local state is stale.

## Generate The LaunchAgent

From the repo:

```bash
npm run hosted:cockpit:launchd:plist
```

This writes a reviewable plist to:

```text
tmp/com.jem.brain-cockpit.plist
```

The generated plist runs `scripts/hosted-cockpit.mjs` directly through an absolute Node path. It does not run through `npm`, shell aliases, or PATH-dependent wrappers. It sets `BRAIN_COCKPIT_PORT_FALLBACK=0` so the browser URL stays stable; if port `8787` is occupied, the service should fail visibly rather than silently move to a new URL.

The plist also sets a conservative runtime `PATH` including Homebrew locations so `hosted:doctor` can find operator tools such as `flyctl` when running under launchd's sparse default environment. Override with `BRAIN_COCKPIT_LAUNCHD_PATH` if the tool layout changes.

## Install On macOS

Review the generated plist first, then install it as a user LaunchAgent:

```bash
cp tmp/com.jem.brain-cockpit.plist ~/Library/LaunchAgents/com.jem.brain-cockpit.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jem.brain-cockpit.plist
launchctl kickstart -k "gui/$(id -u)/com.jem.brain-cockpit"
```

Then open:

```text
http://127.0.0.1:8787/
```

To stop it:

```bash
launchctl bootout "gui/$(id -u)/com.jem.brain-cockpit"
```

## Operator Contract

Green means hosted Brain is ready for normal use.

Warn means use judgement. Typical examples are stale sync health, stale or missing Brain lint, pending inbox files, missing optional Fly status, or no recent measured hosted MCP latency.

Fail means pause hosted writes until the issue is understood. Typical examples are hosted health failure, Postgres summary failure, or sync health error.

Open conflicts must be resolved through `docs/conflict-resolution.md`. Do not manually delete database rows to make the cockpit green.

## Next Hardening

- Add a one-click local launcher or browser bookmark artifact after the LaunchAgent path is stable.
- Expand source-ingestion nudges beyond pending inbox count.
- Add a recovery/reseed guide from local Markdown to hosted Postgres.
