/** Resolved CAD rank from a linked Discord role id. */
export type LinkedRankHit = {
  rankName: string;
  groupName: string | null;
  groupSortOrder: number;
  rankSortOrder: number;
};

/** Lower tuple = higher on the roster (group first, then rank within group). */
export function compareLinkedRankHierarchy(a: LinkedRankHit, b: LinkedRankHit): number {
  const gA = Number.isFinite(a.groupSortOrder) ? a.groupSortOrder : 999_999;
  const gB = Number.isFinite(b.groupSortOrder) ? b.groupSortOrder : 999_999;
  if (gA !== gB) return gA - gB;
  const rA = Number.isFinite(a.rankSortOrder) ? a.rankSortOrder : 999_999;
  const rB = Number.isFinite(b.rankSortOrder) ? b.rankSortOrder : 999_999;
  return rA - rB;
}

/** Pick the highest hierarchy match among a member's linked Discord role ids. */
export function pickHighestLinkedDiscordRole(
  matchingRoleIds: string[],
  rankByRoleId: Map<string, LinkedRankHit>,
): string | null {
  let best: string | null = null;
  for (const roleId of matchingRoleIds) {
    const hit = rankByRoleId.get(roleId);
    if (!hit) continue;
    if (best === null || compareLinkedRankHierarchy(hit, rankByRoleId.get(best)!) < 0) {
      best = roleId;
    }
  }
  return best;
}

type RankRow = {
  name: string;
  discord_role_id: string | null;
  sort_order: number;
  group_id?: number | null;
};

/** Build role-id → rank map, keeping the highest rank when a role id is duplicated. */
export function buildLinkedRankByRoleId(
  ranks: RankRow[],
  groupSortById: Map<number, number>,
  groupNameById: Map<number, string>,
): Map<string, LinkedRankHit> {
  const map = new Map<string, LinkedRankHit>();
  for (const rank of ranks) {
    const roleId = rank.discord_role_id?.trim();
    if (!roleId) continue;
    const groupId = rank.group_id ?? null;
    const groupSortOrder = groupId != null ? (groupSortById.get(groupId) ?? 999_999) : 999_999;
    const groupName = groupId != null ? (groupNameById.get(groupId) ?? null) : null;
    const hit: LinkedRankHit = {
      rankName: rank.name,
      groupName,
      groupSortOrder,
      rankSortOrder: Number(rank.sort_order ?? 999_999),
    };
    const existing = map.get(roleId);
    if (!existing || compareLinkedRankHierarchy(hit, existing) < 0) {
      map.set(roleId, hit);
    }
  }
  return map;
}
