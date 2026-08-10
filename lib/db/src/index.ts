import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { createLocalSqlitePool } from "./local-sqlite-pool";
import { getDataStore, isMongoStore } from "./data-store";
import { connectMongo, closeMongo, pingMongo } from "./mongo";
import { connectRedis, closeRedis, pingRedis } from "./redis";
import { ensureMongoIndexes } from "./ensure-indexes";
import { createMongoPoolFacade } from "./mongo-sql-bridge";

const { Pool } = pg;

function createSqlPool(): pg.Pool {
  if (process.env.DATABASE_URL) {
    console.info("[db] Using Postgres via DATABASE_URL");
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }

  return createLocalSqlitePool();
}

/** Minimal pool surface shared by SQL (pg/SQLite) and the Mongo SQL bridge. */
// Default T is `any` to preserve historical untyped `pool.query(...)` call sites.
export type DbQueryResult<T = any> = {
  rows: T[];
  rowCount: number | null;
};

export type DbPool = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: <T = any>(
    text: string,
    params?: unknown[],
  ) => Promise<DbQueryResult<T>>;
  connect: () => Promise<{
    query: DbPool["query"];
    release: () => void;
  }>;
  end: () => Promise<void>;
  on: (...args: unknown[]) => unknown;
};

/**
 * Shared query pool.
 * - DATA_STORE=sql (default): SQLite or Postgres
 * - DATA_STORE=mongo: Mongo SQL bridge facade (same pool.query API)
 */
const sqlPool = isMongoStore() ? null : createSqlPool();

export const pool: DbPool = (
  isMongoStore() ? createMongoPoolFacade() : sqlPool
) as unknown as DbPool;

export const db = isMongoStore()
  ? (null as unknown as ReturnType<typeof drizzle>)
  : drizzle(sqlPool as pg.Pool, { schema });

export * from "./schema";
export * from "./data-store";
export {
  connectMongo,
  closeMongo,
  pingMongo,
  getDb,
  getCollection,
  getUploadsBucket,
} from "./mongo";
export {
  connectRedis,
  closeRedis,
  pingRedis,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelByPrefix,
} from "./redis";
export { nextId, ensureCounterAtLeast } from "./counters";
export { ensureMongoIndexes } from "./ensure-indexes";

export * as mediaRepo from "./repositories/media";
export * as resourcesRepo from "./repositories/resources";
export * as settingsRepo from "./repositories/settings";
export * as auditRepo from "./repositories/audit";
export * as usersRepo from "./repositories/users";
export * as contentRepo from "./repositories/content";
export * as collectionsRepo from "./repositories/collections";
export {
  getCachedMemberPage,
  invalidateMemberCaches,
} from "./cache/members-cache";

/** Connect Mongo (+ Redis) when DATA_STORE=mongo, or when MONGODB_URI is set for hybrid/ETL. */
export async function initDataStores(): Promise<{ mongo: boolean; redis: boolean }> {
  const wantMongo = isMongoStore() || Boolean((process.env.MONGODB_URI ?? "").trim());
  let mongoOk = false;
  let redisOk = false;

  if (wantMongo) {
    try {
      const database = await connectMongo();
      await ensureMongoIndexes(database);
      mongoOk = await pingMongo();
    } catch (err) {
      console.error("[db] MongoDB init failed:", err instanceof Error ? err.message : err);
      if (isMongoStore()) throw err;
    }
  }

  if ((process.env.REDIS_URL ?? "").trim()) {
    redisOk = await pingRedis();
  }

  console.info(
    `[db] DATA_STORE=${getDataStore()} mongo=${mongoOk ? "ok" : "off"} redis=${redisOk ? "ok" : "off"}`,
  );
  return { mongo: mongoOk, redis: redisOk };
}

export async function shutdownDataStores(): Promise<void> {
  await closeRedis();
  await closeMongo();
  if (!isMongoStore() && typeof pool?.end === "function") {
    await pool.end().catch(() => undefined);
  }
}
