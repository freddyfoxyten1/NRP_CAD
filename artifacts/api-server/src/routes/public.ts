// ─────────────────────────────────────────────────────────────────────────────
// routes/public.ts — Unauthenticated public-view endpoints
//
// GET  /public/stats   — live ERLC player count + Discord guild member count
// GET  /public/gallery — gallery images
// POST /public/gallery (admin) — add image
// DELETE /public/gallery/:id (admin)
// GET  /public/press   — press / news items
// POST /public/press (admin)
// PATCH /public/press/:id (admin)
// DELETE /public/press/:id (admin)
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { fetchInGameStats } from "./stats";
import { writeLog } from "../lib/audit-log";

const router = Router();

const ADMIN_CODE      = process.env.ADMIN_PORTAL_CODE ?? "ADMIN2026";
const DISCORD_BOT     = process.env.DISCORD_BOT_TOKEN ?? "";
const PUBLIC_GUILD_ID = "823606319529066548";

// ── Admin guard ───────────────────────────────────────────────────────────────
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["x-admin-code"] !== ADMIN_CODE) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
};

const actorFrom = (req: Request) =>
  (typeof req.headers["x-actor"] === "string" && req.headers["x-actor"].trim())
  || "Admin";

// ── DB setup ──────────────────────────────────────────────────────────────────
const ensureTables = pool.query(`
  CREATE TABLE IF NOT EXISTS public_gallery (
    id         SERIAL PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    caption    TEXT NOT NULL DEFAULT '',
    image_url  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  )
`).then(() => pool.query(`
  ALTER TABLE public_gallery ADD COLUMN IF NOT EXISTS sort_order INT
`)).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS public_press (
    id         SERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    author     TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    image_url  TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  )
`)).then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS public_store_products (
    id             SERIAL PRIMARY KEY,
    badge_label    TEXT NOT NULL DEFAULT '',
    heading        TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    price          TEXT NOT NULL DEFAULT '',
    price_label    TEXT NOT NULL DEFAULT '',
    price_icon     TEXT NOT NULL DEFAULT 'robux',
    price_icon_url TEXT NOT NULL DEFAULT '',
    footer_text    TEXT NOT NULL DEFAULT '',
    button_text    TEXT NOT NULL DEFAULT '',
    button_url     TEXT NOT NULL DEFAULT '',
    image_url      TEXT NOT NULL DEFAULT '',
    sort_order     INT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
  )
`)).then(() => pool.query(`
  ALTER TABLE public_store_products ADD COLUMN IF NOT EXISTS price_icon TEXT NOT NULL DEFAULT 'robux'
`)).then(() => pool.query(`
  ALTER TABLE public_store_products ADD COLUMN IF NOT EXISTS price_icon_url TEXT NOT NULL DEFAULT ''
`)).catch(() => {});

// ── Simple cache ──────────────────────────────────────────────────────────────
interface CacheEntry<T> { data: T; ts: number }
const cache = new Map<string, CacheEntry<unknown>>();
const TTL = 60_000; // fresh window
const STALE_TTL = 10 * 60_000; // serve stale while refreshing in background
function fromCache<T>(key: string): T | undefined {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  if (e && Date.now() - e.ts < TTL) return e.data;
}
function fromCacheAllowStale<T>(key: string): { data: T; fresh: boolean } | undefined {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  if (!e) return undefined;
  const age = Date.now() - e.ts;
  if (age < TTL) return { data: e.data, fresh: true };
  if (age < STALE_TTL) return { data: e.data, fresh: false };
  return undefined;
}
function toCache<T>(key: string, data: T): T {
  cache.set(key, { data, ts: Date.now() });
  return data;
}

type PublicStats = {
  erlc_players: number;
  erlc_max_players: number;
  discord_members: number;
  discord_online: number;
};

