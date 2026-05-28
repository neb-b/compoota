#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hermes_home="${HERMES_HOME:-${repo_dir}/.local/hermes}"
hermes_working_directory="${HERMES_WORKING_DIRECTORY:-${hermes_home}/hermes-agent}"
hermes_python_path="${HERMES_PYTHON_PATH:-${hermes_working_directory}/venv/bin/python}"

if [[ ! -x "${hermes_python_path}" ]]; then
  echo "Hermes Python was not found at ${hermes_python_path}." >&2
  echo "Run ./scripts/setup-local-hermes.sh first." >&2
  exit 1
fi

export HERMES_HOME="${hermes_home}"
export HERMES_WORKING_DIRECTORY="${hermes_working_directory}"
export HERMES_PYTHON_PATH="${hermes_python_path}"
export HERMES_ENABLE_PROJECT_PLUGINS="${HERMES_ENABLE_PROJECT_PLUGINS:-1}"
export PATH="${hermes_working_directory}/venv/bin:${hermes_working_directory}/node_modules/.bin:${hermes_home}/node/bin:${PATH}"
export VIRTUAL_ENV="${hermes_working_directory}/venv"

cd "${repo_dir}"
exec "${hermes_python_path}" -m hermes_cli.main "$@"
