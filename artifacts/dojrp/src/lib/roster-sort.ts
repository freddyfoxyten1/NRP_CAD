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

export type PersonnelRosterMember = {
  group_name?: string | null;
  staff_role?: string | null;
};

/** Title heading for department personnel roster — never "Community Members". */
export function personnelGroupLabel(m: PersonnelRosterMember): string | null {
  const raw = (m.group_name ?? "").trim();
  if (raw && raw.toLowerCase() !== "community members") return raw;
  if ((m.staff_role ?? "").trim().toLowerCase() === "executive team") return "Executive Team";
  return null;
}

/** Group personnel under title headings, rank order then callsign within each title. */
export function buildPersonnelTitleGroups<
  T extends PersonnelRosterMember & { username?: string | null; callsign?: string | null },
>(
  members: T[],
  groups: TitleGroup[],
  ranks: RankLike[],
  getRankName: (member: T) => string | null | undefined,
): Array<{ id: number | null; label: string; members: T[] }> {
  const safeGroups = groups.filter(g => g.name.trim().toLowerCase() !== "community members");
  const defined = safeGroups
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map(g => ({
      id: g.id as number | null,
      label: g.name,
      members: sortByRankThenCallsign(
        members.filter(m => personnelGroupLabel(m) === g.name),
        ranks,
        getRankName,
      ),
    }));

  const definedLabels = new Set(safeGroups.map(g => g.name));
  const orphanByLabel = new Map<string, T[]>();
  for (const m of members) {
    const label = personnelGroupLabel(m);
    if (!label || definedLabels.has(label)) continue;
    if (!orphanByLabel.has(label)) orphanByLabel.set(label, []);
    orphanByLabel.get(label)!.push(m);
  }
  for (const [label, list] of orphanByLabel) {
    defined.push({
      id: null,
      label,
      members: sortByRankThenCallsign(list, ranks, getRankName),
    });
  }

  return defined;
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
