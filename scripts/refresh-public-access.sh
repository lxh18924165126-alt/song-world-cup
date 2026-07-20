#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/public-access-lib.sh"

PUBLIC_ACCESS_STATE_DIR="${PUBLIC_ACCESS_STATE_DIR:-$PROJECT_ROOT/.public-access}"
PUBLIC_REFRESH_TIMEOUT="${PUBLIC_REFRESH_TIMEOUT:-150}"
MANAGER_LOG="$PUBLIC_ACCESS_STATE_DIR/manager.log"
MANAGER_PID_FILE="$PUBLIC_ACCESS_STATE_DIR/manager.pid"
PUBLIC_URL_FILE="$PUBLIC_ACCESS_STATE_DIR/public-url.txt"
BOOT_ID_FILE="$PUBLIC_ACCESS_STATE_DIR/boot-id.txt"
LAUNCH_AGENT_LABEL="${PUBLIC_ACCESS_LAUNCH_AGENT_LABEL:-com.baituola.song-world-cup-public-access}"
LAUNCH_AGENT_TARGET="gui/$(id -u)/$LAUNCH_AGENT_LABEL"

fail() {
  printf '公网入口刷新失败：%s\n' "$*" >&2
  tail -n 80 "$MANAGER_LOG" >&2 2>/dev/null || true
  exit 1
}

detect_proxy() {
  if [[ -n "${TUNNEL_PROXY:-}" ]]; then
    printf '%s\n' "$TUNNEL_PROXY"
    return
  fi
  if command -v scutil >/dev/null 2>&1; then
    extract_system_proxy "$(scutil --proxy 2>/dev/null || true)" || true
  fi
}

[[ "$PUBLIC_REFRESH_TIMEOUT" =~ ^[0-9]+$ ]] && (( PUBLIC_REFRESH_TIMEOUT >= 1 )) \
  || fail "PUBLIC_REFRESH_TIMEOUT 必须是正整数。"

mkdir -p "$PUBLIC_ACCESS_STATE_DIR"
printf '\n[%s] 开始刷新公网入口\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" >>"$MANAGER_LOG"
command -v launchctl >/dev/null 2>&1 || fail "未找到 launchctl；该后台刷新命令仅支持 macOS。"
launchctl print "$LAUNCH_AGENT_TARGET" >/dev/null 2>&1 \
  || fail "公网 LaunchAgent 尚未安装，请先运行 pnpm public:service:install。"
LAUNCHED_MANAGER_PID="$(launchctl kickstart -k -p "$LAUNCH_AGENT_TARGET" 2>/dev/null | tr -d '[:space:]')"
[[ "$LAUNCHED_MANAGER_PID" =~ ^[0-9]+$ ]] || fail "LaunchAgent 未返回有效进程 PID。"
DETECTED_PROXY="$(detect_proxy)"

for attempt in $(seq 1 "$PUBLIC_REFRESH_TIMEOUT"); do
  if ! kill -0 "$LAUNCHED_MANAGER_PID" >/dev/null 2>&1; then
    fail "入口管理进程已提前退出。"
  fi

  CURRENT_MANAGER_PID="$(cat "$MANAGER_PID_FILE" 2>/dev/null || true)"
  PUBLIC_URL="$(cat "$PUBLIC_URL_FILE" 2>/dev/null || true)"
  PUBLIC_BOOT_ID="$(cat "$BOOT_ID_FILE" 2>/dev/null || true)"
  if [[ "$CURRENT_MANAGER_PID" == "$LAUNCHED_MANAGER_PID" && -n "$PUBLIC_URL" && -n "$PUBLIC_BOOT_ID" ]]; then
    HEALTH_URL="$PUBLIC_URL/__public-access/health"
    if health_matches_boot "$HEALTH_URL" "$PUBLIC_BOOT_ID" \
      || { [[ -n "$DETECTED_PROXY" ]] && health_matches_boot "$HEALTH_URL" "$PUBLIC_BOOT_ID" "$DETECTED_PROXY"; }; then
      printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
      printf 'PUBLIC_HEALTH_URL=%s\n' "$HEALTH_URL"
      printf 'PUBLIC_BOOT_ID=%s\n' "$PUBLIC_BOOT_ID"
      printf 'PUBLIC_MANAGER_PID=%s\n' "$CURRENT_MANAGER_PID"
      exit 0
    fi
  fi
  sleep 1
done

fail "等待新公网入口就绪超时（${PUBLIC_REFRESH_TIMEOUT} 秒）。"
