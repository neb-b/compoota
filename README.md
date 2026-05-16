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

```sh
ssh pi@PI_IP
git clone repo
cd compoota
cp .env.example .env
# edit .env and set long random secrets
docker compose up -d --build
```

Then open:

```txt
http://PI_IP:8787/setup
```

Optional live progress from the local agent:

```sh
mkdir -p ~/.hermes/plugins
cp -R plugins/compoota-progress ~/.hermes/plugins/compoota-progress
# add compoota-progress to plugins.enabled in ~/.hermes/config.yaml
systemctl --user restart compoota-house.service
```

## Mobile app setup

```sh
cd apps/mobile
npm install
npx expo start
```

Create a pairing code from the setup page, then enter:

- Server URL, for example `http://192.168.1.50:8787`
- Pairing code
- Device name

After pairing, the app saves the server URL, device ID, and device token locally.

## Security model

Setup endpoints require `Authorization: Bearer <HOUSE_SETUP_SECRET>`. Command endpoints require a long-lived device token created during pairing. Raw pairing codes and raw device tokens are not stored; the server stores hashes.

Pairing codes expire and are single-use. Devices can be revoked from `/setup`.

CORS is permissive for LAN development in this version. This is not production-grade multi-user auth.

## Not included yet

- Cloudflare Tunnel or remote access
- OAuth, accounts, or hosted auth providers
- Home Assistant integration
- MCP
- Push notifications or reminders
- Postgres, Redis, queues, Turborepo, or Nx
