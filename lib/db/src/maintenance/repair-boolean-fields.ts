/**
 * Repair data damaged by the SQL bridge storing boolean literals as strings.
 *
 * parseLiteral only matched uppercase TRUE/FALSE, so SQL written as
 * `SET can_view_all_resources = false` stored the string "false". Every read
 * goes through Boolean(...), and Boolean("false") is true — so revoking a
 * permission silently granted it. The bridge is fixed; this repairs the rows
 * written while it was broken.
 *
 * Also clears DPS fields left on profiles of people no longer on the roster.
 * Sessions fall back to cad_user_profiles.dps_rank when no dps_users row
 * exists, so a removed member keeps reporting their old rank.
 *
 * Dry run:  bun run --cwd ./lib/db repair:boolean-fields
 * Apply:    bun run --cwd ./lib/db repair:boolean-fields -- --apply
 */
process.env.DATA_STORE = "mongo";

import { closeMongo, connectMongo, getCollection } from "../mongo";

const APPLY = process.argv.includes("--apply");

/** Boolean columns per collection, taken from the SQL schema. */
const BOOLEAN_FIELDS: Record<string, string[]> = {
  users: [
    "whitelisted",
    "can_access_iab",
    "can_access_system_logs",
    "can_access_terms_privacy",
    "can_access_terminal_offline",
    "can_access_doc_dps_cad",
  ],
  dps_users: ["can_view_all_resources", "pob", "iab", "hsu", "sru", "fou"],
  dph_users: ["can_view_all_resources", "can_access_iab"],
  dps_user_divisions: ["is_manual", "can_edit_resources", "can_edit_roster", "can_edit_info"],
  dph_user_divisions: ["is_manual", "can_edit_resources", "can_edit_roster", "can_edit_info"],
  dps_rank_groups: ["panel_access", "division_oversight"],
  dph_rank_groups: ["panel_access", "division_oversight"],
  staff_rank_groups: ["staff_access", "admin_access", "doc_access", "locked"],
  dps_events: ["is_public"],
};

/** "false"/"FALSE" → false, "true" → true. Anything else is left alone. */
function coerce(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "false") return false;
  if (v === "true") return true;
  return undefined;
}

async function repairBooleans(): Promise<number> {
  let totalFields = 0;

  for (const [collection, fields] of Object.entries(BOOLEAN_FIELDS)) {
    const col = await getCollection(collection);
    const docs = await col.find({}).toArray();
    if (docs.length === 0) continue;

    let docsTouched = 0;
    const perField = new Map<string, number>();

    for (const doc of docs) {
      const patch: Record<string, boolean> = {};
      for (const field of fields) {
        const fixed = coerce(doc[field]);
        if (fixed === undefined) continue;
        patch[field] = fixed;
        perField.set(field, (perField.get(field) ?? 0) + 1);
      }
      if (Object.keys(patch).length === 0) continue;

      docsTouched += 1;
      totalFields += Object.keys(patch).length;
      if (APPLY) await col.updateOne({ _id: doc._id }, { $set: patch });
    }

    if (docsTouched === 0) continue;
    console.log(`${collection}: ${docsTouched}/${docs.length} docs`);
    for (const [field, count] of [...perField].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${field}: ${count}`);
    }
  }

  return totalFields;
}

async function clearOrphanedDpsFields(): Promise<number> {
  const usersCol = await getCollection("users");
  const dpsCol = await getCollection("dps_users");

  const rosterIds = new Set(
    (await dpsCol.find({}).toArray())
      .map(d => Number(d.profile_id))
      .filter(id => Number.isFinite(id)),
  );

  const profiles = await usersCol.find({}).toArray();
  const orphaned = profiles.filter(p => {
    if (rosterIds.has(Number(p.id))) return false;
    return Boolean(p.dps_rank) || Boolean(p.dps_role);
  });

  console.log(`\nprofiles carrying a DPS rank but not on the roster: ${orphaned.length}`);
  for (const p of orphaned.slice(0, 30)) {
    console.log(`  - id=${p.id} '${p.username}' rank='${p.dps_rank ?? ""}'`);
  }
  if (orphaned.length > 30) console.log(`  ... and ${orphaned.length - 30} more`);

  if (APPLY) {
    for (const p of orphaned) {
      await usersCol.updateOne(
        { _id: p._id },
        { $set: { dps_rank: null, dps_role: null, updated_at: new Date().toISOString() } },
      );
    }
  }

  return orphaned.length;
}

async function main(): Promise<void> {
  await connectMongo();

  console.log(`=== string booleans stored by the broken bridge ===`);
  const fields = await repairBooleans();
  if (fields === 0) console.log(`none found`);

  console.log(`\n=== orphaned DPS rank fields on profiles ===`);
  const orphaned = await clearOrphanedDpsFields();

  console.log(`\nboolean fields to fix:   ${fields}`);
  console.log(`profiles to clear:       ${orphaned}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply to write.`);
    return;
  }
  console.log(`\nAPPLIED`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
