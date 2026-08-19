# Optional: Vercel hosting (not used — we stay on GitHub Pages)

This repo includes `vercel.json` if you ever want to switch. **Production uses GitHub Pages** at https://northpointrp.xyz.

See [`LIVE-SETUP.md`](LIVE-SETUP.md) for the active stack.

## Architecture

```
Browser → Vercel (northpointrp.xyz)     static React site
       → Render API (nrp-cad-api)       Discord login + CAD data (Supabase Postgres)
       → Supabase Edge Function         Discord member/online count fallback
```

## 1. Import the repo on Vercel

1. Open [vercel.com/new](https://vercel.com/new)
2. Import **freddyfoxyten1/NRP_CAD**
3. Branch: `cursor/vps-deploy-ia-roster-fixes` (or your active branch)
4. Vercel reads **`vercel.json`** automatically — do not override unless asked:
   - **Build command:** `bun run vercel:build`
   - **Output directory:** `artifacts/dojrp/dist/public`
   - **Install command:** `bun install`

## 2. Environment variables (Vercel project → Settings → Environment Variables)

| Variable | Value | Environments |
|---|---|---|
| `VITE_API_URL` | `https://nrp-cad-api.onrender.com` | Production, Preview, Development |
| `VITE_STATS_URL` | `https://vmkfcsbbzuzznwauzsxe.supabase.co/functions/v1/public-stats` | Production, Preview, Development |

Redeploy after adding variables.

## 3. Custom domain (move off GitHub Pages)

1. Vercel → Project → **Settings → Domains** → Add `northpointrp.xyz` and `www.northpointrp.xyz`
2. Update DNS at your registrar using the records Vercel shows (usually `A` + `CNAME`)
3. Wait for SSL (automatic on Vercel)
4. **Disable GitHub Pages** so it does not fight Vercel:
   - GitHub repo → **Settings → Pages → Source → None**

## 4. Discord OAuth redirects

In [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects, keep:

```
https://northpointrp.xyz/dojcad/discord-callback
https://www.northpointrp.xyz/dojcad/discord-callback
http://localhost:5173/dojcad/discord-callback
```

Optional for Vercel preview URLs (each preview gets its own URL):

```
https://YOUR-PROJECT.vercel.app/dojcad/discord-callback
```

Discord does **not** support wildcard redirects for `*.vercel.app`.

## 5. Render API (already linked)

Render CORS allows `northpointrp.xyz` and `*.vercel.app` preview hosts in code.  
Re-sync Render if you changed secrets:

```bash
bun run render:setup
```

## 6. Supabase stats function

Deploy once (needs `SUPABASE_ACCESS_TOKEN` in `.env`):

```bash
bun run supabase:deploy-stats
```

Set function secrets: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID=1539452857592324116`.

## 7. Verify

| Check | URL |
|---|---|
| Site loads | https://northpointrp.xyz |
| API health | https://nrp-cad-api.onrender.com/api/healthz |
| DB (Supabase) | https://nrp-cad-api.onrender.com/api/health/db |
| Discord counts | Homepage Members / Online cards |
| Sign in | Login with Discord |

## CLI (optional)

```bash
npm i -g vercel
vercel login
vercel link          # in repo root
vercel env pull .env.local
vercel --prod        # deploy production
```

Add `VERCEL_TOKEN` to GitHub secrets if you want CI deploys later.
