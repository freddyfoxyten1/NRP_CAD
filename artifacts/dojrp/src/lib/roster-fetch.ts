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

export function rankBelongsToGroup(
  rank: { group_id?: unknown },
  group: { id: unknown },
): boolean {
  const gid = normalizeRankGroupId(rank.group_id);
  const id = normalizeRankGroupId(group.id);
  return gid != null && id != null && gid === id;
}

export async function fetchRosterJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Failed to load ${label}.`);
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error;
    throw new Error(msg ?? `Failed to load ${label}.`);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchRosterArray<T>(
  url: string,
  label: string,
  retries = 2,
): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await fetchRosterJson<unknown>(url, label);
      if (!Array.isArray(data)) throw new Error(`Failed to load ${label}.`);
      return data as T[];
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to load ${label}.`);
}
