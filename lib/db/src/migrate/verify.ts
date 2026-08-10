/**
 * Compare SQL vs Mongo counts for integrity checks.
 * Usage: bun --preload ../../scripts/load-env.mjs ./src/migrate/verify.ts
 */
process.env.DATA_STORE = "sql";

import pg from "pg";
import { createLocalSqlitePool } from "../local-sqlite-pool";
import { connectMongo, getCollection } from "../mongo";

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : createLocalSqlitePool();

const PAIRS: Array<[string, string, string?]> = [
  ["cad_user_profiles", "users"],
  ["cad_settings", "settings", "key"],
  ["cad_audit_logs", "audit_logs"],
  ["dps_images", "media"],
  ["public_gallery", "gallery"],
  ["public_press", "press"],
  ["public_store_products", "store_products"],
  ["cad_announcements", "announcements"],
  ["portal_content", "portal_content", "key"],
  ["moderations", "moderations"],
  ["staff_rank_groups", "staff_rank_groups"],
  ["staff_ranks", "staff_ranks"],
  ["dps_users", "dps_users"],
  ["dph_users", "dph_users"],
  ["doc_users", "doc_users"],
  ["cad_civilians", "civilians"],
  ["cad_vehicles", "vehicles"],
  ["cad_weapons", "weapons"],
  ["cad_calls", "calls"],
  ["cad_call_history", "call_history"],
];

/** Resource tables merge into one Mongo collection with a department discriminator. */
const RESOURCE_PAIRS: Array<[string, "staff" | "dps" | "dph"]> = [
  ["staff_resources", "staff"],
  ["dps_resources", "dps"],
  ["dph_resources", "dph"],
];

async function sqlCount(table: string): Promise<number | null> {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
    return Number(r.rows[0]?.c ?? 0);
  } catch {
    return null;
  }
}

async function mongoCount(collection: string): Promise<number> {
  const col = await getCollection(collection);
  return col.countDocuments();
}

async function main() {
  await connectMongo();
  let ok = true;
  console.info("SQL table | SQL count | Mongo collection | Mongo count | status");
  for (const [sqlTable, mongoCol] of PAIRS) {
    const s = await sqlCount(sqlTable);
    const m = await mongoCount(mongoCol);
    const status = s === null ? "SQL_MISSING" : s === m ? "OK" : "MISMATCH";
    if (status === "MISMATCH") ok = false;
    console.info(`${sqlTable} | ${s ?? "n/a"} | ${mongoCol} | ${m} | ${status}`);
  }

  for (const [sqlTable, department] of RESOURCE_PAIRS) {
    const s = await sqlCount(sqlTable);
    const col = await getCollection("resources");
    const m = await col.countDocuments({ department });
    const status = s === null ? "SQL_MISSING" : s === m ? "OK" : "MISMATCH";
    if (status === "MISMATCH") ok = false;
    console.info(`${sqlTable} | ${s ?? "n/a"} | resources[${department}] | ${m} | ${status}`);
  }

  // Orphan check: roster profile_id must exist in users
  const users = await getCollection("users");
  for (const roster of ["dps_users", "dph_users", "doc_users"] as const) {
    const rosterCol = await getCollection(roster);
    const rows = await rosterCol.find({}, { projection: { profile_id: 1, id: 1 } }).toArray();
    let orphans = 0;
    for (const u of rows) {
      if (u.profile_id == null) continue;
      const exists = await users.findOne({ id: u.profile_id }, { projection: { id: 1 } });
      if (!exists) orphans++;
    }
    console.info(`${roster} orphan profile_id count: ${orphans}`);
    if (orphans > 0) ok = false;
  }

  // Media / resource GridFS presence sample
  const media = await getCollection("media");
  const mediaMissing = await media.countDocuments({
    $or: [{ gridFsId: null }, { gridFsId: { $exists: false } }],
  });
  console.info(`media docs missing gridFsId: ${mediaMissing}`);
  if (mediaMissing > 0) ok = false;

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
