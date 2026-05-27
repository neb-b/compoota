#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${repo_dir}"

if [[ ! -f ".env" ]]; then
  echo "Missing .env. Copy .env.example to .env before restarting the house-server." >&2
  exit 1
fi

if command -v git >/dev/null 2>&1; then
  git fetch
  git pull --ff-only
else
  echo "git is required to update the house-server before restart." >&2
  exit 1
fi

docker_cmd=(docker)
if ! docker compose version >/dev/null 2>&1; then
  if sudo -n docker compose version >/dev/null 2>&1; then
    docker_cmd=(sudo docker)
  fi
fi

compose=("${docker_cmd[@]}" compose)
if ! "${compose[@]}" version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    compose=(docker-compose)
  elif sudo -n docker-compose version >/dev/null 2>&1; then
    compose=(sudo docker-compose)
  else
    echo "Docker Compose is required. Install docker compose or docker-compose." >&2
    exit 1
  fi
fi

if [[ "${1:-}" == "--tunnel" ]]; then
  "${compose[@]}" --profile tunnel up -d --build house-server cloudflared
else
  "${compose[@]}" up -d --build house-server
fi

"${compose[@]}" ps house-server
