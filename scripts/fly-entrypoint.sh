#!/bin/sh
set -eu

if [ "${TRANSPORT:-}" = "http" ]; then
  if [ -z "${BRAIN_PLATFORM_CONFIG:-}" ] || [ ! -f "$BRAIN_PLATFORM_CONFIG" ]; then
    echo "BRAIN_PLATFORM_CONFIG must reference an existing file when TRANSPORT=http" >&2
    exit 1
  fi
fi

exec "$@"
