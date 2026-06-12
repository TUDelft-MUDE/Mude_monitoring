# MUDE Platform Monitor — School Server Edition

Uptime monitoring dashboard for TU Delft MUDE course infrastructure, packaged for
deployment on the university Linux server **`edu01.citg.tudelft.nl`** instead of
AWS. Same functionality as the AWS edition (HTTP checks every 5 minutes, uptime
history, public status page, DOWN/UP alerts), but with **no AWS dependency**:

| AWS edition | School edition (this repo) |
|-------------|----------------------------|
| Email alerts via AWS SNS | Email alerts via **SMTP** (`nodemailer`) |
| SNS subscription confirmation flow | Plain recipient list in `alerts.json` — no confirmation |
| Deployed on EC2 (Terraform) | Deployed on edu01 (Docker Compose) |
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
  │  Docker: nginx (127.0.0.1:3000, internal only)
  │    ├── GET /           → React dashboard (API key required for writes)
  │    ├── GET /status     → React public status page (read-only)
  │    └── /api/*          → proxy → Express backend (127.0.0.1:3001)
  │
  └── Docker: Express API (127.0.0.1:3001, internal only)
        ├── SQLite database  (/app/data/monitoring.db, Docker volume db_data)
        ├── Cron checker     (runs every 5 minutes)
        ├── SMTP relay       (email alerts — university or Gmail)
        └── Teams webhook    (optional)
```

Both containers bind to `127.0.0.1` only — nothing is exposed to the network
until you put a reverse proxy (host nginx / campus proxy) in front of port 3000.

---

## Repository layout

```
.
├── backend/            Express + SQLite API and the 5-minute checker
│   ├── targets.json    Seed list of URLs to monitor
│   ├── alerts.json     Email recipients for DOWN/UP alerts
│   └── maintenance.json  Windows during which alerts are suppressed
├── frontend/           React dashboard + public status page (served by nginx)
├── docker-compose.yml  Two services: backend (3001) + frontend (3000)
├── deploy.sh           Build & (re)start the stack on the server
├── .env.example        Template for the secrets file (copy to .env)
└── .github/workflows/deploy.yml   CI build + SSH deploy to edu01
```

---

## Prerequisites on edu01

- Docker and the Docker Compose plugin (`docker compose version` works)
- Permission to run Docker (your user is in the `docker` group, or you can
  `sudo docker`)
- An SMTP relay you can send through (see below) — optional, alerts are skipped
  if unset
- Outbound port **587** (STARTTLS) or **465** (implicit TLS) open for email

---

## Quick start (manual deploy on edu01)

```bash
# 1. Clone into your home directory
ssh <netid>@edu01.citg.tudelft.nl
git clone https://github.com/TUDelft-MUDE/Mude_monitoring.git ~/Mude_monitoring
cd ~/Mude_monitoring

# 2. Configure secrets
cp .env.example .env
nano .env          # set SMTP_*, API_KEY, ALLOWED_ORIGINS, PUBLIC_URL

# 3. Edit who gets alerts and what to monitor
nano backend/alerts.json     # ["you@tudelft.nl", ...]
nano backend/targets.json    # services to monitor

# 4. Build, start, and health-check in one step
./deploy.sh
```

`deploy.sh` is idempotent — re-run it any time to pull the latest code, rebuild,
and restart. It waits for the backend `/health` endpoint before declaring
success and prints `docker compose ps` at the end.

- Dashboard:      http://127.0.0.1:3000  (via the reverse proxy in production)
- Public status:  http://127.0.0.1:3000/status
- Backend API:    http://127.0.0.1:3001/api
- Health check:   http://127.0.0.1:3001/health

Confirm the checker and mailer started:

```bash
docker compose logs -f backend
# [Mailer] SMTP ready (smtp.gmail.com) — recipients: you@tudelft.nl
# Backend running on port 3001
# Checker started — polling every 5 minutes
```

---

## CI/CD pipeline

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) with
two jobs:

1. **build** — runs on every push and PR on a GitHub-hosted `ubuntu-latest`
   runner. Installs and builds both the backend (`tsc`) and frontend
   (`tsc && vite build`) so a broken build is caught before it reaches the
   server.
2. **deploy** — runs only on pushes to `main` (and manual *Run workflow*), on a
   **self-hosted runner on edu01**. It simply runs `./deploy.sh` locally, which
   git-pulls `origin/main`, rebuilds, and health-checks.

### Why a self-hosted runner

GitHub-hosted runners connect from public cloud IPs, and the
`student-linux.tudelft.nl` gateway filters by source IP — connections from
those runners time out (`dial tcp …:22: i/o timeout`). So SSH-from-the-runner
is a dead end. Instead, a runner installed **on edu01** dials *out* to GitHub
(only outbound is needed, which the campus firewall allows) and executes the
deploy locally — no inbound SSH, no jump host, no secrets.

```
edu01  ──outbound HTTPS──▶  GitHub  (runner polls for jobs)
   └─ runs ./deploy.sh locally on the same host
```

### Register the runner on edu01

In **Settings → Actions → Runners → New self-hosted runner** (Linux x64), GitHub
shows a `./config.sh` command with a one-time token. Run it on edu01 and give it
the label `edu01` (matching `runs-on: [self-hosted, edu01]` in the workflow):

```bash
# On edu01, in your home dir
mkdir -p ~/actions-runner && cd ~/actions-runner
# (paste the download + tar commands GitHub gives you, then:)
./config.sh --url https://github.com/TUDelft-MUDE/Mude_monitoring \
            --token <ONE_TIME_TOKEN> --labels edu01 --unattended

# Keep it running across logout/reboot as a systemd service (needs sudo):
sudo ./svc.sh install $(whoami)
sudo ./svc.sh start
```

The runner runs as your user, so it has `docker`-group access and owns
`~/Mude_monitoring` (with its untracked `.env`). Nothing else to configure —
push to `main` and the deploy job fires.

> **Public-repo caution:** a self-hosted runner on a public repo can be abused by
> malicious fork PRs. This is mitigated here because the **build** job runs on
> GitHub-hosted runners and the **deploy** job is gated to `push` on `main`
> (never `pull_request`). Keep *Settings → Actions → Fork pull request workflows*
> set to **require approval**, and don't loosen the deploy job's `if:` guard.

---

## Local development (hot reload)

```bash
# Terminal 1 — backend
cd backend
npm install
SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... npm run dev

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Leaving `SMTP_HOST` unset disables email alerts (handy for dev) — the checker
still runs and the dashboard works normally.

---

## Environment variables (`.env`)

Copy `.env.example` to `.env` and fill in real values. `.env` is git-ignored —
**never commit it.**

```env
# SMTP email alerts (replaces AWS SNS)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=MUDE Monitor <your-account@gmail.com>

# Public base URL of the dashboard (used in alert links).
# Dedicated vhost — the edu01 root already hosts another site.
PUBLIC_URL=https://mude-monitoring.citg.tudelft.nl

# API key — required to add/delete targets (openssl rand -hex 32)
API_KEY=your-strong-random-key-here

# CORS — comma-separated allowed frontend origins
ALLOWED_ORIGINS=https://mude-monitoring.citg.tudelft.nl

# Microsoft Teams webhook (optional — omit to disable Teams alerts)
TEAMS_WEBHOOK_URL=
```

### Why SMTP works on a school server

The server does **not** run its own mail server. The Node app only makes an
**outbound** connection to an SMTP relay. Two common options:

1. **University SMTP relay** (e.g. `smtp.tudelft.nl:587`) — inside the campus
   network this often needs no authentication, or your normal account login.
2. **Gmail SMTP** (`smtp.gmail.com:587` + a 16-char
   [app password](https://myaccount.google.com/apppasswords)) — works anywhere.

---

## HTTPS — dedicated vhost on the host nginx

The Docker stack only binds `127.0.0.1:3000` (frontend) and `127.0.0.1:3001`
(backend). Expose it through a **separate** host-nginx server block — the edu01
root already serves another site, so use a dedicated name like
`mude-monitoring.citg.tudelft.nl`.

> **DNS first:** the subdomain must resolve to edu01's IP. If you don't control
> citg DNS, request an A record (or CNAME → edu01) from the faculty IT before
> the `server_name` below will work.

```bash
sudo tee /etc/nginx/sites-available/mude-monitoring << 'EOF'
server {
    listen 80;
    server_name mude-monitoring.citg.tudelft.nl;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/mude-monitoring /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue a cert for the new name (adds the 443 server block automatically):
sudo certbot --nginx -d mude-monitoring.citg.tudelft.nl
```

The docker frontend already proxies `/api/*` to the backend internally, so the
host nginx only needs the single `location /` above. Name-based virtual hosting
means this coexists with the existing edu01 site — no port conflict.

`PUBLIC_URL` and `ALLOWED_ORIGINS` in `.env` are already set to the `https://`
name; after DNS + cert are live just restart:

```bash
./deploy.sh
```

---

## Updating a running deployment

```bash
cd ~/Mude_monitoring
./deploy.sh          # git pull + rebuild + restart + health check
```

The SQLite database lives in the `db_data` Docker volume and survives rebuilds.

---

## Configuration files

| File | Purpose |
|------|---------|
| `backend/targets.json` | Seed list of monitored URLs (`INSERT OR IGNORE` on startup) |
| `backend/alerts.json` | Email recipients for DOWN/UP alerts — plain list, no confirmation |
| `backend/maintenance.json` | Maintenance windows during which alerts are suppressed |

Changes to these require a redeploy (`./deploy.sh`). Targets added through the
dashboard UI are stored in the database and persist.

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
