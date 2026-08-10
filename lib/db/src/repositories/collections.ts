/**
 * Thin typed helpers for roster / CAD collections that largely map 1:1 from SQL.
 * Routes should prefer these over raw pool.query when DATA_STORE=mongo.
 */
import type { Filter, Document, Sort } from "mongodb";
import {
  countDocs,
  deleteById,
  findByNumericId,
  findMany,
  insertWithId,
  updateById,
  upsertById,
} from "./generic";

export async function repoFindById<T extends Document>(collection: string, id: number) {
  return findByNumericId<T>(collection, id);
}

export async function repoFindMany<T extends Document>(
  collection: string,
  filter: Filter<T> = {},
  opts: { sort?: Sort; limit?: number; skip?: number } = {},
) {
  return findMany<T>(collection, filter, opts);
}

export async function repoInsert<T extends Document>(
  collection: string,
  data: Omit<T, "_id" | "id"> & { id?: number },
) {
  return insertWithId<T>(collection, collection, data);
}

export async function repoUpdate<T extends Document>(
  collection: string,
  id: number,
  patch: Partial<T>,
) {
  return updateById<T>(collection, id, patch);
}

export async function repoDelete(collection: string, id: number) {
  return deleteById(collection, id);
}

export async function repoUpsert<T extends Document>(
  collection: string,
  id: number,
  data: Omit<T, "_id">,
) {
  return upsertById<T>(collection, id, data);
}

export async function repoCount(collection: string, filter: Filter<Document> = {}) {
  return countDocs(collection, filter);
}

export async function repoFindOne<T extends Document>(
  collection: string,
  filter: Filter<Document>,
) {
  const rows = await findMany<T>(collection, filter, { limit: 1 });
  return rows[0] ?? null;
}
