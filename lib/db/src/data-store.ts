/** Active persistent data store. Prefers Mongo whenever MONGODB_URI is configured. */
export type DataStore = "sql" | "mongo";

let warnedMissingUri = false;

export function getDataStore(): DataStore {
  const raw = (process.env.DATA_STORE ?? "").trim().toLowerCase();
  const hasUri = Boolean((process.env.MONGODB_URI ?? "").trim());

  if (raw === "sql") return "sql";

  if (raw === "mongo" || raw === "") {
    if (hasUri) return "mongo";
    if (raw === "mongo" && !warnedMissingUri) {
      warnedMissingUri = true;
      console.warn(
        "[db] DATA_STORE=mongo but MONGODB_URI is empty — using SQL until Atlas URI is set",
      );
    }
    // Empty DATA_STORE + no URI → sql; explicit mongo without URI also falls back.
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
