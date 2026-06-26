# MUDE Monitoring — Server Setup Manual (edu01)

End-to-end guide for deploying the MUDE Platform Monitor on the TU Delft server
`edu01.citg.tudelft.nl`. Reflects the **actual** topology in use (not a generic
host-nginx + Let's Encrypt setup).

---

## 0. How traffic actually flows

```
Internet ──▶ edu01:80 / :443
                │   (owned by the didata-nginx Docker container, the shared reverse proxy)
                │
                ├─ server_name edu01.citg.tudelft.nl           ─▶ didata site
                └─ server_name mude-monitoring.citg.tudelft.nl ─▶ proxy_pass http://172.17.0.1:3000
                                                                   │
                                                  (172.17.0.1 = Docker bridge gateway = the host,
                                                   where our frontend container publishes port 3000)
                                                                   │
                        our frontend nginx (3000) ── /api/* ──▶ our backend (backend:3001)
```

Key facts learned the hard way:

- **Ports 80/443 belong to the `didata-nginx-1` container**, not a host nginx.
  Our domain is routed by adding a server block to that container's config.
- **The reverse proxy reaches our app via `172.17.0.1:3000`** (the Docker bridge
  gateway), so our frontend must be published on that interface — not just loopback.
- **HTTPS is via an ICT-issued certificate**, not certbot. Outbound SMTP ports
  587/465 are firewalled on edu01; only **port 25** works (unauthenticated campus relay).

---

## 1. Prerequisites

- SSH access to `edu01.citg.tudelft.nl` with `sudo`.
- Docker + Docker Compose plugin installed (already present on edu01).
- DNS: `mude-monitoring.citg.tudelft.nl` is a **CNAME → edu01.citg.tudelft.nl**
  (confirm with `nslookup mude-monitoring.citg.tudelft.nl`).
- The project directory on the server is **`~/Mude_monitoring`** (capital M,
  underscore). The self-hosted runner lives at `~/Mude_monitoring/actions-runner`,
  so do not rename this directory.

---

## 2. Clone the repo

```bash
ssh <netid>@edu01.citg.tudelft.nl
git clone <repo-url> ~/Mude_monitoring
cd ~/Mude_monitoring
```

---

## 3. Configure `.env`

```bash
cp .env.example .env
nano .env
```

Working values for edu01 (the app reads these via `backend/src/email.ts` etc.):

```bash
# SMTP — TU Delft campus relay, unauthenticated, PORT 25 ONLY (587/465 firewalled)
SMTP_HOST=smtp.tudelft.nl
SMTP_PORT=25
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

# Alert sender / recipients (REQUIRED — no email is sent without ALERT_EMAIL_TO)
ALERT_EMAIL_FROM=mude-monitor@tudelft.nl
ALERT_EMAIL_TO=you@tudelft.nl          # comma-separated for multiple recipients

# While the site is HTTP-only, use http:// here (switch to https:// after TLS — see §6).
# Mismatch causes CORS failures on admin add/delete and wrong links in alert emails.
PUBLIC_URL=http://mude-monitoring.citg.tudelft.nl
ALLOWED_ORIGINS=http://mude-monitoring.citg.tudelft.nl

API_KEY=<run: openssl rand -hex 32>
TEAMS_WEBHOOK_URL=
```

Verify the SMTP relay accepts mail before relying on it:

```bash
nc -vz -w5 smtp.tudelft.nl 25                 # should succeed (587/465 will time out)
swaks --to you@tudelft.nl --from mude-monitor@tudelft.nl \
      --server smtp.tudelft.nl:25 --tls-optional   # if swaks is installed
```

---

## 4. Start the containers

```bash
cd ~/Mude_monitoring
docker compose up -d --build
docker compose ps                              # backend + frontend should be "Up"
docker compose exec backend env | grep -E "SMTP|ALERT_EMAIL"   # confirm config landed
```

The frontend is published on **both** `127.0.0.1:3000` (local debugging) and
`172.17.0.1:3000` (for the reverse proxy). Confirm:

```bash
sudo ss -ltnp | grep ':3000'                   # expect 127.0.0.1:3000 AND 172.17.0.1:3000
curl -sI http://127.0.0.1:3000/                # frontend → 200
curl -sI http://127.0.0.1:3001/health          # backend  → 200
```

---

## 5. Wire up the reverse proxy (didata-nginx)

The public proxy is the `didata-nginx-1` container. Its config is the host file
`/var/web_server/website_docker_configuration/default.conf` (mounted into the
container as `/etc/nginx/conf.d/default.conf`).

```bash
# Always back up the shared config first
sudo cp /var/web_server/website_docker_configuration/default.conf ~/didata-default.conf.bak

# Add our server block (copy it from deploy/nginx/mude-monitoring.conf — the HTTP block)
sudo nano /var/web_server/website_docker_configuration/default.conf
```

Block to add (HTTP, current state):

```nginx
server {
    listen 80;
    server_name mude-monitoring.citg.tudelft.nl;

    location / {
        proxy_pass http://172.17.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Test and reload the container's nginx:

```bash
sudo docker exec didata-nginx-1 nginx -t
sudo docker exec didata-nginx-1 nginx -s reload
```

> ⚠️ This edit lives on the server only — it is **not** in the repo and **not**
> applied by CI/CD. `deploy/nginx/mude-monitoring.conf` is the version-controlled
> reference for what the block should contain. If didata-nginx is ever recreated
> and this file is reset, re-apply the block.

Verify:

```bash
curl -I http://mude-monitoring.citg.tudelft.nl     # 200, no redirect to edu01
```

Open `http://mude-monitoring.citg.tudelft.nl` (dashboard) and `/status` (public page).

---

## 6. HTTPS (after ICT issues a certificate)

Let's Encrypt/certbot is **not** used here. Request a cert for
`mude-monitoring.citg.tudelft.nl` from TU Delft ICT (DNS CNAME is already set).
When it arrives:

1. Place cert + key on the host and add bind mounts to the **didata** compose
   service (same pattern as the existing `edu01.citg.tudelft.nl.crt` / `.key`
   mounts), then recreate didata-nginx.
2. Replace the HTTP block in didata's `default.conf` with the HTTPS variant
   (commented in `deploy/nginx/mude-monitoring.conf`): an `:80 → 301 https`
   redirect plus an `:443 ssl` server block.
3. `sudo docker exec didata-nginx-1 nginx -t && sudo docker exec didata-nginx-1 nginx -s reload`
4. Flip `.env` back to HTTPS and restart our stack:

   ```bash
   sed -i 's|PUBLIC_URL=.*|PUBLIC_URL=https://mude-monitoring.citg.tudelft.nl|' .env
   sed -i 's|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://mude-monitoring.citg.tudelft.nl|' .env
   docker compose up -d
   ```

---

## 7. CI/CD — self-hosted GitHub Actions runner

Inbound SSH from GitHub's cloud is blocked, so deploys run on a **self-hosted
runner installed on edu01** at `~/Mude_monitoring/actions-runner`. On every push
to `main` ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)) it runs,
inside `$HOME/Mude_monitoring`:

