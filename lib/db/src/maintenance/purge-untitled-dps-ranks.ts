/**
 * Permanently remove DPS ranks that do not belong to a title group, plus every
 * roster member sitting on one of them.
 *
 * The SQL→Mongo migration lost the dps_ranks.group_id links and duplicated some
 * rank docs. Ranks with no title never appear on the roster, so this clears them
 * out along with their members.
 *
 * A rank NAME is kept when any doc with that name points at a real title group —
 * members link to ranks by name, and duplicate docs carry different fields.
 *
 * Dry run:  bun run --cwd ./lib/db purge:untitled-dps-ranks
 * Apply:    bun run --cwd ./lib/db purge:untitled-dps-ranks -- --apply
 * Add --verbose to list each affected member instead of per-rank counts.
 */
process.env.DATA_STORE = "mongo";

import { closeMongo, connectMongo, getCollection } from "../mongo";

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

function normalizeGroupId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rankKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

async function main(): Promise<void> {
  await connectMongo();

  const groupsCol = await getCollection("dps_rank_groups");
  const ranksCol = await getCollection("dps_ranks");
  const usersCol = await getCollection("dps_users");
  const profilesCol = await getCollection("users");
  const userDivisionsCol = await getCollection("dps_user_divisions");
  const rankCallsignsCol = await getCollection("dps_rank_custom_callsigns");

  const groupIds = new Set(
    (await groupsCol.find({}).toArray())
      .map(g => normalizeGroupId(g.id))
      .filter((id): id is number => id != null),
  );

  const rankDocs = await ranksCol.find({}).toArray();

  // Names that still sit under a real title group are keepers, duplicates included.
  const titledNames = new Set<string>();
  for (const doc of rankDocs) {
    const gid = normalizeGroupId(doc.group_id);
    if (gid != null && groupIds.has(gid)) titledNames.add(rankKey(doc.name));
  }

  const doomedRanks = rankDocs.filter(d => !titledNames.has(rankKey(d.name)));
  const doomedRankIds = doomedRanks
    .map(d => normalizeGroupId(d.id))
    .filter((id): id is number => id != null);

  // Anything not on a titled rank goes: untitled ranks and ranks deleted long ago.
  const memberDocs = await usersCol.find({}).toArray();
  const doomedMembers = memberDocs.filter(m => !titledNames.has(rankKey(m.dps_rank)));

  console.log(`titles: ${groupIds.size}`);
  console.log(`ranks: ${rankDocs.length} total, ${titledNames.size} kept by name, ${doomedRanks.length} docs to delete`);
  for (const d of doomedRanks) console.log(`  - rank id=${d.id} '${d.name}'`);

  console.log(`\nmembers: ${memberDocs.length} total, ${doomedMembers.length} to remove`);
  if (VERBOSE) {
    for (const m of doomedMembers) {
      console.log(`  - profile_id=${m.profile_id} '${m.username}' rank='${m.dps_rank ?? ""}'`);
    }
  } else {
    const perRank = new Map<string, number>();
    for (const m of doomedMembers) {
      const label = String(m.dps_rank ?? "").trim() || "(blank)";
      perRank.set(label, (perRank.get(label) ?? 0) + 1);
    }
    for (const [label, count] of [...perRank].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${count} on '${label}'`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply to delete.`);
    return;
  }

  // Mirrors DELETE /roster/:id — MANUAL accounts exist only for the roster, so the
  // whole profile goes; real accounts keep their profile and lose DPS membership.
  let removedProfiles = 0;
  let removedRosterRows = 0;
  for (const member of doomedMembers) {
    const profileId = normalizeGroupId(member.profile_id);
    if (profileId == null) continue;

    const profile = await profilesCol.findOne({ id: profileId });
    if (profile && String(profile.community_code ?? "") === "MANUAL") {
      await profilesCol.deleteOne({ id: profileId });
      removedProfiles += 1;
    }
    await usersCol.deleteOne({ profile_id: profileId });
    await userDivisionsCol.deleteMany({ profile_id: profileId });
    removedRosterRows += 1;
  }

  const callsigns = doomedRankIds.length
    ? await rankCallsignsCol.deleteMany({ rank_id: { $in: doomedRankIds } })
    : { deletedCount: 0 };
  const ranksDeleted = doomedRankIds.length
    ? await ranksCol.deleteMany({ id: { $in: doomedRankIds } })
    : { deletedCount: 0 };

  console.log(`\nAPPLIED`);
  console.log(`  roster rows removed:     ${removedRosterRows}`);
  console.log(`  manual profiles deleted: ${removedProfiles}`);
  console.log(`  rank docs deleted:       ${ranksDeleted.deletedCount}`);
  console.log(`  rank callsigns deleted:  ${callsigns.deletedCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
