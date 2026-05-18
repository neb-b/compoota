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

Use Node.js 20 or newer.

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

Install Docker on 64-bit Raspberry Pi OS, then clone the repo on the Pi.

LAN-only:

```sh
ssh pi@PI_IP
git clone repo
cd compoota
cp .env.example .env
# edit .env and set HOUSE_SETUP_SECRET and TOKEN_HASH_SECRET
docker compose up -d --build
```

If your Pi has the older standalone Compose binary, use `docker-compose` in place of `docker compose`.

Use this in the app:

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
# PUBLIC_BASE_URL=https://your-house.example.com
# ALLOWED_ORIGINS=https://your-house.example.com
docker compose --profile tunnel up -d --build
```

In Cloudflare Tunnel, route the public hostname to the Compose service:

```txt
your-house.example.com -> http://house-server:8787
```

Use this in the app:

```txt
https://your-house.example.com
```

Cloudflare Tunnel does not need router port forwarding. It exposes only `house-server`; the local agent stays behind it.

## Local agent progress

The app works in mock mode first. To call the local agent and stream progress:

```sh
mkdir -p ~/.hermes/plugins
cp -R plugins/compoota-progress ~/.hermes/plugins/compoota-progress
# add compoota-progress to plugins.enabled in ~/.hermes/config.yaml
# set HERMES_COMMAND_MODE=oneshot in .env
# if your Pi user is not pi, update the *_HOST_DIR, *_CONTAINER_DIR, and HERMES_* paths
docker compose --profile tunnel up -d --build
```

The default `.env.example` mirrors `/home/pi/.hermes` into the container at the same path. That keeps Python virtualenvs and other absolute paths boring.

## Mobile app setup

```sh
cd apps/mobile
npm install
npx expo start
```

For an installable iPhone build:

```sh
cd apps/mobile
npx eas build --platform ios --profile preview
```

Create a pairing code from the setup page or from the Pi repo root:

```sh
./create-pairing-code.sh
```

Then enter:

- Server URL, for example `http://192.168.1.50:8787`
- Or remote Server URL, for example `https://your-house.example.com`
- Pairing code
- Device name

After pairing, the app saves the server URL, device ID, and device token locally.

The script reads `.env` and calls the running local server API, so it does not write directly to SQLite.

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
