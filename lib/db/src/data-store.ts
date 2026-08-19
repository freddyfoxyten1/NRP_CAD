/** Active persistent data store. Production may be Mongo Atlas or hosted Postgres. */
export type DataStore = "sql" | "mongo";

function isProductionRuntime(): boolean {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function mongoUri(): string {
  return (process.env.MONGODB_URI ?? "").trim();
}

function hostedPostgresUrl(): string {
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) return "";
  if (/\[YOUR-PASSWORD\]|:YOUR_PASSWORD@|:PASSWORD@/i.test(url)) return "";
  return url;
}

function wantsSqlStore(): boolean {
  const raw = (process.env.DATA_STORE ?? "").trim().toLowerCase();
  return raw === "sql" || raw === "postgres";
}

/** Fail at boot when production or explicit mongo mode lacks credentials. */
export function assertMongoConfigured(): void {
  const hasUri = Boolean(mongoUri());

  if (isProductionRuntime()) {
    if (wantsSqlStore()) {
      if (!hostedPostgresUrl()) {
        throw new Error(
          "Production SQL requires DATABASE_URL (Supabase/Neon). Local SQLite is not used on GitHub or a VPS.",
        );
      }
      return;
    }
    if (!hasUri) {
      throw new Error(
        "Production requires MONGODB_URI, or DATABASE_URL with DATA_STORE=sql.",
      );
    }
    return;
  }

  if (!wantsSqlStore() && (process.env.DATA_STORE ?? "").trim().toLowerCase() === "mongo" && !hasUri) {
    throw new Error("DATA_STORE=mongo requires MONGODB_URI. Configure MongoDB Atlas in .env.");
  }
}

export function getDataStore(): DataStore {
  assertMongoConfigured();

  if (wantsSqlStore()) return "sql";

  if (isProductionRuntime()) return "mongo";

  const raw = (process.env.DATA_STORE ?? "").trim().toLowerCase();
  const hasUri = Boolean(mongoUri());

  if (raw === "sql") return "sql";
  if (raw === "mongo" || raw === "") return hasUri ? "mongo" : "sql";
  return hasUri ? "mongo" : "sql";
}

export function isMongoStore(): boolean {
  return getDataStore() === "mongo";
}

export function isSqlStore(): boolean {
  return getDataStore() === "sql";
}
