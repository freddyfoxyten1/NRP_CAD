import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type pg from "pg";

type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
  command: string;
  oid: number;
  fields: never[];
};

/** Columns stored as JSON text in SQLite that Postgres would return as arrays/objects. */
const JSON_TEXT_COLUMNS = new Set([
  "certifications",
  "who_can_drive",
  "who_can_use",
  "restrict_to_divisions",
  "liveries",
  "content",
  "header_config",
]);

function hydrateJsonColumns<T extends Record<string, unknown>>(row: T): T {
  for (const key of Object.keys(row)) {
    if (!JSON_TEXT_COLUMNS.has(key)) continue;
    const value = row[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || (trimmed[0] !== "[" && trimmed[0] !== "{")) continue;
    try {
      (row as Record<string, unknown>)[key] = JSON.parse(trimmed);
    } catch {
      /* leave raw string */
    }
  }
  return row;
}

function hydrateRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => hydrateJsonColumns(row));
}

function findWorkspaceRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (
      existsSync(join(dir, "package.json")) ||
      existsSync(join(dir, "bun.lock")) ||
      existsSync(join(dir, "cad-database"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function resolveDataDir(): string {
  if (process.env.CAD_DATABASE_PATH) {
    return resolve(process.env.CAD_DATABASE_PATH);
  }
  const root = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));
  return join(root, "cad-database");
}

function rewritePgToSqlite(
  sql: string,
  params: unknown[] = [],
): { text: string; values: unknown[] } {
  let text = sql;

  // Expand ANY($n::type[]) / ANY($n) into IN (?, ?, ...)
  const anyRe = /\bANY\s*\(\s*\$(\d+)(?:::\w+(?:\[\])?)?\s*\)/gi;
  const expansions: { index: number; start: number; end: number; paramNum: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = anyRe.exec(sql)) !== null) {
    expansions.push({
      index: match.index,
      start: match.index,
      end: match.index + match[0].length,
      paramNum: Number(match[1]),
    });
  }

  if (expansions.length > 0) {
    const pieces: string[] = [];
    const values: unknown[] = [];
    let cursor = 0;

    const pushWithParams = (chunk: string) => {
      const paramRe = /\$(\d+)/g;
      let m: RegExpExecArray | null;
      let last = 0;
      let out = "";
      while ((m = paramRe.exec(chunk)) !== null) {
        out += chunk.slice(last, m.index) + "?";
        values.push(params[Number(m[1]) - 1]);
        last = m.index + m[0].length;
      }
      out += chunk.slice(last);
      pieces.push(out);
    };

    for (const exp of expansions) {
      let before = sql.slice(cursor, exp.start);
      // Postgres `col = ANY($n)` / `col <> ANY($n)` → SQLite `col IN (...)` / `col NOT IN (...)`
      let op = "IN";
      const eqMatch = before.match(/(\s*)(?:<>|!=|=)\s*$/);
      if (eqMatch) {
        before = before.slice(0, before.length - eqMatch[0].length) + (eqMatch[1] || " ");
        if (eqMatch[0].includes("<>") || eqMatch[0].includes("!=")) op = "NOT IN";
      }
      pushWithParams(before);
      const arr = params[exp.paramNum - 1];
      const list = Array.isArray(arr) ? arr : [arr];
      if (list.length === 0) {
        // Match nothing
        pieces.push(`${op} (SELECT NULL WHERE 0)`);
      } else {
        pieces.push(`${op} (${list.map(() => "?").join(", ")})`);
        values.push(...list);
      }
      cursor = exp.end;
    }
    pushWithParams(sql.slice(cursor));
    text = pieces.join("");
    text = applyTypeRewrites(text);
    return { text, values };
  }

  text = applyTypeRewrites(text);

  // Remap $1-style params to ? in appearance order
  const values: unknown[] = [];
  text = text.replace(/\$(\d+)/g, (_whole, num: string) => {
    values.push(params[Number(num) - 1]);
    return "?";
  });

  return { text, values };
}

