# Northpoint Roleplay CAD

Public community CAD for Northpoint Roleplay. The live frontend is published from this repo with GitHub Pages:

**https://freddyfoxyten1.github.io/NRP_CAD/**

GitHub Pages is the static website. Discord login, member counts, and CAD data come from the API, which uses your Discord bot and Supabase Postgres.

The Pages build calls `https://nrp-cad-api.onrender.com`. Create that API once on [Render](https://render.com) from this repo (`render.yaml`), and paste these **environment values** in the Render dashboard (do not put them in git):

- `DATABASE_URL` — Supabase session pooler URI
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN`

In the [Discord Developer Portal](https://discord.com/developers/applications) OAuth2 redirects, add:

- `http://localhost:5173/dojcad/discord-callback`
- `https://freddyfoxyten1.github.io/NRP_CAD/dojcad/discord-callback`

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
