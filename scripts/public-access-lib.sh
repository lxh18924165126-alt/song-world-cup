#!/usr/bin/env bash

find_project_node() {
  if [[ -n "${CODEX_NODE_BIN:-}" && -x "$CODEX_NODE_BIN" ]]; then
    printf '%s\n' "$CODEX_NODE_BIN"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  if command -v pnpm >/dev/null 2>&1; then
    local pnpm_bin candidate node_dir
    pnpm_bin="$(command -v pnpm)"
    node_dir="$(cd "$(dirname "$pnpm_bin")/../../node/bin" 2>/dev/null && pwd || true)"
    candidate="$node_dir/node"
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  fi
  return 1
}

is_port_open() {
  local port="$1"
  nc -z 127.0.0.1 "$port" >/dev/null 2>&1
}

choose_available_port() {
  local port="$1"
  while is_port_open "$port"; do
    port=$((port + 1))
  done
  printf '%s\n' "$port"
}

make_runtime_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  date +%s%N
}

extract_system_proxy() {
  local proxy_text="$1"
  local enabled host port
  enabled="$(printf '%s\n' "$proxy_text" | awk '/HTTPSEnable[[:space:]]*:/ {print $3; exit}')"
  host="$(printf '%s\n' "$proxy_text" | awk '/HTTPSProxy[[:space:]]*:/ {print $3; exit}')"
  port="$(printf '%s\n' "$proxy_text" | awk '/HTTPSPort[[:space:]]*:/ {print $3; exit}')"
  if [[ "$enabled" == "1" && -n "$host" && -n "$port" ]] && nc -z "$host" "$port" >/dev/null 2>&1; then
    printf 'http://%s:%s\n' "$host" "$port"
    return 0
  fi

  enabled="$(printf '%s\n' "$proxy_text" | awk '/HTTPEnable[[:space:]]*:/ {print $3; exit}')"
  host="$(printf '%s\n' "$proxy_text" | awk '/HTTPProxy[[:space:]]*:/ {print $3; exit}')"
  port="$(printf '%s\n' "$proxy_text" | awk '/HTTPPort[[:space:]]*:/ {print $3; exit}')"
  if [[ "$enabled" == "1" && -n "$host" && -n "$port" ]] && nc -z "$host" "$port" >/dev/null 2>&1; then
    printf 'http://%s:%s\n' "$host" "$port"
    return 0
  fi
  return 1
}

extract_pinggy_https_url() {
  local log_file="$1"
  grep -Eo 'https://[-a-zA-Z0-9.]+\.(run\.pinggy-free\.link|[-a-zA-Z0-9.]*pinggy\.link)' "$log_file" \
    | head -n 1 \
    || true
}

health_matches_boot() {
  local url="$1"
  local boot_id="$2"
  local proxy="${3:-}"
  local body
  if [[ -n "$proxy" ]]; then
    body="$(curl --proxy "$proxy" -fsS --max-time 12 -H 'X-Pinggy-No-Screen: 1' "$url" 2>/dev/null || true)"
  else
    body="$(curl --noproxy '*' -fsS --max-time 12 -H 'X-Pinggy-No-Screen: 1' "$url" 2>/dev/null || true)"
  fi
  printf '%s' "$body" | grep -Fq "\"ok\":true" \
    && printf '%s' "$body" | grep -Fq "\"bootId\":\"$boot_id\""
}

wait_for_local_proxy() {
  local health_url="$1"
  local boot_id="$2"
  local timeout="${3:-30}"
  local attempt
  for attempt in $(seq 1 "$timeout"); do
    if health_matches_boot "$health_url" "$boot_id"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_pinggy_ready() {
  local log_file="$1"
  local boot_id="$2"
  local timeout="${3:-90}"
  local proxy="${4:-}"
  local public_url=""
  local attempt
  for attempt in $(seq 1 "$timeout"); do
    if [[ -z "$public_url" ]]; then
      public_url="$(extract_pinggy_https_url "$log_file")"
    fi
    if [[ -n "$public_url" ]]; then
      if health_matches_boot "$public_url/__public-access/health" "$boot_id"; then
        printf '%s\n' "$public_url"
        return 0
      fi
      if [[ -n "$proxy" ]] && health_matches_boot "$public_url/__public-access/health" "$boot_id" "$proxy"; then
        printf '%s\n' "$public_url"
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}
