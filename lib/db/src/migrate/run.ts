/**
 * Resumable SQL → MongoDB ETL.
 * Usage: bun --preload ../../scripts/load-env.mjs ./src/migrate/run.ts
 *
 * Requires MONGODB_URI. Reads from the current SQL pool (SQLite/Postgres).
 */
// Always read from SQL during ETL (ignore DATA_STORE=mongo for the source).
process.env.DATA_STORE = "sql";

import pg from "pg";
import { createLocalSqlitePool } from "../local-sqlite-pool";
import { connectMongo, getUploadsBucket, getCollection } from "../mongo";
import { ensureMongoIndexes } from "../ensure-indexes";
import { ensureCounterAtLeast } from "../counters";
import { writeGridFs } from "../repositories/media";
import { upsertUserMigration, type UserDoc } from "../repositories/users";
import { upsertMediaFromMigration, type MediaDoc } from "../repositories/media";
import { upsertResourceMigration, type ResourceDoc } from "../repositories/resources";
import { setSetting } from "../repositories/settings";
import { upsertAuditMigration, type AuditLogDoc } from "../repositories/audit";
import { upsertById } from "../repositories/generic";

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : createLocalSqlitePool();

type Report = {
  table: string;
  discovered: number;
  migrated: number;
  failed: number;
  skipped: number;
  errors: string[];
};

const reports: Report[] = [];

async function markState(table: string, lastId: number, status: string) {
  const col = await getCollection("migration_state");
  await col.updateOne(
    { table },
    { $set: { table, lastId, status, updated_at: new Date().toISOString() } },
    { upsert: true },
  );
}

