import type { Filter, Document, Sort } from "mongodb";
import { getCollection } from "../mongo";
import { nextId } from "../counters";

/** Strip Mongo internals before returning API-shaped docs. */
export function toApiDoc<T extends Document>(doc: T | null | undefined): Omit<T, "_id"> | null {
  if (!doc) return null;
  const { _id: _ignored, ...rest } = doc as T & { _id?: unknown };
  return rest as Omit<T, "_id">;
}

export function toApiDocs<T extends Document>(docs: T[]): Array<Omit<T, "_id">> {
  return docs.map((d) => toApiDoc(d)!);
}

export async function findByNumericId<T extends Document = Document>(
  collection: string,
  id: number,
): Promise<Omit<T, "_id"> | null> {
  const col = await getCollection(collection);
  const doc = await col.findOne({ id });
  return toApiDoc(doc as T | null);
}

export async function findMany<T extends Document = Document>(
  collection: string,
  filter: Filter<Document> = {},
  opts: { sort?: Sort; limit?: number; skip?: number } = {},
): Promise<Array<Omit<T, "_id">>> {
  const col = await getCollection(collection);
  let cursor = col.find(filter);
  if (opts.sort) cursor = cursor.sort(opts.sort);
  if (opts.skip) cursor = cursor.skip(opts.skip);
  if (opts.limit) cursor = cursor.limit(opts.limit);
  const docs = await cursor.toArray();
  return toApiDocs(docs as unknown as T[]);
}

export async function insertWithId<T extends Document = Document>(
  collection: string,
  counterName: string,
  data: Omit<T, "_id" | "id"> & { id?: number },
): Promise<Omit<T, "_id">> {
  const col = await getCollection(collection);
  const id = data.id ?? await nextId(counterName);
  const doc = { ...data, id } as Document;
  await col.insertOne(doc);
  return toApiDoc(doc as T)!;
}

export async function updateById<T extends Document = Document>(
  collection: string,
  id: number,
  patch: Partial<T>,
): Promise<Omit<T, "_id"> | null> {
  const col = await getCollection(collection);
  const { _id: _a, id: _b, ...safe } = patch as T & { _id?: unknown; id?: unknown };
  const result = await col.findOneAndUpdate(
    { id },
    { $set: safe as Document },
    { returnDocument: "after" },
  );
  return toApiDoc(result as T | null);
}

export async function deleteById(collection: string, id: number): Promise<boolean> {
  const col = await getCollection(collection);
  const result = await col.deleteOne({ id });
  return result.deletedCount > 0;
}

export async function softDeleteById(collection: string, id: number): Promise<boolean> {
  const col = await getCollection(collection);
  const result = await col.updateOne(
    { id },
    { $set: { deleted_at: new Date().toISOString() } },
  );
  return result.modifiedCount > 0;
}

export async function countDocs(
  collection: string,
  filter: Filter<Document> = {},
): Promise<number> {
  const col = await getCollection(collection);
  return col.countDocuments(filter);
}

export async function upsertById<T extends Document = Document>(
  collection: string,
  id: number,
  data: Omit<T, "_id">,
): Promise<void> {
  const col = await getCollection(collection);
  const { _id: _ignored, ...rest } = data as T & { _id?: unknown };
  await col.updateOne(
    { id },
    { $set: { ...rest, id } },
    { upsert: true },
  );
}
