import pg from "pg";
import { postgresPoolConfig } from "./postgres-url";
import { ensurePostgresSchema } from "./bootstrap-postgres";

const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) {
  console.error("DATABASE_URL is missing. Add your Supabase Postgres URI to .env");
  process.exit(1);
}
if (/\[YOUR-PASSWORD\]/i.test(url) || /:YOUR_PASSWORD@/i.test(url) || /:PASSWORD@/i.test(url)) {
  console.error("Replace the password placeholder in DATABASE_URL with the real database password.");
  process.exit(1);
}

const pool = new pg.Pool(postgresPoolConfig(url));
try {
  const ping = await pool.query("SELECT current_database() AS db, current_user AS \"user\", NOW() AS now");
  console.log("Connected:", ping.rows[0]);
  await ensurePostgresSchema(pool);
  const tables = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  console.log(`Schema ready (${tables.rows.length} public tables):`);
  for (const row of tables.rows) console.log(`  - ${row.tablename}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Postgres setup failed:", message);
  if (/ENOTFOUND|EAI_AGAIN/i.test(message) && /db\.[^.]+\.supabase\.co/i.test(url)) {
    console.error(
      "Direct Supabase hosts are IPv6-only. Use the IPv4 session pooler from Dashboard → Connect:",
    );
    console.error(
      "postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require",
    );
  }
  process.exit(1);
} finally {
  await pool.end();
}
