import type pg from "pg";

/** True for hosted Postgres (Supabase, Neon) that requires TLS. */
export function postgresNeedsSsl(url: string): boolean {
  return /supabase\.co|pooler\.supabase\.com|neon\.tech|sslmode=require/i.test(url);
}

export function normalizePostgresUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/[?&]sslmode=/i.test(trimmed)) return trimmed;
  if (!postgresNeedsSsl(trimmed)) return trimmed;
  return `${trimmed}${trimmed.includes("?") ? "&" : "?"}sslmode=require`;
}

function stripSslMode(url: string): string {
  return url
    .replace(/[?&]sslmode=[^&]*/gi, "")
    .replace(/[?&]uselibpqcompat=[^&]*/gi, "")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
}

export function postgresPoolConfig(url: string): pg.PoolConfig {
  const needsSsl = postgresNeedsSsl(url);
  // pg 8 treats sslmode=require as verify-full. That fails on Windows when
  // the chain is incomplete or intercepted. Encrypt without verifying CA.
  return {
    connectionString: stripSslMode(url.trim()),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    connectionTimeoutMillis: 15_000,
  };
}
