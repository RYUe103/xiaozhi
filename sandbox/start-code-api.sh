#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

export SANSUO_CODE_BACKEND="${SANSUO_CODE_BACKEND:-opensandbox}"
export SANSUO_OPENSANDBOX_BASE_URL="${SANSUO_OPENSANDBOX_BASE_URL:-http://127.0.0.1:8090/v1}"
export SANSUO_OPENSANDBOX_API_KEY="${SANSUO_OPENSANDBOX_API_KEY:-local-dev}"
export SANSUO_OPENSANDBOX_IMAGE="${SANSUO_OPENSANDBOX_IMAGE:-sansuo/opensandbox-office:latest}"
export SANSUO_SANDBOX_TIMEOUT_MS="${SANSUO_SANDBOX_TIMEOUT_MS:-900000}"
export SANSUO_SANDBOX_MEMORY="${SANSUO_SANDBOX_MEMORY:-2g}"
export SANSUO_SANDBOX_CPUS="${SANSUO_SANDBOX_CPUS:-2}"

while true; do
  node sandbox/code-api-server.js
  status=$?
  echo "SanSuo Code API exited with status ${status}; restarting in 2 seconds..." >&2
  sleep 2
done
