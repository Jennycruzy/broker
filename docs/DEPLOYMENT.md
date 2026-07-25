# Dashboard deployment

The dashboard is a Node service, not a static bundle. `web/server.mjs` serves
the assets in `web/public` and the dynamic `/api/live` endpoint, which reads
Solana devnet and authenticated or recorded TxLINE data.

Run it locally:

```bash
HOST=127.0.0.1 PORT=8787 npm run dashboard
curl --fail http://127.0.0.1:8787/healthz
```

For this VPS, keep the application in `/opt/broker`, run it as an unprivileged
`broker` user with `deploy/broker-dashboard.service`, and put Nginx or Caddy in
front of `127.0.0.1:8787`. Replace `broker.example.com` in
`deploy/nginx-dashboard.conf`, install TLS, and expose only ports 80/443.

The World Cup cards use proof-checked historical recordings after the live
TxLINE window has expired. They are labelled `replay` and are never bindable.
The policy and vault panels continue to read current Solana devnet state.
