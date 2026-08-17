import { getCollection } from "@workspace/db";
import type { Document, Sort } from "mongodb";
import { normalizeGroupRow, normalizeRankGroupId, normalizeRankRow } from "./roster-normalize.js";

let rankGroupRepairDone = false;

/** getCollection is async — always await before .find() / .findOne(). */
async function colFind<T extends Document = Document>(
  name: string,
  filter: Document = {},
  sort?: Sort,
): Promise<T[]> {
  const col = await getCollection<T>(name);
  let cursor = col.find(filter);
  if (sort) cursor = cursor.sort(sort);
  return cursor.toArray();
}

/** One-time cleanup for corrupted rank group_id values after SQL→Mongo migration. */
export async function ensureDpsRankGroupIdsRepaired(): Promise<void> {
  if (rankGroupRepairDone) return;
  rankGroupRepairDone = true;
  try {
    const col = await getCollection("dps_ranks");
    const ranks = await col.find({ group_id: { $exists: true, $ne: null } }).toArray();
    for (const row of ranks) {
      const fixed = normalizeRankGroupId(row.group_id);
      if (fixed === row.group_id) continue;
      await col.updateOne({ _id: row._id }, { $set: { group_id: fixed } });
    }
  } catch (err) {
    console.warn("[dps] rank group_id repair skipped:", err);
  }
}

function stripMongoId<T extends Record<string, unknown>>(doc: T): T {
  const { _id: _a, ...rest } = doc;
  return rest as T;
}

function asStringOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "object") return null;
  return String(value);
}

function asDateStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : value;
  if (typeof value === "object") return null;
  return String(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => (typeof v === "string" ? v : String(v ?? "")));
}

async function loadUsersByProfileIds(profileIds: number[]): Promise<Map<number, Record<string, unknown>>> {
  if (profileIds.length === 0) return new Map();
  const users = await colFind("users", { id: { $in: profileIds } });
  return new Map(
    users
      .map(u => [Number(u.id), u] as const)
      .filter(([id]) => Number.isInteger(id) && id > 0),
  );
}

export async function listDpsRankGroupsMongo(): Promise<Record<string, unknown>[]> {
  await ensureDpsRankGroupIdsRepaired();
  const col = await getCollection("dps_rank_groups");
  const rows = await col.find({}).sort({ sort_order: 1, id: 1 }).toArray();
  return rows.map(r => normalizeGroupRow(stripMongoId(r)));
}

export async function listDpsRanksMongo(): Promise<Record<string, unknown>[]> {
  await ensureDpsRankGroupIdsRepaired();
  const col = await getCollection("dps_ranks");
  const rows = await col.find({}).sort({ sort_order: 1, id: 1 }).toArray();
  return rows.map(r => normalizeRankRow(stripMongoId(r)));
}

