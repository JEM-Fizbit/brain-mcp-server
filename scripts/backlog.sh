#!/usr/bin/env bash
# Lightweight backlog capture. See ai-knowledge/protocols/ROADMAP_AND_BACKLOG.md.
#
# Usage: scripts/backlog.sh <item text>
# Env:
#   BACKLOG_NO_COMMIT=1   stage the change but skip auto-commit
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repo" >&2
  exit 1
}
cd "$REPO_ROOT"

ITEM="$*"
if [ -z "$ITEM" ]; then
  echo "usage: backlog <item text>" >&2
  exit 1
fi

if [ ! -f BACKLOG.md ]; then
  echo "error: BACKLOG.md not found at repo root ($REPO_ROOT)" >&2
  exit 1
fi

SENTINEL="<!-- backlog items below; newest first -->"
if ! grep -qF "$SENTINEL" BACKLOG.md; then
  echo "error: sentinel marker missing from BACKLOG.md; cannot determine insertion point" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

awk -v item="- $ITEM" -v sentinel="$SENTINEL" '
  { print }
  $0 == sentinel && !done { print item; done=1 }
' BACKLOG.md > "$TMP"
mv "$TMP" BACKLOG.md
trap - EXIT

echo "added: $ITEM"

if [ "${BACKLOG_NO_COMMIT:-}" = "1" ]; then
  echo "(working tree only; BACKLOG_NO_COMMIT=1)"
  exit 0
fi

git add BACKLOG.md
if ! git commit -m "backlog: $ITEM" -q; then
  echo "warning: commit failed (likely a pre-commit hook). Item is staged in BACKLOG.md; resolve and re-run 'git commit' manually." >&2
  exit 0
fi
