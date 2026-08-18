import { pool } from "@workspace/db";

/** Virtual division rank for members with the division membership Discord role but no linked rank role. */
export const DIVISION_UNRANKED_RANK = "Unranked";

export function isDivisionUnrankedRank(rankName: string | null | undefined): boolean {
  return String(rankName ?? "").trim().toLowerCase() === DIVISION_UNRANKED_RANK.toLowerCase();
}

export type DivisionLinkConfig = {
  membershipRoleByDiv: Map<number, string>;
  rankByRole: Map<string, { division_id: number; division_rank: string; sort_order: number }>;
  defaultRankByDiv: Map<number, { name: string; sort_order: number }>;
  linkedDivisionIds: Set<number>;
  linkedRankNames: Set<string>;
};

type GuildMemberRoles = { user: { id: string }; roles: string[] };

export async function loadDivisionLinkConfig(
  divisionsTable: "dps_divisions" | "dph_divisions",
  divisionRanksTable: "dps_division_ranks" | "dph_division_ranks",
): Promise<DivisionLinkConfig> {
  const membershipDivs = await pool.query<{ id: number; discord_role_id: string }>(
    `SELECT id, discord_role_id FROM ${divisionsTable}
     WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`,
  );
  const membershipRoleByDiv = new Map<number, string>();
  for (const d of membershipDivs.rows) membershipRoleByDiv.set(d.id, d.discord_role_id);

  const rankLinks = await pool.query<{
    division_id: number; name: string; sort_order: number; discord_role_id: string;
  }>(
    `SELECT division_id, name, sort_order, discord_role_id
     FROM ${divisionRanksTable}
     WHERE discord_role_id IS NOT NULL AND discord_role_id != '' AND division_id IS NOT NULL`,
  );

  const defaultRankByDiv = new Map<number, { name: string; sort_order: number }>();
  const allDivRanks = await pool.query<{ division_id: number; name: string; sort_order: number }>(
    `SELECT division_id, name, sort_order FROM ${divisionRanksTable}
     WHERE division_id IS NOT NULL ORDER BY sort_order DESC, id DESC`,
  );
  for (const r of allDivRanks.rows) {
    if (!defaultRankByDiv.has(r.division_id)) {
      defaultRankByDiv.set(r.division_id, { name: r.name, sort_order: r.sort_order });
    }
  }

  const rankByRole = new Map<string, { division_id: number; division_rank: string; sort_order: number }>();
  for (const r of rankLinks.rows) {
    const sortOrder = Number(r.sort_order ?? 999_999);
    const existing = rankByRole.get(r.discord_role_id);
    if (!existing || sortOrder < existing.sort_order) {
      rankByRole.set(r.discord_role_id, {
        division_id: r.division_id,
        division_rank: r.name,
        sort_order: sortOrder,
      });
    }
  }

  return {
    membershipRoleByDiv,
    rankByRole,
    defaultRankByDiv,
    linkedDivisionIds: new Set<number>([
      ...rankLinks.rows.map(r => r.division_id),
      ...membershipRoleByDiv.keys(),
    ]),
    linkedRankNames: new Set(rankLinks.rows.map(r => r.name.toLowerCase())),
  };
}

export function desiredDivisionAssignmentsFromRoles(
  roles: string[],
  config: DivisionLinkConfig,
): Map<number, { division_id: number; division_rank: string; sort_order: number }> {
  const roleSet = new Set(roles);
  const desiredByDiv = new Map<number, { division_id: number; division_rank: string; sort_order: number }>();

  for (const roleId of roles) {
    const rankHit = config.rankByRole.get(roleId);
    if (!rankHit) continue;
    const membershipRole = config.membershipRoleByDiv.get(rankHit.division_id);
    if (membershipRole && !roleSet.has(membershipRole)) continue;
    const cur = desiredByDiv.get(rankHit.division_id);
    if (!cur || rankHit.sort_order < cur.sort_order) {
      desiredByDiv.set(rankHit.division_id, rankHit);
    }
  }

  for (const [divId, roleId] of config.membershipRoleByDiv) {
    if (!roleSet.has(roleId) || desiredByDiv.has(divId)) continue;
    desiredByDiv.set(divId, {
      division_id: divId,
      division_rank: DIVISION_UNRANKED_RANK,
      sort_order: 999_999,
    });
  }

  return desiredByDiv;
}

export function divisionHasDiscordLinks(divisionId: number, config: DivisionLinkConfig): boolean {
  return config.linkedDivisionIds.has(divisionId);
}

/** Division ids whose linked membership Discord role the member currently holds. */
export function divisionMembershipIdsFromRoles(
  roles: string[],
  membershipRoleByDiv: Map<number, string>,
): number[] {
  const roleSet = new Set(roles);
  const ids: number[] = [];
  for (const [divId, roleId] of membershipRoleByDiv) {
    if (roleSet.has(roleId)) ids.push(divId);
  }
  return ids;
}

