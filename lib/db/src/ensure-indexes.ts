import type { Db, IndexDescription } from "mongodb";

async function ensure(collection: string, indexes: IndexDescription[], db: Db): Promise<void> {
  const col = db.collection(collection);
  for (const index of indexes) {
    try {
      await col.createIndexes([index]);
    } catch (err) {
      console.warn(`[mongo] index on ${collection} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Create indexes required by application query patterns. Idempotent. */
export async function ensureMongoIndexes(db: Db): Promise<void> {
  await ensure("users", [
    { key: { id: 1 }, unique: true, name: "users_id_uq" },
    { key: { email: 1 }, unique: true, sparse: true, name: "users_email_uq" },
    { key: { discord_id: 1 }, unique: true, sparse: true, name: "users_discord_id_uq" },
    { key: { username: 1 }, name: "users_username" },
    { key: { staff_rank: 1 }, name: "users_staff_rank" },
    { key: { status: 1 }, name: "users_status" },
    { key: { created_at: -1 }, name: "users_created_at" },
  ], db);

  await ensure("media", [
    { key: { id: 1 }, unique: true, name: "media_id_uq" },
    { key: { gridFsId: 1 }, name: "media_gridfs" },
    { key: { created_at: -1 }, name: "media_created_at" },
  ], db);

  await ensure("resources", [
    // IDs are unique per department (staff/dps/dph tables historically overlapped).
    { key: { department: 1, id: 1 }, unique: true, name: "resources_dept_id_uq" },
    { key: { gridFsId: 1 }, name: "resources_gridfs" },
    { key: { created_at: -1 }, name: "resources_created_at" },
  ], db);

  await ensure("settings", [
    { key: { key: 1 }, unique: true, name: "settings_key_uq" },
  ], db);

  await ensure("audit_logs", [
    { key: { id: 1 }, unique: true, name: "audit_id_uq" },
    { key: { category: 1, created_at: -1 }, name: "audit_category_created" },
  ], db);

  await ensure("gallery", [
    { key: { id: 1 }, unique: true, name: "gallery_id_uq" },
    { key: { deleted_at: 1, sort_order: 1, created_at: -1 }, name: "gallery_list" },
  ], db);

  await ensure("press", [
    { key: { id: 1 }, unique: true, name: "press_id_uq" },
    { key: { deleted_at: 1, created_at: -1 }, name: "press_list" },
  ], db);

  await ensure("store_products", [
    { key: { id: 1 }, unique: true, name: "store_id_uq" },
    { key: { deleted_at: 1, sort_order: 1, created_at: -1 }, name: "store_list" },
  ], db);

  await ensure("announcements", [
    { key: { id: 1 }, unique: true, name: "announcements_id_uq" },
    { key: { created_at: -1 }, name: "announcements_created" },
  ], db);

  await ensure("portal_content", [
    { key: { key: 1 }, unique: true, name: "portal_content_key_uq" },
  ], db);

  await ensure("moderations", [
    { key: { id: 1 }, unique: true, name: "moderations_id_uq" },
  ], db);

  for (const name of [
    "staff_rank_groups", "staff_ranks",
    "dps_rank_groups", "dps_ranks", "dps_users", "dps_divisions", "dps_division_ranks", "dps_user_divisions",
    "dph_rank_groups", "dph_ranks", "dph_users", "dph_divisions", "dph_division_ranks", "dph_user_divisions",
    "doc_rank_groups", "doc_ranks", "doc_users",
    "civilians", "vehicles", "weapons", "arrests", "citations", "warnings", "civilian_history",
    "calls", "call_history",
    "dps_fleet", "dps_fleet_categories", "dps_equipment", "dps_equipment_categories",
    "dps_events", "dps_content", "dps_resources",
    "dps_rank_custom_callsigns", "dps_division_rank_custom_callsigns",
    "dph_fleet", "dph_equipment", "dph_events", "dph_content", "dph_resources",
    "staff_resources", "staff_events", "doc_fleet",
  ]) {
    await ensure(name, [
      { key: { id: 1 }, unique: true, name: `${name}_id_uq` },
    ], db);
  }

  await ensure("dps_users", [{ key: { profile_id: 1 }, unique: true, sparse: true, name: "dps_users_profile_uq" }], db);
  await ensure("dph_users", [{ key: { profile_id: 1 }, unique: true, sparse: true, name: "dph_users_profile_uq" }], db);
  await ensure("doc_users", [{ key: { profile_id: 1 }, unique: true, sparse: true, name: "doc_users_profile_uq" }], db);
  await ensure("civilians", [
    { key: { first_name: 1, last_name: 1 }, name: "civilians_name" },
  ], db);
  await ensure("vehicles", [
    { key: { plate: 1 }, name: "vehicles_plate" },
  ], db);
}
