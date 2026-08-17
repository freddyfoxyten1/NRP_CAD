/**
 * SQL → Mongo bridge for DATA_STORE=mongo.
 * Executes the Postgres-flavored SQL used by api-server routes against Mongo collections
 * (including common JOINs, ILIKE, OR/IN/ANY, and CASE WHEN updates).
 */
import type { Filter, Document } from "mongodb";
import { getCollection } from "./mongo";
import { nextId } from "./counters";

type QueryResult<T = Document> = { rows: T[]; rowCount: number };

type JoinSpec = {
  type: "left" | "inner";
  table: string;
  alias: string;
  on: string;
};

const ALIAS_KEY = "__aliases__";

function rowWithAlias(doc: Document, alias: string): Document {
  const clean = { ...doc };
  delete (clean as Document)._id;
  return { [ALIAS_KEY]: { [alias]: clean } };
}

function mergeJoinRow(left: Document, right: Document, rightAlias: string): Document {
  const leftAliases = { ...((left[ALIAS_KEY] ?? {}) as Record<string, Document>) };
  const rightClean = { ...right };
  delete (rightClean as Document)._id;
  leftAliases[rightAlias] = rightClean;
  return { [ALIAS_KEY]: leftAliases };
}

function stripCasts(sql: string): string {
  return sql
    .replace(/::text(\[\])?/gi, "")
    .replace(/::int(eger)?/gi, "")
    .replace(/::boolean/gi, "")
    .replace(/::timestamptz/gi, "")
    .replace(/::jsonb/gi, "")
    .replace(/\bnow\(\)/gi, "CURRENT_TIMESTAMP");
}

/** Collapse whitespace so multiline INSERT/SELECT patterns match reliably. */
function normalizeSqlWhitespace(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
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
    else if (Array.isArray(val)) {
      lit = `(${val.map((v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)).join(",")})`;
    } else lit = `'${String(val).replace(/'/g, "''")}'`;
    out = out.replace(new RegExp(`\\$${i}\\b`, "g"), lit);
  }
  return out;
}

