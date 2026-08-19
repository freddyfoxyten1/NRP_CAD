# Northpoint Roleplay CAD

Public community CAD for Northpoint Roleplay. The live site is published with GitHub Pages on a custom domain:

**https://northpointrp.xyz**

GitHub Pages serves the static website. Discord login, member counts, and CAD data come from the API (`nrp-cad-api` on Render), which uses your Discord bot and Supabase Postgres.

**Setup guide:** [`docs/LIVE-SETUP.md`](docs/LIVE-SETUP.md)

The Pages build calls `https://nrp-cad-api.onrender.com`. Deploy the API with:

```bash
# Add RENDER_API_KEY to .env, then:
bun run render:setup
```

Or use [Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint) once, then paste these **environment values** in the Render dashboard (do not put them in git):

- `DATABASE_URL` — Supabase session pooler URI
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN`

In the [Discord Developer Portal](https://discord.com/developers/applications) OAuth2 redirects, add:

- `http://localhost:5173/dojcad/discord-callback`
- `https://northpointrp.xyz/dojcad/discord-callback`

```bash
bun install
bun run preview
```

That starts a **local live-reload preview** at http://localhost:5173/ — save a file and the browser updates. Nothing is committed or pushed until you do it yourself.

| Command | What it does |
|---|---|
| `bun run preview` | Live reload of your unpublished files (use this while editing) |
| `bun run preview:edit` | Production-style build preview on port 4173 |
| `bun run preview:live` | Local files + live VPS data (cad.dojrblx.com) |
| `bun run render:setup` | Create/update Render API + sync secrets from `.env` |
| `bun run render:check` | Probe `https://nrp-cad-api.onrender.com/api/healthz` |
