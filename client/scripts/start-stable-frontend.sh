#!/bin/zsh

set -euo pipefail

REPO_DIR="/Users/yooyoung/Documents/Codex/2026-05-12/files-mentioned-by-the-user-v58/LibreChat-main/client"
NODE_BIN="/Users/yooyoung/.nvm/versions/node/v24.14.1/bin/node"
SERVER_SCRIPT="$REPO_DIR/scripts/stable-frontend-server.mjs"

export PATH="/Users/yooyoung/.nvm/versions/node/v24.14.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export FRONTEND_HOST="127.0.0.1"
export FRONTEND_PORT="3095"
export BACKEND_HOST="127.0.0.1"
export BACKEND_PORT="3080"

cd "$REPO_DIR"

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

exec "$NODE_BIN" "$SERVER_SCRIPT"
