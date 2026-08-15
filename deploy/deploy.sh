#!/bin/bash
# ============================================================================
# DOJCAD one-command deploy
#
# Usage:  sudo bash deploy/deploy.sh
#
# This assumes /var/www/dojcad is the SINGLE source of truth (the git repo).
# It pulls the latest code, installs deps, builds, and restarts the API.
# ============================================================================
set -e  # stop on any error

REPO_DIR="/var/www/dojcad"
API_NAME="dojcad-api"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "ERROR: $REPO_DIR is not a git repository."
  echo "You must clone the repo there first, e.g.:"
  echo "  sudo mkdir -p /var/www"
  echo "  sudo git clone https://github.com/DOJ-Development/DOJCAD.git $REPO_DIR"
  echo "  sudo chown -R \$USER:\$USER $REPO_DIR"
  exit 1
fi

echo "==> 1/6 Pulling latest code..."
cd "$REPO_DIR"
git pull

echo "==> 2/6 Installing dependencies..."
bun install

echo "==> 3/6 Building (API + frontend)..."
bun run build

echo "==> 4/6 Ensuring frontend is readable by nginx..."
chown -R www-data:www-data "$REPO_DIR/artifacts/dojrp/dist/public" 2>/dev/null || true

echo "==> 5/6 Restarting API via bm2..."
if bm2 list 2>/dev/null | grep -q "$API_NAME"; then
  bm2 restart "$API_NAME"
else
  bm2 start ecosystem.config.js
fi

echo "==> 6/6 Verifying API + database..."
HEALTH_OK=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:8080/api/healthz" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: API health check failed after 60s. Run: bm2 logs $API_NAME --lines 50"
  exit 1
fi

DB_HEALTH="$(curl -sf "http://127.0.0.1:8080/api/health/db" || true)"
if [ -n "$DB_HEALTH" ]; then
  echo "   Database: $DB_HEALTH"
  if echo "$DB_HEALTH" | grep -q '"dataStore":"mongo"'; then
    if ! echo "$DB_HEALTH" | grep -q '"mongo":true'; then
      echo "ERROR: DATA_STORE=mongo but Mongo ping failed. Check MONGODB_URI in .env"
      exit 1
    fi
    # Roster sorting and other API changes use existing Mongo fields (sort_order, callsign).
    # Re-run ETL only when intentionally syncing a SQL backup into Atlas:
    #   SYNC_SQL_TO_MONGO=1 bun run migrate:mongo
    if [ "${SYNC_SQL_TO_MONGO:-}" = "1" ] && [ -f "$REPO_DIR/cad-database/dojcad.sqlite" ]; then
      echo "==> Syncing SQL backup → Mongo (SYNC_SQL_TO_MONGO=1)..."
      bun run migrate:mongo
      bun run migrate:mongo:verify
    fi
  fi
fi

VERSION_JSON="$(curl -sf "http://127.0.0.1:8080/api/health/version" || true)"
echo ""
echo "✅ Deploy complete! (git $(git rev-parse --short HEAD))"
if [ -n "$VERSION_JSON" ]; then
  echo "   Running build: $VERSION_JSON"
fi
echo "   Frontend: https://cad.dojrblx.com/"
echo "   API:      https://cad.dojrblx.com/api/healthz"
echo "   Version:  https://cad.dojrblx.com/api/health/version"