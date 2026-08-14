/** Natural callsign order (numeric suffix after last hyphen, e.g. 4D-02 before 4D-10). */
export function compareCallsigns(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const nA = parseInt((a ?? "").split("-").pop() ?? "", 10);
  const nB = parseInt((b ?? "").split("-").pop() ?? "", 10);
  if (!Number.isNaN(nA) && !Number.isNaN(nB) && nA !== nB) return nA - nB;
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

export function sortStaffByRank<T extends { username?: string | null; staff_rank?: string | null }>(
  rows: T[],
  rankOrderByName: Map<string, number>,
): T[] {
  return [...rows].sort((a, b) => {
    const rA = rankOrderByName.get((a.staff_rank ?? "").trim().toLowerCase()) ?? 999_999;
    const rB = rankOrderByName.get((b.staff_rank ?? "").trim().toLowerCase()) ?? 999_999;
    if (rA !== rB) return rA - rB;
    return String(a.username ?? "").localeCompare(String(b.username ?? ""), undefined, {
      sensitivity: "base",
    });
  });
}

export function sortDepartmentPersonnel<
  T extends { username?: string | null; callsign?: string | null },
>(
  rows: T[],
  getGroupSort: (row: T) => number,
  getRankSort: (row: T) => number,
  getCallsign: (row: T) => string | null | undefined = (row) => row.callsign,
  getUsername: (row: T) => string = (row) => String(row.username ?? ""),
): T[] {
  return [...rows].sort((a, b) => {
    const groupCmp = getGroupSort(a) - getGroupSort(b);
    if (groupCmp !== 0) return groupCmp;
    const rankCmp = getRankSort(a) - getRankSort(b);
    if (rankCmp !== 0) return rankCmp;
    const callsignCmp = compareCallsigns(getCallsign(a), getCallsign(b));
    if (callsignCmp !== 0) return callsignCmp;
    return getUsername(a).localeCompare(getUsername(b), undefined, { sensitivity: "base" });
  });
}

export function sortByCallsignThenUsername<
  T extends { username?: string | null; callsign?: string | null },
>(
  rows: T[],
  getCallsign: (row: T) => string | null | undefined = (row) => row.callsign,
  getUsername: (row: T) => string = (row) => String(row.username ?? ""),
): T[] {
  return [...rows].sort((a, b) => {
    const callsignCmp = compareCallsigns(getCallsign(a), getCallsign(b));
    if (callsignCmp !== 0) return callsignCmp;
    return getUsername(a).localeCompare(getUsername(b), undefined, { sensitivity: "base" });
  });
}
