#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${repo_dir}"

if [[ ! -f ".env" ]]; then
  echo "Missing .env. Copy .env.example to .env and adjust local paths first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required for the house-server runtime." >&2
  exit 1
fi

cd apps/server
bun run dev
