type RankLike = { name: string; sort_order: number };

export function compareCallsigns(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const nA = parseInt((a ?? "").split("-").pop() ?? "", 10);
  const nB = parseInt((b ?? "").split("-").pop() ?? "", 10);
  if (!Number.isNaN(nA) && !Number.isNaN(nB) && nA !== nB) return nA - nB;
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

export function rankSortOrder(
  rankName: string | null | undefined,
  ranks: RankLike[],
  fallback = 999_999,
): number {
  if (!rankName?.trim()) return fallback;
  const meta = ranks.find(
    (r) => r.name.toLowerCase() === rankName.toLowerCase().trim(),
  );
  return meta?.sort_order ?? fallback;
}

export function compareByRankThenUsername<
  T extends { username?: string | null },
>(
  a: T,
  b: T,
  ranks: RankLike[],
  getRankName: (member: T) => string | null | undefined,
): number {
  const rA = rankSortOrder(getRankName(a), ranks);
  const rB = rankSortOrder(getRankName(b), ranks);
  if (rA !== rB) return rA - rB;
  return String(a.username ?? "").localeCompare(String(b.username ?? ""), undefined, {
    sensitivity: "base",
  });
}

export function compareByRankThenCallsign<
  T extends { username?: string | null; callsign?: string | null },
>(
  a: T,
  b: T,
  ranks: RankLike[],
  getRankName: (member: T) => string | null | undefined,
): number {
  const rA = rankSortOrder(getRankName(a), ranks);
  const rB = rankSortOrder(getRankName(b), ranks);
  if (rA !== rB) return rA - rB;
  const callsignCmp = compareCallsigns(a.callsign, b.callsign);
  if (callsignCmp !== 0) return callsignCmp;
  return String(a.username ?? "").localeCompare(String(b.username ?? ""), undefined, {
    sensitivity: "base",
  });
}

export function sortByRankThenUsername<
  T extends { username?: string | null },
>(
  members: T[],
  ranks: RankLike[],
  getRankName: (member: T) => string | null | undefined,
): T[] {
  return [...members].sort((a, b) => compareByRankThenUsername(a, b, ranks, getRankName));
}

export function sortByRankThenCallsign<
  T extends { username?: string | null; callsign?: string | null },
>(
  members: T[],
  ranks: RankLike[],
  getRankName: (member: T) => string | null | undefined,
): T[] {
  return [...members].sort((a, b) => compareByRankThenCallsign(a, b, ranks, getRankName));
}

export type TitleGroup = { id: number; name: string; sort_order: number };
export type TitleRank = RankLike & { group_id?: number | null };

/** Keep one row per profile id — guards against join-multiplied API rows. */
export function dedupeRosterMembersById<T extends { id: number }>(members: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const m of members) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export type PersonnelRosterMember = {
  group_name?: string | null;
  staff_role?: string | null;
};

function isCommunityTitle(name: string): boolean {
  return name.trim().toLowerCase() === "community members";
}

function normalizeId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Title group from the member's configured department rank only (not staff role). */
export function personnelGroupLabelFromRank<
  T extends PersonnelRosterMember,
>(
  member: T,
  ranks: TitleRank[],
  groups: TitleGroup[],
  getRankName: (member: T) => string | null | undefined,
): string | null {
  const rankName = (getRankName(member) ?? "").trim();
  if (!rankName) return null;
  const rankMeta = ranks.find(
    (r) => r.name.toLowerCase() === rankName.toLowerCase(),
  );
  const rankGroupId = normalizeId(rankMeta?.group_id);
  if (rankGroupId == null) return null;
  const group = groups.find((g) => normalizeId(g.id) === rankGroupId);
  if (!group || isCommunityTitle(group.name)) return null;
  return group.name;
}

/** Resolve roster title from linked rank metadata or API group_name. */
export function personnelGroupLabelForDisplay<
  T extends PersonnelRosterMember,
>(
  member: T,
  ranks: TitleRank[],
  groups: TitleGroup[],
  getRankName: (member: T) => string | null | undefined,
): string | null {
  const fromRank = personnelGroupLabelFromRank(member, ranks, groups, getRankName);
  if (fromRank) return fromRank;

  const fromApi = personnelGroupLabel(member);
  if (!fromApi) return null;

  const safeGroups = groups.filter(g => !isCommunityTitle(g.name));
  if (safeGroups.length === 0) return fromApi;

  const matched = safeGroups.find(
    g => g.name.trim().toLowerCase() === fromApi.toLowerCase(),
  );
  return matched?.name ?? fromApi;
}

/**
 * Members link to ranks by name, so two rank rows sharing a name are the same
 * rank. Collapse them, keeping the first row's ordering and filling in a title
 * group from whichever duplicate has one.
 */
export function dedupeTitleRanksByName<T extends TitleRank>(ranks: T[]): T[] {
  const byName = new Map<string, T>();
  for (const rank of ranks) {
    const key = rank.name.trim().toLowerCase();
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...rank });
      continue;
    }
    if (normalizeId(existing.group_id) == null && normalizeId(rank.group_id) != null) {
      existing.group_id = rank.group_id;
    }
  }
  return [...byName.values()];
}