export type DivisionDiscordEnrichment = {
  map: Map<string, number[]>;
  warm: boolean;
  linkedDivisionIds: Set<number>;
};

export function divisionDiscordLinksForMember(
  discordId: string,
  assignments: Array<{ division_id: number }>,
  enrichment: DivisionDiscordEnrichment,
): number[] {
  if (!discordId) return [];
  if (enrichment.warm) {
    return enrichment.map.get(discordId) ?? [];
  }
  if (enrichment.map.size > 0) {
    return enrichment.map.get(discordId) ?? [];
  }
  if (enrichment.linkedDivisionIds.size === 0) return [];
  return assignments
    .filter(a => enrichment.linkedDivisionIds.has(a.division_id))
    .map(a => a.division_id);
}

/** Build discord_id → linked division ids from a guild member snapshot. */
export function buildDivisionDiscordMembershipMap(
  members: Array<{ user: { id: string }; roles: string[] }>,
  membershipRoleByDiv: Map<number, string>,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const m of members) {
    const ids = divisionMembershipIdsFromRoles(m.roles, membershipRoleByDiv);
    if (ids.length > 0) map.set(m.user.id, ids);
  }
  return map;
}

export async function guildRolesForDiscordId(
  discordId: string,
  fetchMembers: () => Promise<GuildMemberRoles[]>,
): Promise<string[] | null> {
  const trimmed = discordId.trim();
  if (!trimmed) return null;
  const members = await fetchMembers();
  const hit = members.find(m => m.user.id === trimmed);
  return hit ? hit.roles : null;
}

export type DivisionAssignmentMergeInput = {
  division_id: number;
  division_rank: string;
  is_manual?: boolean;
  can_edit_resources?: boolean;
  can_edit_roster?: boolean;
  can_edit_info?: boolean;
};

/** Linked divisions: Discord roles only. Unlinked divisions: keep existing rows. */
export function mergeDivisionAssignmentsFromDiscord<T extends DivisionAssignmentMergeInput>(
  existing: T[],
  desiredByDiv: Map<number, { division_id: number; division_rank: string }>,
  config: DivisionLinkConfig,
): T[] {
  const mergedMap = new Map<number, T>();

  for (const desired of desiredByDiv.values()) {
    const prev = existing.find(a => a.division_id === desired.division_id);
    mergedMap.set(desired.division_id, {
      ...(prev ?? {}),
      division_id: desired.division_id,
      division_rank: desired.division_rank,
      is_manual: false,
    } as T);
  }

  for (const a of existing) {
    if (mergedMap.has(a.division_id)) continue;
    if (!config.linkedDivisionIds.has(a.division_id)) {
      mergedMap.set(a.division_id, a);
    }
  }

  return [...mergedMap.values()];
}

export async function validateLinkedDivisionMemberAdd(opts: {
  divisionId: number;
  profileId: number;
  requestedRank: string;
  config: DivisionLinkConfig;
  fetchMembers: () => Promise<GuildMemberRoles[]>;
}): Promise<
  | { ok: true; rankName: string; isManual: boolean }
  | { ok: false; error: string }
> {
  const { divisionId, profileId, requestedRank, config, fetchMembers } = opts;

  if (!divisionHasDiscordLinks(divisionId, config)) {
    return { ok: true, rankName: requestedRank, isManual: true };
  }

  const profile = await pool.query<{ discord_id: string | null }>(
    `SELECT discord_id FROM cad_user_profiles WHERE id = $1 LIMIT 1`,
    [profileId],
  );
  const discordId = profile.rows[0]?.discord_id?.trim() ?? "";
  if (!discordId) {
    return { ok: false, error: "Member must have a linked Discord account for this division." };
  }

  const roles = await guildRolesForDiscordId(discordId, fetchMembers);
  if (!roles) {
    return { ok: false, error: "Member was not found in the division Discord guild." };
  }

  const desired = desiredDivisionAssignmentsFromRoles(roles, config);
  const placement = desired.get(divisionId);
  if (!placement) {
    return {
      ok: false,
      error: "Member must hold a linked division rank or membership Discord role to join this division.",
    };
  }

  return { ok: true, rankName: placement.division_rank, isManual: false };
}

export type DivisionPruneTables = {
  userDivisionsTable: "dps_user_divisions" | "dph_user_divisions";
  divisionRanksTable: "dps_division_ranks" | "dph_division_ranks";
};

/**
 * Drop division roster rows that reference a deleted rank, and linked-division
 * rows where the member no longer holds a qualifying Discord role.
 */
