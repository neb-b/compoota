# compoota

## What this is

compoota is a small companion stack for a local house agent running on a Raspberry Pi. The mobile app talks only to the house-server on your LAN. The house-server can run in mock mode for assistant setup, or call the private local agent when configured on the Pi.

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

Or from the repo root, with `.env` loaded:

```sh
./start-local-server.sh
```

Restart the deployed house-server from the repo root:

```sh
./restart-server.sh
```

If you also run the Cloudflare tunnel:

```sh
./restart-server.sh --tunnel
```

Photo uploads stay local while Hermes analyzes them. If Cloudflare R2 is configured,
the house-server uploads each analyzed photo to R2 after the agent returns and stores
the R2 key/URL in SQLite.

Set these in `.env` to enable R2:

```sh
CLOUDFLARE_R2_ACCOUNT_ID=your-account-id
CLOUDFLARE_R2_ACCESS_KEY_ID=your-r2-access-key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-r2-secret-key
CLOUDFLARE_R2_BUCKET=your-bucket-name
CLOUDFLARE_R2_PUBLIC_BASE_URL=https://your-public-r2-domain.example.com
CLOUDFLARE_R2_KEY_PREFIX=compoota
CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS=3600
```

`CLOUDFLARE_R2_PUBLIC_BASE_URL` is optional. If you leave it empty, or set it to
the private `*.r2.cloudflarestorage.com` S3 API endpoint, the server returns
signed R2 GET URLs for image rendering. If you set a true public/custom-domain
base URL, the app renders that public URL directly.

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

## Local Hermes

compoota is meant to be self-contained: local databases, media, Hermes memory,
Hermes virtualenvs, and development caches should live under `.local/` whenever
possible. That keeps Mac development close to the eventual Pi/home-server
deployment shape without depending on your global `~/.hermes`.

On a Mac or development machine, bootstrap project-local Hermes from the repo
root:

```sh
./scripts/setup-local-hermes.sh
```

That script creates:

- `.local/hermes` as `HERMES_HOME`
- `.local/hermes/hermes-agent/venv` for the Hermes Python environment
- `.local/hermes/plugins/compoota-progress`
- `.env` with repo-local paths when `.env` does not already exist

Use the wrapper when you want to call Hermes by hand:

```sh
./scripts/hermes-local.sh status
./scripts/hermes-local.sh memory status
./scripts/hermes-local.sh -z "hello from compoota"
```

Hermes still needs a model/provider before `HERMES_COMMAND_MODE=oneshot` can
work:

```sh
./scripts/hermes-local.sh model
```

Until then, set `HERMES_COMMAND_MODE=mock` in `.env` for assistant-only setup.
Nearby feed refreshes require `HERMES_COMMAND_MODE=oneshot` because the feed
does not insert fake events.

## Pi Hermes

```sh
mkdir -p ~/.hermes/plugins
cp -R plugins/compoota-progress ~/.hermes/plugins/compoota-progress
# add compoota-progress to plugins.enabled in ~/.hermes/config.yaml
# set HERMES_COMMAND_MODE=oneshot in .env
# if your Pi user is not pi, update the *_HOST_DIR, *_CONTAINER_DIR, and HERMES_* paths
docker compose --profile tunnel up -d --build
```

The default `.env.example` mirrors `/home/pi/.hermes` into the container at the same path. That keeps Python virtualenvs and other absolute paths boring.

## Nearby feed setup

The Home screen reads stored feed items with `GET /feed`; pull-to-refresh starts
a real Hermes nearby-events research run. If no events are stored yet, the app
shows a loading nearby events state instead of fake cards.

Setup/admin scripts:

```sh
./refresh-feed.sh status        # inspect tables, runs, devices, and items
./refresh-feed.sh refresh       # trigger the real Hermes refresh service
./refresh-feed.sh clear-running # mark stuck running refreshes as errored
./seed-feed --reset             # reset local DB/media, start server, print pairing code
./seed-feed --refresh           # start server, then trigger a real Hermes refresh
```

In local Expo development, you can bypass manual pairing by launching with dev-only env vars:

```sh
EXPO_PUBLIC_COMPOOTA_DEV_SERVER_URL=http://127.0.0.1:8787 \
EXPO_PUBLIC_COMPOOTA_DEV_DEVICE_ID=... \
EXPO_PUBLIC_COMPOOTA_DEV_DEVICE_TOKEN=... \
npm run ios
```

Those variables are only used in `__DEV__` and only when no saved connection exists.

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
- Your name

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
