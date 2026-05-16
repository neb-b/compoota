# Compoota Progress Plugin

Small Hermes plugin that lets the Compoota house-server show live progress in
the mobile chat.

The plugin listens to Hermes lifecycle hooks and writes JSONL events to the
path in `COMPOOTA_PROGRESS_FILE`. The house-server sets that variable for each
command run and streams the events to the app.

## Install On A Pi

From the Compoota repo:

```sh
mkdir -p ~/.hermes/plugins
cp -R plugins/compoota-progress ~/.hermes/plugins/compoota-progress
```

Enable it in `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - compoota-progress
```

Restart the house-server after installing:

```sh
systemctl --user restart compoota-house.service
```

The plugin is intentionally optional. If it is not installed, Compoota still
shows server-level progress and the final reply.