function parseLiteral(raw: string): unknown {
  const v = raw.trim();
  // Keyword match must be case-insensitive: SQL written as `= false` would
  // otherwise fall through and store the string "false", which is truthy.
  const keyword = v.toUpperCase();
  if (keyword === "NULL") return null;
  if (keyword === "TRUE") return true;
  if (keyword === "FALSE") return false;
  if (v === "CURRENT_TIMESTAMP" || /^now\(\)$/i.test(v)) return new Date().toISOString();
  if (/^'.*'$/s.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function resourceDepartment(originalSql: string): "staff" | "dps" | "dph" | null {
  if (/staff_resources/i.test(originalSql)) return "staff";
  if (/dph_resources/i.test(originalSql)) return "dph";
  if (/dps_resources/i.test(originalSql)) return "dps";
  return null;
}

function applyResourceDeptFilter(
  table: string,
  originalSql: string,
  filter: Filter<Document>,
): Filter<Document> {
  if (table !== "resources") return filter;
  const dept = resourceDepartment(originalSql);
  if (!dept) return filter;
  return { ...filter, department: dept };
}

function stripAlias(field: string): string {
  const m = field.trim().match(/^(?:[a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)$/);
  return m ? m[1] : field.trim();
}

function getField(row: Document, expr: string): unknown {
  const e = expr.trim();

  const aliasField = e.match(/^([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)$/);
  if (aliasField) {
    const aliases = row[ALIAS_KEY] as Record<string, Document> | undefined;
    const bucket = aliases?.[aliasField[1]];
    if (bucket && aliasField[2] in bucket) return bucket[aliasField[2]];
  }

  const trimM = e.match(/^trim\((.+)\)$/i);
  if (trimM) {
    const v = getField(row, trimM[1]);
    return v == null ? null : String(v).trim();
  }

  const lower = e.match(/^lower\((.+)\)$/i);
  if (lower) {
    const v = getField(row, lower[1]);
    return v == null ? null : String(v).toLowerCase();
  }
  const concat = e.match(/^concat\((.+)\)$/i);
  if (concat) {
    return splitArgs(concat[1]).map((p) => {
      const v = /^'/.test(p.trim()) || /^(TRUE|FALSE|NULL)$/i.test(p.trim()) || /^-?\d/.test(p.trim())
        ? parseLiteral(p)
        : getField(row, p);
      return v == null ? "" : String(v);
    }).join("");
  }
  const nullif = e.match(/^nullif\((.+),\s*(.+)\)$/i);
  if (nullif) {
    const a = getField(row, nullif[1]);
    const b = parseLiteral(nullif[2]);
    return a === b ? null : a;
  }
  const coal = e.match(/^coalesce\((.+)\)$/i);
  if (coal) {
    const parts = splitArgs(coal[1]);
    for (const p of parts) {
      const t = p.trim();
      const v = (/^(TRUE|FALSE|NULL)$/i.test(t) || /^'/.test(t) || /^-?\d/.test(t))
        ? parseLiteral(t)
        : getField(row, t);
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  }
  if (/^'.*'$/s.test(e) || /^-?\d+(\.\d+)?$/.test(e) || /^(TRUE|FALSE|NULL)$/i.test(e)) {
    return parseLiteral(e);
  }
  const plain = stripAlias(e);
  if (plain in row) return row[plain];
  // Fallback: unqualified field — search alias buckets (prefer first match)
  const aliases = row[ALIAS_KEY] as Record<string, Document> | undefined;
  if (aliases) {
    for (const bucket of Object.values(aliases)) {
      if (plain in bucket) return bucket[plain];
    }
  }
  return row[e] ?? row[plain];
}

function splitArgs(src: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" && src[i + 1] === "'") { cur += "''"; i++; continue; }
    if (ch === "'") { inQ = !inQ; cur += ch; continue; }
    if (!inQ && ch === "(") { depth++; cur += ch; continue; }
    if (!inQ && ch === ")") { depth--; cur += ch; continue; }
    if (!inQ && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitTopLevel(src: string, keyword: RegExp): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" && src[i + 1] === "'") { cur += "''"; i++; continue; }
    if (ch === "'") { inQ = !inQ; cur += ch; continue; }
    if (!inQ && ch === "(") { depth++; cur += ch; continue; }
    if (!inQ && ch === ")") { depth--; cur += ch; continue; }
    if (!inQ && depth === 0) {
      const rest = src.slice(i);
      const m = rest.match(keyword);
      if (m && m.index === 0) {
        parts.push(cur.trim());
        cur = "";
        i += m[0].length - 1;
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

function evalPredicate(row: Document, expr: string): boolean {
  const e = expr.trim();
  if (!e) return true;

  // OR groups
  if (/\bor\b/i.test(e) && !/^\(.*\)$/.test(e)) {
    const ors = splitTopLevel(e, /^\s*or\s+/i);
    if (ors.length > 1) return ors.some((p) => evalPredicate(row, p));
  }
  // AND groups
  if (/\band\b/i.test(e)) {
    const ands = splitTopLevel(e, /^\s*and\s+/i);
    if (ands.length > 1) return ands.every((p) => evalPredicate(row, p));
  }

  // unwrap parens
  if (e.startsWith("(") && e.endsWith(")")) {
    return evalPredicate(row, e.slice(1, -1));
  }

  const isNotNull = e.match(/^(.+?)\s+is\s+not\s+null$/i);
  if (isNotNull) {
    const v = getField(row, isNotNull[1]);
    return v !== null && v !== undefined;
  }
  const isNull = e.match(/^(.+?)\s+is\s+null$/i);
  if (isNull) {
    const v = getField(row, isNull[1]);
    return v === null || v === undefined;
  }

  const like = e.match(/^(.+?)\s+(i?like)\s+'([^']*)'$/i);
  if (like) {
    const v = String(getField(row, like[1]) ?? "");
    const pattern = like[3].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp(`^${pattern}$`, "i").test(v);
  }

  const inList = e.match(/^(.+?)\s+in\s*\(([\s\S]+)\)$/i);
  if (inList) {
    const v = getField(row, inList[1]);
    const vals = splitArgs(inList[2]).map(parseLiteral);
    return vals.some((x) => x === v || String(x) === String(v));
  }

  const anyArr = e.match(/^(.+?)\s*=\s*any\s*\(([\s\S]+)\)$/i);
  if (anyArr) {
    const v = getField(row, anyArr[1]);
    const inner = anyArr[2].trim();
    const list = inner.startsWith("(") ? splitArgs(inner.slice(1, -1)) : splitArgs(inner);
    const vals = list.map(parseLiteral);
    return vals.some((x) => x === v || String(x).toLowerCase() === String(v ?? "").toLowerCase());
  }

  const ne = e.match(/^(.+?)\s*(<>|!=)\s*(.+)$/i);
  if (ne) {
    const a = getField(row, ne[1]);
    const b = /^[a-zA-Z_]/.test(ne[3].trim()) && !/^(TRUE|FALSE|NULL)$/i.test(ne[3].trim()) && !/^'/.test(ne[3].trim())
      ? getField(row, ne[3])
      : parseLiteral(ne[3]);
    return a !== b;
  }

  const eq = e.match(/^(.+?)\s*=\s*(.+)$/i);
  if (eq) {
    const left = getField(row, eq[1]);
    const rightRaw = eq[2].trim();
    const right = /^[a-zA-Z_]/.test(rightRaw) && !/^(TRUE|FALSE|NULL)$/i.test(rightRaw) && !/^'/.test(rightRaw) && !/^-?\d/.test(rightRaw)
      ? getField(row, rightRaw)
      : parseLiteral(rightRaw);
    if (typeof left === "string" && typeof right === "string") {
      return left === right || left.toLowerCase() === right.toLowerCase();
    }
    return left === right || String(left) === String(right);
  }

  return true;
}

function parseWhereEquals(where: string): Filter<Document> {
  // Only used for simple Mongo server-side filters; complex WHERE uses evalPredicate.
  const filter: Filter<Document> = {};
  const parts = splitTopLevel(where, /^\s*and\s+/i);
  for (const part of parts) {
    if (/\bor\b|\blike\b|\bin\s*\(|\bany\s*\(/i.test(part)) return {};
    const isNotNull = part.match(/^([a-zA-Z0-9_.]+)\s+is\s+not\s+null$/i);
    if (isNotNull) {
      filter[stripAlias(isNotNull[1])] = { $ne: null, $exists: true };
      continue;
    }
    const isNull = part.match(/^([a-zA-Z0-9_.]+)\s+is\s+null$/i);
    if (isNull) {
      const key = stripAlias(isNull[1]);
      filter.$and = [
        ...((filter.$and as Filter<Document>[]) ?? []),
        { $or: [{ [key]: null }, { [key]: { $exists: false } }] },
      ];
      continue;
    }
    const lowerEq = part.match(/^lower\(([a-zA-Z0-9_.]+)\)\s*=\s*(.+)$/i);
    if (lowerEq) {
      const lit = parseLiteral(lowerEq[2]);
      if (typeof lit === "string") {
        filter[stripAlias(lowerEq[1])] = {
          $regex: `^${lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        };
      }
      continue;
    }
    const eq = part.match(/^([a-zA-Z0-9_.]+)\s*=\s*(.+)$/i);
    if (!eq) continue;
    const rhs = eq[2].trim();
    if (/^[a-zA-Z_][\w]*\./.test(rhs)) continue; // join-style equality
    filter[stripAlias(eq[1])] = parseLiteral(rhs);
  }
  return filter;
}

function parseJoins(fromClause: string): { primary: string; primaryAlias: string; joins: JoinSpec[] } {
  const primaryMatch = fromClause.match(/^([a-zA-Z0-9_]+)(?:\s+(?:as\s+)?([a-zA-Z0-9_]+))?/i);
  if (!primaryMatch) throw new Error("mongo-sql-bridge: bad FROM clause");
  const primary = primaryMatch[1];
  const primaryAlias = primaryMatch[2] || primaryMatch[1];
  const joins: JoinSpec[] = [];
  const joinRe = /\b(left\s+join|inner\s+join|join)\s+([a-zA-Z0-9_]+)(?:\s+(?:as\s+)?([a-zA-Z0-9_]+))?\s+on\s+/gi;
  let m: RegExpExecArray | null;
  const matches: Array<{ type: string; table: string; alias: string; onStart: number }> = [];
  while ((m = joinRe.exec(fromClause)) !== null) {
    matches.push({
      type: m[1].toLowerCase(),
      table: m[2],
      alias: m[3] || m[2],
      onStart: m.index + m[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const rest = fromClause.slice(matches[i].onStart);
    const nextJoin = rest.search(/\b(?:left\s+join|inner\s+join|join)\s+/i);
    const on = (nextJoin >= 0 ? rest.slice(0, nextJoin) : rest).trim();
    joins.push({
      type: matches[i].type.includes("left") ? "left" : "inner",
      table: matches[i].table,
      alias: matches[i].alias,
      on,
    });
  }
  return { primary, primaryAlias, joins };
}

function projectSelect(sql: string, row: Document): Document {
  const selectMatch = sql.match(/select\s+([\s\S]+?)\s+from\s+/i);
  if (!selectMatch) {
    const { _id: _a, ...rest } = row;
    return rest;
  }
  const list = selectMatch[1].trim();
  if (list === "*" || /\.\*/.test(list) && !list.includes(",")) {
    const { _id: _a, ...rest } = row;
    return rest;
  }
  const out: Document = {};
  for (const raw of splitArgs(list)) {
    const asMatch = raw.match(/^([\s\S]+?)\s+as\s+([a-zA-Z_][\w]*)$/i);
    if (asMatch) {
      out[asMatch[2]] = getField(row, asMatch[1]);
      continue;
    }
    const plain = stripAlias(raw);
    out[plain] = getField(row, raw);
  }
  return out;
}

function evaluateCase(raw: string, row?: Document): unknown | undefined {
  // CASE WHEN TRUE THEN 'x' ELSE col END  (after param bind)
  // CASE WHEN $n::boolean THEN ... already bound
  const m = raw.match(/^case\s+when\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+?)\s+end$/i);
  if (!m) return undefined;
  const cond = m[1].trim();
  const thenV = m[2].trim();
  const elseV = m[3].trim();
  let condTrue = false;
  if (/^(TRUE|FALSE)$/i.test(cond)) condTrue = /^TRUE$/i.test(cond);
  else if (/^(TRUE|FALSE|NULL)\s+IS\s+NOT\s+NULL$/i.test(cond)) {
    condTrue = !/^NULL\s/i.test(cond);
  } else if (row) condTrue = evalPredicate(row, cond);
  else return undefined;
  if (condTrue) return parseLiteral(thenV);
  // ELSE column reference → leave unchanged (skip patch)
  if (/^[a-zA-Z_][\w.]*$/.test(elseV) && !/^(TRUE|FALSE|NULL)$/i.test(elseV)) {
    return undefined;
  }
  return parseLiteral(elseV);
}

async function loadCollection(tableSql: string, originalSql: string): Promise<Document[]> {
  const table = mapTable(tableSql);
  const filter = applyResourceDeptFilter(table, originalSql, {});
  const col = await getCollection(table);
  return col.find(filter).toArray();
}

async function executeSelect(sql: string, original: string): Promise<QueryResult> {
  // COUNT(*)
  const countMatch = sql.match(
    /select\s+count\(\*\)(?:\s*(?:as\s+)?(\w+))?\s+from\s+([\s\S]+?)(?:\s+where\s+([\s\S]+))?$/i,
  );
  if (countMatch && !/\bjoin\b/i.test(countMatch[2])) {
    const alias = countMatch[1] || "c";
    const table = mapTable(countMatch[2].trim().split(/\s+/)[0]);
    const whereRaw = countMatch[3] ?? "";
    const baseFilter = applyResourceDeptFilter(
      table,
      original,
      whereRaw && !/\b(or|like|ilike|in\s*\(|any\s*\()/i.test(whereRaw) ? parseWhereEquals(whereRaw) : {},
    );
    const col = await getCollection(table);
    let docs = await col.find(baseFilter).toArray();
    if (whereRaw) docs = docs.filter((d) => evalPredicate(d, whereRaw));
    const c = docs.length;
    return { rows: [{ [alias]: c, count: c, c }], rowCount: 1 };
  }

  // MAX / COALESCE(MAX(sort_order), -1) [+ N]
  const coalesceMaxMatch = sql.match(
    /select\s+coalesce\s*\(\s*max\(([a-zA-Z0-9_.]+)\)\s*,\s*(-?\d+)\s*\)(?:\s*\+\s*(\d+))?\s+(?:as\s+(\w+)\s+)?from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by|\s+limit|\s*$)/i,
  );
  if (coalesceMaxMatch) {
    const field = stripAlias(coalesceMaxMatch[1]);
    const coalesceDefault = Number(coalesceMaxMatch[2]);
    const addend = coalesceMaxMatch[3] ? Number(coalesceMaxMatch[3]) : 0;
    const alias = coalesceMaxMatch[4] || "m";
    const table = mapTable(coalesceMaxMatch[5]);
    const whereRaw = coalesceMaxMatch[6]?.trim() ?? "";
    const col = await getCollection(table);
    let docs = await col.find(applyResourceDeptFilter(table, original, {})).toArray();
    if (whereRaw) docs = docs.filter((d) => evalPredicate(d, whereRaw));
    let max: number | null = null;
    for (const d of docs) {
      const n = Number(d[field]);
      if (!Number.isFinite(n)) continue;
      max = max == null ? n : Math.max(max, n);
    }
    const base = Number.isFinite(coalesceDefault) ? (max ?? coalesceDefault) : (max ?? 0);
    const value = base + addend;
    return { rows: [{ [alias]: value, m: value, mx: value }], rowCount: 1 };
  }

  const maxMatch = sql.match(
    /select\s+max\(([a-zA-Z0-9_.]+)\)(?:\s+as\s+(\w+))?\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by|\s+limit|\s*$)/i,
  );
  if (maxMatch) {
    const field = stripAlias(maxMatch[1]);
    const alias = maxMatch[2] || "m";
    const table = mapTable(maxMatch[3]);
    const whereRaw = maxMatch[4]?.trim() ?? "";
    const col = await getCollection(table);
    let docs = await col.find(applyResourceDeptFilter(table, original, {})).toArray();
    if (whereRaw) docs = docs.filter((d) => evalPredicate(d, whereRaw));
    let max: number | null = null;
    for (const d of docs) {
      const n = Number(d[field]);
      if (!Number.isFinite(n)) continue;
      max = max == null ? n : Math.max(max, n);
    }
    return { rows: [{ [alias]: max, m: max, mx: max }], rowCount: 1 };
  }

  // Legacy: COALESCE(MAX(...), 0) without nested coalesce form above
  const legacyMaxMatch = sql.match(
    /select\s+(?:coalesce\s*\(\s*)?max\(([a-zA-Z0-9_.]+)\)(?:\s*,\s*0\s*\))?(?:\s+as\s+(\w+))?\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by|\s+limit|\s*$)/i,
  );
  if (legacyMaxMatch) {
    const field = stripAlias(legacyMaxMatch[1]);
    const alias = legacyMaxMatch[2] || "m";
    const table = mapTable(legacyMaxMatch[3]);
    const whereRaw = legacyMaxMatch[4]?.trim() ?? "";
    const col = await getCollection(table);
    let docs = await col.find(applyResourceDeptFilter(table, original, {})).toArray();
    if (whereRaw) docs = docs.filter((d) => evalPredicate(d, whereRaw));
    let max: number | null = null;
    for (const d of docs) {
      const n = Number(d[field]);
      if (!Number.isFinite(n)) continue;
      max = max == null ? n : Math.max(max, n);
    }
    const value = /\bcoalesce\b/i.test(sql) ? (max ?? 0) : max;
    return { rows: [{ [alias]: value, m: value, mx: value }], rowCount: 1 };
  }

  const bodyMatch = sql.match(
    /select\s+([\s\S]+?)\s+from\s+([\s\S]+?)(?:\s+where\s+([\s\S]+?))?(?:\s+order\s+by\s+([\s\S]+?))?(?:\s+limit\s+(\d+))?(?:\s+offset\s+(\d+))?$/i,
  );
  if (!bodyMatch) throw new Error(`mongo-sql-bridge: unsupported SELECT: ${original.slice(0, 120)}`);

  const fromAndJoins = bodyMatch[2].trim();
  // Strip trailing ORDER/LIMIT already handled by regex — fromAndJoins may still include joins only
  const whereRaw = bodyMatch[3]?.trim() ?? "";
  const orderRaw = bodyMatch[4]?.trim() ?? "";
  const limit = bodyMatch[5] ? Number(bodyMatch[5]) : undefined;
  const offset = bodyMatch[6] ? Number(bodyMatch[6]) : 0;

  const { primary, primaryAlias, joins } = parseJoins(fromAndJoins);
  let rows = (await loadCollection(primary, original)).map((d) => {
    const { _id: _a, ...rest } = d;
    return rowWithAlias(rest, primaryAlias);
  });

  for (const join of joins) {
    const rightDocs = await loadCollection(join.table, original);
    const next: Document[] = [];
    for (const left of rows) {
      const matches = rightDocs.filter((r) => {
        const { _id: _a, ...right } = r;
        const merged = mergeJoinRow(left, right, join.alias);
        return evalPredicate(merged, join.on);
      });
      if (matches.length === 0) {
        if (join.type === "left") next.push(left);
        continue;
      }
      for (const r of matches) {
        const { _id: _a, ...right } = r;
        next.push(mergeJoinRow(left, right, join.alias));
      }
    }
    rows = next;
  }

  if (whereRaw) {
    rows = rows.filter((r) => evalPredicate(r, whereRaw));
  }

  if (orderRaw) {
    const orders = orderRaw.split(",").map((s) => s.trim());
    rows.sort((a, b) => {
      for (const o of orders) {
        const m = o.match(/^([a-zA-Z0-9_.]+)(?:\s+(asc|desc))?(?:\s+nulls\s+(?:first|last))?$/i);
        if (!m) continue;
        const field = stripAlias(m[1]);
        const dir = (m[2] || "asc").toLowerCase() === "desc" ? -1 : 1;
        const av = a[field];
        const bv = b[field];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? dir : -dir;
      }
      return 0;
    });
  }

  if (offset) rows = rows.slice(offset);
  if (limit != null) rows = rows.slice(0, limit);

  const projected = rows.map((r) => projectSelect(sql, r));
  return { rows: projected, rowCount: projected.length };
}

export async function mongoSqlQuery<T = Document>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const original = text.trim();
  const upper = original.toUpperCase();

  if (
    upper.startsWith("CREATE TABLE")
    || upper.startsWith("CREATE UNIQUE INDEX")
    || upper.startsWith("CREATE INDEX")
    || upper.startsWith("ALTER TABLE")
    || upper.startsWith("DROP TABLE")
    || upper.startsWith("BEGIN")
    || upper.startsWith("COMMIT")
    || upper.startsWith("ROLLBACK")
  ) {
    return { rows: [], rowCount: 0 };
  }

  // CTE bulk-delete used by admin member purge — execute inner DELETE only
  if (upper.startsWith("WITH ")) {
    const del = original.match(/delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+([\s\S]+?)(?:\s+returning\s+([\s\S]+))?$/i);
    if (del) {
      return mongoSqlQuery<T>(`DELETE FROM ${del[1]} WHERE ${del[2]}${del[3] ? ` RETURNING ${del[3]}` : ""}`, params);
    }
  }

  const sql = normalizeSqlWhitespace(stripCasts(bindParams(original, params)));
  const sqlUpper = sql.toUpperCase();

  // INSERT
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

    const vals: string[] = [];
    let cur = "";
    let inQ = false;
    let depth = 0;
    for (let i = 0; i < valsRaw.length; i++) {
      const ch = valsRaw[i];
      if (ch === "'" && valsRaw[i + 1] === "'") { cur += "'"; i++; continue; }
      if (ch === "'") { inQ = !inQ; cur += ch; continue; }
      if (!inQ && ch === "(") depth++;
      if (!inQ && ch === ")") depth--;
      if (ch === "," && !inQ && depth === 0) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) vals.push(cur.trim());

    const doc: Document = {};
    for (let i = 0; i < cols.length; i++) {
      doc[cols[i]] = parseLiteral(vals[i] ?? "NULL");
    }

    if (doc.id == null && table !== "settings" && table !== "portal_content") {
      doc.id = await nextId(table === "users" ? "users" : table);
    }
    if (table === "resources") {
      doc.department = resourceDepartment(original) ?? "dps";
      delete doc.file_data;
      delete doc.data;
    }
    if (table === "media") delete doc.data;

    if (table === "dps_rank_groups" || table === "dph_rank_groups" || table === "doc_rank_groups" || table === "staff_rank_groups") {
      if (doc.panel_access == null) doc.panel_access = false;
      if (doc.division_oversight == null) doc.division_oversight = false;
    }
    if (table.endsWith("_ranks") && doc.group_id != null) {
      const gid = Number(doc.group_id);
      doc.group_id = Number.isFinite(gid) ? gid : null;
    }

    const col = await getCollection(table);

    // ON CONFLICT (key) / (id) / (profile_id)
    const conflictTarget = sql.match(/\bon\s+conflict\s*\(([^)]+)\)/i);
    const conflictKeys = conflictTarget
      ? conflictTarget[1].split(",").map((s) => s.trim())
      : (doc.id != null ? ["id"] : doc.key != null ? ["key"] : doc.profile_id != null ? ["profile_id"] : []);

    if (table === "settings" && doc.key) {
      if (onConflictNothing) {
        const existing = await col.findOne({ key: doc.key });
        if (existing) return { rows: [], rowCount: 0 };
      }
      await col.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
      return { rows: [doc as T], rowCount: 1 };
    }

    if (conflictKeys.length && (onConflictNothing || onConflictUpdate)) {
      const filter: Filter<Document> = {};
      for (const k of conflictKeys) filter[k] = doc[k];
      const existing = await col.findOne(filter);
      if (existing && onConflictNothing) return { rows: [], rowCount: 0 };
      if (existing && onConflictUpdate) {
        // Merge EXCLUDED-style: use new doc fields except keep existing id if present
        const merged = { ...existing, ...doc, id: existing.id ?? doc.id };
        delete (merged as Document)._id;
        await col.updateOne({ _id: existing._id }, { $set: merged });
        return { rows: [merged as T], rowCount: 1 };
      }
    }

    await col.insertOne(doc);
    const returning = m[4]?.trim();
    if (returning) {
      const projected = projectSelect(`SELECT ${returning}`, doc);
      return { rows: [projected as T], rowCount: 1 };
    }
    return { rows: [doc as T], rowCount: 1 };
  }

  // UPDATE
  if (sqlUpper.startsWith("UPDATE")) {
    const m = sql.match(
      /update\s+([a-zA-Z0-9_]+)\s+set\s+([\s\S]+?)\s+where\s+([\s\S]+?)(?:\s+returning\s+([\s\S]+))?$/i,
    );
    if (!m) throw new Error(`mongo-sql-bridge: unsupported UPDATE: ${original.slice(0, 120)}`);
    const table = mapTable(m[1]);
    const setPart = m[2];
    const wherePart = m[3];
    const col = await getCollection(table);
    let candidates = await col.find(applyResourceDeptFilter(table, original, {})).toArray();
    candidates = candidates.filter((d) => evalPredicate(d, wherePart));

    const updated: Document[] = [];
    for (const doc of candidates) {
      const patch: Document = {};
      for (const assign of splitArgs(setPart)) {
        const eq = assign.trim().match(/^([a-zA-Z0-9_]+)\s*=\s*([\s\S]+)$/);
        if (!eq) continue;
        const key = eq[1];
        let raw = eq[2].trim();
        if (raw === "CURRENT_TIMESTAMP" || /^now\(\)$/i.test(raw)) {
          patch[key] = new Date().toISOString();
          continue;
        }
        const coal = raw.match(/^coalesce\((.+),\s*[a-zA-Z0-9_.]+\)$/i);
        if (coal) {
          const lit = parseLiteral(coal[1]);
          if (lit !== null) patch[key] = lit;
          continue;
        }
        if (/^case\b/i.test(raw)) {
          const v = evaluateCase(raw, doc);
          if (v !== undefined) patch[key] = v;
          continue;
        }
        patch[key] = parseLiteral(raw);
      }
      if (Object.keys(patch).length === 0) {
        updated.push(doc);
        continue;
      }
      await col.updateOne({ _id: doc._id }, { $set: patch });
      updated.push({ ...doc, ...patch });
    }

    if (/returning/i.test(sql)) {
      const rows = updated.map((d) => {
        const { _id: _a, ...rest } = d;
        return rest;
      }) as T[];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: updated.length };
  }

  // DELETE
  if (sqlUpper.startsWith("DELETE FROM")) {
    const m = sql.match(
      /delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+([\s\S]+?)(?:\s+returning\s+([\s\S]+))?$/i,
    );
    if (!m) throw new Error(`mongo-sql-bridge: unsupported DELETE: ${original.slice(0, 120)}`);
    const table = mapTable(m[1]);
    const col = await getCollection(table);
    let docs = await col.find(applyResourceDeptFilter(table, original, {})).toArray();
    docs = docs.filter((d) => evalPredicate(d, m[2]));
    if (docs.length) {
      await col.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    }
    if (/returning/i.test(sql)) {
      return {
        rows: docs.map((d) => {
          const { _id: _a, ...rest } = d;
          return rest;
        }) as T[],
        rowCount: docs.length,
      };
    }
    return { rows: [], rowCount: docs.length };
  }

  if (sqlUpper.startsWith("SELECT") || sqlUpper.startsWith("WITH")) {
    const result = await executeSelect(sql, original);
    return result as QueryResult<T>;
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
