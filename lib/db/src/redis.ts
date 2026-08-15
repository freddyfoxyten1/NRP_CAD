import Redis from "ioredis";

let client: Redis | null = null;
let disabled = false;

const UNRECOVERABLE_RE = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|NOAUTH|EAI_AGAIN/i;

function disableRedis(reason: string): void {
  if (disabled) return;
  disabled = true;
  if (client) {
    client.removeAllListeners();
    client.disconnect(false);
    client = null;
  }
  console.warn(`[redis] cache disabled — ${reason}`);
}

export function getRedisUrl(): string {
  return (process.env.REDIS_URL ?? "").trim();
}

export function getRedis(): Redis | null {
  if (disabled) return null;
  const url = getRedisUrl();
  if (!url) return null;
  if (client) return client;

  client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    // Optional cache — do not spam reconnects when Redis is misconfigured or down.
    retryStrategy: () => null,
  });
  client.on("error", (err) => {
    const msg = err.message ?? String(err);
    if (UNRECOVERABLE_RE.test(msg)) {
      disableRedis(msg);
      return;
    }
    console.warn("[redis] error:", msg);
  });
  return client;
}

export async function connectRedis(): Promise<Redis | null> {
  const redis = getRedis();
  if (!redis) return null;
  if (redis.status === "ready" || redis.status === "connecting") {
    if (redis.status !== "ready") {
      try {
        await redis.connect();
      } catch (err) {
        disableRedis(err instanceof Error ? err.message : String(err));
        return null;
      }
    }
    return redis;
  }
  try {
    await redis.connect();
    console.info("[redis] Connected");
    return redis;
  } catch (err) {
    disableRedis(err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const redis = await connectRedis();
    if (!redis) return false;
    const pong = await redis.ping();
    return pong === "PONG";
  } catch (err) {
    disableRedis(err instanceof Error ? err.message : String(err));
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}

/** Safe get — returns null if Redis unavailable. */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    const redis = await connectRedis();
    if (!redis) return null;
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    const redis = await connectRedis();
    if (!redis) return;
    await redis.set(key, value, "EX", ttlSeconds);
  } catch {
    /* degrade without cache */
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    const redis = await connectRedis();
    if (!redis) return;
    await redis.del(...keys);
  } catch {
    /* ignore */
  }
}

export async function cacheDelByPrefix(prefix: string): Promise<void> {
  try {
    const redis = await connectRedis();
    if (!redis) return;
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* ignore */
  }
}

/** Single-flight lock. Returns true if lock acquired. */
export async function cacheAcquireLock(key: string, ttlMs = 10_000): Promise<boolean> {
  try {
    const redis = await connectRedis();
    if (!redis) return true; // no redis → proceed without lock
    const result = await redis.set(key, "1", "PX", ttlMs, "NX");
    return result === "OK";
  } catch {
    return true;
  }
}

export async function cacheReleaseLock(key: string): Promise<void> {
  await cacheDel(key);
}
