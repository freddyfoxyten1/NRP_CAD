import type { Filter } from "mongodb";
import { getCollection } from "../mongo";
import { nextId } from "../counters";
import { toApiDoc, toApiDocs } from "./generic";
import { invalidateMemberCaches } from "../cache/members-cache";

export type UserDoc = {
  id: number;
  auth_user_id?: string | null;
  username: string;
  discord_username?: string | null;
  discord_id?: string | null;
  email?: string | null;
  community_code?: string | null;
  status?: string | null;
  rank?: string | null;
  role?: string | null;
  dps_rank?: string | null;
  dps_role?: string | null;
  staff_rank?: string | null;
  staff_role?: string | null;
  callsign?: string | null;
  password_salt?: string | null;
  password_hash?: string | null;
  whitelisted?: boolean | null;
  avatar_hash?: string | null;
  can_access_iab?: boolean | null;
  can_access_system_logs?: boolean | null;
  can_access_terms_privacy?: boolean | null;
  can_access_terminal_offline?: boolean | null;
  staff_appointed_date?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Public-safe member summary (never includes password fields). */
export type MemberSummary = {
  id: number;
  auth_user_id: string | null;
  username: string;
  discord_username: string | null;
  discord_id: string | null;
  email: string | null;
  community_code: string | null;
  status: string | null;
  rank: string | null;
  role: string | null;
  dps_rank: string | null;
  dps_role: string | null;
  staff_rank: string | null;
  staff_role: string | null;
  whitelisted: boolean | null;
  avatar_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const SUMMARY_PROJECTION = {
  _id: 0,
  id: 1,
  auth_user_id: 1,
  username: 1,
  discord_username: 1,
  discord_id: 1,
  email: 1,
  community_code: 1,
  status: 1,
  rank: 1,
  role: 1,
  dps_rank: 1,
  dps_role: 1,
  staff_rank: 1,
  staff_role: 1,
  whitelisted: 1,
  avatar_hash: 1,
  created_at: 1,
  updated_at: 1,
} as const;

function stripSecrets<T extends UserDoc>(doc: T): Omit<T, "password_hash" | "password_salt"> {
  const { password_hash: _h, password_salt: _s, ...rest } = doc;
  return rest;
}

export async function getUserById(id: number): Promise<Omit<UserDoc, "_id"> | null> {
  const col = await getCollection<UserDoc>("users");
  return toApiDoc(await col.findOne({ id }));
}

export async function getUserByEmail(email: string): Promise<Omit<UserDoc, "_id"> | null> {
  const col = await getCollection<UserDoc>("users");
  return toApiDoc(await col.findOne({ email }));
}

export async function getUserByDiscordId(discordId: string): Promise<Omit<UserDoc, "_id"> | null> {
  const col = await getCollection<UserDoc>("users");
  return toApiDoc(await col.findOne({ discord_id: discordId }));
}

export async function getUserByUsername(username: string): Promise<Omit<UserDoc, "_id"> | null> {
  const col = await getCollection<UserDoc>("users");
  const needle = username.trim().toLowerCase();
  // Case-insensitive exact match
  return toApiDoc(
    await col.findOne({ username: { $regex: `^${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }),
  );
}

/** Merge DPS roster ranks onto a user profile (mirrors SQL LEFT JOIN dps_users). */
export async function withDpsRanks(
  user: Omit<UserDoc, "_id">,
): Promise<Omit<UserDoc, "_id"> & { dps_rank: string | null; dps_role: string | null }> {
  const dpsCol = await getCollection<{ profile_id: number; dps_rank?: string | null; dps_role?: string | null }>("dps_users");
  const dps = await dpsCol.findOne({ profile_id: user.id });
  const dpsRank = (dps?.dps_rank && String(dps.dps_rank).trim()) || user.dps_rank || null;
  const dpsRole = (dps?.dps_role && String(dps.dps_role).trim()) || user.dps_role || null;
  return { ...user, dps_rank: dpsRank, dps_role: dpsRole };
}

export async function insertUser(data: Partial<UserDoc> & { username: string }): Promise<Omit<UserDoc, "_id">> {
  const id = data.id ?? await nextId("users");
  const col = await getCollection<UserDoc>("users");
  const now = new Date().toISOString();
  const doc: UserDoc = {
    status: "active",
    ...data,
    id,
    username: data.username,
    created_at: data.created_at ?? now,
    updated_at: data.updated_at ?? now,
  };
  await col.insertOne(doc as UserDoc);
  await invalidateMemberCaches(id);
  return toApiDoc(doc)!;
}

export async function updateUser(id: number, patch: Partial<UserDoc>): Promise<Omit<UserDoc, "_id"> | null> {
  const col = await getCollection<UserDoc>("users");
  const { id: _b, ...safe } = patch;
  const result = await col.findOneAndUpdate(
    { id },
    { $set: { ...safe, updated_at: new Date().toISOString() } },
    { returnDocument: "after" },
  );
  await invalidateMemberCaches(id);
  return toApiDoc(result);
}

export async function deleteUser(id: number): Promise<boolean> {
  const col = await getCollection<UserDoc>("users");
  const result = await col.deleteOne({ id });
  await invalidateMemberCaches(id);
  return result.deletedCount > 0;
}

export async function listMemberSummaries(opts: {
  page?: number;
  limit?: number;
  q?: string;
}): Promise<{ items: MemberSummary[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts.page ?? 1);
  // Paginated UI caps at 100; `all=1` tooling may request up to 10k summaries.
  const limit = Math.min(10_000, Math.max(1, opts.limit ?? 25));
  const skip = (page - 1) * limit;
  const col = await getCollection<UserDoc>("users");

  const filter: Filter<UserDoc> = {};
  const q = opts.q?.trim();
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { username: re },
      { discord_username: re },
      { discord_id: re },
      { email: re },
      { staff_rank: re },
      { rank: re },
    ];
  }

  const [total, docs] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter, { projection: SUMMARY_PROJECTION })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
  ]);

  return {
    items: docs as unknown as MemberSummary[],
    total,
    page,
    limit,
  };
}

export async function listAllMemberIdDiscordMap(): Promise<Array<{ id: number; discord_id: string | null; discord_username: string | null; username: string; staff_rank: string | null; rank: string | null }>> {
  const col = await getCollection<UserDoc>("users");
  const docs = await col.find({}, {
    projection: {
      _id: 0, id: 1, discord_id: 1, discord_username: 1, username: 1, staff_rank: 1, rank: 1,
    },
  }).toArray();
  return docs as Array<{ id: number; discord_id: string | null; discord_username: string | null; username: string; staff_rank: string | null; rank: string | null }>;
}

export async function upsertUserMigration(doc: UserDoc): Promise<void> {
  const col = await getCollection<UserDoc>("users");
  await col.updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
}

export { stripSecrets };
