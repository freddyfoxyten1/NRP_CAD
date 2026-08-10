/** Active persistent data store. SQL remains default until Mongo cutover is verified. */
export type DataStore = "sql" | "mongo";

export function getDataStore(): DataStore {
  const raw = (process.env.DATA_STORE ?? "sql").trim().toLowerCase();
  return raw === "mongo" ? "mongo" : "sql";
}

export function isMongoStore(): boolean {
  return getDataStore() === "mongo";
}

export function isSqlStore(): boolean {
  return getDataStore() === "sql";
}
