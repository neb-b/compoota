#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${repo_dir}/.env"

if [[ ! -f "${env_file}" ]]; then
  echo "Missing .env. Copy .env.example to .env and set HOUSE_SETUP_SECRET." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

if [[ -z "${HOUSE_SETUP_SECRET:-}" ]]; then
  echo "HOUSE_SETUP_SECRET is missing from .env." >&2
  exit 1
fi

server_url="${PAIRING_CODE_SERVER_URL:-http://127.0.0.1:${PORT:-8787}}"
server_url="${server_url%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to request a pairing code." >&2
  exit 1
fi

curl --fail-with-body -sS \
  -X POST "${server_url}/setup/pairing-code" \
  -H "Authorization: Bearer ${HOUSE_SETUP_SECRET}" \
  -H "Content-Type: application/json" \
  -d "{}"
echo
