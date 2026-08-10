/**
 * Pragmatic SQL → Mongo bridge for DATA_STORE=mongo.
 * Handles the common Postgres-flavored patterns used across api-server routes.
 * Complex queries should be migrated to repositories over time.
 */
import type { Filter, Document } from "mongodb";
import { getCollection } from "./mongo";
import { nextId } from "./counters";

type QueryResult<T = Document> = { rows: T[]; rowCount: number };

function stripCasts(sql: string): string {
  return sql
    .replace(/::text/gi, "")
    .replace(/::int/gi, "")
    .replace(/::integer/gi, "")
    .replace(/::boolean/gi, "")
    .replace(/::timestamptz/gi, "")
    .replace(/now\(\)/gi, "CURRENT_TIMESTAMP");
}

function tableAlias(sql: string): { table: string; rest: string } | null {
  const m = sql.match(/\bfrom\s+([a-zA-Z0-9_]+)/i);
  if (!m) return null;
  return { table: m[1], rest: sql };
}

function mapTable(table: string): string {
  const map: Record<string, string> = {
    cad_user_profiles: "users",
    cad_settings: "settings",
    cad_audit_logs: "audit_logs",
    dps_images: "media",
    public_gallery: "gallery",
    public_press: "press",
    public_store_products: "store_products",
    cad_announcements: "announcements",
    cad_civilians: "civilians",
    cad_vehicles: "vehicles",
    cad_weapons: "weapons",
    cad_arrests: "arrests",
    cad_citations: "citations",
    cad_warnings: "warnings",
    cad_civilian_history: "civilian_history",
    cad_calls: "calls",
    cad_call_history: "call_history",
    staff_resources: "resources",
    dps_resources: "resources",
    dph_resources: "resources",
  };
  return map[table] ?? table;
}

function bindParams(sql: string, params: unknown[]): string {
  let out = sql;
  for (let i = params.length; i >= 1; i--) {
    const val = params[i - 1];
    let lit: string;
    if (val === null || val === undefined) lit = "NULL";
    else if (typeof val === "number") lit = String(val);
    else if (typeof val === "boolean") lit = val ? "TRUE" : "FALSE";
    else if (Buffer.isBuffer(val)) lit = `'__BUFFER__'`;
    else lit = `'${String(val).replace(/'/g, "''")}'`;
    out = out.replace(new RegExp(`\\$${i}\\b`, "g"), lit);
  }
  return out;
}