/** A member belongs on the roster only when their rank sits under a title group. */
export function isPersonnelRosterMemberVisible<
  T extends PersonnelRosterMember,
>(
  member: T,
  ranks: TitleRank[],
  groups: TitleGroup[],
  getRankName: (member: T) => string | null | undefined,
): boolean {
  return personnelGroupLabelForDisplay(member, ranks, groups, getRankName) != null;
}

/** @deprecated Prefer personnelGroupLabelFromRank for roster display grouping. */
export function personnelGroupLabel(m: PersonnelRosterMember): string | null {
  const raw = (m.group_name ?? "").trim();
  if (raw && !isCommunityTitle(raw)) return raw;
  return null;
}

/** Group personnel under title headings, rank order then callsign within each title. */
export function buildPersonnelTitleGroups<
  T extends PersonnelRosterMember & {
    id: number;
    username?: string | null;
    callsign?: string | null;
  },
>(
  members: T[],
  groups: TitleGroup[],
  rawRanks: TitleRank[],
  getRankName: (member: T) => string | null | undefined,
): Array<{ id: number | null; label: string; members: T[] }> {
  const ranks = dedupeTitleRanksByName(rawRanks);
  const eligible = dedupeRosterMembersById(members).filter(m =>
    isPersonnelRosterMemberVisible(m, ranks, groups, getRankName),
  );
  const safeGroups = groups.filter(g => !isCommunityTitle(g.name));

  const titleOrder = new Map<string, { id: number | null; sort: number }>();
  for (const g of safeGroups) {
    titleOrder.set(g.name, { id: g.id, sort: g.sort_order });
  }

  return [...titleOrder.entries()]
    .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
    .map(([label, meta]) => ({
      id: meta.id,
      label,
      members: sortByRankThenCallsign(
        eligible.filter(m => personnelGroupLabelForDisplay(m, ranks, groups, getRankName) === label),
        ranks,
        getRankName,
      ),
    }))
    .filter(group => group.members.length > 0);
}

/** Title label for the public index roster. */
function publicPersonnelTitleLabel<
  T extends PersonnelRosterMember,
>(
  member: T,
  ranks: TitleRank[],
  groups: TitleGroup[],
  getRankName: (member: T) => string | null | undefined,
): string | null {
  const fromDisplay = personnelGroupLabelForDisplay(member, ranks, groups, getRankName);
  if (fromDisplay) return fromDisplay;

  const fromApi = personnelGroupLabel(member);
  if (fromApi) return fromApi;

  return null;
}

const PUBLIC_UNASSIGNED_TITLE = "Unassigned";

/** Public roster grouping — includes all personnel under title headings. */
export function buildPublicPersonnelTitleGroups<
  T extends PersonnelRosterMember & { username?: string | null; callsign?: string | null },
