#!/usr/bin/env bash
# Unified read-only view of all open work across configured sources.
#
# Always shows:
#   1. BACKLOG.md items
#   2. In-flight specs in docs/specs/
#
# Optional (configure via .backlogrc at repo root):
#   3. Roadmap doc — open ⬜ rows grouped by phase (ROADMAP_PATH)
#   4. Audit docs matching glob — open items per file (AUDIT_GLOB)
#   5. Structured design docs — count-only ⬜ summary (STRUCTURED_DOCS array)
#
# Universal protocol: ~/Projects/ai-knowledge/protocols/ROADMAP_AND_BACKLOG.md
# Project glue lives in CLAUDE.md and (optionally) .backlogrc.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repo" >&2
  exit 1
}
cd "$REPO_ROOT"

# --- Defaults (overridden by .backlogrc if present) ---
ROADMAP_PATH=""
AUDIT_GLOB=""
STRUCTURED_DOCS=()

if [ -f .backlogrc ]; then
  # shellcheck source=/dev/null
  . ./.backlogrc
fi

section() { printf '\n=== %s ===\n' "$1"; }

# 1. BACKLOG.md (always)
section "BACKLOG.md items"
if [ -f BACKLOG.md ]; then
  awk '
    /<!-- backlog items below; newest first -->/ { flag=1; next }
    flag && /^- / { i++; print "  " i ". " substr($0, 3) }
    END { if (!i) print "  (empty)" }
  ' BACKLOG.md
else
  echo "  (BACKLOG.md not found)"
fi

# 2. Roadmap (optional)
if [ -n "$ROADMAP_PATH" ]; then
  if [ -f "$ROADMAP_PATH" ]; then
    section "$(basename "$ROADMAP_PATH") — open rows by phase"
    awk '
      /^## Phase [0-9]/ { phase=$0; printed_phase=0 }
      /^\| [0-9]+\.[0-9]+ \|.*⬜/ {
        if (!printed_phase) { print ""; print phase; printed_phase=1 }
        split($0, parts, "|")
        gsub(/^ +| +$/, "", parts[2]); gsub(/^ +| +$/, "", parts[3])
        gsub(/\*\*/, "", parts[3])
        print "  " parts[2] " — " parts[3]
      }
    ' "$ROADMAP_PATH"
  else
    section "$(basename "$ROADMAP_PATH") — open rows by phase"
    echo "  ($ROADMAP_PATH not found)"
  fi
fi

# 3. Audit docs (optional). Pattern matches dated audit docs by convention.
if [ -n "$AUDIT_GLOB" ]; then
  mapfile -t audits < <(compgen -G "$AUDIT_GLOB" 2>/dev/null || true)
  if [ ${#audits[@]} -eq 0 ]; then
    section "Audit docs"
    echo "  (no files match $AUDIT_GLOB)"
  else
    for audit in "${audits[@]}"; do
      section "$(basename "$audit") — open items"
      awk '
        /^### [0-9]+\./ { item=$0 }
        /\*\*Status:\*\* ⬜/ {
          sub(/^### /, "", item)
          print "  " item
          found=1
        }
        END { if (!found) print "  (none — all items resolved; consider archiving per protocol lifecycle rules)" }
      ' "$audit"
    done
  fi
fi

# 4. In-flight specs (always)
section "In-flight specs (docs/specs/)"
if [ -d docs/specs ]; then
  mapfile -t specs < <(find docs/specs -maxdepth 1 -name "*.md" ! -name "README.md" 2>/dev/null | sort)
  if [ ${#specs[@]} -eq 0 ]; then
    echo "  (none — no specs drafted yet)"
  else
    for f in "${specs[@]}"; do
      title=$(head -1 "$f" | sed 's/^# //')
      status=$(grep -m1 "^\*\*Status:\*\*" "$f" 2>/dev/null | sed 's/\*\*Status:\*\* //' || echo "(no status)")
      [ -z "$status" ] && status="(no status)"
      echo "  $f — $title — $status"
    done
  fi
else
  echo "  (docs/specs/ not found)"
fi

# 5. Structured design docs (optional, count-only)
if [ ${#STRUCTURED_DOCS[@]} -gt 0 ]; then
  section "Structured design docs (count of ⬜; scan manually if relevant)"
  for f in "${STRUCTURED_DOCS[@]}"; do
    if [ -f "$f" ]; then
      count=$(grep -c "⬜" "$f" 2>/dev/null || true)
      : "${count:=0}"
      printf '  %s: ⬜ count = %s\n' "$(basename "$f")" "$count"
    fi
  done
fi

echo
