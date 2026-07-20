#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_ROOT/scripts/public-access-lib.sh"

PUBLIC_PROXY_HOST="${PUBLIC_PROXY_HOST:-127.0.0.1}"
PUBLIC_PROXY_PORT="${PUBLIC_PROXY_PORT:-8790}"
UPSTREAM_ORIGIN="${UPSTREAM_ORIGIN:-https://song-world-cup.baituola-song-world-cup.workers.dev}"
PUBLIC_READY_TIMEOUT="${PUBLIC_READY_TIMEOUT:-90}"
PUBLIC_ACCESS_STATE_DIR="${PUBLIC_ACCESS_STATE_DIR:-$PROJECT_ROOT/.public-access}"
PROXY_LOG="$PUBLIC_ACCESS_STATE_DIR/proxy.log"
PINGGY_LOG="$PUBLIC_ACCESS_STATE_DIR/pinggy.log"
PROXY_PID_FILE="$PUBLIC_ACCESS_STATE_DIR/proxy.pid"
TUNNEL_PID_FILE="$PUBLIC_ACCESS_STATE_DIR/tunnel.pid"
MANAGER_PID_FILE="$PUBLIC_ACCESS_STATE_DIR/manager.pid"
PUBLIC_URL_FILE="$PUBLIC_ACCESS_STATE_DIR/public-url.txt"
PROVIDER_FILE="$PUBLIC_ACCESS_STATE_DIR/provider.txt"
BOOT_ID_FILE="$PUBLIC_ACCESS_STATE_DIR/boot-id.txt"
KNOWN_HOSTS_FILE="$PUBLIC_ACCESS_STATE_DIR/known_hosts"
PROXY_PID=""
TUNNEL_PID=""

say() {
  printf '%s\n' "$*"
}

fail() {
  say "公网中转启动失败：$*" >&2
  exit 1
}

is_project_pid() {
  local pid="$1"
  local marker="$2"
  local command process_cwd=""
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$marker"* ]] || return 1
  if [[ "$command" == *"$PROJECT_ROOT"* ]]; then
    return 0
  fi
  if [[ -L "/proc/$pid/cwd" ]]; then
    process_cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  elif command -v lsof >/dev/null 2>&1; then
    process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  fi
  [[ "$process_cwd" == "$PROJECT_ROOT" ]]
}

stop_recorded_pid() {
  local pid_file="$1"
  local marker="$2"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1 && is_project_pid "$pid" "$marker"; then
    say "停止上一次本项目公网进程：PID $pid"
    kill "$pid" >/dev/null 2>&1 || true
    local attempt
    for attempt in $(seq 1 50); do
      kill -0 "$pid" >/dev/null 2>&1 || return 0
      sleep 0.1
    done
  fi
}