export async function pruneDivisionRosterAssignments(
  tables: DivisionPruneTables,
  config: DivisionLinkConfig,
  opts?: {
    fetchMembers?: () => Promise<GuildMemberRoles[]>;
    onProfilesUpdated?: (profileIds: number[]) => Promise<void>;
    onRankUpdated?: (profileId: number, divisionId: number, previousRank: string, nextRank: string) => Promise<void>;
  },
): Promise<{ orphaned: number; unqualified: number; updated: number }> {
  const affectedProfiles = new Set<number>();
  let orphaned = 0;
  let unqualified = 0;
  let updated = 0;

  const rankRows = await pool.query<{ division_id: number; name: string }>(
    `SELECT division_id, name FROM ${tables.divisionRanksTable} WHERE division_id IS NOT NULL`,
  );
  const validRanksByDiv = new Map<number, Set<string>>();
  for (const r of rankRows.rows) {
    const divId = Number(r.division_id);
    if (!Number.isInteger(divId) || divId <= 0) continue;
    const set = validRanksByDiv.get(divId) ?? new Set<string>();
    set.add(String(r.name ?? "").trim().toLowerCase());
    validRanksByDiv.set(divId, set);
  }

  const assignmentRows = await pool.query<{
    profile_id: number;
    division_id: number;
    division_rank: string;
  }>(`SELECT profile_id, division_id, division_rank FROM ${tables.userDivisionsTable}`);

  for (const row of assignmentRows.rows) {
    const profileId = Number(row.profile_id);
    const divisionId = Number(row.division_id);
    const rank = String(row.division_rank ?? "").trim();
    if (isDivisionUnrankedRank(rank)) continue;
    const valid = validRanksByDiv.get(divisionId);
    if (!valid?.has(rank.toLowerCase())) {
      await pool.query(
        `DELETE FROM ${tables.userDivisionsTable} WHERE profile_id = $1 AND division_id = $2`,
        [profileId, divisionId],
      );
      affectedProfiles.add(profileId);
      orphaned += 1;
    }
  }

  if (config.linkedDivisionIds.size > 0 && opts?.fetchMembers) {
    const linkedSet = config.linkedDivisionIds;
    const linkedAssignments = (await pool.query<{
      profile_id: number;
      division_id: number;
      division_rank: string;
    }>(`SELECT profile_id, division_id, division_rank FROM ${tables.userDivisionsTable}`)).rows
      .filter(r => linkedSet.has(Number(r.division_id)));

    const profileIds = [...new Set(linkedAssignments.map(r => Number(r.profile_id)))];
    const discordByProfile = new Map<number, string | null>();
    if (profileIds.length > 0) {
      const profiles = await pool.query<{ id: number; discord_id: string | null }>(
        `SELECT id, discord_id FROM cad_user_profiles WHERE id = ANY($1)`,
        [profileIds],
      );
      for (const p of profiles.rows) {
        discordByProfile.set(Number(p.id), p.discord_id?.trim() || null);
      }
    }

    const rolesByDiscordId = new Map<string, string[]>();
    try {
      for (const member of await opts.fetchMembers()) {
        rolesByDiscordId.set(member.user.id, member.roles);
      }
    } catch {
      // Guild fetch failed — orphan cleanup above still applied.
    }

    if (rolesByDiscordId.size > 0) {
      for (const row of linkedAssignments) {
        const profileId = Number(row.profile_id);
        const divisionId = Number(row.division_id);
        const currentRank = String(row.division_rank ?? "").trim();
        const discordId = discordByProfile.get(profileId) ?? null;
        const desired = discordId && rolesByDiscordId.has(discordId)
          ? desiredDivisionAssignmentsFromRoles(rolesByDiscordId.get(discordId)!, config)
          : new Map<number, { division_id: number; division_rank: string }>();
        const placement = desired.get(divisionId);

        if (!placement) {
          await pool.query(
            `DELETE FROM ${tables.userDivisionsTable} WHERE profile_id = $1 AND division_id = $2`,
            [profileId, divisionId],
          );
          affectedProfiles.add(profileId);
          unqualified += 1;
          continue;
        }

        if (currentRank.toLowerCase() !== placement.division_rank.toLowerCase()) {
          await pool.query(
            `UPDATE ${tables.userDivisionsTable} SET division_rank = $3 WHERE profile_id = $1 AND division_id = $2`,
            [profileId, divisionId, placement.division_rank],
          );
          affectedProfiles.add(profileId);
          updated += 1;
          if (opts?.onRankUpdated) {
            await opts.onRankUpdated(profileId, divisionId, currentRank, placement.division_rank);
          }
        }
      }
    }
  }

  if (affectedProfiles.size > 0 && opts?.onProfilesUpdated) {
    await opts.onProfilesUpdated([...affectedProfiles]);
  }

  if (orphaned > 0 || unqualified > 0 || updated > 0) {
    console.info(
      `[division-prune] orphaned=${orphaned} unqualified=${unqualified} updated=${updated} profiles=${affectedProfiles.size}`,
    );
  }

  return { orphaned, unqualified, updated };
}
