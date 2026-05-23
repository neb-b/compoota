#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${repo_dir}"

if [[ ! -f ".env" ]]; then
  echo "Missing .env. Copy .env.example to .env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${HOUSE_SETUP_SECRET:-}" ]]; then
  echo "HOUSE_SETUP_SECRET is missing from .env." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

server_url="${FEED_REFRESH_SERVER_URL:-http://127.0.0.1:${PORT:-8787}}"
server_url="${server_url%/}"

request() {
  local method="$1"
  local path="$2"
  curl --fail-with-body -sS \
    -X "${method}" \
    "${server_url}${path}" \
    -H "Authorization: Bearer ${HOUSE_SETUP_SECRET}" \
    -H "Content-Type: application/json" \
    -d "{}"
}

pretty_json() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

running_count() {
  if command -v jq >/dev/null 2>&1; then
    jq '[.runs[]? | select(.status == "running")] | length'
  else
    grep -o '"status":"running"\|"status": "running"' | wc -l | tr -d ' '
  fi
}

echo "== Feed status before refresh =="
request GET /setup/feed/status | pretty_json

echo
echo "== Triggering feed refresh =="
echo "This calls Hermes in oneshot mode, or deterministic sample data in mock mode."
request POST /setup/feed/refresh | pretty_json

echo
echo "== Waiting for running refreshes =="
for attempt in $(seq 1 36); do
  status_json="$(request GET /setup/feed/status)"
  count="$(printf '%s' "${status_json}" | running_count)"
  if [[ "${count}" == "0" ]]; then
    echo "No running feed refreshes remain."
    break
  fi
  echo "Still running (${count}); polling again in 10s... (${attempt}/36)"
  sleep 10
done

echo
echo "== Feed status after refresh =="
request GET /setup/feed/status | pretty_json

echo
echo "== Recent server logs =="
if [[ "${1:-}" == "--logs" ]] && docker compose ps house-server >/dev/null 2>&1; then
  docker compose logs --tail=80 house-server || echo "Could not read Docker logs. Try: sudo docker compose logs --tail=80 house-server"
elif [[ "${1:-}" == "--logs" ]] && sudo -n docker compose ps house-server >/dev/null 2>&1; then
  sudo docker compose logs --tail=80 house-server || true
elif [[ "${1:-}" == "--logs" ]] && command -v docker-compose >/dev/null 2>&1 && docker-compose ps house-server >/dev/null 2>&1; then
  docker-compose logs --tail=80 house-server || echo "Could not read Docker logs. Try: sudo docker-compose logs --tail=80 house-server"
elif [[ "${1:-}" == "--logs" ]] && command -v docker-compose >/dev/null 2>&1 && sudo -n docker-compose ps house-server >/dev/null 2>&1; then
  sudo docker-compose logs --tail=80 house-server || true
else
  echo "Skipping Docker logs. Run ./refresh-feed.sh --logs, or use sudo docker compose logs --tail=80 house-server."
fi