let _statsRefreshRunning = false;
async function refreshPublicStats(): Promise<PublicStats> {
  const [erlc, discordResult] = await Promise.allSettled([
    fetchInGameStats(),
    DISCORD_BOT
      ? fetch(`https://discord.com/api/v10/guilds/${PUBLIC_GUILD_ID}?with_counts=true`, {
          headers: { Authorization: `Bot ${DISCORD_BOT}` },
          signal: AbortSignal.timeout(8_000),
        }).then(r => r.ok ? r.json() as Promise<{ approximate_member_count?: number; approximate_presence_count?: number }> : Promise.resolve({}))
      : Promise.resolve(null),
  ]);

  const { inGame, maxPlayers } = erlc.status === "fulfilled" ? erlc.value : { inGame: 0, maxPlayers: 0 };
  const discordGuild = discordResult.status === "fulfilled" && discordResult.value != null
    ? discordResult.value as { approximate_member_count?: number; approximate_presence_count?: number }
    : {};

  return toCache("stats", {
    erlc_players:     inGame,
    erlc_max_players: maxPlayers,
    discord_members:  discordGuild.approximate_member_count  ?? 0,
    discord_online:   discordGuild.approximate_presence_count ?? 0,
  });
}

// ── GET /public/stats ─────────────────────────────────────────────────────────
router.get("/public/stats", async (req, res) => {
  try {
    const cached = fromCacheAllowStale<PublicStats>("stats");
    if (cached?.fresh) { res.json(cached.data); return; }
    if (cached && !cached.fresh) {
      // Stale-while-revalidate: return immediately, refresh in background
      res.json(cached.data);
      if (!_statsRefreshRunning) {
        _statsRefreshRunning = true;
        void refreshPublicStats()
          .catch(err => req.log.error({ err }, "public/stats background refresh failed"))
          .finally(() => { _statsRefreshRunning = false; });
      }
      return;
    }

    res.json(await refreshPublicStats());
  } catch (err) {
    req.log.error({ err }, "public/stats error");
    res.status(500).json({ error: "Unable to load stats." });
  }
});

// ── GET /public/gallery ───────────────────────────────────────────────────────
router.get("/public/gallery", async (req, res) => {
  await ensureTables;
  try {
    const rows = await pool.query<{ id: number; title: string; caption: string; image_url: string; created_at: string }>(
      `SELECT id, title, caption, image_url, created_at::text
       FROM public_gallery WHERE deleted_at IS NULL
       ORDER BY sort_order ASC NULLS LAST, created_at DESC LIMIT 100`
    );
    res.json(rows.rows);
  } catch (err) {
    req.log.error({ err }, "public/gallery GET error");
    res.status(500).json({ error: "Unable to load gallery." });
  }
});

// ── POST /public/gallery (admin) ──────────────────────────────────────────────
router.post("/public/gallery", requireAdmin, async (req, res) => {
  await ensureTables;
  const { title = "", caption = "", image_url } = req.body ?? {};
  if (!image_url?.trim()) { res.status(400).json({ error: "image_url is required." }); return; }
  try {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO public_gallery (title, caption, image_url) VALUES ($1,$2,$3) RETURNING id`,
      [title.trim(), caption.trim(), image_url.trim()]
    );
    void writeLog("gallery", actorFrom(req), "Added gallery image", title.trim() || `ID ${r.rows[0].id}`);
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    req.log.error({ err }, "public/gallery POST error");
    res.status(500).json({ error: "Unable to add image." });
  }
});

// ── PUT /public/gallery/reorder (admin) ───────────────────────────────────────
router.put("/public/gallery/reorder", requireAdmin, async (req, res) => {
  await ensureTables;
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "number")) {
    res.status(400).json({ error: "ids must be an array of numbers." }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      await client.query(`UPDATE public_gallery SET sort_order = $1 WHERE id = $2`, [i + 1, ids[i]]);
    }
    await client.query("COMMIT");
    void writeLog("gallery", actorFrom(req), "Reordered gallery", `${ids.length} image(s)`);
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    req.log.error({ err }, "public/gallery reorder error");
    res.status(500).json({ error: "Failed to save order." });
  } finally {
    client.release();
  }
});

// ── DELETE /public/gallery/:id (admin) ────────────────────────────────────────
router.delete("/public/gallery/:id", requireAdmin, async (req, res) => {
  await ensureTables;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  await pool.query(`UPDATE public_gallery SET deleted_at = NOW() WHERE id = $1`, [id]);
  void writeLog("gallery", actorFrom(req), "Deleted gallery image", `ID ${id}`);
  res.json({ ok: true });
});

// ── GET /public/press ─────────────────────────────────────────────────────────
router.get("/public/press", async (req, res) => {
  await ensureTables;
  try {
    const rows = await pool.query<{
      id: number; title: string; content: string; author: string;
      source_url: string; image_url: string; created_at: string;
    }>(
      `SELECT id, title, content, author, source_url, image_url, created_at::text
       FROM public_press WHERE deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows.rows);
  } catch (err) {
    req.log.error({ err }, "public/press GET error");
    res.status(500).json({ error: "Unable to load press." });
  }
});

