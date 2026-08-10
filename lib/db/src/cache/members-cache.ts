import { createHash } from "node:crypto";
import {
  cacheAcquireLock,
  cacheDel,
  cacheDelByPrefix,
  cacheGet,
  cacheReleaseLock,
  cacheSet,
} from "../redis";
import {
  listMemberSummaries,
  type MemberSummary,
} from "../repositories/users";

const LIST_TTL_SEC = 90;
const ID_TTL_SEC = 300;

function listKey(page: number, limit: number, q: string): string {
  const hash = createHash("sha1").update(q || "").digest("hex").slice(0, 12);
  return `members:list:page:${page}:limit:${limit}:q:${hash}`;
}

export async function getCachedMemberPage(opts: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<{ items: MemberSummary[]; total: number; page: number; limit: number; cache: "HIT" | "MISS" }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const q = (opts.q ?? "").trim();
  const key = listKey(page, limit, q);

  const cached = await cacheGet(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { items: MemberSummary[]; total: number; page: number; limit: number };
      return { ...parsed, cache: "HIT" };
    } catch {
      /* fall through */
    }
  }

  const lockKey = `members:lock:${key}`;
  const gotLock = await cacheAcquireLock(lockKey, 8_000);
  if (!gotLock) {
    // Brief wait for the winner to populate cache
    await new Promise((r) => setTimeout(r, 150));
    const again = await cacheGet(key);
    if (again) {
      try {
        const parsed = JSON.parse(again) as { items: MemberSummary[]; total: number; page: number; limit: number };
        return { ...parsed, cache: "HIT" };
      } catch { /* fall through */ }
    }
  }

  try {
    const result = await listMemberSummaries({ page, limit, q });
    await cacheSet(key, JSON.stringify(result), LIST_TTL_SEC);
    return { ...result, cache: "MISS" };
  } finally {
    if (gotLock) await cacheReleaseLock(lockKey);
  }
}

export async function invalidateMemberCaches(memberId?: number): Promise<void> {
  await cacheDelByPrefix("members:list:");
  if (typeof memberId === "number") {
    await cacheDel(`members:id:${memberId}`);
  } else {
    await cacheDelByPrefix("members:id:");
  }
}

export async function cacheMemberSummary(member: MemberSummary): Promise<void> {
  await cacheSet(`members:id:${member.id}`, JSON.stringify(member), ID_TTL_SEC);
}
