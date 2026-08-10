import { getCollection } from "../mongo";

export type SettingDoc = {
  key: string;
  value: string;
  updated_at: string;
};

export async function getSetting(key: string): Promise<string | null> {
  const col = await getCollection<SettingDoc>("settings");
  const doc = await col.findOne({ key });
  return doc?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const col = await getCollection<SettingDoc>("settings");
  await col.updateOne(
    { key },
    { $set: { key, value, updated_at: new Date().toISOString() } },
    { upsert: true },
  );
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const col = await getCollection<SettingDoc>("settings");
  const docs = await col.find({ key: { $in: keys } }).toArray();
  const out: Record<string, string> = {};
  for (const d of docs) out[d.key] = d.value;
  return out;
}

export async function ensureDefaultSettings(): Promise<void> {
  const col = await getCollection<SettingDoc>("settings");
  const defaults: Array<[string, string]> = [
    ["cad_online", "true"],
    ["cad_mode", "online"],
    ["self_dispatch", "false"],
  ];
  for (const [key, value] of defaults) {
    await col.updateOne(
      { key },
      { $setOnInsert: { key, value, updated_at: new Date().toISOString() } },
      { upsert: true },
    );
  }
}
