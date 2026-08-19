type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

const NOW = `(NOW() AT TIME ZONE 'utc')::text`;

/**
 * Create the CAD SQL tables on hosted Postgres (Supabase / Neon).
 * Column types stay compatible with existing pool.query SQL (INTEGER flags, TEXT JSON).
 */
export async function ensurePostgresSchema(pool: Queryable): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_user_profiles (
      id SERIAL PRIMARY KEY,
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
      pob INTEGER NOT NULL DEFAULT 0,
      iab INTEGER NOT NULL DEFAULT 0,
      hsu INTEGER NOT NULL DEFAULT 0,
      sru INTEGER NOT NULL DEFAULT 0,
      fou INTEGER NOT NULL DEFAULT 0,
      certifications TEXT NOT NULL DEFAULT '[]',
      can_access_iab INTEGER NOT NULL DEFAULT 0,
      can_access_system_logs INTEGER NOT NULL DEFAULT 0,
      can_access_terms_privacy INTEGER NOT NULL DEFAULT 0,
      can_access_terminal_offline INTEGER NOT NULL DEFAULT 0,
      can_access_doc_dps_cad INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cad_user_profiles_discord_id_unique
      ON cad_user_profiles (discord_id)
      WHERE discord_id IS NOT NULL AND discord_id != '';

    CREATE TABLE IF NOT EXISTS staff_rank_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      staff_access INTEGER NOT NULL DEFAULT 1,
      admin_access INTEGER NOT NULL DEFAULT 0,
      doc_access INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS staff_ranks (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      panel_access INTEGER NOT NULL DEFAULT 0,
      division_oversight INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_ranks (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
      can_view_all_resources INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dps_divisions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      discord_role_id TEXT,
      unit_key TEXT,
      info_content TEXT NOT NULL DEFAULT '{"sections":[]}'
    );

    CREATE TABLE IF NOT EXISTS dps_division_ranks (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      division_rank_id INTEGER NOT NULL REFERENCES dps_division_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dps_rank_custom_callsigns (
      id SERIAL PRIMARY KEY,
      rank_id INTEGER NOT NULL REFERENCES dps_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dps_user_divisions (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      username TEXT,
      doc_rank TEXT,
      doc_role TEXT,
      callsign TEXT NOT NULL DEFAULT 'DOC-XX',
      status TEXT NOT NULL DEFAULT 'Active',
      appointed_date TEXT,
      certifications TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dph_rank_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      panel_access INTEGER NOT NULL DEFAULT 0,
      division_oversight INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_ranks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      group_id INTEGER REFERENCES dph_rank_groups(id) ON DELETE SET NULL,
      color_hex TEXT,
      callsign_prefix TEXT,
      callsign_type TEXT,
      callsign_static TEXT,
      callsign_min INTEGER,
      callsign_max INTEGER,
      insignia_url TEXT,
      discord_role_id TEXT
    );

    CREATE TABLE IF NOT EXISTS dph_users (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL UNIQUE REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
      username TEXT,
      dph_rank TEXT,
      dph_role TEXT,
      division_rank TEXT,
      callsign TEXT NOT NULL DEFAULT 'DPH-XX',
      status TEXT NOT NULL DEFAULT 'Active',
      appointed_date TEXT,
      certifications TEXT NOT NULL DEFAULT '[]',
      can_view_all_resources INTEGER NOT NULL DEFAULT 0,
      can_access_iab INTEGER NOT NULL DEFAULT 0,
      pob INTEGER NOT NULL DEFAULT 0,
      iab INTEGER NOT NULL DEFAULT 0,
      hsu INTEGER NOT NULL DEFAULT 0,
      sru INTEGER NOT NULL DEFAULT 0,
      fou INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dph_fleet_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_fleet (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_equipment (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      category_sort INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      image_scale DOUBLE PRECISION NOT NULL DEFAULT 1,
      image_position_x DOUBLE PRECISION NOT NULL DEFAULT 50,
      image_position_y DOUBLE PRECISION NOT NULL DEFAULT 50,
      who_can_use TEXT NOT NULL DEFAULT '[]',
      restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dph_events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      purpose TEXT,
      hosted_by TEXT,
      hosting_department TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dph_divisions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      discord_role_id TEXT,
      unit_key TEXT,
      info_content TEXT NOT NULL DEFAULT '{"sections":[]}'
    );

    CREATE TABLE IF NOT EXISTS dph_division_ranks (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      division_rank_id INTEGER NOT NULL REFERENCES dph_division_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dph_rank_custom_callsigns (
      id SERIAL PRIMARY KEY,
      rank_id INTEGER NOT NULL REFERENCES dph_ranks(id) ON DELETE CASCADE,
      callsign TEXT NOT NULL,
      assigned_profile_id INTEGER REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dph_user_divisions (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'document',
      logo_url TEXT,
      header_config TEXT NOT NULL DEFAULT '{}',
      content TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      file_data BYTEA,
      division_id INTEGER,
      division_only INTEGER NOT NULL DEFAULT 0,
      allowed_ranks TEXT NOT NULL DEFAULT '[]',
      personnel_only INTEGER NOT NULL DEFAULT 0,
      allowed_dph_ranks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dps_fleet_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_fleet (
      id SERIAL PRIMARY KEY,
      name TEXT,
      year TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      category_sort INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      image_scale DOUBLE PRECISION NOT NULL DEFAULT 1,
      image_position_x DOUBLE PRECISION NOT NULL DEFAULT 50,
      image_position_y DOUBLE PRECISION NOT NULL DEFAULT 50,
      who_can_drive TEXT NOT NULL DEFAULT '[]',
      restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
      liveries TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      purpose TEXT,
      hosted_by TEXT,
      hosting_department TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS staff_events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      purpose TEXT,
      hosted_by TEXT,
      hosting_department TEXT NOT NULL DEFAULT 'Northpoint Staff',
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dps_content (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS cad_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    INSERT INTO cad_settings (key, value) VALUES ('cad_online', 'true')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO cad_settings (key, value) VALUES ('cad_mode', 'online')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO cad_settings (key, value) VALUES ('self_dispatch', 'false')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO staff_rank_groups (name, sort_order, locked, staff_access, admin_access, doc_access)
    SELECT 'Executive Team', 0, 1, 1, 1, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM staff_rank_groups WHERE lower(name) = 'executive team'
    );
  `);

  await ensurePostgresMigrations(pool);
}

/** Idempotent column/table patches for Supabase databases created from older schema snapshots. */
async function ensurePostgresMigrations(pool: Queryable): Promise<void> {
  const addColumns: Array<[string, string, string]> = [
    ["cad_user_profiles", "division_rank", "TEXT"],
    ["dps_users", "division_rank", "TEXT"],
    ["dps_rank_groups", "panel_access", "INTEGER NOT NULL DEFAULT 0"],
    ["dps_rank_groups", "division_oversight", "INTEGER NOT NULL DEFAULT 0"],
    ["dps_rank_groups", "locked", "INTEGER NOT NULL DEFAULT 0"],
    ["dph_rank_groups", "panel_access", "INTEGER NOT NULL DEFAULT 0"],
    ["dph_rank_groups", "division_oversight", "INTEGER NOT NULL DEFAULT 0"],
    ["dps_resources", "allowed_dps_ranks", "TEXT NOT NULL DEFAULT '[]'"],
    ["dps_resources", "google_file_id", "TEXT"],
    ["dps_resources", "google_integration_id", "INTEGER"],
    ["dps_resources", "google_modified_time", "TEXT"],
  ];

  for (const [table, column, definition] of addColumns) {
    await pool.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`,
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dps_resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'document',
      logo_url TEXT,
      header_config TEXT NOT NULL DEFAULT '{}',
      content TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      file_data BYTEA,
      division_id INTEGER,
      division_only INTEGER NOT NULL DEFAULT 0,
      allowed_ranks TEXT NOT NULL DEFAULT '[]',
      personnel_only INTEGER NOT NULL DEFAULT 0,
      allowed_dps_ranks TEXT NOT NULL DEFAULT '[]',
      google_file_id TEXT,
      google_integration_id INTEGER,
      google_modified_time TEXT,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS dps_equipment_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dps_equipment (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity TEXT,
      category TEXT NOT NULL DEFAULT 'General',
      category_sort INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      image_scale DOUBLE PRECISION NOT NULL DEFAULT 1,
      image_position_x DOUBLE PRECISION NOT NULL DEFAULT 50,
      image_position_y DOUBLE PRECISION NOT NULL DEFAULT 50,
      who_can_use TEXT NOT NULL DEFAULT '[]',
      restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS staff_resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'document',
      logo_url TEXT,
      header_config TEXT NOT NULL DEFAULT '{}',
      content TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      file_data BYTEA,
      allowed_ranks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT ${NOW},
      updated_at TEXT NOT NULL DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS cad_audit_logs (
      id SERIAL PRIMARY KEY,
      department TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'System',
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );
  `);
}
