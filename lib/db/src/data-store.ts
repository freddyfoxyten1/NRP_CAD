/** Active persistent data store. GitHub / VPS production is Mongo only. */
export type DataStore = "sql" | "mongo";

function isProductionRuntime(): boolean {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function mongoUri(): string {
  return (process.env.MONGODB_URI ?? "").trim();
}

/** Fail at boot when production or explicit mongo mode lacks Atlas credentials. */
export function assertMongoConfigured(): void {
  const raw = (process.env.DATA_STORE ?? "").trim().toLowerCase();
  const hasUri = Boolean(mongoUri());

  if (isProductionRuntime()) {
    if (raw === "sql") {
      throw new Error("GitHub/VPS production cannot use a local SQL database. Set DATA_STORE=mongo.");
    }
    if (!hasUri) {
      throw new Error(
        "Production requires MONGODB_URI. Local SQLite is not used on GitHub or the VPS.",
      );
    }
    return;
  }

  if (raw === "mongo" && !hasUri) {
    throw new Error("DATA_STORE=mongo requires MONGODB_URI. Configure MongoDB Atlas in .env.");
  }
}

export function getDataStore(): DataStore {
  assertMongoConfigured();

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
