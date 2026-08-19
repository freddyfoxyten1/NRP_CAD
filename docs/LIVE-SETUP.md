# Live site: northpointrp.xyz

GitHub Pages serves the frontend only — it **does not read `.env`**. Discord member/online counts and sign-in need hosted backends with your secrets.

## Quick fix: Discord counts on the homepage (Supabase)

1. Open [Supabase → Edge Functions](https://supabase.com/dashboard/project/vmkfcsbbzuzznwauzsxe/functions) for project **vmkfcsbbzuzznwauzsxe**.
2. Deploy the **`public-stats`** function from this repo (`supabase/functions/public-stats/index.ts`), or add GitHub secret `SUPABASE_ACCESS_TOKEN` so the **Deploy Supabase public-stats** workflow runs on push.
3. In **Project Settings → Edge Functions → Secrets**, add (same values as your local `.env`):

   | Secret | Value |
   |---|---|
   | `DISCORD_BOT_TOKEN` | Your bot token |
   | `DISCORD_GUILD_ID` | `1539452857592324116` |

4. Test: `https://vmkfcsbbzuzznwauzsxe.supabase.co/functions/v1/public-stats`  
   Should return JSON with `discord_members` and `discord_online` (not both zero).

GitHub Pages is built with `VITE_STATS_URL` pointing at that URL, so the homepage uses it when Render is unavailable.

## Full CAD: API on Render (sign-in + database)

### Option A — one command (recommended after first Blueprint)

1. Create a Render [API key](https://dashboard.render.com/u/settings#api-keys) and add to local `.env`:
   ```
   RENDER_API_KEY=rnd_...
   ```
2. Ensure `.env` has `DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_BOT_TOKEN`.
3. Run:
   ```bash
   bun run render:setup
   ```
   This creates or updates **nrp-cad-api**, syncs env vars, runs `db:setup` on deploy, and checks `/api/healthz`.

   Check only: `bun run render:check`

### Option B — Blueprint (first time, no API key)

1. Open [Render → New Blueprint](https://dashboard.render.com/select-repo?type=blueprint) and connect **freddyfoxyten1/NRP_CAD** (branch `cursor/vps-deploy-ia-roster-fixes`).
2. Render creates **nrp-cad-api** from `render.yaml`.
3. Set these **secret** environment variables (copy from your local `.env`):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase session pooler URI |
   | `DISCORD_CLIENT_ID` | `1539474351752224789` |
   | `DISCORD_CLIENT_SECRET` | From Discord portal |
   | `DISCORD_BOT_TOKEN` | From Discord portal |
   | `DPS_DISCORD_GUILD_ID` | `1539660726338326571` (DPS Discord server) |
   | `DATA_STORE` | `sql` |
   | `DATABASE_URL` | Supabase session pooler URI (see `.env.example`) |

4. Check: `https://nrp-cad-api.onrender.com/api/healthz` → `{"status":"ok"}`.

### GitHub Actions (optional)

Add repo secrets: `RENDER_API_KEY`, `DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`.  
Run workflow **Sync Render env** to push secrets and redeploy without a local machine.

Optional: add Render **Deploy Hook** URL as GitHub secret `RENDER_DEPLOY_HOOK` (used by **Deploy API (Render)** on push).

## Discord OAuth redirect

In [Discord Developer Portal](https://discord.com/developers/applications/1539474351752224789/oauth2) → **Redirects**, add:

```
https://northpointrp.xyz/dojcad/discord-callback
```

Local preview:

```
http://localhost:5173/dojcad/discord-callback
```

## Verify live data

- **Homepage counts:** https://northpointrp.xyz (Members / Online cards)
- **Stats JSON (Supabase):** `https://vmkfcsbbzuzznwauzsxe.supabase.co/functions/v1/public-stats`
- **Stats JSON (Render):** `https://nrp-cad-api.onrender.com/api/public/live-stats`
- **Sign in:** Login with Discord on https://northpointrp.xyz
