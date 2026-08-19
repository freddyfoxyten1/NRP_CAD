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

1. Open [Render → New Blueprint](https://dashboard.render.com/select-repo?type=blueprint) and connect **freddyfoxyten1/NRP_CAD**.
2. Render creates **nrp-cad-api** from `render.yaml`.
3. Set these **secret** environment variables (copy from your local `.env`):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase session pooler URI |
   | `DISCORD_CLIENT_ID` | `1539474351752224789` |
   | `DISCORD_CLIENT_SECRET` | From Discord portal |
   | `DISCORD_BOT_TOKEN` | From Discord portal |

4. Check: `https://nrp-cad-api.onrender.com/api/healthz` → `{"status":"ok"}`.

Optional: add Render **Deploy Hook** URL as GitHub secret `RENDER_DEPLOY_HOOK`.

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
- **Stats JSON (Render):** `https://nrp-cad-api.onrender.com/api/public/stats`
- **Sign in:** Staff Login with Discord on https://northpointrp.xyz
