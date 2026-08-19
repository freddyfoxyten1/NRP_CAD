# Northpoint Roleplay CAD

Public community CAD for Northpoint Roleplay. The live frontend is published from this repo with GitHub Pages:

**https://freddyfoxyten1.github.io/NRP_CAD/**

GitHub Pages serves the React app only. Discord login, rosters, and CAD data still need the API server (Bun + MongoDB) on a VPS. See `deploy/README.md`.

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
