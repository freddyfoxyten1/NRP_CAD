# DOJCAD Production Deployment

This guide deploys DOJCAD to a Linux VPS behind nginx at **cad.dojrblx.com**
using **bun + bm2** exclusively — no pnpm, no node.

---

## Architecture (production)

```
Internet → nginx :443 (cad.dojrblx.com)
              ├── /api/*  → proxy → bun API on 127.0.0.1:8080  (managed by bm2)
              └── /*      → serve static files from artifacts/dojrp/dist/public
```

- **Frontend**: Vite + React, built by `bun` and served by nginx.
- **API**: Express 5, bundled by esbuild to a single ESM file, executed by **bun**
  under **bm2** (auto-restart, health-check, daemon persistence, boot startup).
- **DB**: Local SQLite at `cad-database/dojcad.sqlite` (auto-created). Set
  `DATABASE_URL` in `.env` to switch to Postgres.

---

## 1. Install bun + bm2 on the VPS

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # or ~/.zshrc

# Install bm2 (Bun Process Manager)
bun install -g bm2

# Verify
bun --version        # 1.3.x
bm2 --version        # 1.0.x
```

---

## 2. Install nginx + certbot

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 3. Clone & prepare the repo

```bash
# Clone to /var/www/dojcad (or your preferred location)
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/DOJ-Development/DOJCAD.git dojcad
cd dojcad

# Give your user ownership
sudo chown -R $USER:$USER /var/www/dojcad
```

---

## 4. Create `.env`

```bash
cp .env.example .env
nano .env
```

Set at minimum:

```env
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=823606319529066548
DISCORD_SERVER_NAME=DOJRP
DISCORD_INVITE_CODE=
DISCORD_REDIRECT_URI=https://cad.dojrblx.com/dojcad/discord-callback
STAFF_DISCORD_GUILD_ID=1411760639428399194
DPS_DISCORD_GUILD_ID=1469131277612486791
DIVISION_DISCORD_GUILD_ID=1469131277612486791
DPH_DISCORD_GUILD_ID=1519857439220957204
# Leave empty to use local SQLite (cad-database/dojcad.sqlite)
# DATABASE_URL=postgres://user:pass@localhost:5432/dojcad
SUPERADMIN_DISCORD_IDS=
ERLC_API_KEY=
ADMIN_PORTAL_CODE=ADMIN2026
WEB_PORT=5173
API_PORT=8080
```

> **Important**: update `DISCORD_REDIRECT_URI` to your production domain
> (`https://cad.dojrblx.com/dojcad/discord-callback`) — otherwise Discord OAuth
> breaks. Also add this URI to your Discord application's OAuth2 redirects.

---

## 5. Install dependencies + build (bun only)

