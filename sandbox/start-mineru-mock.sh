#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

while true; do
  node sandbox/mineru-mock-server.js
  status=$?
  echo "SanSuo MinerU mock exited with status ${status}; restarting in 2 seconds..." >&2
  sleep 2
done
