import { getCollection } from "../mongo";
import { nextId } from "../counters";
import { toApiDocs } from "./generic";

export type AuditLogDoc = {
  id: number;
  category: string;
  actor: string;
  action: string;
  details: string | null;
  created_at: string;
};

export async function writeAuditLog(
  category: string,
  actor: string,
  action: string,
  details?: string,
): Promise<void> {
  try {
    const id = await nextId("audit_logs");
    const col = await getCollection<AuditLogDoc>("audit_logs");
    await col.insertOne({
      id,
      category,
      actor: actor || "Admin",
      action,
      details: details ?? null,
      created_at: new Date().toISOString(),
    } as AuditLogDoc);
  } catch {
    /* never let logging break the main request */
  }
}

export async function listAuditLogs(category?: string | null, limit = 200): Promise<Array<Omit<AuditLogDoc, "_id">>> {
  const col = await getCollection<AuditLogDoc>("audit_logs");
  const filter = category ? { category } : {};
  const docs = await col.find(filter).sort({ created_at: -1 }).limit(limit).toArray();
  return toApiDocs(docs);
}

export async function upsertAuditMigration(doc: AuditLogDoc): Promise<void> {
  const col = await getCollection<AuditLogDoc>("audit_logs");
  await col.updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
}
