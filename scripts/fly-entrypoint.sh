#!/bin/sh
set -eu

mkdir -p /root/.ssh
chmod 700 /root/.ssh

if [ -f /run/secrets/brain_deploy_key ]; then
  cp /run/secrets/brain_deploy_key /root/.ssh/id_ed25519
  chmod 600 /root/.ssh/id_ed25519
fi

ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null || true

exec "$@"
