import { Router, Request, Response, NextFunction } from "express";
import {
  pool,
  isMongoStore,
  usersRepo,
  getCachedMemberPage,
  invalidateMemberCaches,
} from "@workspace/db";
import { writeLog, ensureAuditLog, listLogs } from "../lib/audit-log";
import { COMMUNITY_GUILD_ID } from "../lib/discord-auth";

const router = Router();

const ADMIN_CODE = process.env.ADMIN_PORTAL_CODE ?? "ADMIN2026";

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
};

// Check admin code middleware
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["x-admin-code"] !== ADMIN_CODE) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
};

router.get("/admin/logs", requireAdmin, async (req, res) => {
  await ensureAuditLog;
  try {
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const rows = await listLogs(category);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "admin/logs GET error");
    res.status(500).json({ error: "Unable to load logs." });
  }
});

// Caches for Discord data — rate limits make per-request fetches unsustainable.
// Admin Members tab is always scoped to the main community Discord guild.

type CachedMember = { id: string; username: string; global_name?: string | null; avatar?: string | null; nick?: string | null; roles: string[] };
type CachedRole   = { id: string; name: string; position: number };

const guildMemberCache: { guildId: string | null; members: CachedMember[] | null; fetchedAt: number } =
  { guildId: null, members: null, fetchedAt: 0 };
const guildRolesCache:  { guildId: string | null; roles: CachedRole[] | null; fetchedAt: number } =
  { guildId: null, roles: null, fetchedAt: 0 };
const GUILD_MEMBER_CACHE_TTL_MS = 5  * 60 * 1000; // 5 minutes
const GUILD_ROLES_CACHE_TTL_MS  = 30 * 60 * 1000; // 30 minutes

async function discordFetch(url: string, botToken: string): Promise<Response> {
  let r = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
  if (r.status === 429) {
    const body = await r.json().catch(() => ({})) as { retry_after?: number };
    const waitMs = Math.min((body.retry_after ?? 1) * 1000 + 200, 10_000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    r = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
  }
  return r;
}

async function fetchGuildRoles(botToken: string, guildId: string): Promise<CachedRole[]> {
  if (
    guildRolesCache.roles &&
    guildRolesCache.guildId === guildId &&
    Date.now() - guildRolesCache.fetchedAt < GUILD_ROLES_CACHE_TTL_MS
  ) {
    return guildRolesCache.roles;
  }
  const r = await discordFetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, botToken);
  if (!r.ok) throw new Error(`Discord roles API error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const all = (await r.json()) as Array<{ id: string; name: string; position: number }>;
  guildRolesCache.roles     = all.filter((role) => role.name !== "@everyone");
  guildRolesCache.guildId   = guildId;
  guildRolesCache.fetchedAt = Date.now();
  return guildRolesCache.roles;
}

async function fetchGuildApproxMemberCount(botToken: string, guildId: string): Promise<number | null> {
  try {
    const r = await discordFetch(
      `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
      botToken,
    );
    if (!r.ok) return null;
    const body = (await r.json()) as { approximate_member_count?: number };
    return typeof body.approximate_member_count === "number" ? body.approximate_member_count : null;
  } catch {
    return null;
  }
}

type MemberFetchProgress = {
  loaded: number;
  total: number | null;
  percent: number;
  label: string;
  fromCache?: boolean;
};

