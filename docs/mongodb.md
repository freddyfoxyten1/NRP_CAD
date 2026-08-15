# MongoDB Architecture (DOJCAD)

MongoDB Atlas is the target authoritative database. SQL (SQLite/Postgres via `pool`) remains available until cutover.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATA_STORE` | `mongo` (preferred) or `sql`; if unset, mongo when `MONGODB_URI` is set |
| `MONGODB_URI` | Atlas connection string |
| `MONGODB_DATABASE` | Database name (default `dojcad`) |
| `REDIS_URL` | Redis for admin member cache |
| `DATABASE_URL` | Optional Postgres for SQL mode / ETL source |
| `CAD_DATABASE_PATH` | Optional SQLite directory for SQL mode / ETL source |

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
- After verify: set `DATA_STORE=mongo` in deployment

## Backup / restore

- Prefer **Atlas continuous backup / snapshots** for production
- Logical backup: `mongodump --uri="$MONGODB_URI" --db=dojcad`
- Restore: `mongorestore --uri="$MONGODB_URI" --db=dojcad dump/dojcad`
- Verify restore with `migrate:mongo:verify` counts (or spot-check critical collections)
- Keep a SQL backup (`cad-database/dojcad.sqlite` or `pg_dump`) until soak period ends

## Cutover checklist

1. Backup SQL (`cad-database/dojcad.sqlite` or `pg_dump`)
2. Set `MONGODB_URI` (+ optional `REDIS_URL`) in deploy env
3. Run `bun run migrate:mongo` then `bun run migrate:mongo:verify` (exit 0)
4. Smoke-test against Atlas with a staging `DATA_STORE=mongo` instance
5. Set production `DATA_STORE=mongo`
6. Keep SQL files for a soak period — do not delete until verified

When `DATA_STORE=mongo`, request handlers use Mongo repositories + the SQL bridge; the SQL pool is not used for requests. ETL still reads SQL as the migration source.

## Local development

1. Copy `.env.example` → `.env`
2. Set `MONGODB_URI` (required) and optional `REDIS_URL`
3. Run ETL once from existing SQLite/Postgres: `bun run migrate:mongo`
4. Keep `DATA_STORE=mongo` — the API and website read/write Mongo (GridFS for files)
5. Use `DATA_STORE=sql` only as an emergency fallback

## Troubleshooting

| Symptom | Check |
|---------|--------|
| API exits on boot | `DATA_STORE=mongo` but bad/missing `MONGODB_URI` |
| Cache always MISS | `REDIS_URL` missing/unreachable (app still works) |
| `[redis] error: getaddrinfo ENOTFOUND` | `REDIS_URL` hostname invalid — leave empty if no Redis, or fix the URL; API works without cache |
| Image 404 after cutover | Run ETL for `dps_images` / confirm GridFS files |
| Bridge SQL error | Log shows unsupported SQL — migrate that path to a repository |
