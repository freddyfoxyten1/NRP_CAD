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

/** Match preview proxy GET timeout (12s) with a small buffer for slow VPS responses. */
export const ROSTER_FETCH_TIMEOUT_MS = 15_000;

export function isFetchTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("signal timed out")
    || msg.includes("aborted")
    || msg.includes("timeout");
}

export function rosterFetchErrorMessage(err: unknown, label: string): string {
  if (isFetchTimeoutError(err)) {
    return `Failed to load ${label}. The server took too long to respond — try again.`;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return `Failed to load ${label}.`;
}

export async function fetchRosterJson<T>(url: string, label: string): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ROSTER_FETCH_TIMEOUT_MS),
    });
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
  } catch (err) {
    throw new Error(rosterFetchErrorMessage(err, label));
  }
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
