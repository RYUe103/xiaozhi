#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

CONFIG_PATH="${SANSUO_OPENSANDBOX_CONFIG:-sandbox/opensandbox.local.toml}"

while true; do
  uvx opensandbox-server --config "${CONFIG_PATH}"
  status=$?
  echo "OpenSandbox server exited with status ${status}; restarting in 2 seconds..." >&2
  sleep 2
done
