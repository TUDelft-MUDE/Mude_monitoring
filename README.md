# MUDE Platform Monitor — School Server Edition

Uptime monitoring dashboard for TU Delft MUDE course infrastructure, packaged for
deployment on a **university Linux server** instead of AWS. Same functionality as
the AWS edition (HTTP checks every 5 minutes, uptime history, public status page,
DOWN/UP alerts), but with **no AWS dependency**:

| AWS edition | School edition |
|-------------|----------------|
| Email alerts via AWS SNS | Email alerts via **SMTP** (`nodemailer`) |
| SNS subscription confirmation flow | Plain recipient list in `alerts.json` — no confirmation |
| Deployed on EC2 (Terraform) | Deployed on a school Linux server (Docker Compose) |
| IAM instance profile | Just SMTP credentials in `.env` |

Everything else — backend API, SQLite storage, the React dashboard, the public
`/status` page, maintenance windows, and optional Microsoft Teams alerts — is
identical to the AWS edition.

---

## Architecture

```
Browser (HTTPS)
  │
  │  Host nginx — TLS (port 443)         ← campus cert or Let's Encrypt
  │    ├── HTTP 80 → redirect to HTTPS
  │    └── HTTPS 443 → proxy → localhost:3000
  │
  │  Docker: nginx (localhost:3000, internal only)
  │    ├── GET /           → React dashboard (API key required for writes)
  │    ├── GET /status     → React public status page (read-only)
  │    └── /api/*          → proxy → Express backend (localhost:3001)
  │
  └── Docker: Express API (localhost:3001, internal only)
        ├── SQLite database  (/app/data/monitoring.db, Docker volume)
        ├── Cron checker     (runs every 5 minutes)
        ├── SMTP relay       (email alerts — university or Gmail)
        └── Teams webhook    (optional)
```

---

## Why SMTP works on a school server

The server does **not** run its own mail server. The Node app only makes an
**outbound** connection to an SMTP relay. Two common options:

1. **University SMTP relay** (e.g. `smtp.tudelft.nl:587`) — inside the campus
   network this often needs no authentication, or your normal account login.
2. **Gmail SMTP** (`smtp.gmail.com:587` + a 16-char [app password](https://myaccount.google.com/apppasswords))
   — works from anywhere.

The only requirement is that the firewall allows outbound port **587** (STARTTLS)
or **465** (implicit TLS), which is the default on virtually all campus networks.

---

## Prerequisites

- A Linux server with **Docker** and **Docker Compose** installed
- An SMTP relay you can send through (see above)
- A DNS name pointing at the server (for HTTPS) — optional but recommended

---

## Quick start

```bash
# From the repo, work inside the school edition
cd school

# Configure environment
cp .env.example .env
nano .env          # set SMTP_*, API_KEY, ALLOWED_ORIGINS, PUBLIC_URL

# Edit who gets alerts and what to monitor
nano backend/alerts.json     # ["you@tudelft.nl", ...]
nano backend/targets.json    # services to monitor

# Build and run
docker compose up -d --build
```

- Dashboard:      http://localhost:3000
- Public status:  http://localhost:3000/status
- Backend API:    http://localhost:3001/api

Check the logs to confirm SMTP connected:

```bash
docker compose logs -f backend
# [Mailer] SMTP ready (smtp.gmail.com) — recipients: you@tudelft.nl
# Checker started — polling every 5 minutes
```

---

## Local development (hot reload)

```bash
# Terminal 1 — backend
cd school/backend
npm install
SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... npm run dev

# Terminal 2 — frontend
cd school/frontend
npm install
npm run dev
```

Leaving `SMTP_HOST` unset disables email alerts (handy for dev) — the checker
still runs and the dashboard works normally.

---

## Environment variables (`school/.env`)

```env
# SMTP email alerts (replaces AWS SNS)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=MUDE Monitor <your-account@gmail.com>

# Public base URL of the dashboard (used in alert links)
PUBLIC_URL=https://mude-monitor.your-school.nl

# API key — required to add/delete targets (openssl rand -hex 32)
API_KEY=your-strong-random-key-here

# CORS — comma-separated allowed frontend origins
ALLOWED_ORIGINS=https://mude-monitor.your-school.nl

# Microsoft Teams webhook (optional — omit to disable Teams alerts)
TEAMS_WEBHOOK_URL=
```

> Never commit `.env` — it is in `.gitignore`.

---

## HTTPS on the school server

If the campus already terminates TLS for you, just point its reverse proxy at
`http://localhost:3000`. Otherwise, run a host nginx + Let's Encrypt:

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/mude-monitor << 'EOF'
server {
    listen 80;
    server_name mude-monitor.your-school.nl;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mude-monitor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
sudo certbot --nginx -d mude-monitor.your-school.nl
```

Then set `PUBLIC_URL` and `ALLOWED_ORIGINS` to the `https://` URL and restart:

```bash
docker compose down && docker compose up -d
```

---

## Updating a running deployment

```bash
cd school
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

The SQLite database lives in the `db_data` Docker volume and survives rebuilds.

---

## Configuration files

| File | Purpose |
|------|---------|
| `backend/targets.json` | Seed list of monitored URLs (`INSERT OR IGNORE` on startup) |
| `backend/alerts.json` | Email recipients for DOWN/UP alerts — plain list, no confirmation |
| `backend/maintenance.json` | Maintenance windows during which alerts are suppressed |

Changes to these require a redeploy (`docker compose up -d --build`). Targets
added through the dashboard UI are stored in the database and persist.

---

## API reference

Identical to the AWS edition. Base URL: `<PUBLIC_URL>/api`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/status` | — | Latest check result for all targets |
| `GET` | `/api/history/:id` | — | Last 24h of checks for a target |
| `GET` | `/api/uptime/:id` | — | 24h and 7d uptime % for a target |
| `GET` | `/api/incidents` | — | All recorded incidents |
| `GET` | `/api/maintenance` | — | Maintenance window status |
| `POST` | `/api/targets` | `X-Api-Key` | Add a monitoring target |
| `DELETE` | `/api/targets/:id` | `X-Api-Key` | Remove a monitoring target |

Rate limits: 200 req / 15 min globally, 30 req / 15 min on write endpoints.

---

## Alert behaviour

| Transition | Action |
|-----------|--------|
| UP → DOWN | Email via SMTP + Teams (if configured) |
| DOWN → UP | Recovery email via SMTP + Teams (if configured) |
| Stays UP / stays DOWN | No alert (only on transition) |
| During a maintenance window | Alerts suppressed |

---

## Backing up the database

```bash
docker cp $(docker compose ps -q backend):/app/data/monitoring.db ./backup.db
```
