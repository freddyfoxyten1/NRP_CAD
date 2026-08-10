import {
  MongoClient,
  GridFSBucket,
  type Db,
  type Collection,
  type Document,
  type ObjectId,
} from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;
let connecting: Promise<Db> | null = null;

export function getMongoDatabaseName(): string {
  return (process.env.MONGODB_DATABASE ?? "dojcad").trim() || "dojcad";
}

export function getMongoUri(): string {
  const uri = (process.env.MONGODB_URI ?? "").trim();
  if (!uri) {
    throw new Error("MONGODB_URI is required when DATA_STORE=mongo (or for migration).");
  }
  return uri;
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;
  if (connecting) return connecting;

  connecting = (async () => {
    const uri = getMongoUri();
    const databaseName = getMongoDatabaseName();
    const next = new MongoClient(uri, {
      maxPoolSize: 20,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 15_000,
    });
    await next.connect();
    client = next;
    db = next.db(databaseName);
    console.info(`[db] Connected to MongoDB database "${databaseName}"`);
    return db;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function getDb(): Promise<Db> {
  return connectMongo();
}

export async function getCollection<T extends Document = Document>(
  name: string,
): Promise<Collection<T>> {
  const database = await getDb();
  return database.collection<T>(name);
}

export async function getUploadsBucket(): Promise<GridFSBucket> {
  const database = await getDb();
  return new GridFSBucket(database, { bucketName: "uploads" });
}

export async function pingMongo(): Promise<boolean> {
  try {
    const database = await getDb();
    await database.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export type { Db, Collection, Document, ObjectId, GridFSBucket };
