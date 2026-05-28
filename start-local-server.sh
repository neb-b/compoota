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

node_bin="${NODE_BIN:-node}"
node_major="$("${node_bin}" -p 'Number(process.versions.node.split(".")[0])')"
if [[ "${node_major}" -lt 20 ]]; then
  echo "Node 20+ is required. Current node: $("${node_bin}" --version)" >&2
  echo "Set NODE_BIN=/path/to/node if you have a newer Node outside PATH." >&2
  exit 1
fi

node_path="$(command -v "${node_bin}" || true)"
if [[ -n "${node_path}" ]]; then
  export PATH="$(dirname "${node_path}"):${PATH}"
fi

cd apps/server
npm run dev
