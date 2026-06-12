#!/usr/bin/env bash
#
# deploy.sh — build & (re)start the MUDE monitoring stack on edu01.
#
# Run this ON the server, from the repo root:
#   cd ~/Mude_monitoring && ./deploy.sh
#
# It is also the script invoked remotely by the GitHub Actions workflow.
# Idempotent: safe to run repeatedly. The SQLite DB lives in the
# `db_data` Docker volume and survives rebuilds.
#
set -euo pipefail

# Resolve the repo root (directory containing this script) so the script
# works no matter where it is called from.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; }

# ── Pick the right compose command (plugin vs legacy) ────────────────
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  err "Neither 'docker compose' nor 'docker-compose' found on PATH."
  exit 1
fi
log "Using compose command: $COMPOSE"

# ── Pre-flight checks ────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  err ".env not found in $REPO_DIR"
  err "Create it first:  cp .env.example .env && nano .env"
  exit 1
fi

# ── Pull latest code (skip if not a git checkout, e.g. CI rsync) ─────
if [[ -d .git ]]; then
  BRANCH="${DEPLOY_BRANCH:-main}"
  log "Fetching latest code (branch: $BRANCH)…"
  git fetch --quiet origin "$BRANCH"
  git checkout --quiet "$BRANCH"
  git reset --hard --quiet "origin/$BRANCH"
fi

# ── Build & restart ──────────────────────────────────────────────────
log "Building images…"
$COMPOSE build

log "Restarting stack…"
$COMPOSE up -d --remove-orphans

# ── Health check ─────────────────────────────────────────────────────
log "Waiting for backend health check…"
HEALTH_URL="http://127.0.0.1:3001/health"
ok=0
for i in $(seq 1 20); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -eq 1 ]]; then
  log "Backend healthy ✓  ($HEALTH_URL)"
else
  err "Backend did not become healthy within ~40s. Recent logs:"
  $COMPOSE logs --tail 40 backend || true
  exit 1
fi

# Front-end (nginx) reachability — non-fatal, just informational.
if curl -fsS "http://127.0.0.1:3000/" >/dev/null 2>&1; then
  log "Frontend reachable ✓  (http://127.0.0.1:3000/)"
else
  log "Frontend not reachable yet on :3000 (may still be starting)."
fi

log "Deploy complete."
$COMPOSE ps
