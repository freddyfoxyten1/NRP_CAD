import { getCollection } from "../mongo";
import { nextId } from "../counters";
import { toApiDoc } from "./generic";

export type GoogleIntegrationDoc = {
  id: number;
  created_by: string | null;
  email: string;
  google_user_id: string;
  refresh_token: string;
  access_token: string;
  token_expiry: string;
  created_at: string;
  updated_at?: string;
};

const COLLECTION = "google_integrations";

export function publicGoogleIntegration(doc: Omit<GoogleIntegrationDoc, "_id"> | null) {
  if (!doc) return null;
  return {
    id: doc.id,
    email: doc.email,
    google_user_id: doc.google_user_id,
    created_by: doc.created_by,
    created_at: doc.created_at,
    updated_at: doc.updated_at ?? null,
  };
}

export async function getGoogleIntegration(id: number): Promise<Omit<GoogleIntegrationDoc, "_id"> | null> {
  const col = await getCollection<GoogleIntegrationDoc>(COLLECTION);
  return toApiDoc(await col.findOne({ id }));
}

export async function upsertGoogleIntegration(data: {
  created_by?: string | null;
  email: string;
  google_user_id: string;
  refresh_token?: string | null;
  access_token: string;
  token_expiry: string;
}): Promise<Omit<GoogleIntegrationDoc, "_id">> {
  const col = await getCollection<GoogleIntegrationDoc>(COLLECTION);
  const existing = await col.findOne({ google_user_id: data.google_user_id });
  const now = new Date().toISOString();
  if (existing) {
    const refresh = data.refresh_token?.trim() || existing.refresh_token;
    const result = await col.findOneAndUpdate(
      { id: existing.id },
      {
        $set: {
          email: data.email,
          created_by: data.created_by ?? existing.created_by,
          refresh_token: refresh,
          access_token: data.access_token,
          token_expiry: data.token_expiry,
          updated_at: now,
        },
      },
      { returnDocument: "after" },
    );
    return toApiDoc(result)!;
  }

  const id = await nextId("google_integrations");
  const doc: GoogleIntegrationDoc = {
    id,
    created_by: data.created_by ?? null,
    email: data.email,
    google_user_id: data.google_user_id,
    refresh_token: data.refresh_token ?? "",
    access_token: data.access_token,
    token_expiry: data.token_expiry,
    created_at: now,
    updated_at: now,
  };
  await col.insertOne(doc as GoogleIntegrationDoc);
  return toApiDoc(doc)!;
}

export async function updateGoogleIntegrationTokens(
  id: number,
  patch: { access_token: string; token_expiry: string; refresh_token?: string },
): Promise<Omit<GoogleIntegrationDoc, "_id"> | null> {
  const col = await getCollection<GoogleIntegrationDoc>(COLLECTION);
  const result = await col.findOneAndUpdate(
    { id },
    { $set: { ...patch, updated_at: new Date().toISOString() } },
    { returnDocument: "after" },
  );
  return toApiDoc(result);
}