async function migrateTable(
  table: string,
  sql: string,
  writer: (row: Record<string, unknown>) => Promise<void>,
  idField = "id",
): Promise<void> {
  const report: Report = { table, discovered: 0, migrated: 0, failed: 0, skipped: 0, errors: [] };
  try {
    const result = await pool.query(sql);
    const rows = result.rows as Array<Record<string, unknown>>;
    report.discovered = rows.length;
    let maxId = 0;
    for (const row of rows) {
      try {
        await writer(row);
        report.migrated++;
        const id = Number(row[idField]);
        if (Number.isFinite(id)) maxId = Math.max(maxId, id);
      } catch (err) {
        report.failed++;
        report.errors.push(`${row[idField]}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (maxId > 0) await ensureCounterAtLeast(table === "cad_user_profiles" ? "users" : table, maxId);
    await markState(table, maxId, report.failed ? "partial" : "done");
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
  }
  reports.push(report);
  console.info(`[migrate] ${table}: ${report.migrated}/${report.discovered} ok, ${report.failed} failed`);
}

function asIso(v: unknown): string {
  if (v == null) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function main() {
  console.info("[migrate] Connecting to MongoDB…");
  const db = await connectMongo();
  await ensureMongoIndexes(db);

  // Users
  await migrateTable(
    "cad_user_profiles",
    `SELECT * FROM cad_user_profiles`,
    async (row) => {
      const doc = { ...row, id: Number(row.id) } as UserDoc;
      await upsertUserMigration(doc);
    },
  );

  // Settings
  await migrateTable(
    "cad_settings",
    `SELECT key, value, updated_at FROM cad_settings`,
    async (row) => {
      await setSetting(String(row.key), String(row.value ?? ""));
    },
    "key",
  );

  // Audit logs
  await migrateTable(
    "cad_audit_logs",
    `SELECT id, category, actor, action, details, created_at FROM cad_audit_logs`,
    async (row) => {
      await upsertAuditMigration({
        id: Number(row.id),
        category: String(row.category),
        actor: String(row.actor),
        action: String(row.action),
        details: row.details == null ? null : String(row.details),
        created_at: asIso(row.created_at),
      } as AuditLogDoc);
    },
  );

  // Images → GridFS + media
  await migrateTable(
    "dps_images",
    `SELECT id, mime_type, data, created_at FROM dps_images`,
    async (row) => {
      const id = Number(row.id);
      const mime = String(row.mime_type || "application/octet-stream");
      const data = Buffer.isBuffer(row.data)
        ? row.data
        : Buffer.from(row.data as ArrayBuffer);
      const bucket = await getUploadsBucket();
      const gridFsId = await writeGridFs(bucket, `image-${id}`, data, {
        contentType: mime,
        metadata: { kind: "image", mediaId: id, migrated: true },
      });
      const doc: MediaDoc = {
        id,
        mime_type: mime,
        filename: `image-${id}`,
        size: data.length,
        gridFsId,
        created_at: asIso(row.created_at),
      };
      await upsertMediaFromMigration(doc);
    },
  );

  // Resources with optional file blobs
  for (const [table, department] of [
    ["staff_resources", "staff"],
    ["dps_resources", "dps"],
    ["dph_resources", "dph"],
  ] as const) {
    await migrateTable(
      table,
      `SELECT * FROM ${table}`,
      async (row) => {
        const id = Number(row.id);
        let gridFsId = null as MediaDoc["gridFsId"] | null;
        if (row.file_data) {
          const data = Buffer.isBuffer(row.file_data)
            ? row.file_data
            : Buffer.from(row.file_data as ArrayBuffer);
          if (data.length) {
            const bucket = await getUploadsBucket();
            gridFsId = await writeGridFs(bucket, `${department}-resource-${id}`, data, {
              contentType: String(row.mime_type || "application/pdf"),
              metadata: { kind: "resource", department, resourceId: id, migrated: true },
            });
          }
        }
        const { file_data: _blob, ...rest } = row;
        const doc = {
          ...rest,
          id,
          department,
          gridFsId,
          created_at: asIso(row.created_at),
          deleted_at: row.deleted_at ? asIso(row.deleted_at) : null,
        } as ResourceDoc;
        await upsertResourceMigration(doc);
      },
    );
  }

  // Simple document tables (no blobs)
  const simpleTables: Array<[string, string]> = [
    ["public_gallery", "gallery"],
    ["public_press", "press"],
    ["public_store_products", "store_products"],
    ["cad_announcements", "announcements"],
    ["portal_content", "portal_content"],
    ["moderations", "moderations"],
    ["staff_rank_groups", "staff_rank_groups"],
    ["staff_ranks", "staff_ranks"],
    ["dps_rank_groups", "dps_rank_groups"],
    ["dps_ranks", "dps_ranks"],
    ["dps_users", "dps_users"],
    ["dps_divisions", "dps_divisions"],
    ["dps_division_ranks", "dps_division_ranks"],
    ["dps_user_divisions", "dps_user_divisions"],
    ["dps_fleet", "dps_fleet"],
    ["dps_equipment", "dps_equipment"],
    ["dps_events", "dps_events"],
    ["dps_content", "dps_content"],
    ["dph_rank_groups", "dph_rank_groups"],
    ["dph_ranks", "dph_ranks"],
    ["dph_users", "dph_users"],
    ["dph_divisions", "dph_divisions"],
    ["dph_division_ranks", "dph_division_ranks"],
    ["dph_user_divisions", "dph_user_divisions"],
    ["dph_fleet", "dph_fleet"],
    ["dph_equipment", "dph_equipment"],
    ["dph_events", "dph_events"],
    ["dph_content", "dph_content"],
    ["doc_rank_groups", "doc_rank_groups"],
    ["doc_ranks", "doc_ranks"],
    ["doc_users", "doc_users"],
    ["doc_fleet", "doc_fleet"],
    ["cad_civilians", "civilians"],
    ["cad_vehicles", "vehicles"],
    ["cad_weapons", "weapons"],
    ["cad_arrests", "arrests"],
    ["cad_citations", "citations"],
    ["cad_warnings", "warnings"],
    ["cad_civilian_history", "civilian_history"],
    ["cad_calls", "calls"],
    ["cad_call_history", "call_history"],
    ["staff_events", "staff_events"],
  ];

  for (const [sqlTable, mongoCollection] of simpleTables) {
    await migrateTable(
      sqlTable,
      `SELECT * FROM ${sqlTable}`,
      async (row) => {
        // portal_content uses key as identity
        if (mongoCollection === "portal_content") {
          const col = await getCollection("portal_content");
          await col.updateOne(
            { key: row.key },
            { $set: { ...row, key: row.key } },
            { upsert: true },
          );
          return;
        }
        const id = Number(row.id);
        if (!Number.isFinite(id)) throw new Error("missing id");
        await upsertById(mongoCollection, id, { ...row, id } as never);
      },
      mongoCollection === "portal_content" ? "key" : "id",
    );
  }

  console.info("\n=== Migration report ===");
  let totalDisc = 0, totalOk = 0, totalFail = 0;
  for (const r of reports) {
    totalDisc += r.discovered;
    totalOk += r.migrated;
    totalFail += r.failed;
    if (r.errors.length) {
      console.info(`  ${r.table} errors:`, r.errors.slice(0, 5));
    }
  }
  console.info(`Total discovered=${totalDisc} migrated=${totalOk} failed=${totalFail}`);
  console.info("SQL data was NOT deleted. Set DATA_STORE=mongo after verify.");
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
