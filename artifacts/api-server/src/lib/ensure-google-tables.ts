import { isMongoStore, pool } from "@workspace/db";

let ensured = false;

export async function ensureGoogleResourceTables(): Promise<void> {
  if (ensured || isMongoStore()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_integrations (
      id              serial PRIMARY KEY,
      created_by      text,
      email           text NOT NULL,
      google_user_id  text NOT NULL UNIQUE,
      refresh_token   text NOT NULL DEFAULT '',
      access_token    text NOT NULL DEFAULT '',
      token_expiry    text,
      created_at      timestamptz NOT NULL DEFAULT NOW(),
      updated_at      timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  for (const table of ["dps_resources", "dph_resources", "staff_resources"]) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS google_file_id text`);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS google_integration_id integer`);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS google_modified_time text`);
  }
  ensured = true;
}
