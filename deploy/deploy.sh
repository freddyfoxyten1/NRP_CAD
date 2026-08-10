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

echo "==> 1/5 Pulling latest code..."
cd "$REPO_DIR"
git pull

echo "==> 2/5 Installing dependencies..."
bun install

echo "==> 3/5 Building (API + frontend)..."
bun run build

echo "==> 4/5 Ensuring frontend is readable by nginx..."
chown -R www-data:www-data "$REPO_DIR/artifacts/dojrp/dist/public" 2>/dev/null || true

echo "==> 5/5 Restarting API via bm2..."
if bm2 list 2>/dev/null | grep -q "$API_NAME"; then
  bm2 restart "$API_NAME"
else
  bm2 start ecosystem.config.js
fi

echo ""
echo "✅ Deploy complete!"
echo "   Frontend: https://cad.dojrblx.com/"
echo "   API:      https://cad.dojrblx.com/api/healthz"