/** Coerce rank/title group ids from SQL, SQLite, or Mongo (may be string or corrupt). */
export function normalizeRankGroupId(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeRankRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    id: Number(row.id),
    sort_order: Number(row.sort_order ?? 0),
    group_id: normalizeRankGroupId(row.group_id),
    callsign_min: row.callsign_min == null ? null : Number(row.callsign_min),
    callsign_max: row.callsign_max == null ? null : Number(row.callsign_max),
  };
}

export function normalizeGroupRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    id: Number(row.id),
    sort_order: Number(row.sort_order ?? 0),
    panel_access: Boolean(row.panel_access),
    division_oversight: Boolean(row.division_oversight),
  };
}
