# compoota Agent Notes

## Project Shape

compoota is a portable home-agent stack. The design goal is that a whole checkout can be moved to a Mac, Raspberry Pi, or small home server and run with minimal machine-global state.

Keep new infrastructure encapsulated inside this repository whenever practical:

- Use `.local/` for generated local runtime state, databases, media, Hermes home, virtualenvs, and caches.
- Do not require a developer's global `~/.hermes`, global Python environment, or global Node packages for normal local development.
- Prefer scripts that derive absolute paths from the repository root over hard-coded user paths.
- Keep Pi/home-server deployment values configurable through `.env`; do not bake hostnames, usernames, or secrets into source.
- Treat `.env` and `.local/` as disposable. They should be reproducible from tracked scripts/docs plus private credentials.

## Local Hermes

For Mac/local development, Hermes should live under:

```txt
.local/hermes
```

Run this from the repo root to create or refresh the local Hermes install and generate a local `.env` when needed:

```sh
./scripts/setup-local-hermes.sh
```

Run Hermes through the project wrapper so `HERMES_HOME`, working directory, and Python path are always project-local:

```sh
./scripts/hermes-local.sh status
./scripts/hermes-local.sh memory status
./scripts/hermes-local.sh -z "hello"
```

The house-server should use these local `.env` values when running on a Mac:

```txt
HERMES_COMMAND_MODE=oneshot
HERMES_HOME=<repo>/.local/hermes
HERMES_WORKING_DIRECTORY=<repo>/.local/hermes/hermes-agent
HERMES_PYTHON_PATH=<repo>/.local/hermes/hermes-agent/venv/bin/python
```

## Development

- Server code is in `apps/server`.
- Mobile app code is in `apps/mobile`.
- Shared operational scripts live at the repo root or in `scripts/`.
- Before finalizing server changes, run `npm run typecheck` in `apps/server` when feasible.
- Use `rg` for code search.

## Deployment Mindset

The Pi should be a target environment, not the only environment. If a task requires Pi-specific behavior, keep the Mac-local path working too, and document the difference in README or scripts.
