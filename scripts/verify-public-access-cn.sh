#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/public-access-lib.sh"

NODE_BIN="$(find_project_node)" || {
  printf '未找到 Node.js；可通过 CODEX_NODE_BIN 指定绝对路径。\n' >&2
  exit 1
}

DETECTED_PROXY="${TUNNEL_PROXY:-}"
if [[ -z "$DETECTED_PROXY" && "$(uname -s)" == "Darwin" ]] && command -v scutil >/dev/null 2>&1; then
  DETECTED_PROXY="$(extract_system_proxy "$(scutil --proxy 2>/dev/null || true)" || true)"
fi

if [[ -n "$DETECTED_PROXY" ]]; then
  HTTP_PROXY="$DETECTED_PROXY" HTTPS_PROXY="$DETECTED_PROXY" NO_PROXY="127.0.0.1,localhost,::1" \
    exec "$NODE_BIN" --use-env-proxy "$PROJECT_ROOT/scripts/public-access-cn-verify.mjs"
fi
exec "$NODE_BIN" "$PROJECT_ROOT/scripts/public-access-cn-verify.mjs"

