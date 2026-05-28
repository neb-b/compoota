#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
label="${COMPOOTA_LAUNCH_LABEL:-compoota.house-server}"
node_bin="${NODE_BIN:-node}"
log_path="${repo_dir}/.local/house-server.log"

mkdir -p "${repo_dir}/.local"

launchctl remove "${label}" 2>/dev/null || true
launchctl submit -l "${label}" -- /bin/zsh -lc "cd '${repo_dir}' && NODE_BIN='${node_bin}' ./start-local-server.sh >> '${log_path}' 2>&1"

cat <<EOF
Started ${label}.

Health:
  curl http://127.0.0.1:8787/health

Logs:
  tail -f ${log_path}

Stop:
  launchctl remove ${label}
EOF
