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

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "${node_major}" -lt 20 ]]; then
  echo "Node 20+ is required. Current node: $(node --version)" >&2
  exit 1
fi

cd apps/server
npm run dev
