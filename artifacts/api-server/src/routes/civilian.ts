import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

// ── Auto-create tables on first boot ─────────────────────────────────────────
const ensureTables = pool
  .query(`ALTER TABLE cad_civilians ADD COLUMN IF NOT EXISTS wanted BOOLEAN DEFAULT FALSE`)
  .catch(() => null)
  .then(() => pool.query(`ALTER TABLE cad_civilians ADD COLUMN IF NOT EXISTS bolo_reason TEXT`).catch(() => null))
  .then(() => pool.query(`ALTER TABLE cad_vehicles ADD COLUMN IF NOT EXISTS vin TEXT`).catch(() => null))  
  .then(() => pool.query(`ALTER TABLE cad_vehicles ADD COLUMN IF NOT EXISTS insured BOOLEAN DEFAULT FALSE`).catch(() => null))
  .then(() => pool.query(`ALTER TABLE cad_vehicles ALTER COLUMN model DROP NOT NULL`).catch(() => null))
  .then(() => pool.query(`ALTER TABLE cad_civilians ADD COLUMN IF NOT EXISTS hair_colour TEXT`).catch(() => null))
  .then(() => pool.query(`ALTER TABLE cad_civilians ADD COLUMN IF NOT EXISTS occupation TEXT`).catch(() => null))
  .then(() => pool.query(`ALTER TABLE cad_civilians ADD COLUMN IF NOT EXISTS valid_licence BOOLEAN DEFAULT TRUE`).catch(() => null))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS cad_civilians (
      id            SERIAL PRIMARY KEY,
      owner_username TEXT NOT NULL,
      first_name    TEXT NOT NULL,
      last_name     TEXT NOT NULL,
      dob           TEXT,
      gender        TEXT,
      ethnicity     TEXT,
      address       TEXT,
      phone         TEXT,
      notes         TEXT,
      wanted        BOOLEAN DEFAULT FALSE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS cad_vehicles (
      id            SERIAL PRIMARY KEY,
      owner_username TEXT NOT NULL,
      civilian_id   INTEGER REFERENCES cad_civilians(id) ON DELETE SET NULL,
      plate         TEXT NOT NULL,
      make          TEXT NOT NULL,
      model         TEXT,
      year          TEXT,
      color         TEXT,
      vin           TEXT,
      registered    BOOLEAN DEFAULT TRUE,
      insured       BOOLEAN DEFAULT FALSE,
      stolen        BOOLEAN DEFAULT FALSE,
      bolo          BOOLEAN DEFAULT FALSE,
      bolo_reason   TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `))
  .then(() => pool.query(`ALTER TABLE cad_vehicles ADD COLUMN IF NOT EXISTS bolo BOOLEAN DEFAULT FALSE`).catch(() => null))
  .then(() => pool.query(`ALTER TABLE cad_vehicles ADD COLUMN IF NOT EXISTS bolo_reason TEXT`).catch(() => null))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS cad_weapons (
      id             SERIAL PRIMARY KEY,
      owner_username  TEXT NOT NULL,
      civilian_id    INTEGER REFERENCES cad_civilians(id) ON DELETE SET NULL,
      weapon_type    TEXT NOT NULL,
      serial_number  TEXT,
      registered     BOOLEAN DEFAULT TRUE,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS cad_arrests (
      id          SERIAL PRIMARY KEY,
      civilian_id INTEGER NOT NULL REFERENCES cad_civilians(id) ON DELETE CASCADE,
      charges     TEXT NOT NULL,
      officer     TEXT,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS cad_civilian_history (
      id          SERIAL PRIMARY KEY,
      civilian_id INTEGER NOT NULL REFERENCES cad_civilians(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      description TEXT,
      officer     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `))
  .then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS cad_citations (
      id          SERIAL PRIMARY KEY,
      civilian_id INTEGER REFERENCES cad_civilians(id) ON DELETE SET NULL,
      subject     TEXT NOT NULL,
      officer     TEXT,
      date_time   TEXT,
      location    TEXT,
      violation   TEXT NOT NULL,
      fine_amount TEXT,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `))
  .then(() => pool.query(`ALTER TABLE cad_citations ADD COLUMN IF NOT EXISTS civilian_id INTEGER REFERENCES cad_civilians(id) ON DELETE SET NULL`).catch(() => null))
  .catch(() => null);

// ── Helpers ───────────────────────────────────────────────────────────────────
const init = () => ensureTables;

/** Accept both JSON booleans and their string representations. */
const parseBool = (val: string | boolean | undefined, defaultVal: boolean): boolean => {
  if (val === true || val === "true") return true;
  if (val === false || val === "false") return false;
  return defaultVal;
};

// ── CAD Officer: Name Search ──────────────────────────────────────────────────
// Search all civilians by first/last name (no owner filter — officers can see all)
router.get("/civilian/search", async (req, res) => {
  await init();
  const { q } = req.query as { q?: string };
  if (!q || q.trim().length < 2) {
    res.json([]);
    return;
  }
  const term = `%${q.trim()}%`;
  const result = await pool.query(
    `SELECT c.id, c.first_name, c.last_name, c.dob, c.gender, c.ethnicity, c.hair_colour, c.occupation, c.address, c.phone, c.notes, c.wanted, c.valid_licence, c.created_at,
            COALESCE(ci.cnt, 0)::int AS citation_count
     FROM cad_civilians c
     LEFT JOIN (
       SELECT civilian_id, COUNT(*) AS cnt
       FROM cad_citations
       WHERE civilian_id IS NOT NULL
       GROUP BY civilian_id
     ) ci ON ci.civilian_id = c.id
     WHERE c.first_name ILIKE $1 OR c.last_name ILIKE $1
        OR CONCAT(c.first_name, ' ', c.last_name) ILIKE $1
     ORDER BY c.last_name, c.first_name
     LIMIT 50`,
    [term]
  );
  res.json(result.rows);
});

// ── CAD Officer: Civilian detail sub-resources ────────────────────────────────
router.get("/civilian/:id/vehicles", async (req, res) => {
  await init();
  const result = await pool.query(
    `SELECT id, plate, make, model, year, color, registered, stolen, created_at
     FROM cad_vehicles WHERE civilian_id=$1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.get("/civilian/:id/arrests", async (req, res) => {
  await init();
  const result = await pool.query(
    `SELECT id, charges, officer, notes, created_at
     FROM cad_arrests WHERE civilian_id=$1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.get("/civilian/:id/history", async (req, res) => {
  await init();
  const result = await pool.query(
    `SELECT id, type, description, officer, created_at
     FROM cad_civilian_history WHERE civilian_id=$1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.get("/civilian/:id/citations", async (req, res) => {
  await init();
  const result = await pool.query(
    `SELECT id, violation, fine_amount, officer, date_time, location, notes, created_at
     FROM cad_citations WHERE civilian_id=$1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(result.rows);
});

// ── Characters ────────────────────────────────────────────────────────────────
router.get("/civilian/characters", async (req, res) => {
  await init();
  const { username } = req.query as { username?: string };
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  const result = await pool.query(
    `SELECT * FROM cad_civilians WHERE owner_username=$1 ORDER BY created_at DESC`,
    [username]
  );
  res.json(result.rows);
});

router.get("/civilian/phone-lookup", async (req, res) => {
  await init();
  const { phone } = req.query as { phone?: string };
  if (!phone) { res.status(400).json({ error: "phone required" }); return; }
  const result = await pool.query(
    `SELECT id, first_name, last_name FROM cad_civilians WHERE phone=$1 LIMIT 1`,
    [phone]
  );
  res.json({ found: result.rows.length > 0, contact: result.rows[0] ?? null });
});

const genPhone = () => {
  const first = Math.floor(Math.random() * 900 + 100);
  const last  = Math.floor(Math.random() * 9000 + 1000);
  return `${first}-${last}`;
};

router.post("/civilian/characters", async (req, res) => {
  await init();
  const { owner_username, first_name, last_name, dob, gender, ethnicity, hair_colour, occupation, address, notes, wanted, valid_licence } =
    req.body as Record<string, string | boolean>;
  if (!owner_username || !first_name || !last_name) {
    res.status(400).json({ error: "owner_username, first_name and last_name are required" });
    return;
  }
  const phone = genPhone();
  const result = await pool.query(
    `INSERT INTO cad_civilians (owner_username,first_name,last_name,dob,gender,ethnicity,hair_colour,occupation,address,phone,notes,wanted,valid_licence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [owner_username, first_name, last_name, dob ?? null, gender ?? null, ethnicity ?? null, hair_colour ?? null, occupation ?? null, address ?? null, phone, notes ?? null,
     parseBool(wanted as string | boolean | undefined, false),
     parseBool(valid_licence as string | boolean | undefined, true)]
  );
  res.status(201).json(result.rows[0]);
});

router.patch("/civilian/characters/:id", async (req, res) => {
  await init();
  const { id } = req.params;
  const { first_name, last_name, dob, gender, ethnicity, hair_colour, occupation, address, notes, wanted, valid_licence } =
    req.body as Record<string, string | boolean>;
  const result = await pool.query(
    `UPDATE cad_civilians SET first_name=$1,last_name=$2,dob=$3,gender=$4,ethnicity=$5,hair_colour=$6,occupation=$7,address=$8,notes=$9,wanted=$10,valid_licence=$11
     WHERE id=$12 RETURNING *`,
    [first_name, last_name, dob ?? null, gender ?? null, ethnicity ?? null, hair_colour ?? null, occupation ?? null, address ?? null, notes ?? null,
     parseBool(wanted as string | boolean | undefined, false),
     parseBool(valid_licence as string | boolean | undefined, true), id]
  );
  res.json(result.rows[0] ?? null);
});

// GET /civilian/bolos — all active BOLOs (civilians + vehicles, each with a kind field)
router.get("/civilian/bolos", async (req, res) => {
  await init();
  const result = await pool.query(`
    SELECT 'civilian' AS kind, id, bolo_reason, created_at,
           first_name, last_name, gender, hair_colour, occupation,
           NULL AS plate, NULL AS make, NULL AS model, NULL AS year, NULL AS color, NULL AS owner_name
    FROM cad_civilians WHERE wanted = TRUE
    UNION ALL
    SELECT 'vehicle' AS kind, v.id, v.bolo_reason, v.created_at,
           NULL, NULL, NULL, NULL, NULL,
           v.plate, v.make, v.model, v.year, v.color,
           CONCAT(c.first_name,' ',c.last_name) AS owner_name
    FROM cad_vehicles v
    LEFT JOIN cad_civilians c ON c.id = v.civilian_id
    WHERE v.bolo = TRUE
    ORDER BY created_at DESC
  `);
  res.json(result.rows);
});

// PATCH /civilian/characters/:id/bolo — set/clear BOLO without touching other fields
router.patch("/civilian/characters/:id/bolo", async (req, res) => {
  await init();
  const { id } = req.params;
  const { wanted, bolo_reason } = req.body as { wanted?: boolean; bolo_reason?: string };
  const result = await pool.query(
    `UPDATE cad_civilians SET wanted=$1, bolo_reason=$2 WHERE id=$3 RETURNING *`,
    [wanted ?? false, bolo_reason ?? null, id]
  );
  res.json(result.rows[0] ?? null);
});

router.delete("/civilian/characters/:id", async (req, res) => {
  await init();
  await pool.query(`DELETE FROM cad_civilians WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Vehicles ──────────────────────────────────────────────────────────────────
router.get("/civilian/vehicles/search", async (req, res) => {
  await init();
  const { q } = req.query as { q?: string };
  if (!q || q.trim().length < 1) { res.json([]); return; }
  const term = `%${q.trim().toUpperCase()}%`;
  const result = await pool.query(
    `SELECT v.id, v.plate, v.make, v.model, v.year, v.color, v.vin,
            v.registered, v.insured, v.stolen, v.bolo, v.bolo_reason,
            CONCAT(c.first_name,' ',c.last_name) AS owner_name,
            c.id AS owner_id
     FROM cad_vehicles v
     LEFT JOIN cad_civilians c ON c.id = v.civilian_id
     WHERE UPPER(v.plate) LIKE $1 OR UPPER(v.vin) LIKE $1
     ORDER BY v.plate
     LIMIT 50`,
    [term]
  );
  res.json(result.rows);
});

router.get("/civilian/vehicles", async (req, res) => {
  await init();
  const { username } = req.query as { username?: string };
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  const result = await pool.query(
    `SELECT v.*, CONCAT(c.first_name,' ',c.last_name) AS civilian_name
     FROM cad_vehicles v
     LEFT JOIN cad_civilians c ON c.id=v.civilian_id
     WHERE v.owner_username=$1 ORDER BY v.created_at DESC`,
    [username]
  );
  res.json(result.rows);
});

router.post("/civilian/vehicles", async (req, res) => {
  await init();
  const { owner_username, civilian_id, plate, make, model, year, color, vin, registered, insured, stolen } =
    req.body as Record<string, string | boolean>;
  if (!owner_username || !plate || !make) {
    res.status(400).json({ error: "owner_username, plate and make are required" });
    return;
  }
  const result = await pool.query(
    `INSERT INTO cad_vehicles (owner_username,civilian_id,plate,make,model,year,color,vin,registered,insured,stolen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [owner_username, civilian_id ? Number(civilian_id) : null, plate, make, model ?? null, year ?? null, color ?? null,
     vin ?? null,
     parseBool(registered as string | boolean | undefined, true),
     parseBool(insured as string | boolean | undefined, false),
     parseBool(stolen as string | boolean | undefined, false)]
  );
  res.status(201).json(result.rows[0]);
});

router.patch("/civilian/vehicles/:id", async (req, res) => {
  await init();
  const { id } = req.params;
  const { civilian_id, plate, make, model, year, color, vin, registered, insured, stolen } =
    req.body as Record<string, string | boolean>;
  const result = await pool.query(
    `UPDATE cad_vehicles SET civilian_id=$1,plate=$2,make=$3,model=$4,year=$5,color=$6,vin=$7,registered=$8,insured=$9,stolen=$10
     WHERE id=$11 RETURNING *`,
    [civilian_id ? Number(civilian_id) : null, plate, make, model ?? null, year ?? null, color ?? null,
     vin ?? null,
     parseBool(registered as string | boolean | undefined, true),
     parseBool(insured as string | boolean | undefined, false),
     parseBool(stolen as string | boolean | undefined, false), id]
  );
  res.json(result.rows[0] ?? null);
});

// PATCH /civilian/vehicles/:id/bolo — set/clear vehicle BOLO independently
router.patch("/civilian/vehicles/:id/bolo", async (req, res) => {
  await init();
  const { id } = req.params;
  const { bolo, bolo_reason } = req.body as { bolo?: boolean; bolo_reason?: string | null };
  const result = await pool.query(
    `UPDATE cad_vehicles SET bolo=$1, bolo_reason=$2 WHERE id=$3 RETURNING *`,
    [bolo ?? false, bolo_reason ?? null, id]
  );
  res.json(result.rows[0] ?? null);
});

router.delete("/civilian/vehicles/:id", async (req, res) => {
  await init();
  await pool.query(`DELETE FROM cad_vehicles WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Weapons ───────────────────────────────────────────────────────────────────
router.get("/civilian/weapons", async (req, res) => {
  await init();
  const { username } = req.query as { username?: string };
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  const result = await pool.query(
    `SELECT w.*, CONCAT(c.first_name,' ',c.last_name) AS civilian_name
     FROM cad_weapons w
     LEFT JOIN cad_civilians c ON c.id=w.civilian_id
     WHERE w.owner_username=$1 ORDER BY w.created_at DESC`,
    [username]
  );
  res.json(result.rows);
});

router.post("/civilian/weapons", async (req, res) => {
  await init();
  const { owner_username, civilian_id, weapon_type, serial_number, registered } =
    req.body as Record<string, string | boolean>;
  if (!owner_username || !weapon_type) {
    res.status(400).json({ error: "owner_username and weapon_type are required" });
    return;
  }
  const result = await pool.query(
    `INSERT INTO cad_weapons (owner_username,civilian_id,weapon_type,serial_number,registered)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [owner_username, civilian_id ? Number(civilian_id) : null, weapon_type,
     serial_number ?? null, parseBool(registered as string | boolean | undefined, true)]
  );
  res.status(201).json(result.rows[0]);
});

router.patch("/civilian/weapons/:id", async (req, res) => {
  await init();
  const { id } = req.params;
  const { civilian_id, weapon_type, serial_number, registered } =
    req.body as Record<string, string | boolean>;
  const result = await pool.query(
    `UPDATE cad_weapons SET civilian_id=$1,weapon_type=$2,serial_number=$3,registered=$4
     WHERE id=$5 RETURNING *`,
    [civilian_id ? Number(civilian_id) : null, weapon_type, serial_number ?? null,
     parseBool(registered as string | boolean | undefined, true), id]
  );
  res.json(result.rows[0] ?? null);
});

router.delete("/civilian/weapons/:id", async (req, res) => {
  await init();
  await pool.query(`DELETE FROM cad_weapons WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;
