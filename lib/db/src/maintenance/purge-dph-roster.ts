/**
 * Permanently remove every DPH title group, rank, and personnel roster member.
 *
 * Does not touch divisions, division ranks, fleet, equipment, events, or resources.
 *
 * Dry run:  bun run --cwd ./lib/db purge:dph-roster
 * Apply:    bun run --cwd ./lib/db purge:dph-roster -- --apply
 */
process.env.DATA_STORE = "mongo";

import { closeMongo, connectMongo, getCollection } from "../mongo";

const APPLY = process.argv.includes("--apply");

function profileId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  await connectMongo();

  const groupsCol = await getCollection("dph_rank_groups");
  const ranksCol = await getCollection("dph_ranks");
  const usersCol = await getCollection("dph_users");
  const profilesCol = await getCollection("users");
  const userDivisionsCol = await getCollection("dph_user_divisions");
  const rankCallsignsCol = await getCollection("dph_rank_custom_callsigns");

  const [groups, ranks, members, callsigns, divisionLinks] = await Promise.all([
    groupsCol.countDocuments({}),
    ranksCol.countDocuments({}),
    usersCol.countDocuments({}),
    rankCallsignsCol.countDocuments({}),
    userDivisionsCol.countDocuments({}),
  ]);

  console.log("DPH personnel roster purge");
  console.log(`  title groups:        ${groups}`);
  console.log(`  ranks:               ${ranks}`);
  console.log(`  roster members:      ${members}`);
  console.log(`  rank callsigns:      ${callsigns}`);
  console.log(`  division links:      ${divisionLinks}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing changed. Re-run with --apply to delete.");
    return;
  }

  const memberDocs = await usersCol.find({}).toArray();
  let removedProfiles = 0;
  for (const member of memberDocs) {
    const id = profileId(member.profile_id);
    if (id == null) continue;
    const profile = await profilesCol.findOne({ id });
    if (profile && String(profile.community_code ?? "") === "MANUAL") {
      await profilesCol.deleteOne({ id });
      removedProfiles += 1;
    }
  }

  const [callsignRes, divisionRes, userRes, rankRes, groupRes] = await Promise.all([
    rankCallsignsCol.deleteMany({}),
    userDivisionsCol.deleteMany({}),
    usersCol.deleteMany({}),
    ranksCol.deleteMany({}),
    groupsCol.deleteMany({}),
  ]);

  console.log("\nAPPLIED");
  console.log(`  roster rows removed:     ${userRes.deletedCount}`);
  console.log(`  manual profiles deleted: ${removedProfiles}`);
  console.log(`  rank docs deleted:       ${rankRes.deletedCount}`);
  console.log(`  title groups deleted:    ${groupRes.deletedCount}`);
  console.log(`  rank callsigns deleted:  ${callsignRes.deletedCount}`);
  console.log(`  division links deleted:  ${divisionRes.deletedCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
