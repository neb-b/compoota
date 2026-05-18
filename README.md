# Compoota

## What this is

Compoota is a small companion stack for a local house agent running on a Raspberry Pi. The mobile app talks only to the house-server on your LAN. The house-server can run in mock mode for setup, or call the private local agent when configured on the Pi.

The local agent is not exposed publicly.

## Current status

- Expo TypeScript mobile app
- Node/Fastify TypeScript server
- SQLite persistence
- Pairing-code device registration
- Long-lived device tokens
- Docker Compose deployment for 64-bit Raspberry Pi OS
- Optional Cloudflare Tunnel remote access

## Local development

Use Node.js 20 or newer for local development.

Server:

```sh
cd apps/server
npm install
npm run dev
```

Health check:

```sh
curl http://localhost:8787/health
```

Setup page:

```sh
open http://localhost:8787/setup
```

## Raspberry Pi deployment

LAN-only mode:

```sh
ssh pi@PI_IP
git clone repo
cd compoota
cp .env.example .env
# edit .env and set long random secrets
docker compose up -d --build
```

Use this server URL in the mobile app:

```txt
http://PI_IP:8787
```

Open setup on your LAN:

```txt
http://PI_IP:8787/setup
```

Remote access with Cloudflare Tunnel:

```sh
cp .env.example .env
# edit .env:
# CLOUDFLARE_TUNNEL_TOKEN=...
# PUBLIC_BASE_URL=https://hermes.compoota.com
# ALLOWED_ORIGINS=https://hermes.compoota.com
docker compose --profile tunnel up -d --build
```

In Cloudflare Tunnel, route the public hostname to the Compose service:

```txt
hermes.compoota.com -> http://house-server:8787
```

Use this server URL in the mobile app:

```txt
https://hermes.compoota.com
```

Optional live progress from the local agent:

```sh
mkdir -p ~/.hermes/plugins
cp -R plugins/compoota-progress ~/.hermes/plugins/compoota-progress
# add compoota-progress to plugins.enabled in ~/.hermes/config.yaml
# set HERMES_COMMAND_MODE=oneshot, HERMES_HOST_DIR=/home/neb/.hermes,
# and UV_PYTHON_HOST_DIR=/home/neb/.local/share/uv in .env
docker compose --profile tunnel up -d --build
```

## Mobile app setup

```sh
cd apps/mobile
npm install
npx expo start
```

Create a pairing code from the setup page, then enter:

- Server URL, for example `http://192.168.1.50:8787`
- Or remote Server URL, for example `https://hermes.compoota.com`
- Pairing code
- Device name

After pairing, the app saves the server URL, device ID, and device token locally.

You can also ask the running server to create a pairing code from the repo root:

```sh
./create-pairing-code.sh
```

The script reads `.env` and calls the running server API, so it does not write directly to SQLite.

## Security model

Setup endpoints require `Authorization: Bearer <HOUSE_SETUP_SECRET>`. Command endpoints require a long-lived device token created during pairing. Raw pairing codes and raw device tokens are not stored; the server stores hashes.

Pairing codes expire and are single-use. Devices can be revoked from `/setup`.

Cloudflare Tunnel gives HTTPS public reachability without router port forwarding. Only `house-server` is exposed; the local agent is not exposed directly. Setup actions still require `HOUSE_SETUP_SECRET`, and app commands require a paired device token.

CORS is permissive for LAN development when `ALLOWED_ORIGINS` is empty. Set `ALLOWED_ORIGINS` to the public HTTPS origin for remote mode. This is self-hosted auth, not enterprise auth.

## Not included yet

- Cloudflare Access, OAuth, accounts, or hosted auth providers
- Home Assistant integration
- MCP
- Push notifications or reminders
- Postgres, Redis, queues, Turborepo, or Nx
