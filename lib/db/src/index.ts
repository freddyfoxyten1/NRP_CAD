import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { createLocalSqlitePool } from "./local-sqlite-pool";

const { Pool } = pg;

function createPool(): pg.Pool {
  if (process.env.DATABASE_URL) {
    console.info("[db] Using Postgres via DATABASE_URL");
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }

  return createLocalSqlitePool();
}

export const pool = createPool();
export const db = drizzle(pool, { schema });

export * from "./schema";