export async function listDpsPersonnelMongo(includeAll: boolean): Promise<Record<string, unknown>[]> {
  await ensureDpsRankGroupIdsRepaired();
  const dpsUsers = await colFind("dps_users");
  const activeDpsUsers = includeAll
    ? dpsUsers
    : dpsUsers.filter(d => String(d.status ?? "Active").toLowerCase() !== "inactive");

  const profileIds = [...new Set(
    activeDpsUsers
      .map(d => Number(d.profile_id))
      .filter(id => Number.isInteger(id) && id > 0),
  )];

  const [userById, ranks, groups] = await Promise.all([
    loadUsersByProfileIds(profileIds),
    colFind("dps_ranks"),
    colFind("dps_rank_groups"),
  ]);
  const rankByName = new Map(
    ranks.map(r => [String(r.name ?? "").trim().toLowerCase(), r]),
  );
  const groupById = new Map(groups.map(g => [Number(g.id), g]));

  const rows: Record<string, unknown>[] = [];
  for (const d of activeDpsUsers) {
    const profileId = Number(d.profile_id);
    if (!Number.isInteger(profileId) || profileId <= 0) continue;
    const p = userById.get(profileId);
    if (!p) continue;

    const rankName = asStringOrNull(d.dps_rank);
    const rankMeta = rankName
      ? rankByName.get(rankName.trim().toLowerCase()) ?? null
      : null;
    const groupId = normalizeRankGroupId(rankMeta?.group_id);
    const group = groupId == null ? null : groupById.get(groupId) ?? null;
    const groupName =
      group && String(group.name ?? "").trim().toLowerCase() !== "community members"
        ? String(group.name)
        : null;

    // Public roster: only members whose rank exists in current Mongo Personnel Management.
    if (!includeAll && (!rankMeta || !groupName)) continue;

    rows.push({
      id: profileId,
      username: asStringOrNull(d.username) ?? asStringOrNull(p.username) ?? "",
      discord_username: asStringOrNull(p.discord_username),
      discord_id: asStringOrNull(p.discord_id),
      avatar_hash: asStringOrNull(p.avatar_hash),
      callsign: asStringOrNull(d.callsign),
      dps_rank: rankName,
      dps_role: asStringOrNull(d.dps_role),
      division_rank: asStringOrNull(d.division_rank),
      status: asStringOrNull(d.status) ?? "Active",
      appointed_date: asDateStringOrNull(d.appointed_date),
      pob: Boolean(d.pob),
      iab: Boolean(d.iab),
      hsu: Boolean(d.hsu),
      sru: Boolean(d.sru),
      fou: Boolean(d.fou),
      certifications: asStringArray(d.certifications),
      can_view_all_resources: Boolean(d.can_view_all_resources),
      can_access_iab: Boolean(p.can_access_iab),
      staff_role: asStringOrNull(p.staff_role),
      group_name: groupName,
      group_sort_order: Number(group?.sort_order ?? 999),
      rank_sort_order: Number(rankMeta?.sort_order ?? 999),
    });
  }
  return rows;
}

export async function listDpsFleetMongo(): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_fleet");
  const rows = await col.find({}).sort({ category_sort: 1, category: 1, sort_order: 1, id: 1 }).toArray();
  return rows.map(stripMongoId);
}

export async function listDpsFleetCategoriesMongo(): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_fleet_categories");
  const rows = await col.find({}).sort({ sort_order: 1, id: 1 }).toArray();
  return rows.map(stripMongoId);
}

export async function listDpsEquipmentMongo(): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_equipment");
  const rows = await col.find({}).sort({ category_sort: 1, category: 1, sort_order: 1, id: 1 }).toArray();
  return rows.map(stripMongoId);
}

export async function listDpsEquipmentCategoriesMongo(): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_equipment_categories");
  const rows = await col.find({}).sort({ sort_order: 1, id: 1 }).toArray();
  return rows.map(stripMongoId);
}

export async function listDpsDivisionsMongo(): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_divisions");
  const rows = await col.find({}).sort({ sort_order: 1, id: 1 }).toArray();
  return rows.map(stripMongoId);
}

export async function listDpsDivisionRanksMongo(): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_division_ranks");
  const rows = await col.find({}).sort({ sort_order: 1, id: 1 }).toArray();
  return rows.map(stripMongoId);
}

export async function listDpsEventsMongo(publicOnly: boolean): Promise<Record<string, unknown>[]> {
  const col = await getCollection("dps_events");
  const filter = publicOnly ? { is_public: true } : {};
  const rows = await col.find(filter).sort({ event_date: 1, event_time: 1 }).toArray();
  return rows.map((row) => {
    const doc = stripMongoId(row);
    const eventDate = doc.event_date;
    let eventDateStr = eventDate;
    if (eventDate instanceof Date) {
      eventDateStr = eventDate.toISOString().slice(0, 10);
    } else if (typeof eventDate === "string" && eventDate.length >= 10) {
      eventDateStr = eventDate.slice(0, 10);
    }
    return {
      ...doc,
      event_date: eventDateStr,
      hosting_department: doc.hosting_department || "Department of Public Safety",
      is_public: Boolean(doc.is_public),
    };
  });
}

