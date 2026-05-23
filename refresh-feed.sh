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
    node -e "let body=''; process.stdin.on('data', c => body += c); process.stdin.on('end', () => console.log(JSON.stringify(JSON.parse(body), null, 2)));"
  fi
}

echo "== Feed status before refresh =="
request GET /setup/feed/status | pretty_json

echo
echo "== Triggering feed refresh =="
echo "This calls Hermes in oneshot mode, or deterministic sample data in mock mode."
request POST /setup/feed/refresh | pretty_json

echo
echo "== Feed status after refresh =="
request GET /setup/feed/status | pretty_json

echo
echo "== Recent server logs =="
if docker compose ps house-server >/dev/null 2>&1; then
  docker compose logs --tail=80 house-server
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose logs --tail=80 house-server
else
  echo "Docker Compose not found; skipping logs."
fi
