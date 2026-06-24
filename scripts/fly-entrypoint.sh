#!/bin/sh
set -eu

DEFAULT_REGISTRY="/app/config/brain-platform.john-ers-pilot.json"
CONFIG_PATH="${BRAIN_PLATFORM_CONFIG:-/data/config/registry.json}"

if [ ! -f "$CONFIG_PATH" ] && [ -f "$DEFAULT_REGISTRY" ]; then
  mkdir -p "$(dirname "$CONFIG_PATH")"
  cp "$DEFAULT_REGISTRY" "$CONFIG_PATH"
fi

exec "$@"