export async function getDpsContentMongo(key: string): Promise<Record<string, unknown>> {
  const col = await getCollection("dps_content");
  const row = await col.findOne({ key });
  const content = row?.content;
  if (content == null) return {};
  if (typeof content === "object") return content as Record<string, unknown>;
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export type DivisionAssignmentRow = {
  profile_id: number;
  division_id: number;
  division_name: string;
  division_rank: string;
  unit_key: string | null;
  sort_order: number;
  is_manual: boolean;
  can_edit_resources: boolean;
  can_edit_roster: boolean;
  can_edit_info: boolean;
};

export async function loadDpsDivisionAssignmentsMongo(
  profileIds: number[],
): Promise<Map<number, DivisionAssignmentRow[]>> {
  const map = new Map<number, DivisionAssignmentRow[]>();
  if (profileIds.length === 0) return map;

  const [userDivisions, divisions] = await Promise.all([
    colFind("dps_user_divisions", { profile_id: { $in: profileIds } }),
    colFind("dps_divisions"),
  ]);
  const divisionById = new Map(divisions.map(d => [Number(d.id), d]));
  const idSet = new Set(profileIds);

  for (const ud of userDivisions) {
    const profileId = Number(ud.profile_id);
    if (!idSet.has(profileId)) continue;
    const divisionId = Number(ud.division_id);
    const division = divisionById.get(divisionId);
    if (!division) continue;
    const list = map.get(profileId) ?? [];
    list.push({
      profile_id: profileId,
      division_id: divisionId,
      division_name: String(division.name ?? ""),
      division_rank: String(ud.division_rank ?? ""),
      unit_key: (division.unit_key as string | null) ?? null,
      sort_order: Number(division.sort_order ?? 999),
      is_manual: Boolean(ud.is_manual),
      can_edit_resources: Boolean(ud.can_edit_resources),
      can_edit_roster: Boolean(ud.can_edit_roster),
      can_edit_info: Boolean(ud.can_edit_info),
    });
    map.set(profileId, list);
  }

  for (const [profileId, list] of map) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.division_id - b.division_id);
    map.set(profileId, list);
  }
  return map;
}

function parseDivisionInfoContent(raw: unknown): { sections: unknown[] } {
  if (raw == null) return { sections: [] };
  if (typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as { sections?: unknown }).sections)) {
    return { sections: (raw as { sections: unknown[] }).sections };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { sections?: unknown }).sections)) {
        return { sections: (parsed as { sections: unknown[] }).sections };
      }
    } catch { /* ignore */ }
  }
  return { sections: [] };
}

export async function searchDpsMembersMongo(
  query: string,
  guildDiscordIds: string[],
): Promise<Record<string, unknown>[]> {
  const q = query.trim().toLowerCase();
  if (!q || guildDiscordIds.length === 0) return [];

  const usersCol = await getCollection("users");
  const cadMatches = await usersCol
    .find({ discord_id: { $in: guildDiscordIds } })
    .limit(200)
    .toArray();

  type SearchHit = {
    id: number | null;
    username: string;
    discord_username: string | null;
    discord_id: string | null;
    rank: string | null;
  };
  const hits: SearchHit[] = [];
  const seenDiscordIds = new Set<string>();

  for (const row of cadMatches) {
    const username = String(row.username ?? "");
    const discordUsername = row.discord_username == null ? null : String(row.discord_username);
    const discordId = row.discord_id == null ? null : String(row.discord_id);
    const hay = `${username} ${discordUsername ?? ""} ${discordId ?? ""}`.toLowerCase();
    if (!hay.includes(q)) continue;
    hits.push({
      id: Number(row.id),
      username,
      discord_username: discordUsername,
      discord_id: discordId,
      rank: row.rank == null ? null : String(row.rank),
    });
    if (discordId) seenDiscordIds.add(discordId);
    if (hits.length >= 20) break;
  }

  return hits.slice(0, 20);
}

