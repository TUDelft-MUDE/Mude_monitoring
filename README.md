# MUDE Platform Monitor

Uptime monitoring dashboard for TU Delft MUDE course infrastructure. Checks HTTP endpoints every 5 minutes, tracks uptime history, sends email alerts (and optional Microsoft Teams alerts) on DOWN/UP transitions, and exposes a public read-only status page.

---

## Features

| Feature | Details |
|---------|---------|
| **Uptime checks** | HTTP GET every 5 minutes, stores result in SQLite |
| **Dashboard** | Private admin view — status cards, 24h/7d uptime %, history chart |
| **Public status page** | Read-only page at `/status`, no auth required |
| **Email alerts** | SMTP (TU Delft relay) email on DOWN and UP recovery |
| **Teams alerts** | Optional Microsoft Teams Incoming Webhook (set `TEAMS_WEBHOOK_URL`) |
| **Incident history** | Tracks every outage start/end/duration |
| **Target management** | Add/delete monitored URLs via UI (API key required) |
| **Security** | API key auth, CORS origin restriction, rate limiting |

---

## Who gets the alert emails (no setup knowledge needed)

The list of people who receive "site is DOWN / recovered" emails lives in one
plain file: **[`backend/recipients.txt`](backend/recipients.txt)** — one email
address per line.

To change it, you do **not** need to log into the server or understand `.env`:

1. Open [`backend/recipients.txt`](backend/recipients.txt) on GitHub and click the ✏️ (Edit) button.
2. Add a line for each new person, or delete a line to remove someone. Lines starting with `#` are notes and are ignored.
3. Click **Commit changes**.

That's it — the dashboard redeploys itself automatically within a few minutes and
the new list takes effect. (If the file is ever empty, it falls back to the
`ALERT_EMAIL_TO` value in `.env`.)

---

## Architecture

```
Browser (HTTPS)
  │
  │  didata-nginx container — owns host ports 80/443 (shared reverse proxy)
  │    ├── server_name edu01.citg.tudelft.nl              → didata site
  │    └── server_name mude-monitoring.citg.tudelft.nl    → TLS (ICT cert) → proxy → 172.17.0.1:3000
  │         (HTTP :80 redirects to HTTPS; 172.17.0.1 = Docker bridge gateway = our frontend)
  │
  │  Docker: our frontend nginx (host 127.0.0.1:3000 + 172.17.0.1:3000)
  │    ├── GET /           → React dashboard (admin, API key required for writes)
  │    ├── GET /status     → React public status page (read-only)
  │    └── /api/*          → proxy → Express backend (service "backend:3001", internal)
  │
  └── Docker: Express API (host 127.0.0.1:3001, internal only)
        ├── SQLite database  (/app/data/monitoring.db, persisted via Docker volume)
        ├── Cron checker     (runs every 5 minutes)
        ├── Email (SMTP)     (alerts)
        └── Teams webhook    (optional)

Deployment: TU Delft Linux server (edu01.citg.tudelft.nl) — https://mude-monitoring.citg.tudelft.nl
CI/CD:      GitHub Actions self-hosted runner on edu01 → docker compose up
Reverse proxy: the existing didata-nginx container, NOT a host nginx (see deploy/nginx)
```

---

## Project Structure

```
mude-monitoring/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express server entry point
│   │   ├── routes.ts         # API route handlers
│   │   ├── db.ts             # SQLite operations (sql.js)
│   │   ├── checker.ts        # HTTP check loop + alert logic
│   │   ├── email.ts          # SMTP email alerts (nodemailer)
│   │   └── middleware.ts     # API key auth + rate limiters
│   ├── targets.json          # Seed targets (INSERT OR IGNORE on startup)
│   ├── recipients.txt        # Alert email recipients (edit on GitHub — one per line)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.tsx          # Entry point — routes to App or StatusPage
│   │   ├── App.tsx           # Admin dashboard
│   │   ├── StatusPage.tsx    # Public status page (/status)
│   │   ├── api.ts            # API client + auth helpers
│   │   └── components/
│   │       ├── StatusCard.tsx
│   │       └── UptimeChart.tsx
│   ├── nginx.conf            # nginx config (SPA routing + API proxy)
│   └── Dockerfile
├── deploy/
│   └── nginx/
│       └── mude-monitoring.conf  # Reference reverse-proxy block (added to didata-nginx; see file header)
├── docker-compose.yml
└── .github/workflows/deploy.yml
```