// ── POST /public/press (admin) ────────────────────────────────────────────────
router.post("/public/press", requireAdmin, async (req, res) => {
  await ensureTables;
  const { title, content = "", author = "", source_url = "", image_url = "" } = req.body ?? {};
  if (!title?.trim()) { res.status(400).json({ error: "title is required." }); return; }
  try {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO public_press (title, content, author, source_url, image_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [title.trim(), content.trim(), author.trim(), source_url.trim(), image_url.trim()]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    req.log.error({ err }, "public/press POST error");
    res.status(500).json({ error: "Unable to add press item." });
  }
});

// ── PATCH /public/press/:id (admin) ──────────────────────────────────────────
router.patch("/public/press/:id", requireAdmin, async (req, res) => {
  await ensureTables;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { title, content, author, source_url, image_url } = req.body ?? {};
  await pool.query(
    `UPDATE public_press SET
       title      = COALESCE($2, title),
       content    = COALESCE($3, content),
       author     = COALESCE($4, author),
       source_url = COALESCE($5, source_url),
       image_url  = COALESCE($6, image_url)
     WHERE id = $1`,
    [id, title?.trim() ?? null, content?.trim() ?? null, author?.trim() ?? null,
         source_url?.trim() ?? null, image_url?.trim() ?? null]
  );
  res.json({ ok: true });
});

// ── DELETE /public/press/:id (admin) ─────────────────────────────────────────
router.delete("/public/press/:id", requireAdmin, async (req, res) => {
  await ensureTables;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  await pool.query(`UPDATE public_press SET deleted_at = NOW() WHERE id = $1`, [id]);
  res.json({ ok: true });
});

type StoreProductRow = {
  id: number;
  badge_label: string;
  heading: string;
  description: string;
  price: string;
  price_label: string;
  price_icon: string;
  price_icon_url: string;
  footer_text: string;
  button_text: string;
  button_url: string;
  image_url: string;
  sort_order: number | null;
  created_at: string;
};

const STORE_PRODUCT_SELECT = `
  id, badge_label, heading, description, price, price_label,
  COALESCE(NULLIF(price_icon, ''), 'robux') AS price_icon,
  COALESCE(price_icon_url, '') AS price_icon_url,
  footer_text, button_text, button_url, image_url, sort_order, created_at::text
`;

function normalizePriceIcon(value: unknown): "robux" | "dollar" | "custom" {
  if (value === "dollar" || value === "custom") return value;
  return "robux";
}

// ── GET /public/store-products ────────────────────────────────────────────────
router.get("/public/store-products", async (req, res) => {
  await ensureTables;
  try {
    const rows = await pool.query<StoreProductRow>(
      `SELECT ${STORE_PRODUCT_SELECT}
       FROM public_store_products WHERE deleted_at IS NULL
       ORDER BY sort_order ASC NULLS LAST, id ASC LIMIT 100`
    );
    res.json(rows.rows);
  } catch (err) {
    req.log.error({ err }, "public/store-products GET error");
    res.status(500).json({ error: "Unable to load store products." });
  }
});

// ── POST /public/store-products (admin) ───────────────────────────────────────
router.post("/public/store-products", requireAdmin, async (req, res) => {
  await ensureTables;
  const {
    badge_label = "",
    heading = "",
    description = "",
    price = "",
    price_label = "",
    price_icon = "robux",
    price_icon_url = "",
    footer_text = "",
    button_text = "",
    button_url = "",
    image_url = "",
  } = req.body ?? {};
  if (!String(heading).trim()) {
    res.status(400).json({ error: "heading is required." }); return;
  }
  try {
    const mx = await pool.query<{ m: number | null }>(
      `SELECT MAX(sort_order) AS m FROM public_store_products WHERE deleted_at IS NULL`
    );
    const nextOrder = (mx.rows[0]?.m ?? 0) + 1;
    const icon = normalizePriceIcon(price_icon);
    const r = await pool.query<StoreProductRow>(
      `INSERT INTO public_store_products
         (badge_label, heading, description, price, price_label, price_icon, price_icon_url,
          footer_text, button_text, button_url, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${STORE_PRODUCT_SELECT}`,
      [
        String(badge_label).trim(),
        String(heading).trim(),
        String(description).trim(),
        String(price).trim(),
        String(price_label).trim(),
        icon,
        icon === "custom" ? String(price_icon_url).trim() : "",
        String(footer_text).trim(),
        String(button_text).trim(),
        String(button_url).trim(),
        String(image_url).trim(),
        nextOrder,
      ]
    );
    void writeLog("store", actorFrom(req), "Created store product", String(heading).trim());
    res.status(201).json(r.rows[0]);
  } catch (err) {
    req.log.error({ err }, "public/store-products POST error");
    res.status(500).json({ error: "Unable to add store product." });
  }
});

// ── PATCH /public/store-products/:id (admin) ──────────────────────────────────
router.patch("/public/store-products/:id", requireAdmin, async (req, res) => {
  await ensureTables;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const b = req.body ?? {};
  try {
    const hasIcon = Object.prototype.hasOwnProperty.call(b, "price_icon");
    const icon = hasIcon ? normalizePriceIcon(b.price_icon) : null;
    const hasIconUrl = Object.prototype.hasOwnProperty.call(b, "price_icon_url");
    const r = await pool.query<StoreProductRow>(
      `UPDATE public_store_products SET
         badge_label    = CASE WHEN $2::boolean THEN $3  ELSE badge_label END,
         heading        = CASE WHEN $4::boolean THEN $5  ELSE heading     END,
         description    = CASE WHEN $6::boolean THEN $7  ELSE description END,
         price          = CASE WHEN $8::boolean THEN $9  ELSE price       END,
         price_label    = CASE WHEN $10::boolean THEN $11 ELSE price_label END,
         price_icon     = CASE WHEN $12::boolean THEN $13 ELSE price_icon END,
         price_icon_url = CASE WHEN $14::boolean THEN $15 ELSE price_icon_url END,
         footer_text    = CASE WHEN $16::boolean THEN $17 ELSE footer_text END,
         button_text    = CASE WHEN $18::boolean THEN $19 ELSE button_text END,
         button_url     = CASE WHEN $20::boolean THEN $21 ELSE button_url  END,
         image_url      = CASE WHEN $22::boolean THEN $23 ELSE image_url   END
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${STORE_PRODUCT_SELECT}`,
      [
        id,
        Object.prototype.hasOwnProperty.call(b, "badge_label"), String(b.badge_label ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "heading"), String(b.heading ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "description"), String(b.description ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "price"), String(b.price ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "price_label"), String(b.price_label ?? "").trim(),
        hasIcon, icon ?? "robux",
        hasIconUrl || hasIcon,
        hasIcon
          ? (icon === "custom" ? String(b.price_icon_url ?? "").trim() : "")
          : String(b.price_icon_url ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "footer_text"), String(b.footer_text ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "button_text"), String(b.button_text ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "button_url"), String(b.button_url ?? "").trim(),
        Object.prototype.hasOwnProperty.call(b, "image_url"), String(b.image_url ?? "").trim(),
      ]
    );
    if ((r.rowCount ?? 0) === 0) { res.status(404).json({ error: "Product not found." }); return; }
    void writeLog("store", actorFrom(req), "Updated store product", r.rows[0]?.heading ?? `ID ${id}`);
    res.json(r.rows[0]);
  } catch (err) {
    req.log.error({ err }, "public/store-products PATCH error");
    res.status(500).json({ error: "Unable to update store product." });
  }
});

// ── PUT /public/store-products/reorder (admin) ────────────────────────────────
router.put("/public/store-products/reorder", requireAdmin, async (req, res) => {
  await ensureTables;
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== "number")) {
    res.status(400).json({ error: "ids must be an array of numbers." }); return;
  }
  try {
    await Promise.all(ids.map((id: number, i: number) =>
      pool.query(`UPDATE public_store_products SET sort_order = $1 WHERE id = $2`, [i + 1, id])
    ));
    void writeLog("store", actorFrom(req), "Reordered store products", `${ids.length} product(s)`);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "public/store-products reorder error");
    res.status(500).json({ error: "Failed to save order." });
  }
});

