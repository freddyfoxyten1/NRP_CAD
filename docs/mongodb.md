# MongoDB Architecture (DOJCAD)

MongoDB Atlas is the only database on GitHub and the VPS (`cad.dojrblx.com`).
Local SQLite (`cad-database/`) is not used in production.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATA_STORE` | Must be `mongo` on GitHub/VPS. Production ignores SQL. |
| `MONGODB_URI` | Atlas connection string (required in production) |
| `MONGODB_DATABASE` | Database name (default `dojcad`) |
| `REDIS_URL` | Redis for admin member cache |
| `DATABASE_URL` | Optional Postgres for one-time ETL only — not a runtime store |

Never commit production credentials.

## Boot

On API start (`artifacts/api-server/src/index.ts`):

1. `initDataStores()` connects Mongo (when URI set or `DATA_STORE=mongo`) and Redis (when `REDIS_URL` set)
2. Creates indexes via `ensureMongoIndexes`
3. Health: `GET /api/health/db`

## Collections

Key collections: `users`, `settings`, `audit_logs`, `media`, `resources`, `gallery`, `press`, `store_products`, `announcements`, `portal_content`, roster tables (`staff_*`, `dps_*`, `dph_*`, `doc_*`), CAD tables (`civilians`, `vehicles`, `calls`, …), `id_counters`, `migration_state`.

Numeric API `id` fields are preserved. Mongo `_id` is ObjectId.

## Files / GridFS

- Bucket name: `uploads`
- Images: `media` metadata + GridFS; served at `/api/images/:id`
- PDFs: `resources` metadata (`department`: staff|dps|dph) + GridFS; served at department file routes

## Member caching (Redis)

| Key | Meaning |
|-----|---------|
| `members:list:page:{n}:limit:{l}:q:{hash}` | Paginated admin member summaries |
| `members:id:{id}` | Optional per-member summary |
| `members:lock:*` | Single-flight refresh locks |

- List TTL ~90s; never caches password hashes/salts
- Invalidation: `invalidateMemberCaches(id?)` on create/update/delete
- If Redis is down, API falls back to Mongo (degraded, still works)

Admin members:

- `GET /api/admin/members?page=1&limit=25&q=` → paginated + cache
- `GET /api/admin/members?all=1` → full summary list for staff tooling

## SQL compatibility bridge

When `DATA_STORE=mongo`, `pool.query` is backed by `mongo-sql-bridge` for common Postgres-flavored SQL used in existing routes. Prefer repositories (`mediaRepo`, `usersRepo`, `contentRepo`, …) for new code.

## Migration (SQL → Mongo)

From repo root (with SQL data available and `MONGODB_URI` set):

```bash
bun run --cwd lib/db migrate:mongo
bun run --cwd lib/db migrate:mongo:verify
```

- Resumable via `migration_state`
- Copies binaries into GridFS
- Does **not** delete SQL data
- After verify: keep `DATA_STORE=mongo` in deployment. Do not switch production back to SQL.

## Backup / restore

- Prefer **Atlas continuous backup / snapshots** for production
- Logical backup: `mongodump --uri="$MONGODB_URI" --db=dojcad`
- Restore: `mongorestore --uri="$MONGODB_URI" --db=dojcad dump/dojcad`
- Verify restore with `migrate:mongo:verify` counts (or spot-check critical collections)
- Do not run or restore SQLite on the VPS

## Cutover checklist

1. Set `MONGODB_URI` (+ optional `REDIS_URL`) in the VPS `.env`
2. Keep `DATA_STORE=mongo` and `NODE_ENV=production`
3. Confirm `GET /api/health/db` reports `"dataStore":"mongo"` and `"mongo":true`
4. Do not create or restore `cad-database/dojcad.sqlite` on GitHub or the VPS

When `DATA_STORE=mongo`, request handlers use Mongo repositories + the SQL bridge; the SQL pool is not opened in production.

## Local development

1. Copy `.env.example` → `.env`
2. Set `MONGODB_URI` (required) and optional `REDIS_URL`
3. Keep `DATA_STORE=mongo` — the API and website read/write Atlas (GridFS for files)

## Troubleshooting

| Symptom | Check |
|---------|--------|
| API exits on boot | `DATA_STORE=mongo` but bad/missing `MONGODB_URI` |
| Cache always MISS | `REDIS_URL` missing/unreachable (app still works) |
| `[redis] error: getaddrinfo ENOTFOUND` | `REDIS_URL` hostname invalid — leave empty if no Redis, or fix the URL; API works without cache |
| Image 404 after cutover | Run ETL for `dps_images` / confirm GridFS files |
| Bridge SQL error | Log shows unsupported SQL — migrate that path to a repository |
