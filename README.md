# Northpoint Roleplay CAD

Public community CAD for Northpoint Roleplay.

**Production site:** https://northpointrp.xyz — published with **GitHub Pages** (free) on the custom domain.

The **API** runs on Render (`nrp-cad-api`) with **Supabase Postgres**. Discord counts can fall back to a Supabase Edge Function.

**Setup guide:** [`docs/LIVE-SETUP.md`](docs/LIVE-SETUP.md)

Deploy the API with:

```bash
# Add RENDER_API_KEY to .env, then:
bun run render:setup
```

In the [Discord Developer Portal](https://discord.com/developers/applications) OAuth2 redirects, add:

- `http://localhost:5173/dojcad/discord-callback`
- `https://northpointrp.xyz/dojcad/discord-callback`
- `https://www.northpointrp.xyz/dojcad/discord-callback`

```bash
bun install
bun run dev:live
```

Live-reload preview at http://localhost:5173/ — UI from this repo, API from Render, stats from Supabase.

| Command | What it does |
|---|---|
| `bun run dev:live` | Live preview + Render API + Supabase stats URL |
| `bun run dev` | Offline preview (local SQLite only) |
| `bun run render:setup` | Create/update Render API + sync secrets from `.env` |
| `bun run supabase:deploy-stats` | Deploy Supabase Discord count function |