>(
  members: T[],
  groups: TitleGroup[],
  ranks: TitleRank[],
  getRankName: (member: T) => string | null | undefined,
): Array<{ id: number | null; label: string; members: T[] }> {
  const eligible = dedupeRosterMembersById(members);
  const safeGroups = groups.filter(g => !isCommunityTitle(g.name));

  const resolveLabel = (m: T): string =>
    publicPersonnelTitleLabel(m, ranks, groups, getRankName) ?? PUBLIC_UNASSIGNED_TITLE;

  const titleOrder = new Map<string, { id: number | null; sort: number }>();
  for (const g of safeGroups) {
    titleOrder.set(g.name, { id: g.id, sort: g.sort_order });
  }
  if (eligible.some(m => publicPersonnelTitleLabel(m, ranks, groups, getRankName) == null)) {
    titleOrder.set(PUBLIC_UNASSIGNED_TITLE, { id: null, sort: 999_999 });
  }
  for (const m of eligible) {
    const label = resolveLabel(m);
    if (titleOrder.has(label)) continue;
    titleOrder.set(label, { id: null, sort: 999 });
  }

  return [...titleOrder.entries()]
    .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
    .map(([label, meta]) => ({
      id: meta.id,
      label,
      members: sortByRankThenCallsign(
        eligible.filter(m => resolveLabel(m) === label),
        ranks,
        getRankName,
      ),
    }))
    .filter(g => g.members.length > 0);
}

export type PersonnelRosterTitle<T> = {
  id: number | null;
  label: string;
  members: T[];
  rankSections: RankSection<T>[];
};

/** Title groups from Personnel Management, each with that title's Mongo ranks. */
export function buildPersonnelRosterTree<
  T extends PersonnelRosterMember & {
    id: number;
    username?: string | null;
    callsign?: string | null;
  },
>(
  members: T[],
  groups: TitleGroup[],
  rawRanks: TitleRank[],
  getRankName: (member: T) => string | null | undefined,
  opts?: { hideEmptyRanks?: boolean },
): PersonnelRosterTitle<T>[] {
  const hideEmptyRanks = opts?.hideEmptyRanks ?? false;
  const ranks = dedupeTitleRanksByName(rawRanks);
  const titles = buildPersonnelTitleGroups(members, groups, ranks, getRankName);

  return titles
    .map((title) => {
      const groupRanks = ranks.filter((r) => {
        const gid = normalizeId(r.group_id);
        const tid = normalizeId(title.id);
        return gid != null && tid != null && gid === tid;
      });
      return {
        ...title,
        rankSections: buildPersonnelRankSections(
          title.members,
          groupRanks,
          getRankName,
          { hideEmpty: hideEmptyRanks },
        ),
      };
    })
    .filter((title) => title.members.length > 0 || title.rankSections.length > 0);
}

export type RankSection<T> = {
  label: string;
  sort: number;
  members: T[];
};

/** Within a title group, bucket members by rank (in sort_order) then callsign. */
export function buildPersonnelRankSections<
  T extends { username?: string | null; callsign?: string | null },
>(
  members: T[],
  groupRanks: RankLike[],
  getRankName: (member: T) => string | null | undefined,
  opts?: { hideEmpty?: boolean },
): RankSection<T>[] {
  const hideEmpty = opts?.hideEmpty ?? false;
  const known = new Set(groupRanks.map(r => r.name.toLowerCase().trim()));
  const byCallsignThenName = (a: T, b: T) =>
    compareCallsigns(a.callsign, b.callsign)
    || String(a.username ?? "").localeCompare(String(b.username ?? ""), undefined, { sensitivity: "base" });

  const sections: RankSection<T>[] = groupRanks
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map(r => ({
      label: r.name,
      sort: r.sort_order,
      members: members
        .filter(m => (getRankName(m) ?? "").trim().toLowerCase() === r.name.toLowerCase())
        .sort(byCallsignThenName),
    }));

  const orphanBuckets = new Map<string, T[]>();
  for (const m of members) {
    const name = (getRankName(m) ?? "").trim();
    if (!name || known.has(name.toLowerCase())) continue;
    if (!orphanBuckets.has(name)) orphanBuckets.set(name, []);
    orphanBuckets.get(name)!.push(m);
  }
  for (const [label, list] of orphanBuckets) {
    sections.push({
      label,
      sort: 999_999,
      members: [...list].sort(byCallsignThenName),
    });
  }

  const visible = hideEmpty ? sections.filter(s => s.members.length > 0) : sections;
  return visible.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}