async function fetchDiscordMembers(
  botToken: string,
  guildId: string,
  onProgress?: (p: MemberFetchProgress) => void,
): Promise<CachedMember[]> {
  if (
    guildMemberCache.members &&
    guildMemberCache.guildId === guildId &&
    Date.now() - guildMemberCache.fetchedAt < GUILD_MEMBER_CACHE_TTL_MS
  ) {
    onProgress?.({
      loaded: guildMemberCache.members.length,
      total: guildMemberCache.members.length,
      percent: 90,
      label: "Using cached Discord members…",
      fromCache: true,
    });
    return guildMemberCache.members;
  }

  onProgress?.({ loaded: 0, total: null, percent: 5, label: "Connecting to Discord…" });
  const approxTotal = await fetchGuildApproxMemberCount(botToken, guildId);
  onProgress?.({
    loaded: 0,
    total: approxTotal,
    percent: 8,
    label: approxTotal ? `Fetching ~${approxTotal.toLocaleString()} members…` : "Fetching Discord members…",
  });

  type DiscordUser   = { id: string; username: string; global_name?: string | null; avatar?: string | null };
  type DiscordMember = { user: DiscordUser; nick?: string | null; roles: string[] };
  const flat: CachedMember[] = [];
  let after = "0";

  for (let page = 0; page < 20; page++) {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`;
    const r = await discordFetch(url, botToken);
    if (!r.ok) throw new Error(`Discord API error ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const batch = (await r.json()) as DiscordMember[];
    if (batch.length === 0) break;
    for (const m of batch) {
      flat.push({
        id: m.user.id,
        username: m.user.username,
        global_name: m.user.global_name,
        avatar: m.user.avatar,
        nick: m.nick,
        roles: m.roles ?? [],
      });
    }

    const total = approxTotal && approxTotal > 0 ? approxTotal : null;
    const rawPct = total ? (flat.length / total) * 80 + 8 : Math.min(85, 8 + (page + 1) * 12);
    const percent = Math.min(88, Math.round(rawPct));
    onProgress?.({
      loaded: flat.length,
      total,
      percent,
      label: total
        ? `Loaded ${flat.length.toLocaleString()} / ~${total.toLocaleString()} members…`
        : `Loaded ${flat.length.toLocaleString()} members…`,
    });

    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }

  guildMemberCache.members   = flat;
  guildMemberCache.guildId   = guildId;
  guildMemberCache.fetchedAt = Date.now();
  return flat;
}

function buildGuildMembersPayload(
  discordMembers: CachedMember[],
  guildRoles: CachedRole[],
  groupsRows: unknown[],
  ranksRows: Array<{ name: string }>,
  cadRows: Array<Record<string, unknown>>,
  guildId: string,
) {
  const roleMap = new Map(guildRoles.map((r) => [r.id, { name: r.name, position: r.position }]));
  const validStaffRankNames = new Set(ranksRows.map((r) => r.name.toLowerCase()));

  const cadByDiscordId = new Map<string, Record<string, unknown>>();
  const cadByUsername = new Map<string, Record<string, unknown>>();
  for (const row of cadRows) {
    if (typeof row.discord_id === "string" && row.discord_id) cadByDiscordId.set(row.discord_id, row);
    if (typeof row.discord_username === "string" && row.discord_username) {
      cadByUsername.set(row.discord_username.toLowerCase(), row);
    }
  }

  const members = discordMembers.map((gm) => {
    const cad = cadByDiscordId.get(gm.id) ?? cadByUsername.get(gm.username?.toLowerCase() ?? "") ?? null;
    const discordRoles = (gm.roles ?? [])
      .map((rid) => roleMap.get(rid))
      .filter((r): r is { name: string; position: number } => r !== undefined)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.name);
    const rawStaffRank = (cad?.staff_rank as string | null) ?? null;
    const cadRank = rawStaffRank && validStaffRankNames.has(rawStaffRank.toLowerCase()) ? rawStaffRank : null;
    return {
      discord_id: gm.id,
      discord_username: gm.username,
      nickname: gm.nick ?? gm.global_name ?? null,
      avatar_hash: gm.avatar ?? null,
      discord_roles: discordRoles,
      cad_rank: cadRank,
      cad_profile: cad,
    };
  });

  return {
    guild_id: guildId,
    groups: groupsRows,
    ranks: ranksRows,
    members,
    total_discord_members: discordMembers.length,
  };
}

