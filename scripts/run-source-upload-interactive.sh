#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BRAIN_REVISION_DATABASE_URL:-}" ]; then
  IFS= read -r -s -p "Paste BRAIN_REVISION_DATABASE_URL: " BRAIN_REVISION_DATABASE_URL
  echo
  export BRAIN_REVISION_DATABASE_URL
fi

if [ -z "${BRAIN_SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  IFS= read -r -s -p "Paste BRAIN_SUPABASE_SERVICE_ROLE_KEY: " BRAIN_SUPABASE_SERVICE_ROLE_KEY
  echo
  export BRAIN_SUPABASE_SERVICE_ROLE_KEY
fi

export BRAIN_SUPABASE_URL="${BRAIN_SUPABASE_URL:-https://omnwbcdtmtvxasgdmvwr.supabase.co}"
export BRAIN_SUPABASE_STORAGE_BUCKET="${BRAIN_SUPABASE_STORAGE_BUCKET:-brain-artifacts}"
export BRAIN_ARTIFACT_BYTE_ACCESS=admin

npm run sources:upload:postgres