---

## Prerequisites

- Docker & Docker Compose
- Node.js 22 (local development only)
- SSH + sudo access to edu01 (to install the self-hosted runner and run Docker)
- Access to an SMTP relay for email alerts (e.g. the TU Delft campus SMTP server)

---

## Local Development

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd Mude_monitoring

cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Create a `.env` file

```bash
cp .env.example .env   # or create manually — see Environment Variables below
```

### 3. Run with Docker Compose

```bash
docker compose up --build
```

- Dashboard: http://localhost:3000
- Public status: http://localhost:3000/status
- Backend API: http://localhost:3001/api

### 4. Run backend/frontend separately (hot reload)

```bash
# Terminal 1 — backend
cd backend
npm run dev

# Terminal 2 — frontend
cd frontend
npm run dev
```

---

## Deployment (edu01.citg.tudelft.nl)

The dashboard is hosted on the TU Delft Linux server `edu01.citg.tudelft.nl`, reachable via SSH with sudo. Docker is expected to already be installed on this host.

DNS: `mude-monitoring.citg.tudelft.nl` is a CNAME pointing to `edu01.citg.tudelft.nl`.

### First-time server setup

```bash
ssh <netid>@edu01.citg.tudelft.nl

# Clone repo
git clone <repo-url> ~/Mude_monitoring
cd ~/Mude_monitoring

# Create .env (see Environment Variables below)
nano .env

# Start containers
docker compose up -d --build
```

### Reverse proxy (didata-nginx container)

On `edu01` the public entry point for ports 80/443 is **not** a host nginx — those ports are owned by an existing Docker container, `didata-nginx-1`. Its config is the host file `/var/web_server/website_docker_configuration/default.conf` (mounted into the container as `/etc/nginx/conf.d/default.conf`).

To route our domain, add the `server_name mude-monitoring.citg.tudelft.nl` block from [deploy/nginx/mude-monitoring.conf](deploy/nginx/mude-monitoring.conf) to that file. It proxies to `http://172.17.0.1:3000` — the Docker bridge gateway, where our frontend is published (see `docker-compose.yml`: the frontend binds both `127.0.0.1:3000` and `172.17.0.1:3000` so the container-based proxy can reach it).

```bash
# Back up first — this is shared didata infra
sudo cp /var/web_server/website_docker_configuration/default.conf ~/didata-default.conf.bak

# Add our server block (see deploy/nginx/mude-monitoring.conf), then:
sudo docker exec didata-nginx-1 nginx -t
sudo docker exec didata-nginx-1 nginx -s reload
```

> ⚠️ This manual edit lives on the server only — it is **not** in this repo and **not** applied by the CI/CD runner. `deploy/nginx/mude-monitoring.conf` is the version-controlled reference for what that block should contain.

### HTTPS

HTTPS is **live**. Let's Encrypt/certbot is not used — TU Delft ICT issued an institutional certificate for `mude-monitoring.citg.tudelft.nl` and auto-renews it (their renewal hook runs `docker restart didata-nginx-1`). The cert/key live on the host at:

```
/etc/ssl/certs/mude-monitoring.citg.tudelft.nl.crt
/etc/ssl/private/mude-monitoring.citg.tudelft.nl.key
```

They are bind-mounted into the didata-nginx container by **its real compose file**, `/var/web_server/htdocs/didata/docker-compose.yml` (the nginx service — same single-file `:ro` pattern as the existing `edu01` cert). The `default.conf` block redirects `:80` → `:443` and terminates TLS on `:443`, proxying to `http://172.17.0.1:3000`. See [deploy/nginx/mude-monitoring.conf](deploy/nginx/mude-monitoring.conf) for the exact server block.

