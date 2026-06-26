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

## Architecture

```
Browser (HTTPS only)
  │
  │  Host nginx — Let's Encrypt TLS (port 443)
  │    ├── HTTP 80 → redirect to HTTPS
  │    └── HTTPS 443 → proxy → localhost:3000
  │
  │  Docker: nginx (localhost:3000, internal only)
  │    ├── GET /           → React dashboard (admin, API key required for writes)
  │    ├── GET /status     → React public status page (read-only)
  │    └── /api/*          → proxy → Express backend (localhost:3001, internal only)
  │
  └── Docker: Express API (localhost:3001, internal only)
        ├── SQLite database  (/app/data/monitoring.db, persisted via Docker volume)
        ├── Cron checker     (runs every 5 minutes)
        ├── Email (SMTP)     (alerts)
        └── Teams webhook    (optional)

Deployment: TU Delft Linux server (edu01.citg.tudelft.nl) — https://mude-monitoring.citg.tudelft.nl
CI/CD:      GitHub Actions self-hosted runner on edu01 → docker compose up
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
│       └── mude-monitoring.conf  # Host nginx vhost for edu01 (proxy → localhost:3000)
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

### HTTPS setup (Let's Encrypt via certbot)

The repo ships a host nginx vhost at [deploy/nginx/mude-monitoring.conf](deploy/nginx/mude-monitoring.conf) that proxies `mude-monitoring.citg.tudelft.nl` to the Docker frontend on `127.0.0.1:3000`. This is a separate file from any existing site config on the host root, so it won't interfere with other services on `edu01`.

```bash
# Install certbot (host nginx + certbot are expected to already be managed on edu01)
sudo apt update && sudo apt install -y certbot python3-certbot-nginx

# Install the vhost
sudo cp ~/Mude_monitoring/deploy/nginx/mude-monitoring.conf /etc/nginx/sites-available/mude-monitoring
sudo ln -s /etc/nginx/sites-available/mude-monitoring /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue certificate (certbot auto-configures HTTPS + HTTP redirect)
sudo certbot --nginx -d mude-monitoring.citg.tudelft.nl --preferred-challenges http
```

Update `.env` to use the HTTPS URL, then restart:

```bash
sed -i 's|PUBLIC_URL=.*|PUBLIC_URL=https://mude-monitoring.citg.tudelft.nl|' .env
sed -i 's|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://mude-monitoring.citg.tudelft.nl|' .env
docker compose down && docker compose up -d
```

Certificates renew automatically via a certbot cron job (expires every 90 days).

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

### Setting the API key

The dashboard is publicly viewable. To add or delete targets, set your API key:

1. Click the **🔓 Set API key** button (top right)
2. Enter your `API_KEY` value from `.env`
3. Click **Save** — the key is stored in `localStorage`

The button turns green (🔒 **Key set**) when a key is configured. The key is never sent to any endpoint other than the backend API.

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