// GET /admin/guild-members — Discord members from the community guild only, merged with CAD profiles
// Pass ?stream=1 for NDJSON progress events (percent + label) while Discord pages load.
router.get("/admin/guild-members", requireAdmin, async (req, res) => {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId  = COMMUNITY_GUILD_ID;
  const stream = String(req.query.stream ?? "") === "1";

  if (!botToken) {
    res.status(503).json({ error: "Discord bot credentials (DISCORD_BOT_TOKEN) are not configured." });
    return;
  }

  const writeProgress = (payload: Record<string, unknown>) => {
    if (!stream) return;
    res.write(`${JSON.stringify(payload)}\n`);
  };

  try {
    if (stream) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
        (res as { flushHeaders: () => void }).flushHeaders();
      }
      writeProgress({ type: "progress", percent: 2, label: "Starting member load…", loaded: 0, total: null });
    }

    let latestProgress: MemberFetchProgress = {
      loaded: 0, total: null, percent: 5, label: "Connecting to Discord…",
    };

    const discordMembersPromise = fetchDiscordMembers(botToken, guildId, (p) => {
      latestProgress = p;
      writeProgress({ type: "progress", ...p });
    });

    const [discordMembers, guildRoles, groupsResult, ranksResult, cadResult] = await Promise.all([
      discordMembersPromise,
      fetchGuildRoles(botToken, guildId),
      pool.query(
        `SELECT id, name, sort_order, locked, staff_access, admin_access, doc_access
         FROM staff_rank_groups ORDER BY sort_order, id`
      ),
      pool.query(
        `SELECT id, name, sort_order, group_id, color_hex FROM staff_ranks ORDER BY sort_order, id`
      ),
      pool.query(
        `SELECT id, discord_id, discord_username, username, staff_rank, rank
         FROM cad_user_profiles`
      ),
    ]);

    writeProgress({
      type: "progress",
      percent: 92,
      label: "Merging CAD profiles…",
      loaded: discordMembers.length,
      total: latestProgress.total ?? discordMembers.length,
    });

    const payload = buildGuildMembersPayload(
      discordMembers,
      guildRoles,
      groupsResult.rows,
      ranksResult.rows as Array<{ name: string }>,
      cadResult.rows as Array<Record<string, unknown>>,
      guildId,
    );

    if (stream) {
      writeProgress({
        type: "progress",
        percent: 100,
        label: `Loaded ${payload.total_discord_members.toLocaleString()} members`,
        loaded: payload.total_discord_members,
        total: payload.total_discord_members,
      });
      res.write(`${JSON.stringify({ type: "complete", ...payload })}\n`);
      res.end();
      return;
    }

    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "admin/guild-members GET error");
    const message = err instanceof Error ? err.message : "Unable to load guild members.";
    if (stream && !res.headersSent) {
      res.status(500).json({ error: message });
      return;
    }
    if (stream && res.headersSent) {
      res.write(`${JSON.stringify({ type: "error", error: message })}\n`);
      res.end();
      return;
    }
    res.status(500).json({ error: message });
  }
});