> `bun run build` **must succeed before** starting bm2 — the API bundle
> (`artifacts/api-server/dist/index.mjs`) is gitignored and only exists after
> building.
>
> The API uses `bun:sqlite` (Bun's built-in SQLite) for the local database —
> if you change the DB layer, rebuild before restarting.

```bash
# Install all workspace dependencies
bun install

# Build everything (API + frontend)
bun run build
```

This produces:
- `artifacts/api-server/dist/index.mjs`  ← the bundled API (bun executes this)
- `artifacts/dojrp/dist/public/`         ← static frontend (nginx serves this)

Verify both exist:
```bash
ls -la artifacts/api-server/dist/index.mjs
ls -la artifacts/dojrp/dist/public/index.html
```

---

## 6. Start the API with bm2

The repo includes `ecosystem.config.js` (CJS, uses `__dirname` absolute paths
so bm2's daemon always resolves the bundle correctly):

```js
const path = require("node:path");
const repoRoot = __dirname; // repo root

module.exports = {
  apps: [
    {
      name: "dojcad-api",
      script: path.join(repoRoot, "artifacts", "api-server", "dist", "index.mjs"),
      interpreter: "bun",
      cwd: repoRoot,
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "500M",
      max_restarts: 10,
      env: { NODE_ENV: "production", API_PORT: "8080", WEB_PORT: "5173" },
      health_check_url: "http://127.0.0.1:8080/api/healthz",
    },
  ],
};
```

```bash
# Start the daemon + API (use the .js config — it uses __dirname absolute
# paths so bm2's daemon always finds the bundle)
bm2 start ecosystem.config.js

# Verify
bm2 list                       # should show dojcad-api online
bm2 logs dojcad-api --lines 20
curl http://127.0.0.1:8080/api/healthz   # → {"status":"ok"}
```

### Persist across reboots

```bash
bm2 save
bm2 startup install
```

The API will now auto-start on boot via the bm2 daemon.

---

## 7. Configure nginx

Copy the included site config (it serves on port 80 immediately — no TLS
needed to get started):

```bash
sudo cp deploy/nginx/dojcad.conf /etc/nginx/sites-available/dojcad.conf
sudo ln -s /etc/nginx/sites-available/dojcad.conf /etc/nginx/sites-enabled/dojcad.conf

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Validate + reload
sudo nginx -t
sudo systemctl reload nginx
```

> **Important**: the config's `root` points to `/root/DOJCAD/artifacts/dojrp/dist/public`.
> If you cloned the repo elsewhere, update that path in the config.

At this point `http://cad.dojrblx.com` should show the CAD (API proxied).
Verify:
```bash
curl http://cad.dojrblx.com/api/healthz   # → {"status":"ok"}
curl -sI http://cad.dojrblx.com/ | head -3  # → 200 text/html
```

---

## 8. Enable HTTPS with certbot

```bash
sudo certbot --nginx -d cad.dojrblx.com --redirect
```

Certbot auto-edits the nginx config to enable TLS and redirect HTTP→HTTPS.
Verify:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl https://cad.dojrblx.com/api/healthz
```

> The included `deploy/nginx/dojcad.conf` has the TLS server block commented
> out — certbot will handle TLS automatically. If you prefer to manage it
> manually, uncomment the `listen 443` block and fill in the cert paths.

---

## 9. Final verification

```bash
# Frontend
curl -sI https://cad.dojrblx.com/ | head -5        # 200, text/html
# API
curl https://cad.dojrblx.com/api/healthz            # {"status":"ok"}
# SPA fallback (client-side route)
curl -s https://cad.dojrblx.com/dojcad/ | head -c 100   # HTML, not 404
# SSE proxy (phone events)
curl -N https://cad.dojrblx.com/api/phone/events?username=test --max-time 5
```

---

## Routine operations

| Action                    | Command                                      |
|---------------------------|----------------------------------------------|
| View status               | `bm2 list`                                   |
| View logs                 | `bm2 logs dojcad-api --lines 100`            |
| Restart API               | `bm2 restart dojcad-api`                     |
| Stop API                  | `bm2 stop dojcad-api`                        |
| **Deploy latest code**    | `sudo bash deploy/deploy.sh`                 |
| Rebuild only API          | `cd artifacts/api-server && bun run build`  |
| Rebuild only frontend     | `cd artifacts/dojrp && bun run build`       |

> **Important**: `/var/www/dojcad` must be the **git repo itself** (not a copy).
> If you copied it from `/root/DOJCAD`, `git pull` in `/root/DOJCAD` won't
> update it. Migrate to a single source of truth (see below).

### Migrate to `/var/www/dojcad` as the single source of truth

If `/var/www/dojcad` is currently a copy (not a git repo), fix it once:

```bash
# 1. Stop the API (it's running from /root/DOJCAD)
bm2 stop dojcad-api

# 2. Remove the copy
sudo rm -rf /var/www/dojcad

# 3. Clone the real repo into /var/www/dojcad
sudo mkdir -p /var/www
sudo git clone https://github.com/DOJ-Development/DOJCAD.git /var/www/dojcad
sudo chown -R $USER:$USER /var/www/dojcad

# 4. Copy your .env (secrets) from the old location
cp /root/DOJCAD/.env /var/www/dojcad/.env

# 5. Install + build
cd /var/www/dojcad
bun install
bun run build

# 6. Start the API from the new location
bm2 start ecosystem.config.js
bm2 save

# 7. (Optional) remove the old /root/DOJCAD copy
# rm -rf /root/DOJCAD
```

After this, `/var/www/dojcad` is the single repo. Deploy updates with:
```bash
sudo bash /var/www/dojcad/deploy/deploy.sh
```

---

## Troubleshooting

**API won't start (port 8080 in use)**
```bash
sudo lsof -i :8080   # find the process
bm2 logs dojcad-api --lines 50
```

**Proxy 502 Bad Gateway**
The API isn't running or is on a different port. Verify:
```bash
bm2 list
curl http://127.0.0.1:8080/api/healthz
```

**401 on Discord login**
`DISCORD_REDIRECT_URI` must exactly match the URI registered in the Discord
Developer Portal (no trailing slash, `https://cad.dojrblx.com/dojcad/discord-callback`).

**Database**
Local SQLite lives at `cad-database/dojcad.sqlite`. Back it up regularly:
```bash
sqlite3 cad-database/dojcad.sqlite ".backup backup-$(date +%F).sqlite"
```
To migrate to Postgres later, set `DATABASE_URL` in `.env`.