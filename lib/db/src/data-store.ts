/** Active persistent data store. Prefers Mongo whenever MONGODB_URI is configured. */
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

  if (isProductionRuntime() && !hasUri) {
    throw new Error(
      "Production requires MONGODB_URI. Set DATA_STORE=mongo and configure MongoDB Atlas in .env.",
    );
  }

  if (raw === "mongo" && !hasUri) {
    throw new Error(
      "DATA_STORE=mongo requires MONGODB_URI. Configure Atlas or use DATA_STORE=sql for local development only.",
    );
  }

  if (isProductionRuntime() && raw === "sql") {
    throw new Error("Production cannot run with DATA_STORE=sql. Use DATA_STORE=mongo.");
  }
}

export function getDataStore(): DataStore {
  assertMongoConfigured();

  const raw = (process.env.DATA_STORE ?? "").trim().toLowerCase();
  const hasUri = Boolean(mongoUri());

  if (raw === "sql") {
    if (isProductionRuntime()) {
      throw new Error("DATA_STORE=sql is not permitted in production.");
    }
    return "sql";
  }

  if (raw === "mongo" || raw === "") {
    if (hasUri) return "mongo";
    if (isProductionRuntime()) {
      throw new Error("Production requires MONGODB_URI when using MongoDB.");
    }
    return "sql";
  }

  return hasUri ? "mongo" : "sql";
}

export function isMongoStore(): boolean {
  return getDataStore() === "mongo";
}

export function isSqlStore(): boolean {
  return getDataStore() === "sql";
}