// ── DELETE /public/store-products/:id (admin) ─────────────────────────────────
router.delete("/public/store-products/:id", requireAdmin, async (req, res) => {
  await ensureTables;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const deleted = await pool.query<{ heading: string }>(
    `UPDATE public_store_products SET deleted_at = NOW() WHERE id = $1 RETURNING heading`,
    [id]
  );
  void writeLog("store", actorFrom(req), "Deleted store product", deleted.rows[0]?.heading ?? `ID ${id}`);
  res.json({ ok: true });
});

// ── GET /public/events — aggregated public events (DPS + DPH + staff) ─────────
router.get("/public/events", async (req, res) => {
  type Row = Record<string, unknown>;
  const normalize = (row: Row, source: "dps" | "dph" | "staff", fallbackDept: string) => ({
    id: row.id,
    title: row.title,
    event_date: String(row.event_date ?? "").slice(0, 10),
    event_time: row.event_time ?? null,
    location: row.location ?? null,
    purpose: row.purpose ?? null,
    hosted_by: row.hosted_by ?? null,
    hosting_department: (row.hosting_department as string) || fallbackDept,
    source,
    is_staff_event: source === "staff",
  });

  try {
    const [dps, dph, staff] = await Promise.all([
      pool.query(
        `SELECT id, title, event_date, event_time, location, purpose, hosted_by, hosting_department
         FROM dps_events WHERE is_public = true`
      ).catch(() => ({ rows: [] as Row[] })),
      pool.query(
        `SELECT id, title, event_date, event_time, location, purpose, hosted_by, hosting_department
         FROM dph_events WHERE is_public = true`
      ).catch(() => ({ rows: [] as Row[] })),
      pool.query(
        `SELECT id, title, event_date, event_time, location, purpose, hosted_by, hosting_department
         FROM staff_events WHERE is_public = true`
      ).catch(() => ({ rows: [] as Row[] })),
    ]);

    const events = [
      ...dps.rows.map((row) => normalize(row as Row, "dps", "Department of Public Safety")),
      ...dph.rows.map((row) => normalize(row as Row, "dph", "Department of Public Health")),
      ...staff.rows.map((row) => normalize(row as Row, "staff", "DOJ Staff")),
    ].sort((a, b) => {
      const dateCmp = String(a.event_date).localeCompare(String(b.event_date));
      if (dateCmp !== 0) return dateCmp;
      return String(a.event_time ?? "").localeCompare(String(b.event_time ?? ""));
    });

    res.json(events);
  } catch (err) {
    req.log.error({ err }, "public/events GET error");
    res.status(500).json({ error: "Unable to load events." });
  }
});

export default router;
