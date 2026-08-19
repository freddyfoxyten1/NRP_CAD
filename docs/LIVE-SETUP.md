# Live site: northpointrp.xyz

GitHub Pages serves the frontend. **Discord login, member count, and online count need the API** at `https://nrp-cad-api.onrender.com`.

## 1. Create the API on Render (one time)

1. Open [Render → New Blueprint](https://dashboard.render.com/select-repo?type=blueprint) and connect **freddyfoxyten1/NRP_CAD**.
2. Render reads `render.yaml` and creates **nrp-cad-api**.
3. When prompted, set these **secret** environment variables (same values as your local `.env`):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase session pooler URI |
   | `DISCORD_CLIENT_ID` | `1539474351752224789` |
   | `DISCORD_CLIENT_SECRET` | *(from Discord portal)* |
   | `DISCORD_BOT_TOKEN` | *(from Discord portal)* |

4. Wait for the deploy to finish. Check: `https://nrp-cad-api.onrender.com/api/healthz` → `{"status":"ok"}`.

Optional: copy the service **Deploy Hook** URL into GitHub repo secret `RENDER_DEPLOY_HOOK` so pushes auto-redeploy the API.

## 2. Discord OAuth redirect

In [Discord Developer Portal](https://discord.com/developers/applications/1539474351752224789/oauth2) → **Redirects**, add:

```
https://northpointrp.xyz/dojcad/discord-callback
```

Keep localhost for local preview:

```
http://localhost:5173/dojcad/discord-callback
```

## 3. GitHub Pages

Pushes to `cursor/vps-deploy-ia-roster-fixes` rebuild Pages automatically. The build sets `VITE_API_URL=https://nrp-cad-api.onrender.com`.

Override with repo variable `VITE_API_URL` if your Render URL differs.

## 4. Verify live data

- **Member / online counts:** `https://nrp-cad-api.onrender.com/api/public/stats`
- **Database:** `https://nrp-cad-api.onrender.com/api/health/db` → `"dataStore":"postgres","ok":true`
- **Sign in:** https://northpointrp.xyz → Staff Login with Discord
