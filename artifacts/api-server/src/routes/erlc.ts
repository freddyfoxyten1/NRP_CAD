import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

const ERLC_BASE = "https://api.erlc.gg/v1";
const ERLC_KEY  = process.env.ERLC_API_KEY ?? "";

// ── Cache (30 s TTL per endpoint) ─────────────────────────────────────────────
interface CacheEntry<T> { data: T; ts: number }
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 30_000;

async function erlcFetch<T>(path: string): Promise<T> {
  const cached = cache.get(path) as CacheEntry<T> | undefined;
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch(`${ERLC_BASE}${path}`, {
    headers: { "Server-Key": ERLC_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`ERLC API ${res.status}: ${path}`);
  const data = await res.json() as T;
  cache.set(path, { data, ts: Date.now() });
  return data;
}

// ── ERLC player shape ─────────────────────────────────────────────────────────
interface ErlcPlayer {
  Player: string;
  Permission: string;
  Team: string;
  Ping?: number;
}

// ── ERLC call shape ───────────────────────────────────────────────────────────
interface ErlcCall {
  CallId: string;
  Code?: string;
  CallTitle?: string;
  CallAddress?: string;
  Status?: string;
  Responders?: string[];
}

// ── DPS roster row ────────────────────────────────────────────────────────────
interface RosterRow {
  username: string;
  callsign: string | null;
  dps_rank: string | null;
  dps_role: string | null;
}

// ── GET /erlc/units ───────────────────────────────────────────────────────────
// Returns officers currently in the ERLC server, cross-referenced with the DPS
// roster to attach callsign and rank.
router.get("/erlc/units", async (req, res) => {
  if (!ERLC_KEY) {
    res.status(503).json({ error: "ERLC API key not configured." });
    return;
  }
  try {
    // Fetch online players from ERLC in parallel with the DPS roster
    const [players, rosterResult] = await Promise.all([
      erlcFetch<ErlcPlayer[]>("/server/players"),
      pool.query<RosterRow>(
        `SELECT COALESCE(d.username, p.username) AS username,
                d.callsign, d.dps_rank, d.dps_role
         FROM cad_user_profiles p
         JOIN dps_users d ON d.profile_id = p.id
         WHERE lower(d.status) != 'inactive'`
      ),
    ]);

    // Build a lookup map: lowercase username → roster row
    const rosterMap = new Map<string, RosterRow>();
    for (const row of rosterResult.rows) {
      rosterMap.set(row.username.toLowerCase(), row);
    }

    // Filter to law-enforcement players only and enrich with roster data
    const units = players
      .filter(p => {
        const t = p.Team?.toLowerCase() ?? "";
        return t.includes("police") || t.includes("sheriff") || t.includes("trooper")
            || t.includes("deputy") || t.includes("dps") || t.includes("fire");
      })
      .map(p => {
        const roster = rosterMap.get(p.Player.toLowerCase());
        return {
          username:   p.Player,
          callsign:   roster?.callsign  ?? "—",
          dps_rank:   roster?.dps_rank  ?? "Officer",
          dps_role:   roster?.dps_role  ?? null,
          team:       p.Team,
          // Default all online units to Available; sign-on flow (Task 2) will
          // let officers update their own status.
          status:     "Available" as const,
          location:   "In Service",
        };
      });

    res.json(units);
  } catch (err) {
    req.log.error({ err }, "erlc/units error");
    res.status(502).json({ error: "Unable to fetch units from ERLC." });
  }
});

// ── GET /erlc/calls ───────────────────────────────────────────────────────────
router.get("/erlc/calls", async (req, res) => {
  if (!ERLC_KEY) {
    res.status(503).json({ error: "ERLC API key not configured." });
    return;
  }
  try {
    const calls = await erlcFetch<ErlcCall[]>("/server/calls");

    const normalized = calls.map(c => ({
      id:        c.CallId,
      code:      c.Code        ?? "—",
      title:     c.CallTitle   ?? "Unknown Call",
      address:   c.CallAddress ?? "Unknown Location",
      postal:    extractPostal(c.CallAddress),
      units:     Array.isArray(c.Responders) ? c.Responders.length : 0,
      responders: Array.isArray(c.Responders) ? c.Responders : [],
      status:    normalizeCallStatus(c.Status),
    }));

    res.json(normalized);
  } catch (err) {
    req.log.error({ err }, "erlc/calls error");
    res.status(502).json({ error: "Unable to fetch calls from ERLC." });
  }
});

// ── GET /erlc/groups ──────────────────────────────────────────────────────────
// Derives active groups from callsign prefixes of online DPS units.
router.get("/erlc/groups", async (req, res) => {
  if (!ERLC_KEY) {
    res.status(503).json({ error: "ERLC API key not configured." });
    return;
  }
  try {
    const [players, rosterResult] = await Promise.all([
      erlcFetch<ErlcPlayer[]>("/server/players"),
      pool.query<RosterRow>(
        `SELECT COALESCE(d.username, p.username) AS username,
                d.callsign, d.dps_rank, d.dps_role
         FROM cad_user_profiles p
         JOIN dps_users d ON d.profile_id = p.id
         WHERE lower(d.status) != 'inactive'`
      ),
    ]);

    const rosterMap = new Map<string, RosterRow>();
    for (const row of rosterResult.rows) {
      rosterMap.set(row.username.toLowerCase(), row);
    }

    // Build a map of callsign prefix → members
    const groupMap = new Map<string, { members: string[]; department: string }>();

    for (const p of players) {
      const t = (p.Team?.toLowerCase() ?? "");
      if (!t.includes("police") && !t.includes("sheriff") && !t.includes("trooper")
       && !t.includes("deputy") && !t.includes("dps") && !t.includes("fire")) continue;

      const roster = rosterMap.get(p.Player.toLowerCase());
      const callsign = roster?.callsign ?? null;
      if (!callsign || callsign === "—") continue;

      // Prefix = everything before the last "-" segment, e.g. "4D" from "4D-01"
      const dashIdx = callsign.lastIndexOf("-");
      const prefix  = dashIdx > 0 ? callsign.slice(0, dashIdx) : callsign;

      if (!groupMap.has(prefix)) {
        groupMap.set(prefix, { members: [], department: p.Team });
      }
      groupMap.get(prefix)!.members.push(p.Player);
    }

    const groups = Array.from(groupMap.entries())
      .filter(([, v]) => v.members.length > 0)
      .map(([prefix, v]) => ({
        name:       prefix,
        location:   "In Service",
        department: v.department,
        status:     "Active",
        members:    v.members,
        count:      v.members.length,
      }));

    res.json(groups);
  } catch (err) {
    req.log.error({ err }, "erlc/groups error");
    res.status(502).json({ error: "Unable to fetch groups from ERLC." });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractPostal(address?: string): string {
  if (!address) return "—";
  const m = address.match(/\b(\d{3,5})\b/);
  return m ? m[1] : "—";
}

function normalizeCallStatus(s?: string): string {
  if (!s) return "Active";
  const lower = s.toLowerCase();
  if (lower.includes("active"))    return "Active";
  if (lower.includes("enroute") || lower.includes("en route")) return "Enroute";
  if (lower.includes("scene"))     return "On-Scene";
  if (lower.includes("closed") || lower.includes("complete")) return "Closed";
  return s;
}

export default router;