```bash
git fetch --all --prune
git reset --hard origin/main
docker compose up -d --build
docker image prune -f
```

Because of `git reset --hard`, anything not committed to `main` is wiped on the
next deploy. The didata-nginx block (§5) is outside the repo, so it survives — but
the **`.env`** (git-ignored) and the **db Docker volume** must stay on the server.

To (re)install the runner: GitHub repo → Settings → Actions → Runners → New
self-hosted runner (Linux x64), install under the user that owns
`~/Mude_monitoring`, use the `edu01` label, and run it as a service
(`sudo ./svc.sh install && sudo ./svc.sh start`). Ensure that user can run Docker
without sudo (`sudo usermod -aG docker $USER`, then restart the runner).

---

## 8. Troubleshooting (issues actually hit during setup)

| Symptom | Cause | Fix |
|---|---|---|
| `http://mude-monitoring…` redirects to edu01 | Our server block not loaded in didata-nginx | Add the block to didata `default.conf` and reload (§5) |
| Runner fails: `cd: …/mude-monitoring: No such file or directory` | Workflow path didn't match real dir | Dir is `~/Mude_monitoring` (fixed in deploy.yml) |
| Runner fails: `…/.docker/buildx/current: permission denied` | A buildx file is root-owned (from an earlier `sudo docker`) | `sudo chown <user>:<user> ~/.docker/buildx/current` |
| Email never sends | `ALERT_EMAIL_TO` empty, or used port 587/465 | Set `ALERT_EMAIL_TO`; use port **25** |
| `nc smtp.tudelft.nl 587` times out | 587/465 firewalled on edu01 | Use port **25** (unauthenticated campus relay) |
| Admin add/delete fails in browser | `ALLOWED_ORIGINS` scheme ≠ how users connect | Match scheme: `http://…` while HTTP, `https://…` after TLS |
| `nginx -t` on the **host** fails: `edu01…key values mismatch` | Host nginx (unused for public traffic) points at an expired `.pem` | Irrelevant to this app — public proxy is the container; ignore or repoint host nginx to the valid `.crt` |
| Proxy returns 502 | Frontend not published on `172.17.0.1:3000` | Check `docker-compose.yml` frontend ports + `docker compose up -d` |

---

## 9. Quick reference

```bash
# our app
cd ~/Mude_monitoring
docker compose ps
docker compose logs -f backend
docker compose up -d --build

# reverse proxy (shared)
sudo docker exec didata-nginx-1 nginx -t
sudo docker exec didata-nginx-1 nginx -s reload

# health
curl -sI http://127.0.0.1:3000/            # frontend
curl -sI http://127.0.0.1:3001/health      # backend
curl -I  http://mude-monitoring.citg.tudelft.nl
```
```
Project dir : ~/Mude_monitoring
Env file    : ~/Mude_monitoring/.env   (git-ignored)
Proxy config: /var/web_server/website_docker_configuration/default.conf  (host; mounted into didata-nginx-1)
Reference   : deploy/nginx/mude-monitoring.conf
Runner      : ~/Mude_monitoring/actions-runner
```
