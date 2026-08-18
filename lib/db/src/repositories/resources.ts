import { ObjectId } from "mongodb";
import { getCollection, getUploadsBucket } from "../mongo";
import { nextId } from "../counters";
import { readGridFs, writeGridFs } from "./media";
import { toApiDoc, toApiDocs } from "./generic";

export type ResourceDepartment = "staff" | "dps" | "dph";

export type ResourceDoc = {
  id: number;
  department: ResourceDepartment;
  title: string;
  description?: string;
  type?: string;
  content?: string;
  header_config?: string;
  logo_url?: string;
  file_name?: string | null;
  mime_type?: string | null;
  size?: number | null;
  gridFsId?: ObjectId | null;
  division_id?: number | null;
  division_only?: boolean | null;
  allowed_ranks?: string | null;
  personnel_only?: boolean | null;
  allowed_dps_ranks?: string | null;
  allowed_dph_ranks?: string | null;
  created_by?: string | null;
  sort_order?: number | null;
  google_file_id?: string | null;
  google_integration_id?: number | null;
  google_modified_time?: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
};

function collectionFor(_department: ResourceDepartment): string {
  // Unified collection with department discriminator (API still filters by department).
  return "resources";
}

export async function listResources(department: ResourceDepartment): Promise<Array<Omit<ResourceDoc, "_id">>> {
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  const docs = await col
    .find({ department, deleted_at: null })
    .sort({ sort_order: 1, created_at: -1 })
    .toArray();
  return toApiDocs(docs);
}

export async function getResource(department: ResourceDepartment, id: number): Promise<Omit<ResourceDoc, "_id"> | null> {
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  return toApiDoc(await col.findOne({ department, id, deleted_at: null }));
}

export async function saveResourceFile(
  department: ResourceDepartment,
  id: number,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<void> {
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  const existing = await col.findOne({ department, id });
  const bucket = await getUploadsBucket();
  if (existing?.gridFsId) {
    try { await bucket.delete(existing.gridFsId); } catch { /* ignore */ }
  }
  const gridFsId = await writeGridFs(bucket, `${department}-resource-${id}`, buffer, {
    contentType: mimeType,
    metadata: { kind: "resource", department, resourceId: id, fileName },
  });
  await col.updateOne(
    { department, id },
    {
      $set: {
        file_name: fileName,
        mime_type: mimeType,
        size: buffer.length,
        gridFsId,
        updated_at: new Date().toISOString(),
      },
    },
  );
}

export async function getResourceFile(
  department: ResourceDepartment,
  id: number,
): Promise<{ data: Buffer; mime_type: string; file_name: string } | null> {
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  const doc = await col.findOne({ department, id, deleted_at: null });
  if (!doc?.gridFsId) return null;
  const bucket = await getUploadsBucket();
  const data = await readGridFs(bucket, doc.gridFsId);
  if (!data) return null;
  return {
    data,
    mime_type: doc.mime_type || "application/pdf",
    file_name: doc.file_name || `resource-${id}.pdf`,
  };
}

export async function insertResource(
  department: ResourceDepartment,
  data: Partial<ResourceDoc>,
): Promise<Omit<ResourceDoc, "_id">> {
  const id = data.id ?? await nextId(`resources_${department}`);
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  const doc: ResourceDoc = {
    title: "",
    ...data,
    id,
    department,
    created_at: data.created_at ?? new Date().toISOString(),
    deleted_at: data.deleted_at ?? null,
  };
  await col.insertOne(doc as ResourceDoc);
  return toApiDoc(doc)!;
}

export async function updateResource(
  department: ResourceDepartment,
  id: number,
  patch: Partial<ResourceDoc>,
): Promise<Omit<ResourceDoc, "_id"> | null> {
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  const { id: _b, department: _c, ...safe } = patch as Partial<ResourceDoc> & { _id?: unknown };
  const result = await col.findOneAndUpdate(
    { department, id },
    { $set: { ...safe, updated_at: new Date().toISOString() } },
    { returnDocument: "after" },
  );
  return toApiDoc(result);
}

export async function softDeleteResource(department: ResourceDepartment, id: number): Promise<boolean> {
  const col = await getCollection<ResourceDoc>(collectionFor(department));
  const result = await col.updateOne(
    { department, id },
    { $set: { deleted_at: new Date().toISOString() } },
  );
  return result.modifiedCount > 0;
}

export async function upsertResourceMigration(doc: ResourceDoc): Promise<void> {
  const col = await getCollection<ResourceDoc>("resources");
  await col.updateOne({ department: doc.department, id: doc.id }, { $set: doc }, { upsert: true });
}
