import { ObjectId, type GridFSBucket } from "mongodb";
import { getCollection, getUploadsBucket } from "../mongo";
import { nextId } from "../counters";
import { toApiDoc } from "./generic";

export type MediaDoc = {
  id: number;
  mime_type: string;
  filename: string;
  size: number;
  gridFsId: ObjectId;
  created_at: string;
};

export async function saveImage(buffer: Buffer, mimeType: string, originalName = "upload"): Promise<{ id: number; url: string }> {
  const id = await nextId("media");
  const bucket = await getUploadsBucket();
  const filename = `image-${id}`;
  const gridFsId = await writeGridFs(bucket, filename, buffer, {
    contentType: mimeType,
    metadata: { kind: "image", mediaId: id, originalName },
  });

  const col = await getCollection<MediaDoc>("media");
  const created_at = new Date().toISOString();
  await col.insertOne({
    id,
    mime_type: mimeType,
    filename,
    size: buffer.length,
    gridFsId,
    created_at,
  } as MediaDoc);

  return { id, url: `/api/images/${id}` };
}

export async function getImage(id: number): Promise<{ mime_type: string; data: Buffer } | null> {
  const col = await getCollection<MediaDoc>("media");
  const doc = await col.findOne({ id });
  if (!doc) return null;
  const bucket = await getUploadsBucket();
  const data = await readGridFs(bucket, doc.gridFsId);
  if (!data) return null;
  return { mime_type: doc.mime_type, data };
}

export async function deleteImage(id: number): Promise<boolean> {
  const col = await getCollection<MediaDoc>("media");
  const doc = await col.findOne({ id });
  if (!doc) return false;
  const bucket = await getUploadsBucket();
  try {
    await bucket.delete(doc.gridFsId);
  } catch {
    /* file may already be gone */
  }
  await col.deleteOne({ id });
  return true;
}

export async function upsertMediaFromMigration(doc: MediaDoc): Promise<void> {
  const col = await getCollection<MediaDoc>("media");
  await col.updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
}

export async function getMediaMeta(id: number): Promise<Omit<MediaDoc, "_id"> | null> {
  const col = await getCollection<MediaDoc>("media");
  return toApiDoc(await col.findOne({ id }));
}

async function writeGridFs(
  bucket: GridFSBucket,
  filename: string,
  buffer: Buffer,
  options: { contentType: string; metadata?: Record<string, unknown> },
): Promise<ObjectId> {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, {
      contentType: options.contentType,
      metadata: options.metadata,
    });
    stream.on("error", reject);
    stream.on("finish", () => resolve(stream.id as ObjectId));
    stream.end(buffer);
  });
}

async function readGridFs(bucket: GridFSBucket, id: ObjectId): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = bucket.openDownloadStream(id);
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("error", (err) => {
      if ((err as { code?: string }).code === "ENOENT") resolve(null);
      else reject(err);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export { writeGridFs, readGridFs };