export async function getDpsRankDetailMongo(id: number): Promise<Record<string, unknown> | null> {
  const ranksCol = await getCollection("dps_ranks");
  const rankDoc = await ranksCol.findOne({ id });
  if (!rankDoc) return null;
  const rank = normalizeRankRow(stripMongoId(rankDoc));
  const rankName = String(rank.name ?? "");
  const rankNamePattern = new RegExp(`^${rankName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

  const [matchingDpsUsers, customCallsigns] = await Promise.all([
    colFind("dps_users", { dps_rank: rankNamePattern }),
    colFind("dps_rank_custom_callsigns", { rank_id: id }, { sort_order: 1, id: 1 }),
  ]);

  const profileIds = [...new Set(
    matchingDpsUsers
      .map(d => Number(d.profile_id))
      .filter(pid => Number.isInteger(pid) && pid > 0),
  )];
  const assignedIds = customCallsigns
    .map(cc => (cc.assigned_profile_id == null ? null : Number(cc.assigned_profile_id)))
    .filter((pid): pid is number => pid != null && Number.isInteger(pid) && pid > 0);
  const userById = await loadUsersByProfileIds([...new Set([...profileIds, ...assignedIds])]);
  const dpsByProfile = new Map(
    matchingDpsUsers
      .map(d => [Number(d.profile_id), d] as const)
      .filter(([pid]) => Number.isInteger(pid) && pid > 0),
  );

  let members: Record<string, unknown>[] = [];
  for (const d of matchingDpsUsers) {
    const profileId = Number(d.profile_id);
    const p = userById.get(profileId);
    if (!p) continue;
    members.push({
      id: profileId,
      username: asStringOrNull(d.username) ?? asStringOrNull(p.username) ?? "",
      discord_username: asStringOrNull(p.discord_username),
      discord_id: asStringOrNull(p.discord_id),
      avatar_hash: asStringOrNull(p.avatar_hash),
      callsign: asStringOrNull(d.callsign),
      dps_rank: asStringOrNull(d.dps_rank),
      status: asStringOrNull(d.status) ?? "Active",
    });
  }

  if (rank.callsign_type === "dynamic") {
    members = [...members].sort((a, b) => {
      const nA = parseInt(String(a.callsign ?? "").split("-").pop() ?? "", 10);
      const nB = parseInt(String(b.callsign ?? "").split("-").pop() ?? "", 10);
      if (!Number.isNaN(nA) && !Number.isNaN(nB)) return nA - nB;
      return String(a.callsign ?? "").localeCompare(String(b.callsign ?? ""));
    });
  } else {
    members.sort((a, b) => String(a.username ?? "").localeCompare(String(b.username ?? "")));
  }

  const custom_callsigns = customCallsigns.map((cc) => {
    const assignedId = cc.assigned_profile_id == null ? null : Number(cc.assigned_profile_id);
    const p = assignedId == null ? null : userById.get(assignedId);
    const d = assignedId == null ? null : dpsByProfile.get(assignedId);
    const doc = stripMongoId(cc);
    return {
      id: Number(doc.id),
      rank_id: Number(doc.rank_id),
      callsign: asStringOrNull(doc.callsign),
      assigned_profile_id: assignedId,
      sort_order: Number(doc.sort_order ?? 0),
      assigned_username: asStringOrNull(d?.username) ?? asStringOrNull(p?.username),
    };
  });

  return { ...rank, members, custom_callsigns };
}

export async function getDpsDivisionInfoMongo(id: number): Promise<Record<string, unknown> | null> {
  const col = await getCollection("dps_divisions");
  const row = await col.findOne({ id });
  if (!row) return null;
  const doc = stripMongoId(row);
  return {
    id: Number(doc.id),
    name: String(doc.name ?? ""),
    ...parseDivisionInfoContent(doc.info_content),
  };
}

export async function getDpsDivisionRankDetailMongo(id: number): Promise<Record<string, unknown> | null> {
  const ranksCol = await getCollection("dps_division_ranks");
  const rankDoc = await ranksCol.findOne({ id });
  if (!rankDoc) return null;
  const rank = stripMongoId(rankDoc) as {
    id: number;
    division_id: number | null;
    name: string;
    callsign_type: string | null;
    callsign_max: number | null;
  };
  const divisionId = rank.division_id == null ? null : Number(rank.division_id);
  const rankNameLower = String(rank.name ?? "").trim().toLowerCase();

  const [userDivisions, customCallsigns] = await Promise.all([
    colFind("dps_user_divisions"),
    colFind("dps_division_rank_custom_callsigns", { division_rank_id: id }, { sort_order: 1, id: 1 }),
  ]);

  const matchingDivisions = userDivisions.filter((ud) => {
    const udDivId = ud.division_id == null ? null : Number(ud.division_id);
    if (udDivId !== divisionId && !(udDivId == null && divisionId == null)) return false;
    const udRank = String(ud.division_rank ?? "").trim().toLowerCase();
    return udRank === rankNameLower;
  });

  const profileIds = [...new Set(
    matchingDivisions
      .map(ud => Number(ud.profile_id))
      .filter(pid => Number.isInteger(pid) && pid > 0),
  )];
  const assignedIds = customCallsigns
    .map(cc => (cc.assigned_profile_id == null ? null : Number(cc.assigned_profile_id)))
    .filter((pid): pid is number => pid != null && Number.isInteger(pid) && pid > 0);
  const allProfileIds = [...new Set([...profileIds, ...assignedIds])];

  const [userById, dpsUsers] = await Promise.all([
    loadUsersByProfileIds(allProfileIds),
    profileIds.length > 0
      ? colFind("dps_users", { profile_id: { $in: profileIds } })
      : Promise.resolve([]),
  ]);
  const dpsByProfile = new Map(
    dpsUsers
      .map(d => [Number(d.profile_id), d] as const)
      .filter(([pid]) => Number.isInteger(pid) && pid > 0),
  );

  let members: Record<string, unknown>[] = [];
  for (const ud of matchingDivisions) {
    const profileId = Number(ud.profile_id);
    const p = userById.get(profileId);
    if (!p) continue;
    const d = dpsByProfile.get(profileId);
    members.push({
      id: profileId,
      username: asStringOrNull(d?.username) ?? asStringOrNull(p.username) ?? "",
      discord_username: asStringOrNull(p.discord_username),
      discord_id: asStringOrNull(p.discord_id),
      avatar_hash: asStringOrNull(p.avatar_hash),
      callsign: asStringOrNull(d?.callsign) ?? "4D-XX",
      status: asStringOrNull(d?.status) ?? "Active",
    });
  }

  if (rank.callsign_type === "dynamic") {
    members = [...members].sort((a, b) => {
      const nA = parseInt(String(a.callsign ?? "").split("-").pop() ?? "", 10);
      const nB = parseInt(String(b.callsign ?? "").split("-").pop() ?? "", 10);
      if (!Number.isNaN(nA) && !Number.isNaN(nB)) return nA - nB;
      return String(a.callsign ?? "").localeCompare(String(b.callsign ?? ""));
    });
  } else {
    members.sort((a, b) => String(a.username ?? "").localeCompare(String(b.username ?? "")));
  }

  const custom_callsigns = customCallsigns.map((cc) => {
    const assignedId = cc.assigned_profile_id == null ? null : Number(cc.assigned_profile_id);
    const p = assignedId == null ? null : userById.get(assignedId);
    const d = assignedId == null ? null : dpsByProfile.get(assignedId);
    const doc = stripMongoId(cc);
    return {
      id: Number(doc.id),
      division_rank_id: Number(doc.division_rank_id),
      callsign: asStringOrNull(doc.callsign),
      assigned_profile_id: assignedId,
      sort_order: Number(doc.sort_order ?? 0),
      assigned_username: asStringOrNull(d?.username) ?? asStringOrNull(p?.username),
    };
  });

  return { ...rank, members, custom_callsigns };
}
