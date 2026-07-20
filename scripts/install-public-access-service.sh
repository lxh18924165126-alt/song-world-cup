#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/public-access-lib.sh"

NODE_BIN="$(find_project_node)" || {
  printf '未找到 Node.js；可通过 CODEX_NODE_BIN 指定绝对路径。\n' >&2
  exit 1
}

exec "$NODE_BIN" "$PROJECT_ROOT/scripts/public-access-service.mjs"
