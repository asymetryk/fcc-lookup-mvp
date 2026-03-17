# TrueNAS Proxy Setup

This project can run a small FCC proxy on the TrueNAS box and expose it through a Cloudflare Tunnel.

## Why this exists

The hosted Cloudflare Pages app cannot reliably call the live FCC endpoints directly. Running the FCC lookup proxy inside the homelab avoids that limitation while keeping the public app on Cloudflare.

## Runtime

- `fcc-proxy` container: Node/Express proxy on `127.0.0.1:8788`
- `cloudflared` container: Cloudflare Tunnel forwarding public traffic to the local proxy

## Required secrets

- `PROXY_SHARED_SECRET`
- `TUNNEL_TOKEN`

## Deploy on TrueNAS

```bash
git clone https://github.com/asymetryk/fcc-lookup-mvp.git
cd fcc-lookup-mvp/deploy
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

- `PROXY_BASE_URL=https://<your-tunnel-hostname>`
- `PROXY_SHARED_SECRET=<same secret as the proxy>`

Once those are set, the deployed Pages app will forward lookup requests to the homelab proxy.