// GET /admin/discord-search — typeahead limited to community Discord guild members
router.get("/admin/discord-search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 1) { res.json([]); return; }

  type SearchHit = {
    id: number | null;
    username: string;
    discord_username: string | null;
    discord_id: string | null;
    nick: string | null;
    rank: string | null;
    source: "cad" | "discord";
  };

  try {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) { res.json([]); return; }

    const cached = await fetchDiscordMembers(botToken, COMMUNITY_GUILD_ID);
    const guildDiscordIds = cached.map(m => m.id);
    const hits: SearchHit[] = [];
    const seenDiscordIds = new Set<string>();

    // 1. CAD profiles whose discord_id is in the community guild
    if (guildDiscordIds.length > 0) {
      const cadRes = await pool.query(
        `SELECT id, username, discord_username, discord_id, staff_rank, rank
         FROM cad_user_profiles
         WHERE discord_id = ANY($1::text[])
           AND (username ILIKE $2 OR discord_username ILIKE $2 OR discord_id ILIKE $2)
         ORDER BY username LIMIT 20`,
        [guildDiscordIds, `%${q}%`]
      );

      for (const row of cadRes.rows as Array<{
        id: number; username: string; discord_username: string | null;
        discord_id: string | null; staff_rank: string | null; rank: string | null;
      }>) {
        hits.push({
          id: row.id, username: row.username,
          discord_username: row.discord_username, discord_id: row.discord_id,
          nick: null, rank: row.staff_rank ?? row.rank, source: "cad",
        });
        if (row.discord_id) seenDiscordIds.add(row.discord_id);
      }
    }

    // 2. Discord-only guild members not yet in CAD
    const remaining = 20 - hits.length;
    if (remaining > 0 && cached.length > 0) {
      const discordHits = cached.filter(m => {
        if (seenDiscordIds.has(m.id)) return false;
        const display = (m.nick ?? m.global_name ?? m.username).toLowerCase();
        return m.username.toLowerCase().includes(q) || display.includes(q) || m.id.includes(q);
      });
      for (const m of discordHits.slice(0, remaining)) {
        hits.push({
          id: null,
          username: m.nick ?? m.global_name ?? m.username,
          discord_username: m.username,
          discord_id: m.id,
          nick: m.nick ?? m.global_name ?? null,
          rank: null,
          source: "discord",
        });
      }
    }

    res.json(hits.slice(0, 20));
  } catch (err) {
    res.status(500).json({ error: "Search failed." });
  }
});