> Note: `/var/web_server/htdocs/didata/docker-compose.yml` is the compose that actually created `didata-nginx-1` (confirmed via its `com.docker.compose.project.config_files` label) — **not** the stale `website_docker_configuration/docker-compose.yml`. Adding a cert mount requires recreating the nginx service (`cd /var/web_server/htdocs/didata && sudo docker compose up -d nginx`); config-only changes to `default.conf` just need `sudo docker exec didata-nginx-1 nginx -s reload`.

To request a renewed/new cert in the future, ask TU Delft ICT; once delivered, `PUBLIC_URL` and `ALLOWED_ORIGINS` in `.env` already point at `https://…` so no app change is needed.

### CI/CD (self-hosted GitHub Actions runner)

Because `edu01` is not reachable via inbound SSH from GitHub's cloud runners, deployment uses a **self-hosted runner installed on edu01**. The runner makes an outbound connection to GitHub, picks up jobs on every push to `main`, and runs the deploy locally on the server — no inbound ports and no stored SSH keys.

**Install the runner (one time):**

1. On GitHub: repo → **Settings → Actions → Runners → New self-hosted runner** (Linux x64). GitHub shows a download URL, a `config.sh` command, and a registration token.

2. On edu01, install under the **same user** that owns `~/Mude_monitoring`:

   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   # Use the download URL + token shown on the GitHub "New runner" page:
   curl -o actions-runner.tar.gz -L <DOWNLOAD_URL_FROM_GITHUB>
   tar xzf actions-runner.tar.gz
   ./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN> --labels edu01
   ```

   The `edu01` label is required — the workflow targets `runs-on: [self-hosted, edu01]`.

3. Run it as a service so it survives reboots and logout:

   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

4. Ensure the runner's user can run Docker without sudo, then restart the runner:

   ```bash
   sudo usermod -aG docker $USER   # re-login or restart the runner service afterwards
   ```

**The deploy workflow** ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) then, on every push to `main`:
1. `git fetch --all --prune && git reset --hard origin/main` in `~/Mude_monitoring`
2. `docker compose up -d --build`
3. `docker image prune -f`

`git reset --hard` keeps untracked files, so the server's `.env` is never touched. No GitHub repository secrets are required — the runner is already authenticated to the repo.

---

## Environment Variables

Create `<DEPLOY_PATH>/.env` on the server:

```env
# Public hostname (used in alert dashboard links)
PUBLIC_URL=https://mude-monitoring.citg.tudelft.nl

# API key — required to add/delete targets via the dashboard
# Generate with: openssl rand -hex 32
API_KEY=your-strong-random-key-here

# CORS — comma-separated list of allowed frontend origins
ALLOWED_ORIGINS=https://mude-monitoring.citg.tudelft.nl

# Email alerts (TU Delft SMTP relay) — DOWN/UP notifications
SMTP_HOST=smtp.tudelft.nl
SMTP_PORT=25
SMTP_SECURE=false
# SMTP_USER / SMTP_PASS — only set if the relay requires authentication
# SMTP_USER=
# SMTP_PASS=
ALERT_EMAIL_FROM=mude-monitor@tudelft.nl
ALERT_EMAIL_TO=you@tudelft.nl,colleague@tudelft.nl

