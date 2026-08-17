# CAD Database (not used on GitHub / VPS)

This folder is **not** the production database. GitHub and `cad.dojrblx.com`
use MongoDB Atlas only (`DATA_STORE=mongo`).

SQLite here is leftover local/ETL storage only. Do not deploy or restore
`dojcad.sqlite` on the VPS.

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
