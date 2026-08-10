import { getCollection } from "./mongo";

type CounterDoc = { _id: string; seq: number };

/** Atomically allocate the next numeric API id for a collection. */
export async function nextId(counterName: string): Promise<number> {
  const counters = await getCollection<CounterDoc>("id_counters");
  const result = await counters.findOneAndUpdate(
    { _id: counterName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const seq = result?.seq;
  if (typeof seq !== "number" || seq < 1) {
    throw new Error(`Failed to allocate id for counter "${counterName}"`);
  }
  return seq;
}

/** Ensure counter is at least `min` (used after ETL from SQL max ids). */
export async function ensureCounterAtLeast(counterName: string, min: number): Promise<void> {
  if (!Number.isFinite(min) || min < 0) return;
  const counters = await getCollection<CounterDoc>("id_counters");
  const existing = await counters.findOne({ _id: counterName });
  const next = Math.max(existing?.seq ?? 0, min);
  await counters.updateOne(
    { _id: counterName },
    { $set: { seq: next } },
    { upsert: true },
  );
}