function applyTypeRewrites(sql: string): string {
  return sql
    .replace(/\bBIGSERIAL\b/gi, "INTEGER")
    .replace(/\bSERIAL\b/gi, "INTEGER")
    .replace(/\bTIMESTAMPTZ\b/gi, "TEXT")
    .replace(/\bTIMESTAMP\b/gi, "TEXT")
    .replace(/\bBOOLEAN\b/gi, "INTEGER")
    .replace(/\bBOOL\b/gi, "INTEGER")
    .replace(/\bTEXT\s*\[\s*\]/gi, "TEXT")
    .replace(/\bINTEGER\s*\[\s*\]/gi, "TEXT")
    .replace(/\bINT\s*\[\s*\]/gi, "TEXT")
    .replace(/DEFAULT\s+'\{\}'/gi, "DEFAULT '[]'")
    .replace(/DEFAULT\s+"\{\}"/gi, "DEFAULT '[]'")
    .replace(/DEFAULT\s+\{\}/g, "DEFAULT '[]'")
    .replace(/DEFAULT\s+NOW\s*\(\s*\)/gi, "DEFAULT (datetime('now'))")
    .replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')")
    .replace(/DEFAULT\s+datetime\('now'\)/gi, "DEFAULT (datetime('now'))")
    .replace(/\bTRUE\b/gi, "1")
    .replace(/\bFALSE\b/gi, "0")
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/TO_CHAR\s*\(\s*([^,]+)\s*,\s*'YYYY-MM-DD'\s*\)/gi, "strftime('%Y-%m-%d', $1)")
    .replace(/\bNULLS\s+LAST\b/gi, "")
    .replace(/\bNULLS\s+FIRST\b/gi, "")
    .replace(/::\s*text\s*\[\s*\]/gi, "")
    .replace(/::\s*int(?:eger)?\s*\[\s*\]/gi, "")
    .replace(/::\s*text(?:\s*::\s*\w+)?/gi, "")
    .replace(/::\s*int(?:eger)?/gi, "")
    .replace(/::\s*boolean/gi, "")
    .replace(/::\s*bool/gi, "")
    .replace(/::\s*date/gi, "")
    .replace(/::\s*timestamptz/gi, "")
    .replace(/::\s*timestamp/gi, "")
    .replace(/::\s*real/gi, "")
    .replace(/::\s*float(?:8)?/gi, "")
    .replace(/\bJSONB\b/gi, "TEXT")
    .replace(/\bJSON\b/gi, "TEXT")
    .replace(/\bEXCLUDED\./g, "excluded.")
    // ORDER BY col ASC NULLS LAST → SQLite-friendly form
    .replace(
      /\bORDER\s+BY\s+([\w.]+)\s+(ASC|DESC)\s+NULLS\s+LAST\b/gi,
      "ORDER BY CASE WHEN $1 IS NULL THEN 1 ELSE 0 END, $1 $2",
    )
    .replace(
      /\bORDER\s+BY\s+([\w.]+)\s+(ASC|DESC)\s+NULLS\s+FIRST\b/gi,
      "ORDER BY CASE WHEN $1 IS NULL THEN 0 ELSE 1 END, $1 $2",
    )
    .replace(/\bNULLS\s+LAST\b/gi, "")
    .replace(/\bNULLS\s+FIRST\b/gi, "");
}

function ensureAutoIncrement(sql: string): string {
  // "id INTEGER PRIMARY KEY" → AUTOINCREMENT for insert behavior like SERIAL
  return sql.replace(
    /\bid\s+INTEGER\s+PRIMARY\s+KEY\b(?!\s+AUTOINCREMENT)/gi,
    "id INTEGER PRIMARY KEY AUTOINCREMENT",
  );
}

function bootstrapSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cad_user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_user_id TEXT,
      username TEXT NOT NULL,
      discord_username TEXT NOT NULL DEFAULT '',
      discord_id TEXT NOT NULL DEFAULT '',
      avatar_hash TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      community_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      rank TEXT NOT NULL DEFAULT 'Member',
      role TEXT NOT NULL DEFAULT 'Community Members',
      callsign TEXT,
      password_salt TEXT,
      password_hash TEXT,
      dps_rank TEXT,
      dps_role TEXT,
      staff_rank TEXT,
      staff_role TEXT,
      staff_appointed_date TEXT,
      appointed_date TEXT,
      whitelisted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cad_user_profiles_discord_id_unique
      ON cad_user_profiles (discord_id)
      WHERE discord_id IS NOT NULL AND discord_id != '';

    CREATE TABLE IF NOT EXISTS staff_rank_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      staff_access INTEGER NOT NULL DEFAULT 1,
      admin_access INTEGER NOT NULL DEFAULT 0,
      doc_access INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS staff_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER REFERENCES staff_rank_groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color_hex TEXT,
      discord_role_id TEXT,
      callsign_prefix TEXT,
      callsign_type TEXT,
      callsign_static TEXT,
      callsign_min INTEGER,
      callsign_max INTEGER
    );

    CREATE TABLE IF NOT EXISTS dps_rank_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      panel_access INTEGER NOT NULL DEFAULT 0,
      division_oversight INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER REFERENCES dps_rank_groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      discord_role_id TEXT,
      callsign_prefix TEXT,
      callsign_type TEXT,
      callsign_static TEXT,
      callsign_min INTEGER,
      callsign_max INTEGER,
      color_hex TEXT,
      insignia_url TEXT
    );

    CREATE TABLE IF NOT EXISTS dps_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      username TEXT,
      dps_rank TEXT,
      dps_role TEXT,
      division_rank TEXT,
      callsign TEXT NOT NULL DEFAULT '4D-XX',
      status TEXT NOT NULL DEFAULT 'Active',
      appointed_date TEXT,
      pob INTEGER NOT NULL DEFAULT 0,
      iab INTEGER NOT NULL DEFAULT 0,
      hsu INTEGER NOT NULL DEFAULT 0,
      sru INTEGER NOT NULL DEFAULT 0,
      fou INTEGER NOT NULL DEFAULT 0,
      certifications TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dps_divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      discord_role_id TEXT,
      unit_key TEXT,
      info_content TEXT NOT NULL DEFAULT '{"sections":[]}'
    );

    CREATE TABLE IF NOT EXISTS dps_division_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      division_id INTEGER REFERENCES dps_divisions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color_hex TEXT,
      insignia_url TEXT,
      discord_role_id TEXT,
      callsign_prefix TEXT,
      callsign_type TEXT,
      callsign_static TEXT,
      callsign_min INTEGER,
      callsign_max INTEGER
    );

    CREATE TABLE IF NOT EXISTS dps_division_rank_custom_callsigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      division_rank_id INTEGER NOT NULL REFERENCES dps_division_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dps_rank_custom_callsigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_id INTEGER NOT NULL REFERENCES dps_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dps_user_divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      division_id INTEGER NOT NULL REFERENCES dps_divisions(id) ON DELETE CASCADE,
      division_rank TEXT NOT NULL,
      is_manual INTEGER NOT NULL DEFAULT 0,
      can_edit_resources INTEGER NOT NULL DEFAULT 0,
      can_edit_roster INTEGER NOT NULL DEFAULT 0,
      can_edit_info INTEGER NOT NULL DEFAULT 0,
      UNIQUE (profile_id, division_id)
    );

    CREATE TABLE IF NOT EXISTS doc_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      username TEXT,
      doc_rank TEXT,
      doc_role TEXT,
      callsign TEXT NOT NULL DEFAULT 'DOC-XX',
      status TEXT NOT NULL DEFAULT 'Active',
      appointed_date TEXT,
      certifications TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dph_rank_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      panel_access INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      group_id INTEGER REFERENCES dph_rank_groups(id) ON DELETE SET NULL,
      color_hex TEXT,
      callsign_prefix TEXT,
      insignia_url TEXT,
      discord_role_id TEXT
    );

    CREATE TABLE IF NOT EXISTS dph_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      username TEXT,
      dph_rank TEXT,
      dph_role TEXT,
      callsign TEXT NOT NULL DEFAULT 'DPH-XX',
      status TEXT NOT NULL DEFAULT 'Active',
      appointed_date TEXT,
      certifications TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dph_fleet_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_fleet (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      year TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      category_sort INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      who_can_drive TEXT NOT NULL DEFAULT '[]',
      restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
      liveries TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_equipment_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      category_sort INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      image_scale REAL NOT NULL DEFAULT 1,
      image_position_x REAL NOT NULL DEFAULT 50,
      image_position_y REAL NOT NULL DEFAULT 50,
      who_can_use TEXT NOT NULL DEFAULT '[]',
      restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      purpose TEXT,
      hosted_by TEXT,
      hosting_department TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dph_divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      discord_role_id TEXT,
      unit_key TEXT,
      info_content TEXT NOT NULL DEFAULT '{"sections":[]}'
    );

    CREATE TABLE IF NOT EXISTS dph_division_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      division_id INTEGER REFERENCES dph_divisions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color_hex TEXT,
      insignia_url TEXT,
      discord_role_id TEXT,
      callsign_prefix TEXT,
      callsign_type TEXT,
      callsign_static TEXT,
      callsign_min INTEGER,
      callsign_max INTEGER
    );

    CREATE TABLE IF NOT EXISTS dph_division_rank_custom_callsigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      division_rank_id INTEGER NOT NULL REFERENCES dph_division_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dph_rank_custom_callsigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_id INTEGER NOT NULL REFERENCES dph_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dph_user_divisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      division_id INTEGER NOT NULL REFERENCES dph_divisions(id) ON DELETE CASCADE,
      division_rank TEXT NOT NULL,
      is_manual INTEGER NOT NULL DEFAULT 0,
      can_edit_resources INTEGER NOT NULL DEFAULT 0,
      can_edit_roster INTEGER NOT NULL DEFAULT 0,
      can_edit_info INTEGER NOT NULL DEFAULT 0,
      UNIQUE (profile_id, division_id)
    );

    CREATE TABLE IF NOT EXISTS dph_content (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS dph_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'document',
      logo_url TEXT,
      header_config TEXT NOT NULL DEFAULT '{}',
      content TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      file_data BLOB,
      division_id INTEGER,
      division_only INTEGER NOT NULL DEFAULT 0,
      allowed_ranks TEXT NOT NULL DEFAULT '[]',
      personnel_only INTEGER NOT NULL DEFAULT 0,
      allowed_dph_ranks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dps_fleet_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_fleet (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      year TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      category_sort INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      image_scale REAL NOT NULL DEFAULT 1,
      image_position_x REAL NOT NULL DEFAULT 50,
      image_position_y REAL NOT NULL DEFAULT 50,
      who_can_drive TEXT NOT NULL DEFAULT '[]',
      restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
      liveries TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      purpose TEXT,
      hosted_by TEXT,
      hosting_department TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS staff_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      purpose TEXT,
      hosted_by TEXT,
      hosting_department TEXT NOT NULL DEFAULT 'DOJ Staff',
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dps_content (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '{}'
    );

    INSERT INTO staff_rank_groups (name, sort_order, locked, staff_access, admin_access, doc_access)
    SELECT 'Executive Team', 0, 1, 1, 1, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM staff_rank_groups WHERE lower(name) = 'executive team'
    );
  `);

  // Existing DBs created before these columns existed — add them safely.
  const optionalProfileColumns: Array<[string, string]> = [
    ["appointed_date", "TEXT"],
    ["staff_appointed_date", "TEXT"],
    ["pob", "INTEGER NOT NULL DEFAULT 0"],
    ["iab", "INTEGER NOT NULL DEFAULT 0"],
    ["hsu", "INTEGER NOT NULL DEFAULT 0"],
    ["sru", "INTEGER NOT NULL DEFAULT 0"],
    ["fou", "INTEGER NOT NULL DEFAULT 0"],
    ["certifications", "TEXT NOT NULL DEFAULT '[]'"],
    ["dps_rank", "TEXT"],
    ["dps_role", "TEXT"],
    ["staff_rank", "TEXT"],
    ["staff_role", "TEXT"],
    ["callsign", "TEXT"],
    ["whitelisted", "INTEGER DEFAULT 0"],
    ["can_access_iab", "INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [column, def] of optionalProfileColumns) {
    const cols = db.prepare(`PRAGMA table_info(cad_user_profiles)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      try {
        db.exec(`ALTER TABLE cad_user_profiles ADD COLUMN ${column} ${def}`);
      } catch {
        /* ignore */
      }
    }
  }

  const optionalRankGroupColumns: Array<[string, string]> = [
    ["panel_access", "INTEGER NOT NULL DEFAULT 0"],
    ["division_oversight", "INTEGER NOT NULL DEFAULT 0"],
    ["locked", "INTEGER NOT NULL DEFAULT 0"],
  ];
  try {
    const groupCols = db.prepare(`PRAGMA table_info(dps_rank_groups)`).all() as { name: string }[];
    for (const [column, def] of optionalRankGroupColumns) {
      if (!groupCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dps_rank_groups ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  const optionalRankColumns: Array<[string, string]> = [
    ["color_hex", "TEXT"],
    ["insignia_url", "TEXT"],
    ["callsign_prefix", "TEXT"],
    ["callsign_type", "TEXT"],
    ["callsign_static", "TEXT"],
    ["callsign_min", "INTEGER"],
    ["callsign_max", "INTEGER"],
    ["discord_role_id", "TEXT"],
  ];
  const rankCols = db.prepare(`PRAGMA table_info(dps_ranks)`).all() as { name: string }[];
  for (const [column, def] of optionalRankColumns) {
    if (!rankCols.some((c) => c.name === column)) {
      try {
        db.exec(`ALTER TABLE dps_ranks ADD COLUMN ${column} ${def}`);
      } catch {
        /* ignore */
      }
    }
  }

  // DPH mirrors the DPS rank feature set (Discord links + callsign generation).
  const optionalDphRankColumns: Array<[string, string]> = [
    ["discord_role_id", "TEXT"],
    ["callsign_prefix", "TEXT"],
    ["callsign_type", "TEXT"],
    ["callsign_static", "TEXT"],
    ["callsign_min", "INTEGER"],
    ["callsign_max", "INTEGER"],
  ];
  try {
    const dphRankCols = db.prepare(`PRAGMA table_info(dph_ranks)`).all() as { name: string }[];
    for (const [column, def] of optionalDphRankColumns) {
      if (!dphRankCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_ranks ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const dphGroupCols = db.prepare(`PRAGMA table_info(dph_rank_groups)`).all() as { name: string }[];
    for (const [column, def] of [
      ["panel_access", "INTEGER NOT NULL DEFAULT 0"],
      ["division_oversight", "INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      if (!dphGroupCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_rank_groups ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const dphUserCols = db.prepare(`PRAGMA table_info(dph_users)`).all() as { name: string }[];
    for (const [column, def] of [
      ["division_rank", "TEXT"],
      ["can_view_all_resources", "INTEGER NOT NULL DEFAULT 0"],
      ["can_access_iab", "INTEGER NOT NULL DEFAULT 0"],
      ["pob", "INTEGER NOT NULL DEFAULT 0"],
      ["iab", "INTEGER NOT NULL DEFAULT 0"],
      ["hsu", "INTEGER NOT NULL DEFAULT 0"],
      ["sru", "INTEGER NOT NULL DEFAULT 0"],
      ["fou", "INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      if (!dphUserCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_users ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const dphDivCols = db.prepare(`PRAGMA table_info(dph_divisions)`).all() as { name: string }[];
    for (const [column, def] of [
      ["discord_role_id", "TEXT"],
      ["unit_key", "TEXT"],
      ["info_content", `TEXT NOT NULL DEFAULT '{"sections":[]}'`],
    ] as const) {
      if (!dphDivCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_divisions ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const dphDivRankCols = db.prepare(`PRAGMA table_info(dph_division_ranks)`).all() as { name: string }[];
    for (const [column, def] of [
      ["discord_role_id", "TEXT"],
      ["color_hex", "TEXT"],
      ["insignia_url", "TEXT"],
      ["callsign_prefix", "TEXT"],
      ["callsign_type", "TEXT"],
      ["callsign_static", "TEXT"],
      ["callsign_min", "INTEGER"],
      ["callsign_max", "INTEGER"],
    ] as const) {
      if (!dphDivRankCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_division_ranks ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const dphUserDivCols = db.prepare(`PRAGMA table_info(dph_user_divisions)`).all() as { name: string }[];
    for (const [column, def] of [
      ["is_manual", "INTEGER NOT NULL DEFAULT 0"],
      ["can_edit_resources", "INTEGER NOT NULL DEFAULT 0"],
      ["can_edit_roster", "INTEGER NOT NULL DEFAULT 0"],
      ["can_edit_info", "INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      if (!dphUserDivCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_user_divisions ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const dphResourceCols = db.prepare(`PRAGMA table_info(dph_resources)`).all() as { name: string }[];
    for (const [column, def] of [
      ["header_config", "TEXT NOT NULL DEFAULT '{}'"],
      ["file_data", "BLOB"],
      ["division_id", "INTEGER"],
      ["division_only", "INTEGER NOT NULL DEFAULT 0"],
      ["allowed_ranks", "TEXT NOT NULL DEFAULT '[]'"],
      ["personnel_only", "INTEGER NOT NULL DEFAULT 0"],
      ["allowed_dph_ranks", "TEXT NOT NULL DEFAULT '[]'"],
    ] as const) {
      if (!dphResourceCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dph_resources ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  const optionalDpsUserColumns: Array<[string, string]> = [
    ["division_rank", "TEXT"],
    ["can_view_all_resources", "INTEGER NOT NULL DEFAULT 0"],
  ];
  const dpsUserCols = db.prepare(`PRAGMA table_info(dps_users)`).all() as { name: string }[];
  for (const [column, def] of optionalDpsUserColumns) {
    if (!dpsUserCols.some((c) => c.name === column)) {
      try {
        db.exec(`ALTER TABLE dps_users ADD COLUMN ${column} ${def}`);
      } catch {
        /* ignore */
      }
    }
  }

  const optionalDivisionColumns: Array<[string, string]> = [
    ["discord_role_id", "TEXT"],
    ["unit_key", "TEXT"],
  ];
  try {
    const divCols = db.prepare(`PRAGMA table_info(dps_divisions)`).all() as { name: string }[];
    for (const [column, def] of optionalDivisionColumns) {
      if (!divCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dps_divisions ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  const optionalDivisionRankColumns: Array<[string, string]> = [
    ["discord_role_id", "TEXT"],
    ["callsign_prefix", "TEXT"],
    ["callsign_type", "TEXT"],
    ["callsign_static", "TEXT"],
    ["callsign_min", "INTEGER"],
    ["callsign_max", "INTEGER"],
  ];
  try {
    const divRankCols = db.prepare(`PRAGMA table_info(dps_division_ranks)`).all() as { name: string }[];
    for (const [column, def] of optionalDivisionRankColumns) {
      if (!divRankCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dps_division_ranks ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const userDivCols = db.prepare(`PRAGMA table_info(dps_user_divisions)`).all() as { name: string }[];
    for (const [column, def] of [
      ["is_manual", "INTEGER NOT NULL DEFAULT 0"],
      ["can_edit_resources", "INTEGER NOT NULL DEFAULT 0"],
      ["can_edit_roster", "INTEGER NOT NULL DEFAULT 0"],
      ["can_edit_info", "INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      if (!userDivCols.some((c) => c.name === column)) {
        try { db.exec(`ALTER TABLE dps_user_divisions ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
      }
    }
  } catch { /* table may not exist yet */ }

  try {
    const divCols = db.prepare(`PRAGMA table_info(dps_divisions)`).all() as { name: string }[];
    if (!divCols.some((c) => c.name === "info_content")) {
      try {
        db.exec(`ALTER TABLE dps_divisions ADD COLUMN info_content TEXT NOT NULL DEFAULT '{"sections":[]}'`);
      } catch { /* ignore */ }
    }
  } catch { /* table may not exist yet */ }

  const optionalStaffRankColumns: Array<[string, string]> = [
    ["color_hex", "TEXT"],
    ["discord_role_id", "TEXT"],
    ["callsign_prefix", "TEXT"],
    ["callsign_type", "TEXT"],
    ["callsign_static", "TEXT"],
    ["callsign_min", "INTEGER"],
    ["callsign_max", "INTEGER"],
  ];
  const staffRankCols = db.prepare(`PRAGMA table_info(staff_ranks)`).all() as { name: string }[];
  for (const [column, def] of optionalStaffRankColumns) {
    if (!staffRankCols.some((c) => c.name === column)) {
      try {
        db.exec(`ALTER TABLE staff_ranks ADD COLUMN ${column} ${def}`);
      } catch {
        /* ignore */
      }
    }
  }

  const optionalEventHostColumns: Array<[string, string]> = [
    ["hosted_by", "TEXT"],
    ["hosting_department", "TEXT"],
  ];
  for (const table of ["dps_events", "dph_events", "staff_events"] as const) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      for (const [column, def] of optionalEventHostColumns) {
        if (!cols.some((c) => c.name === column)) {
          try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); } catch { /* ignore */ }
        }
      }
    } catch { /* table may not exist yet */ }
  }

  const optionalFleetColumns: Array<[string, string]> = [
    ["year", "TEXT"],
    ["category", "TEXT NOT NULL DEFAULT 'General'"],
    ["category_sort", "INTEGER NOT NULL DEFAULT 0"],
    ["image_url", "TEXT"],
    ["image_scale", "REAL NOT NULL DEFAULT 1"],
    ["image_position_x", "REAL NOT NULL DEFAULT 50"],
    ["image_position_y", "REAL NOT NULL DEFAULT 50"],
    ["who_can_drive", "TEXT NOT NULL DEFAULT '[]'"],
    ["restrict_to_divisions", "TEXT NOT NULL DEFAULT '[]'"],
    ["liveries", "TEXT NOT NULL DEFAULT '[]'"],
    ["notes", "TEXT"],
    ["sort_order", "INTEGER NOT NULL DEFAULT 0"],
  ];
  const fleetCols = db.prepare(`PRAGMA table_info(dps_fleet)`).all() as { name: string }[];
  for (const [column, def] of optionalFleetColumns) {
    if (!fleetCols.some((c) => c.name === column)) {
      try {
        db.exec(`ALTER TABLE dps_fleet ADD COLUMN ${column} ${def}`);
      } catch {
        /* ignore */
      }
    }
  }
}

export function createLocalSqlitePool(): pg.Pool {
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "dojcad.sqlite");

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  bootstrapSchema(db);

  console.info(`[db] Using local CAD database: ${dbPath}`);

  const run = (inputSql: string, params: unknown[] = []): QueryResult => {
    // SQLite (node:sqlite build) may not support ADD COLUMN IF NOT EXISTS —
    // emulate it via pragma_table_info.
    const addCol = inputSql.match(
      /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+([\s\S]+)$/i,
    );
    if (addCol) {
      const [, table, column, rest] = addCol;
      const existingCols = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      if (existingCols.some((c) => c.name === column)) {
        return { rows: [], rowCount: 0, command: "ALTER", oid: 0, fields: [] };
      }
      let colDef = applyTypeRewrites(`${column} ${rest}`.trim());
      colDef = colDef.replace(/DEFAULT\s+datetime\('now'\)/gi, "DEFAULT (datetime('now'))");
      // jsonb → TEXT
      colDef = colDef.replace(/\bJSONB\b/gi, "TEXT").replace(/\bJSON\b/gi, "TEXT");
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/duplicate column name/i.test(message)) {
          return { rows: [], rowCount: 0, command: "ALTER", oid: 0, fields: [] };
        }
        throw err;
      }
      return { rows: [], rowCount: 0, command: "ALTER", oid: 0, fields: [] };
    }

    let { text, values } = rewritePgToSqlite(inputSql, params);
    // Coerce values SQLite can bind: booleans → 0/1, arrays/objects → JSON text
    values = values.map((v) => {
      if (typeof v === "boolean") return v ? 1 : 0;
      if (v === null || v === undefined) return v;
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return v;
      if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      if (v instanceof Date) return v.toISOString();
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    });
    text = ensureAutoIncrement(text);
    text = text.replace(/\bJSONB\b/gi, "TEXT").replace(/\bJSON\b/gi, "TEXT");
    text = text.replace(/\bBYTEA\b/gi, "BLOB");

    const trimmed = text.trim();
    const command = trimmed.split(/\s+/)[0]?.toUpperCase() ?? "";

    try {
      if (/^(SELECT|WITH)\b/i.test(trimmed)) {
        const stmt = db.prepare(text);
        const rows = hydrateRows(stmt.all(...values) as Record<string, unknown>[]);
        return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
      }

      if (/\bRETURNING\b/i.test(trimmed)) {
        const stmt = db.prepare(text);
        const rows = hydrateRows(stmt.all(...values) as Record<string, unknown>[]);
        return {
          rows,
          rowCount: rows.length,
          command: command || "UPDATE",
          oid: 0,
          fields: [],
        };
      }

      const stmt = db.prepare(text);
      const info = stmt.run(...values);
      return {
        rows: [],
        rowCount: Number(info.changes ?? 0),
        command: command || "UPDATE",
        oid: 0,
        fields: [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Ignore duplicate-column ALTER failures
      if (
        /ADD COLUMN/i.test(inputSql) &&
        /duplicate column name/i.test(message)
      ) {
        return { rows: [], rowCount: 0, command: "ALTER", oid: 0, fields: [] };
      }

      // Ignore "index already exists" style races
      if (/already exists/i.test(message) && /CREATE (UNIQUE )?INDEX/i.test(inputSql)) {
        return { rows: [], rowCount: 0, command: "CREATE", oid: 0, fields: [] };
      }

      const wrapped = new Error(
        `Local CAD database query failed: ${message}\nSQL: ${inputSql.slice(0, 240)}`,
      );
      (wrapped as Error & { cause?: unknown }).cause = err;
      throw wrapped;
    }
  };

  const pool = {
    query: ((text: string, params?: unknown[]) => {
      try {
        return Promise.resolve(run(text, params ?? []));
      } catch (err) {
        return Promise.reject(err);
      }
    }) as pg.Pool["query"],
    connect: (async () => {
      const client = {
        query: ((text: string, params?: unknown[]) => {
          try {
            return Promise.resolve(run(text, params ?? []));
          } catch (err) {
            return Promise.reject(err);
          }
        }) as pg.PoolClient["query"],
        release: () => undefined,
      };
      return client as pg.PoolClient;
    }) as pg.Pool["connect"],
    end: async () => {
      db.close();
    },
    on: () => pool,
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
  };

  return pool as unknown as pg.Pool;
}
