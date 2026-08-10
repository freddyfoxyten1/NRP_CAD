import { getCollection } from "../mongo";
import { nextId } from "../counters";
import {
  countDocs,
  findByNumericId,
  findMany,
  softDeleteById,
  toApiDoc,
  toApiDocs,
  updateById,
  upsertById,
} from "./generic";

export type GalleryDoc = {
  id: number;
  title: string;
  caption: string;
  image_url: string;
  sort_order?: number | null;
  created_at: string;
  deleted_at?: string | null;
};

export type PressDoc = {
  id: number;
  title: string;
  content: string;
  author: string;
  source_url: string;
  image_url: string;
  created_at: string;
  deleted_at?: string | null;
};

export type StoreProductDoc = {
  id: number;
  badge_label: string;
  heading: string;
  description: string;
  price: string;
  price_label: string;
  price_icon: string;
  price_icon_url: string;
  footer_text: string;
  button_text: string;
  button_url: string;
  image_url: string;
  sort_order?: number | null;
  created_at: string;
  deleted_at?: string | null;
};

export type AnnouncementDoc = {
  id: number;
  title: string;
  message: string;
  posted_by: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  [key: string]: unknown;
};

export type PortalContentDoc = {
  key: string;
  content: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type ModerationDoc = {
  id: number;
  [key: string]: unknown;
};

// ── Gallery ──────────────────────────────────────────────────────────────────
export async function listGallery() {
  return findMany<GalleryDoc>(
    "gallery",
    { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } as never,
    { sort: { sort_order: 1, created_at: -1 }, limit: 100 },
  );
}

export async function insertGallery(data: { title?: string; caption?: string; image_url: string }) {
  const id = await nextId("gallery");
  const doc: GalleryDoc = {
    id,
    title: data.title?.trim() ?? "",
    caption: data.caption?.trim() ?? "",
    image_url: data.image_url.trim(),
    sort_order: id,
    created_at: new Date().toISOString(),
    deleted_at: null,
  };
  await upsertById("gallery", id, doc);
  return doc;
}

export async function updateGallery(id: number, patch: Partial<GalleryDoc>) {
  return updateById<GalleryDoc>("gallery", id, patch);
}

export async function reorderGallery(ids: number[]) {
  const col = await getCollection<GalleryDoc>("gallery");
  for (let i = 0; i < ids.length; i++) {
    await col.updateOne({ id: ids[i] }, { $set: { sort_order: i + 1 } });
  }
}

export async function deleteGallery(id: number) {
  return softDeleteById("gallery", id);
}

// ── Press ────────────────────────────────────────────────────────────────────
export async function listPress() {
  return findMany<PressDoc>(
    "press",
    { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } as never,
    { sort: { created_at: -1 }, limit: 50 },
  );
}

export async function insertPress(data: Partial<PressDoc> & { title: string }) {
  const id = await nextId("press");
  const doc: PressDoc = {
    id,
    title: data.title.trim(),
    content: data.content?.trim() ?? "",
    author: data.author?.trim() ?? "",
    source_url: data.source_url?.trim() ?? "",
    image_url: data.image_url?.trim() ?? "",
    created_at: new Date().toISOString(),
    deleted_at: null,
  };
  await upsertById("press", id, doc);
  return doc;
}

export async function updatePress(id: number, patch: Partial<PressDoc>) {
  return updateById<PressDoc>("press", id, patch);
}

export async function deletePress(id: number) {
  return softDeleteById("press", id);
}

// ── Store ────────────────────────────────────────────────────────────────────
export async function listStoreProducts() {
  return findMany<StoreProductDoc>(
    "store_products",
    { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } as never,
    { sort: { sort_order: 1, created_at: -1 }, limit: 100 },
  );
}

export async function insertStoreProduct(data: Partial<StoreProductDoc>) {
  const id = await nextId("store_products");
  const doc = {
    badge_label: "",
    heading: "",
    description: "",
    price: "",
    price_label: "",
    price_icon: "robux",
    price_icon_url: "",
    footer_text: "",
    button_text: "",
    button_url: "",
    image_url: "",
    ...data,
    id,
    created_at: data.created_at ?? new Date().toISOString(),
    deleted_at: null,
  } as StoreProductDoc;
  await upsertById("store_products", id, doc);
  return doc;
}

export async function updateStoreProduct(id: number, patch: Partial<StoreProductDoc>) {
  return updateById<StoreProductDoc>("store_products", id, patch);
}

export async function reorderStoreProducts(ids: number[]) {
  const col = await getCollection<StoreProductDoc>("store_products");
  for (let i = 0; i < ids.length; i++) {
    await col.updateOne({ id: ids[i] }, { $set: { sort_order: i + 1 } });
  }
}

export async function deleteStoreProduct(id: number) {
  return softDeleteById("store_products", id);
}

// ── Announcements ────────────────────────────────────────────────────────────
export async function listAnnouncements(limit = 50, includeDeleted = false) {
  const filter = includeDeleted
    ? {}
    : ({ $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] } as never);
  return findMany<AnnouncementDoc>("announcements", filter, { sort: { created_at: -1 }, limit });
}

export async function insertAnnouncement(data: { title: string; message: string; posted_by: string }) {
  const id = await nextId("announcements");
  const doc: AnnouncementDoc = {
    id,
    title: data.title,
    message: data.message,
    posted_by: data.posted_by,
    created_at: new Date().toISOString(),
    deleted_at: null,
    deleted_by: null,
  };
  await upsertById("announcements", id, doc);
  return doc;
}

export async function updateAnnouncement(id: number, patch: Partial<AnnouncementDoc>) {
  return updateById<AnnouncementDoc>("announcements", id, patch);
}

export async function softDeleteAnnouncement(id: number, deleted_by: string) {
  return updateById<AnnouncementDoc>("announcements", id, {
    deleted_at: new Date().toISOString(),
    deleted_by,
  });
}

export async function deleteAnnouncement(id: number) {
  const col = await getCollection("announcements");
  const r = await col.deleteOne({ id });
  return r.deletedCount > 0;
}

// ── Portal content ───────────────────────────────────────────────────────────
export async function getPortalContent(key: string) {
  const col = await getCollection<PortalContentDoc>("portal_content");
  return toApiDoc(await col.findOne({ key }));
}

export async function setPortalContent(key: string, content: string, extra: Record<string, unknown> = {}) {
  const col = await getCollection<PortalContentDoc>("portal_content");
  await col.updateOne(
    { key },
    { $set: { key, content, ...extra, updated_at: new Date().toISOString() } },
    { upsert: true },
  );
}

// ── Moderations ──────────────────────────────────────────────────────────────
export async function listModerations() {
  return findMany<ModerationDoc>("moderations", {}, { sort: { id: -1 } });
}

export async function insertModeration(data: Record<string, unknown>) {
  const id = typeof data.id === "number" ? data.id : await nextId("moderations");
  const doc = { ...data, id } as ModerationDoc;
  await upsertById("moderations", id, doc);
  return doc;
}

export { findByNumericId, countDocs, toApiDocs, upsertById };
