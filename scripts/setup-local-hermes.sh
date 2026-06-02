#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_dir="${repo_dir}/.local"
hermes_home="${local_dir}/hermes"
hermes_working_directory="${hermes_home}/hermes-agent"
venv_dir="${hermes_working_directory}/venv"
python_bin="${PYTHON_BIN:-python3}"
force_env="0"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/setup-local-hermes.sh [--force-env]

Creates a project-local Hermes install under .local/hermes and writes a local
.env when one does not exist. Use --force-env to regenerate .env with local
development paths.
USAGE
}

for arg in "$@"; do
  case "${arg}" in
    --force-env)
      force_env="1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "${local_dir}/media" "${local_dir}/uv" "${hermes_home}/plugins" "${hermes_home}/memories" "${hermes_working_directory}"

if [[ ! -x "${venv_dir}/bin/python" ]]; then
  "${python_bin}" -m venv "${venv_dir}"
fi

"${venv_dir}/bin/python" -m pip install --upgrade pip hermes-agent

rm -rf "${hermes_home}/plugins/compoota-progress"
cp -R "${repo_dir}/plugins/compoota-progress" "${hermes_home}/plugins/compoota-progress"

if [[ ! -f "${hermes_home}/config.yaml" ]]; then
  cat > "${hermes_home}/config.yaml" <<EOF
plugins:
  enabled:
  - compoota-progress
terminal:
  backend: local
  working_dir: ${repo_dir}
  timeout: 180
display:
  personality: helpful
  reasoning: false
compression:
  enabled: true
  threshold: 0.5
EOF
elif ! grep -q "compoota-progress" "${hermes_home}/config.yaml"; then
  cat <<EOF

Hermes config exists at ${hermes_home}/config.yaml.
Add compoota-progress to plugins.enabled if it is not already enabled:

plugins:
  enabled:
  - compoota-progress
EOF
fi

if [[ ! -f "${hermes_home}/SOUL.md" ]]; then
  cat > "${hermes_home}/SOUL.md" <<'EOF'
You are the local compoota house agent. Keep household memory practical, concise, and useful for future home, event, maintenance, and media workflows.
EOF
fi

if [[ "${force_env}" == "1" || ! -f "${repo_dir}/.env" ]]; then
  cat > "${repo_dir}/.env" <<EOF
PORT=8787
DATABASE_PATH=${local_dir}/house.db
MEDIA_STORAGE_DIRECTORY=${local_dir}/media

CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_PUBLIC_BASE_URL=
CLOUDFLARE_R2_KEY_PREFIX=compoota
CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS=3600

HOUSE_SETUP_SECRET=local-compoota-setup-secret
TOKEN_HASH_SECRET=local-compoota-token-secret
PAIRING_CODE_TTL_MINUTES=10

CLOUDFLARE_TUNNEL_TOKEN=
PUBLIC_BASE_URL=http://127.0.0.1:8787
PAIRING_CODE_SERVER_URL=http://127.0.0.1:8787
ALLOWED_ORIGINS=

HERMES_COMMAND_MODE=oneshot
HERMES_HOST_DIR=${hermes_home}
HERMES_CONTAINER_DIR=${hermes_home}
UV_PYTHON_HOST_DIR=${local_dir}/uv
UV_PYTHON_CONTAINER_DIR=${local_dir}/uv
HERMES_HOME=${hermes_home}
HERMES_WORKING_DIRECTORY=${hermes_working_directory}
HERMES_PYTHON_PATH=${venv_dir}/bin/python
HERMES_TIMEOUT_SECONDS=120

FEED_REFRESH_ENABLED=false
FEED_REFRESH_TIMEOUT_SECONDS=420
FEED_REFRESH_HOUR=5
FEED_MAX_ITEMS=30
FEED_DEFAULT_LOCATION="Saline, MI"
FEED_DEFAULT_RADIUS_MILES=30
FEED_INCLUSION_THRESHOLD=60
FEED_LOOKAHEAD_DAYS=90
EOF
fi

cat <<EOF
Local Hermes is ready.

Hermes home: ${hermes_home}
Hermes Python: ${venv_dir}/bin/python
Project env: ${repo_dir}/.env

Try:
  ./scripts/hermes-local.sh status
  ./scripts/hermes-local.sh memory status
  ./start-local-server.sh
EOF
