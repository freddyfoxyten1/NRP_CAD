# CAD Database (local)

Local file-based CAD storage used when `DATABASE_URL` is not set.

- **Engine:** SQLite (`dojcad.sqlite`) via Node's built-in `node:sqlite`
- **Purpose:** Develop and run DOJCAD without Postgres
- **Later:** Set `DATABASE_URL` to your real Postgres instance; the app will use that instead

## Layout

```
cad-database/
  README.md
  dojcad.sqlite      # created automatically on first API start (gitignored)
```

Optional override:

```env
CAD_DATABASE_PATH=C:\path\to\custom\folder
```

The SQLite file is written as `dojcad.sqlite` inside that folder.