stop_current_processes() {
  if [[ -n "${TUNNEL_PID:-}" ]]; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${PROXY_PID:-}" ]]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -f "$MANAGER_PID_FILE" && "$(cat "$MANAGER_PID_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$MANAGER_PID_FILE" "$PROXY_PID_FILE" "$TUNNEL_PID_FILE"
    : >"$PUBLIC_URL_FILE"
    : >"$PROVIDER_FILE"
    : >"$BOOT_ID_FILE"
  fi
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

start_proxy() {
  local proxy="$1"
  local -a command
  command=("$NODE_BIN")
  if [[ -n "$proxy" ]]; then
    HTTP_PROXY="$proxy" HTTPS_PROXY="$proxy" NO_PROXY="127.0.0.1,localhost,::1" \
      PUBLIC_PROXY_HOST="$PUBLIC_PROXY_HOST" \
      PUBLIC_PROXY_PORT="$PUBLIC_PROXY_PORT" \
      PUBLIC_BOOT_ID="$PUBLIC_BOOT_ID" \
      UPSTREAM_ORIGIN="$UPSTREAM_ORIGIN" \
      "${command[@]}" "$PROJECT_ROOT/scripts/public-access-proxy.mjs" >"$PROXY_LOG" 2>&1 &
  else
    PUBLIC_PROXY_HOST="$PUBLIC_PROXY_HOST" \
      PUBLIC_PROXY_PORT="$PUBLIC_PROXY_PORT" \
      PUBLIC_BOOT_ID="$PUBLIC_BOOT_ID" \
      UPSTREAM_ORIGIN="$UPSTREAM_ORIGIN" \
      "${command[@]}" "$PROJECT_ROOT/scripts/public-access-proxy.mjs" >"$PROXY_LOG" 2>&1 &
  fi
  PROXY_PID=$!
  printf '%s\n' "$PROXY_PID" >"$PROXY_PID_FILE"
}

start_pinggy() {
  local proxy="$1"
  local -a command
  command=(
    ssh -T -p 443
    -o ExitOnForwardFailure=yes
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
    -o StrictHostKeyChecking=accept-new
    -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE"
  )
  if [[ -n "$proxy" ]]; then
    local proxy_address="${proxy#http://}"
    proxy_address="${proxy_address#https://}"
    command+=(-o "ProxyCommand=nc -X connect -x $proxy_address %h %p")
  fi
  command+=(-R "0:127.0.0.1:$PUBLIC_PROXY_PORT" free.pinggy.io)
  DISPLAY="song-world-cup-public-access" \
    SSH_ASKPASS="$PROJECT_ROOT/scripts/pinggy-askpass.sh" \
    SSH_ASKPASS_REQUIRE=force \
    "${command[@]}" </dev/null >"$PINGGY_LOG" 2>&1 &
  TUNNEL_PID=$!
  printf '%s\n' "$TUNNEL_PID" >"$TUNNEL_PID_FILE"
}

trap stop_current_processes EXIT
trap 'exit 0' INT TERM

mkdir -p "$PUBLIC_ACCESS_STATE_DIR"
touch "$KNOWN_HOSTS_FILE"
stop_recorded_pid "$MANAGER_PID_FILE" "start-public.sh"
stop_recorded_pid "$TUNNEL_PID_FILE" "free.pinggy.io"
stop_recorded_pid "$PROXY_PID_FILE" "public-access-proxy.mjs"
printf '%s\n' "$$" >"$MANAGER_PID_FILE"
: >"$PROXY_LOG"
: >"$PINGGY_LOG"
: >"$PUBLIC_URL_FILE"
: >"$PROVIDER_FILE"
: >"$BOOT_ID_FILE"

command -v curl >/dev/null 2>&1 || fail "未找到 curl。"
command -v nc >/dev/null 2>&1 || fail "未找到 nc。"
command -v ssh >/dev/null 2>&1 || fail "未找到 ssh。"

NODE_BIN="$(find_project_node)" || fail "未找到 Node.js；可通过 CODEX_NODE_BIN 指定绝对路径。"
PUBLIC_BOOT_ID="$(make_runtime_id)"
printf '%s\n' "$PUBLIC_BOOT_ID" >"$BOOT_ID_FILE"
PUBLIC_PROXY_PORT="$(choose_available_port "$PUBLIC_PROXY_PORT")"
DETECTED_PROXY="$(detect_proxy)"

say "启动生产站本机反向代理：http://$PUBLIC_PROXY_HOST:$PUBLIC_PROXY_PORT"
start_proxy "$DETECTED_PROXY"
if ! wait_for_local_proxy "http://$PUBLIC_PROXY_HOST:$PUBLIC_PROXY_PORT/__public-access/health" "$PUBLIC_BOOT_ID" 30; then
  tail -n 40 "$PROXY_LOG" >&2 || true
  fail "本机反向代理未通过生产上游健康检查。"
fi

say "启动 Pinggy HTTPS 反向隧道（SSH 443）..."
start_pinggy ""
if ! PUBLIC_URL="$(wait_for_pinggy_ready "$PINGGY_LOG" "$PUBLIC_BOOT_ID" "$PUBLIC_READY_TIMEOUT" "$DETECTED_PROXY")"; then
  kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  TUNNEL_PID=""
  if [[ -n "$DETECTED_PROXY" ]]; then
    say "Pinggy 直连未就绪，改用系统 HTTP CONNECT 代理重试..."
    : >"$PINGGY_LOG"
    start_pinggy "$DETECTED_PROXY"
    PUBLIC_URL="$(wait_for_pinggy_ready "$PINGGY_LOG" "$PUBLIC_BOOT_ID" "$PUBLIC_READY_TIMEOUT" "$DETECTED_PROXY")" \
      || { tail -n 60 "$PINGGY_LOG" >&2 || true; fail "Pinggy 公网健康检查失败。"; }
  else
    tail -n 60 "$PINGGY_LOG" >&2 || true
    fail "Pinggy 公网健康检查失败。"
  fi
fi

printf '%s\n' "$PUBLIC_URL" >"$PUBLIC_URL_FILE"
printf 'pinggy\n' >"$PROVIDER_FILE"

say ""
say "国内公网临时访问地址：$PUBLIC_URL"
say "公网健康检查：$PUBLIC_URL/__public-access/health"
say "上游生产站：$UPSTREAM_ORIGIN"
say "状态目录：$PUBLIC_ACCESS_STATE_DIR"
say "说明：免费 Pinggy 隧道约 60 分钟后失效；保持本终端、本机网络和代理持续运行。"
say "按 Ctrl+C 停止公网入口。"

while kill -0 "$PROXY_PID" >/dev/null 2>&1 && kill -0 "$TUNNEL_PID" >/dev/null 2>&1; do
  sleep 5
done

if ! kill -0 "$PROXY_PID" >/dev/null 2>&1; then
  tail -n 60 "$PROXY_LOG" >&2 || true
  fail "本机反向代理已退出。"
fi
tail -n 60 "$PINGGY_LOG" >&2 || true
fail "Pinggy 隧道已退出，请重新运行 pnpm public:start 获取新地址。"
