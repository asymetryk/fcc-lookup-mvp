# TrueNAS Proxy Setup

This project can run a small FCC proxy on the TrueNAS box and expose it through a Cloudflare Tunnel.

## Why this exists

The hosted Cloudflare Pages app cannot reliably call the live FCC endpoints directly. Running the FCC lookup proxy inside the homelab avoids that limitation while keeping the public app on Cloudflare.

## Runtime

- `fcc-proxy` container: Node/Express proxy on `127.0.0.1:8788`
- `cloudflared` container: Cloudflare Tunnel forwarding public traffic to the local proxy
- `../data:/app/data` volume: persists the FCC download cache across container restarts

## Required secrets

- `PROXY_SHARED_SECRET`
- `TUNNEL_TOKEN`

## Deploy on TrueNAS

```bash
sudo mkdir -p /mnt/Shallow/apps/fcc-lookup-mvp
sudo chown -R truenas_admin:truenas_admin /mnt/Shallow/apps/fcc-lookup-mvp

git clone https://github.com/asymetryk/fcc-lookup-mvp.git /mnt/Shallow/apps/fcc-lookup-mvp
cd /mnt/Shallow/apps/fcc-lookup-mvp/deploy
cp .env.proxy.example .env.proxy
# fill in PROXY_SHARED_SECRET and TUNNEL_TOKEN
sudo docker compose --env-file .env.proxy -f docker-compose.proxy.yml up -d --build
```

## Verify

```bash
curl -H "x-fcc-proxy-secret: $PROXY_SHARED_SECRET" http://127.0.0.1:8788/health
```

## Cloudflare Pages env vars

The Pages project should be configured with:

- `PROXY_BASE_URL=https://fcclookup-proxy.asymetryk.com`
- `PROXY_SHARED_SECRET=<same secret as the proxy>`

Once those are set, the deployed Pages app will forward lookup requests to the homelab proxy.

## Current status

- The TrueNAS proxy is currently running from `/mnt/Shallow/apps/fcc-lookup-mvp`
- The hosted Pages app has proxy forwarding enabled
- `fcclookup-proxy.asymetryk.com` is routed to the Cloudflare Tunnel
- The `cloudflared` container is connected with a real `TUNNEL_TOKEN`
- Fixed broadband now falls back to the downloaded FCC cache when the live FCC fixed-detail endpoint returns `403`
