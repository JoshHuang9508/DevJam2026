# Restricted SSH deployment

GitHub Actions connects through a dedicated Cloudflare SSH Tunnel with an
Ed25519 key whose `authorized_keys` entry uses both `restrict` and a forced
command. No inbound SSH port is exposed. The key cannot open a shell, forward
ports, allocate a PTY, or select another command. The host-side command accepts
only `deploy <40-character SHA>`, confirms that the commit belongs to
`origin/main`, and then updates the isolated production checkout.

Host paths:

- Command: `/home/e0pwr/bin/devjam2026-ssh-deploy`
- Checkout: `/home/e0pwr/deployments/DevJam2026`
- SSH tunnel hostname: `devjam-deploy.0950405.xyz`
- Optional Compose environment: `/home/e0pwr/.config/devjam2026/env`
- Last successful commit: `/home/e0pwr/.local/state/devjam2026/last-successful-sha`

Production secrets stay outside the checkout:

- DeepSeek and Compose settings: `/home/e0pwr/.config/devjam2026/env` (mode 0600)
- Nginx APR1 password file: `/home/e0pwr/.config/devjam2026/.htpasswd` (mode 0600)

Cloudflare sends web traffic to `127.0.0.1:3000`, where the Nginx `gateway`
service enforces Basic Auth before forwarding to the unexposed `web` service.
The `/healthz` endpoint is the only unauthenticated route and returns only
`200 ok` for container/deployment health checks.

The GitHub repository needs these Actions variables:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_KNOWN_HOSTS`
- `PUBLIC_URL`

The private key is stored only in the `DEPLOY_SSH_KEY` Actions secret.