function parseLiteral(raw: string): unknown {
  const v = raw.trim();
  if (v === "NULL") return null;
  if (v === "TRUE") return true;
  if (v === "FALSE") return false;
  if (v === "CURRENT_TIMESTAMP" || v === "NOW()") return new Date().toISOString();
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseWhereEquals(where: string): Filter<Document> {
  const filter: Filter<Document> = {};
  // key = 'value' | key = 123 | key IS NULL | key IS NOT NULL
  const parts = where.split(/\band\b/i).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const isNotNull = part.match(/^([a-zA-Z0-9_]+)\s+is\s+not\s+null$/i);
    if (isNotNull) {
      filter[isNotNull[1]] = { $ne: null, $exists: true };
      continue;
    }
    const isNull = part.match(/^([a-zA-Z0-9_]+)\s+is\s+null$/i);
    if (isNull) {
      // Match SQL NULL and missing field (soft-delete patterns).
      filter.$and = [
        ...((filter.$and as Filter<Document>[]) ?? []),
        { $or: [{ [isNull[1]]: null }, { [isNull[1]]: { $exists: false } }] },
      ];
      continue;
    }
    const lowerEq = part.match(/^lower\(([a-zA-Z0-9_]+)\)\s*=\s*(.+)$/i);
    if (lowerEq) {
      const lit = parseLiteral(lowerEq[2]);
      if (typeof lit === "string") {
        filter[lowerEq[1]] = { $regex: `^${lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
      }
      continue;
    }
    const eq = part.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/i);
    if (!eq) continue;
    filter[eq[1]] = parseLiteral(eq[2]);
  }
  return filter;
}

function resourceDepartment(originalSql: string): "staff" | "dps" | "dph" | null {
  if (/staff_resources/i.test(originalSql)) return "staff";
  if (/dph_resources/i.test(originalSql)) return "dph";
  if (/dps_resources/i.test(originalSql)) return "dps";
  return null;
}

function applyResourceDeptFilter(table: string, originalSql: string, filter: Filter<Document>): Filter<Document> {
  if (table !== "resources") return filter;
  const dept = resourceDepartment(originalSql);
  if (!dept) return filter;
  return { ...filter, department: dept };
}

function projectFields(sql: string, doc: Document): Document {
  const selectMatch = sql.match(/select\s+([\s\S]+?)\s+from\s+/i);
  if (!selectMatch) return doc;
  const list = selectMatch[1].trim();
  if (list === "*" || list.startsWith("*")) {
    const { _id: _ignored, ...rest } = doc;
    return rest;
  }
  // Keep full doc for complex selects (COALESCE, joins) — callers often need many fields
  const { _id: _ignored, ...rest } = doc;
  return rest;
}

export async function mongoSqlQuery<T = Document>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const original = text.trim();
  const upper = original.toUpperCase();

  // DDL no-ops
  if (
    upper.startsWith("CREATE TABLE")
    || upper.startsWith("CREATE INDEX")
    || upper.startsWith("ALTER TABLE")
    || upper.startsWith("DROP TABLE")
    || upper.startsWith("BEGIN")
    || upper.startsWith("COMMIT")
    || upper.startsWith("ROLLBACK")
  ) {
    return { rows: [], rowCount: 0 };
  }

  const sql = stripCasts(bindParams(original, params));
  const sqlUpper = sql.toUpperCase();

  // INSERT INTO table (cols) VALUES (...) [ON CONFLICT ...] [RETURNING ...]
  if (sqlUpper.startsWith("INSERT INTO")) {
    const m = sql.match(
      /insert\s+into\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*values\s*\(([\s\S]+?)\)(?:\s*on\s+conflict[\s\S]*?)?(?:\s*returning\s+([\s\S]+))?$/i,
    );
    if (!m) throw new Error(`mongo-sql-bridge: unsupported INSERT: ${original.slice(0, 120)}`);
    const table = mapTable(m[1]);
    const cols = m[2].split(",").map((c) => c.trim());
    const valsRaw = m[3];
    const onConflictNothing = /\bon\s+conflict\s+do\s+nothing\b/i.test(sql);
    const onConflictUpdate = /\bon\s+conflict[\s\S]*\bdo\s+update\b/i.test(sql);
    // split values by comma not inside quotes — simple approach
    const vals: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < valsRaw.length; i++) {
      const ch = valsRaw[i];
      if (ch === "'" && valsRaw[i + 1] === "'") { cur += "'"; i++; continue; }
      if (ch === "'") { inQ = !inQ; cur += ch; continue; }
      if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) vals.push(cur.trim());

    const doc: Document = {};
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const raw = (vals[i] ?? "NULL").trim();
      if (raw === "NULL") doc[col] = null;
      else if (raw === "TRUE") doc[col] = true;
      else if (raw === "FALSE") doc[col] = false;
      else if (/^'.*'$/.test(raw)) doc[col] = raw.slice(1, -1).replace(/''/g, "'");
      else if (/^-?\d+(\.\d+)?$/.test(raw)) doc[col] = Number(raw);
      else if (raw === "CURRENT_TIMESTAMP") doc[col] = new Date().toISOString();
      else doc[col] = raw;
    }

    if (doc.id == null && table !== "settings" && table !== "portal_content") {
      doc.id = await nextId(table === "users" ? "users" : table);
    }
    if (table === "resources") {
      doc.department = resourceDepartment(original) ?? "dps";
      // Binary columns are stored in GridFS via repositories — drop raw blobs from SQL inserts.
      delete doc.file_data;
      delete doc.data;
    }
    if (table === "media") {
      delete doc.data;
    }

    const col = await getCollection(table);
    if (table === "settings" && doc.key) {
      if (onConflictNothing) {
        const existing = await col.findOne({ key: doc.key });
        if (existing) return { rows: [], rowCount: 0 };
      }
      await col.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
      return { rows: [doc as T], rowCount: 1 };
    }
    if (doc.id != null && (onConflictNothing || onConflictUpdate)) {
      const existing = await col.findOne({ id: doc.id });
      if (existing && onConflictNothing) return { rows: [], rowCount: 0 };
      if (existing && onConflictUpdate) {
        await col.updateOne({ id: doc.id }, { $set: doc });
        return { rows: [doc as T], rowCount: 1 };
      }
    }
    await col.insertOne(doc);
    return { rows: [doc as T], rowCount: 1 };
  }

  // UPDATE table SET ... WHERE ...
  if (sqlUpper.startsWith("UPDATE")) {
    const m = sql.match(/update\s+([a-zA-Z0-9_]+)\s+set\s+([\s\S]+?)\s+where\s+([\s\S]+?)(?:\s+returning\s+([\s\S]+))?$/i);
    if (!m) throw new Error(`mongo-sql-bridge: unsupported UPDATE: ${original.slice(0, 120)}`);
    const table = mapTable(m[1]);
    const setPart = m[2];
    const wherePart = m[3];
    const filter = applyResourceDeptFilter(table, original, parseWhereEquals(wherePart));
    const patch: Document = {};
    for (const assign of setPart.split(",")) {
      const eq = assign.trim().match(/^([a-zA-Z0-9_]+)\s*=\s*([\s\S]+)$/);
      if (!eq) continue;
      const key = eq[1];
      let raw = eq[2].trim();
      if (raw === "CURRENT_TIMESTAMP" || raw === "NOW()" || /^now\(\)$/i.test(raw)) {
        patch[key] = new Date().toISOString();
        continue;
      }
      // COALESCE($n, col) / COALESCE(literal, col) — only set when non-null
      const coal = raw.match(/^coalesce\((.+),\s*[a-zA-Z0-9_]+\)$/i);
      if (coal) {
        const lit = parseLiteral(coal[1]);
        if (lit !== null) patch[key] = lit;
        continue;
      }
      // Skip CASE expressions — leave field unchanged
      if (/^case\b/i.test(raw)) continue;
      patch[key] = parseLiteral(raw);
    }
    const col = await getCollection(table);
    if (/returning/i.test(sql)) {
      const result = await col.findOneAndUpdate(filter, { $set: patch }, { returnDocument: "after" });
      const row = result ? projectFields(sql, result) : null;
      return { rows: row ? [row as T] : [], rowCount: row ? 1 : 0 };
    }
    const result = await col.updateMany(filter, { $set: patch });
    return { rows: [], rowCount: result.modifiedCount };
  }

  // DELETE FROM table WHERE ...
  if (sqlUpper.startsWith("DELETE FROM")) {
    const m = sql.match(/delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+([\s\S]+?)(?:\s+returning\s+([\s\S]+))?$/i);
    if (!m) throw new Error(`mongo-sql-bridge: unsupported DELETE: ${original.slice(0, 120)}`);
    const table = mapTable(m[1]);
    const filter = applyResourceDeptFilter(table, original, parseWhereEquals(m[2]));
    const col = await getCollection(table);
    if (/returning/i.test(sql)) {
      const existing = await col.find(filter).toArray();
      await col.deleteMany(filter);
      return {
        rows: existing.map((d) => projectFields(sql, d)) as T[],
        rowCount: existing.length,
      };
    }
    const result = await col.deleteMany(filter);
    return { rows: [], rowCount: result.deletedCount };
  }

  // SELECT ...
  if (sqlUpper.startsWith("SELECT") || sqlUpper.startsWith("WITH")) {
    // Reject unsupported JOINs early (auth paths use repositories).
    if (/\bjoin\b/i.test(sql)) {
      throw new Error(`mongo-sql-bridge: JOINs unsupported — use a repository: ${original.slice(0, 100)}`);
    }

    // COUNT(*)
    const countMatch = sql.match(/select\s+count\(\*\)(?:\s*(?:as\s+)?(\w+))?\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+([\s\S]+))?$/i);
    if (countMatch) {
      const alias = countMatch[1] || "c";
      const table = mapTable(countMatch[2]);
      const filter = applyResourceDeptFilter(
        table,
        original,
        countMatch[3] ? parseWhereEquals(countMatch[3]) : {},
      );
      const col = await getCollection(table);
      const c = await col.countDocuments(filter);
      return { rows: [{ [alias]: c, count: c, c } as T], rowCount: 1 };
    }

    // MAX / COALESCE(MAX(...), 0)
    const maxMatch = sql.match(
      /select\s+(?:coalesce\s*\(\s*)?max\(([a-zA-Z0-9_]+)\)(?:\s*,\s*0\s*\))?(?:\s+as\s+(\w+))?\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+([\s\S]+))?$/i,
    );
    if (maxMatch) {
      const field = maxMatch[1];
      const alias = maxMatch[2] || "m";
      const table = mapTable(maxMatch[3]);
      const filter = applyResourceDeptFilter(
        table,
        original,
        maxMatch[4] ? parseWhereEquals(maxMatch[4]) : {},
      );
      const col = await getCollection(table);
      const docs = await col.find(filter).project({ [field]: 1 }).toArray();
      let max: number | null = null;
      for (const d of docs) {
        const n = Number(d[field]);
        if (!Number.isFinite(n)) continue;
        max = max == null ? n : Math.max(max, n);
      }
      const value = /\bcoalesce\b/i.test(sql) ? (max ?? 0) : max;
      return { rows: [{ [alias]: value, m: value, mx: value } as T], rowCount: 1 };
    }

    const parsed = tableAlias(sql);
    if (!parsed) throw new Error(`mongo-sql-bridge: unsupported SELECT: ${original.slice(0, 120)}`);
    const table = mapTable(parsed.table);
    let filter: Filter<Document> = {};
    const whereMatch = sql.match(/\bwhere\s+([\s\S]+?)(?:\s+order\s+by|\s+limit|\s+offset|$)/i);
    const whereRaw = whereMatch?.[1] ?? "";
    if (whereRaw) {
      if (!/\b(like|or|in\s*\(|any\s*\()/i.test(whereRaw)) {
        filter = parseWhereEquals(whereRaw);
      }
    }
    filter = applyResourceDeptFilter(table, original, filter);
    const col = await getCollection(table);
    let docs = await col.find(filter).toArray();

    // Client-side LIKE / OR filters when Mongo filter was skipped
    if (whereRaw && /\blike\b/i.test(whereRaw)) {
      const likeParts = [...whereRaw.matchAll(/([a-zA-Z0-9_]+)\s+like\s+'([^']*)'/gi)];
      if (likeParts.length) {
        docs = docs.filter((d) =>
          likeParts.some((lp) => {
            const field = lp[1];
            const pattern = lp[2].replace(/%/g, ".*").replace(/_/g, ".");
            return new RegExp(`^${pattern}$`, "i").test(String(d[field] ?? ""));
          }),
        );
      }
    }

    // Basic ORDER BY field ASC/DESC (ignore NULLS LAST)
    const orderMatch = sql.match(/\border\s+by\s+([a-zA-Z0-9_]+)(?:\s+(asc|desc))?(?:\s+nulls\s+(?:first|last))?/i);
    if (orderMatch) {
      const field = orderMatch[1];
      const dir = (orderMatch[2] || "asc").toLowerCase() === "desc" ? -1 : 1;
      docs.sort((a, b) => {
        const av = a[field]; const bv = b[field];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? dir : -dir;
      });
    }

    const limitMatch = sql.match(/\blimit\s+(\d+)/i);
    const offsetMatch = sql.match(/\boffset\s+(\d+)/i);
    const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
    const limit = limitMatch ? Number(limitMatch[1]) : undefined;
    if (offset) docs = docs.slice(offset);
    if (limit != null) docs = docs.slice(0, limit);

    const rows = docs.map((d) => projectFields(sql, d)) as T[];
    return { rows, rowCount: rows.length };
  }

  throw new Error(`mongo-sql-bridge: unsupported SQL: ${original.slice(0, 160)}`);
}

/** pg.Pool-compatible facade used when DATA_STORE=mongo. */
export function createMongoPoolFacade() {
  return {
    query: async <T = Document>(text: string, params?: unknown[]) =>
      mongoSqlQuery<T>(text, params ?? []),
    connect: async () => ({
      query: async <T = Document>(text: string, params?: unknown[]) =>
        mongoSqlQuery<T>(text, params ?? []),
      release: () => undefined,
    }),
    end: async () => undefined,
    on: () => undefined,
  };
}