# Microsoft Teams Incoming Webhook URL — optional, leave unset to disable
# TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
```

> **SMTP note:** `SMTP_HOST=smtp.tudelft.nl` is a placeholder — confirm the actual relay hostname and whether it requires authentication with TU Delft ICT. If email alerts stay silent, check the backend logs for `[Email]` messages. Email is disabled (no error) when `SMTP_HOST` or `ALERT_EMAIL_TO` is unset.

> **Security note:** Never commit `.env` to git. The file is in `.gitignore`.

---

## Configuration Files

### `backend/targets.json` — Seed targets

Defines the initial set of monitored URLs. Loaded on startup with `INSERT OR IGNORE` — existing targets in the database are never deleted.

```json
[
  { "name": "MUDE Course Website",       "url": "https://mude.citg.tudelft.nl" },
  { "name": "Content Archival System",   "url": "https://mude.citg.tudelft.nl/archive" },
  { "name": "Jupyter Publishing Pipeline","url": "https://mude.citg.tudelft.nl/book" },
  { "name": "diData - Test Webpage",     "url": "https://edu01.citg.tudelft.nl" }
]
```

Adding a URL here and redeploying will add it. Targets added through the UI are stored in the database and persist across restarts.

---

## API Reference

Base URL: `https://mude-monitoring.citg.tudelft.nl/api`

### Public endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Latest check result for all targets |
| `GET` | `/api/history/:id` | Last 100 check results for a target |
| `GET` | `/api/uptime/:id` | 24h and 7d uptime percentage for a target |
| `GET` | `/api/incidents` | All recorded incidents (most recent first) |
| `GET` | `/health` | Health check — returns `{ status: "ok" }` |

### Protected endpoints (require `X-Api-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/targets` | Add a new monitoring target |
| `DELETE` | `/api/targets/:id` | Remove a monitoring target |

**POST `/api/targets` body:**
```json
{ "name": "My Service", "url": "https://example.com" }
```

**Rate limits:**
- Global: 200 requests per 15 minutes
- Write endpoints: 30 requests per 15 minutes

---

## Dashboard Usage

### The API key — generate, configure, use

Reading the dashboard and the public status page needs no key. The key only gates **write** actions (adding/deleting monitored targets). There is one shared key, stored server-side in `.env`.

**1. Generate a key** (any long random string; on the server or your laptop):

```bash
openssl rand -hex 32
```

**2. Configure it on the server** — put the generated value in `.env`, then restart so the backend picks it up:

```bash
cd ~/Mude_monitoring
nano .env                 # set: API_KEY=<the value from step 1>
docker compose up -d      # restart with the new key
```

> If `API_KEY` is left empty/unset, the backend runs in **open mode** — anyone can add/delete targets. Always set a key in production.

**3. Use it in the dashboard** (each admin enters it once, in their browser):

1. Open `https://mude-monitoring.citg.tudelft.nl` and click **🔓 Set API key** (top right).
2. Paste the same `API_KEY` value from `.env` and click **Save**.

The key is stored in that browser's `localStorage` and sent only as the `X-Api-Key` header to the backend API. The button turns green (🔒 **Key set**) once configured. To rotate the key: change `API_KEY` in `.env`, `docker compose up -d`, and have each admin re-enter the new value.

### Adding a target

Fill in the **Name** and **URL** fields in the "Add Monitoring Target" form and click **Add**. The target is immediately checked (no waiting for the next cron cycle).

### Deleting a target

Click the **✕** button on any status card. A confirmation dialog appears before deletion.

---

## Public Status Page

Accessible at `https://mude-monitoring.citg.tudelft.nl/status` — no login required.

- Shows overall system health banner (green / red / amber)
- Lists each service with UP/DOWN status and 24h/7d uptime
- Auto-refreshes every 60 seconds
- Suitable for sharing with students or stakeholders

---

## Alert Behaviour

| Transition | Action |
|-----------|--------|
| UP → DOWN | Email alert (+ Teams if configured) |
| DOWN → UP | Email recovery alert (+ Teams if configured) |
| Stays UP | No alert |
| Stays DOWN | No repeat alert (only on transition) |

---

## Data Persistence

SQLite database is stored at `/app/data/monitoring.db` inside the backend container, mounted via a named Docker volume (`db_data`). Data survives container restarts and redeployments.

To back up the database:
```bash
docker cp $(docker compose ps -q backend):/app/data/monitoring.db ./backup.db
```