router.get("/admin/members", requireAdmin, async (req, res) => {
  try {
    const pageRaw = typeof req.query.page === "string" ? Number(req.query.page) : NaN;
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const wantAll = req.query.all === "1" || req.query.all === "true";
    const paginated = Number.isFinite(pageRaw) && pageRaw >= 1;

    if (isMongoStore()) {
      if (wantAll && !paginated) {
        // Lightweight full list for staff tooling (cached via list pages / direct query)
        const result = await usersRepo.listMemberSummaries({ page: 1, limit: 10_000, q });
        req.log.info({ cache: "BYPASS_ALL", total: result.total }, "admin/members");
        res.json(result.items);
        return;
      }
      if (paginated) {
        const result = await getCachedMemberPage({
          page: pageRaw,
          limit: Number.isFinite(limitRaw) ? limitRaw : 25,
          q,
        });
        req.log.info({ cache: result.cache, page: result.page, total: result.total }, "admin/members");
        res.json({
          items: result.items,
          total: result.total,
          page: result.page,
          limit: result.limit,
          cache: result.cache,
        });
        return;
      }
      // Default: paginated first page (do not dump entire collection)
      const result = await getCachedMemberPage({ page: 1, limit: 25, q });
      req.log.info({ cache: result.cache, page: result.page, total: result.total }, "admin/members");
      res.json({
        items: result.items,
        total: result.total,
        page: result.page,
        limit: result.limit,
        cache: result.cache,
      });
      return;
    }

    // SQL path — keep legacy full-list for all=1 / no page; otherwise paginate in SQL
    if (paginated) {
      const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 25));
      const page = Math.max(1, pageRaw);
      const offset = (page - 1) * limit;
      const params: unknown[] = [];
      let where = "";
      if (q.trim()) {
        params.push(`%${q.trim().toLowerCase()}%`);
        where = `WHERE lower(username) LIKE $1 OR lower(coalesce(discord_username,'')) LIKE $1 OR lower(coalesce(email,'')) LIKE $1 OR coalesce(discord_id,'') LIKE $1`;
      }
      const countR = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM cad_user_profiles ${where}`,
        params,
      );
      const listParams = [...params, limit, offset];
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `SELECT id, auth_user_id, username, discord_username, discord_id,
                email, community_code, status, rank, role,
                dps_rank, dps_role, staff_rank, staff_role,
                whitelisted, avatar_hash, created_at::text, updated_at::text
         FROM cad_user_profiles
         ${where}
         ORDER BY created_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        listParams,
      );
      res.json({
        items: result.rows,
        total: countR.rows[0]?.c ?? 0,
        page,
        limit,
        cache: "BYPASS",
      });
      return;
    }

    const result = await pool.query(
      `SELECT id, auth_user_id, username, discord_username, discord_id,
              email, community_code, status, rank, role,
              dps_rank, dps_role, staff_rank, staff_role,
              whitelisted, avatar_hash, created_at::text, updated_at::text
       FROM cad_user_profiles
       ORDER BY created_at DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "admin/members GET error");
    res.status(500).json({ error: "Unable to load members." });
  }
});

router.patch("/admin/members", requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      id?: number;
      auth_user_id?: string | null;
      username?: string;
      discord_username?: string;
      discord_id?: string;
      email?: string;
      community_code?: string;
      status?: string;
      rank?: string;
      role?: string;
      dps_rank?: string | null;
      dps_role?: string | null;
      staff_rank?: string | null;
      staff_role?: string | null;
    };

    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid member ID." });
      return;
    }

    const actor = (typeof (body as Record<string, unknown>).actor === "string" ? (body as Record<string, unknown>).actor as string : null)
      ?? (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");

    const authUserId = body.auth_user_id === null ? null : (typeof body.auth_user_id === "string" ? body.auth_user_id.trim() || null : null);
    const username = requireString(body.username, "Username");
    const discordUsername = requireString(body.discord_username, "Discord username");
    const discordId = requireString(body.discord_id, "Discord ID");
    const email = requireString(body.email, "Email").toLowerCase();
    const communityCode = requireString(body.community_code, "Community code").toUpperCase();
    const status = requireString(body.status, "Status").toLowerCase();
    const rank = requireString(body.rank, "Rank");
    const role = requireString(body.role, "Role").toLowerCase();

    // New separated fields — optional; null clears the value
    const dpsRank   = body.dps_rank   !== undefined ? (body.dps_rank?.trim()   || null) : undefined;
    const dpsRole   = body.dps_role   !== undefined ? (body.dps_role?.trim()   || null) : undefined;
    const staffRank = body.staff_rank !== undefined ? (body.staff_rank?.trim() || null) : undefined;
    const staffRole = body.staff_role !== undefined ? (body.staff_role?.trim() || null) : undefined;

    if (isMongoStore()) {
      const patch: Record<string, unknown> = {
        auth_user_id: authUserId,
        username,
        discord_username: discordUsername,
        discord_id: discordId,
        email,
        community_code: communityCode,
        status,
        rank,
        role,
      };
      if (dpsRank !== undefined) patch.dps_rank = dpsRank;
      if (dpsRole !== undefined) patch.dps_role = dpsRole;
      if (staffRank !== undefined) patch.staff_rank = staffRank;
      if (staffRole !== undefined) patch.staff_role = staffRole;
      const updated = await usersRepo.updateUser(id, patch);
      if (!updated) {
        res.status(404).json({ error: "Member not found." });
        return;
      }
      void writeLog("members", actor, "Edited member account", `Username: ${updated.username} (ID: ${id})`);
      res.json(updated);
      return;
    }

    const result = await pool.query(
      `UPDATE cad_user_profiles
       SET auth_user_id=$1, username=$2, discord_username=$3, discord_id=$4,
           email=$5, community_code=$6, status=$7, rank=$8, role=$9,
           dps_rank   = CASE WHEN $10::text IS NOT NULL THEN $10 ELSE dps_rank   END,
           dps_role   = CASE WHEN $11::text IS NOT NULL THEN $11 ELSE dps_role   END,
           staff_rank = CASE WHEN $12::text IS NOT NULL THEN $12 ELSE staff_rank END,
           staff_role = CASE WHEN $13::text IS NOT NULL THEN $13 ELSE staff_role END,
           updated_at = now()
       WHERE id=$14
       RETURNING id, auth_user_id, username, discord_username, discord_id,
                 email, community_code, status, rank, role,
                 dps_rank, dps_role, staff_rank, staff_role,
                 created_at::text, updated_at::text`,
      [authUserId, username, discordUsername, discordId, email, communityCode, status, rank, role,
       dpsRank ?? null, dpsRole ?? null, staffRank ?? null, staffRole ?? null, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Member not found." });
      return;
    }

    const updated = result.rows[0] as { username: string };
    void writeLog("members", actor, "Edited member account", `Username: ${updated.username} (ID: ${id})`);
    await invalidateMemberCaches(id);

    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "admin/members PATCH error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unable to save changes." });
  }
});

router.delete("/admin/members", requireAdmin, async (req, res) => {
  const actor = typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin";
  try {
    const memberId = typeof req.query.id === "string" ? req.query.id : null;

    if (memberId) {
      const id = Number(memberId);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid member ID." });
        return;
      }

      if (isMongoStore()) {
        const member = await usersRepo.getUserById(id);
        if (!member) {
          res.json({ deleted_count: 0, protected_count: 0, deleted_ids: [] });
          return;
        }
        const isProtected = Boolean(member.staff_role) || Boolean(member.whitelisted);
        if (isProtected) {
          res.json({ deleted_count: 0, protected_count: 1, deleted_ids: [] });
          return;
        }
        const deleted = await usersRepo.deleteUser(id);
        if (deleted) {
          void writeLog("members", actor, "Deleted member account", `Member ID: ${id}`);
        }
        res.json({
          deleted_count: deleted ? 1 : 0,
          deleted_ids: deleted ? [id] : [],
          protected_count: 0,
        });
        return;
      }

      // Protect staff members (staff_role set) or whitelisted accounts
      const checkResult = await pool.query<{ id: number; protected: boolean }>(
        `SELECT id,
                (staff_role IS NOT NULL OR whitelisted = TRUE) AS protected
         FROM cad_user_profiles WHERE id=$1 LIMIT 1`,
        [id]
      );

      const member = checkResult.rows[0];
      if (!member) {
        res.json({ deleted_count: 0, protected_count: 0, deleted_ids: [] });
        return;
      }

      if (member.protected) {
        res.json({ deleted_count: 0, protected_count: 1, deleted_ids: [] });
        return;
      }

      const deleteResult = await pool.query<{ id: number }>(
        `DELETE FROM cad_user_profiles WHERE id=$1 RETURNING id`,
        [id]
      );

      if (deleteResult.rows.length > 0) {
        void writeLog("members", actor, "Deleted member account", `Member ID: ${id}`);
        await invalidateMemberCaches(id);
      }

      res.json({
        deleted_count: deleteResult.rows.length,
        deleted_ids: deleteResult.rows.map((r) => r.id),
        protected_count: 0,
      });
      return;
    }

    // Bulk delete non-staff, non-whitelisted active accounts
    const result = await pool.query<{ deleted_count: number; deleted_ids: number[]; protected_count: number }>(
      `WITH protected AS (
         SELECT COUNT(*)::int AS protected_count
         FROM cad_user_profiles
         WHERE lower(status)='active'
           AND (staff_role IS NOT NULL OR whitelisted = TRUE)
       ),
       deleted AS (
         DELETE FROM cad_user_profiles
         WHERE lower(status)='active'
           AND staff_role IS NULL
           AND (whitelisted IS NULL OR whitelisted = FALSE)
         RETURNING id
       )
       SELECT
         (SELECT COUNT(*)::int FROM deleted) AS deleted_count,
         COALESCE((SELECT array_agg(id) FROM deleted), '{}'::int[]) AS deleted_ids,
         (SELECT protected_count FROM protected) AS protected_count`
    );

    const bulkResult = result.rows[0] ?? { deleted_count: 0, deleted_ids: [], protected_count: 0 };
    if ((bulkResult.deleted_count ?? 0) > 0) {
      void writeLog("members", actor, "Bulk deleted member accounts", `Deleted ${bulkResult.deleted_count} account(s)`);
    }
    res.json(bulkResult);
  } catch (err) {
    req.log.error({ err }, "admin/members DELETE error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unable to delete member(s)." });
  }
});

export default router;
