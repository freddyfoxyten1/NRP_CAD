/**
 * Purge all DPH title groups, ranks, and roster members via the live API.
 * Uses PREVIEW_API_URL or https://cad.dojrblx.com by default.
 *
 * Dry run:  bun ./scripts/purge-dph-roster-api.mjs
 * Apply:    bun ./scripts/purge-dph-roster-api.mjs --apply
 */
const BASE = (process.env.PREVIEW_API_URL ?? "https://cad.dojrblx.com").replace(/\/$/, "");
const APPLY = process.argv.includes("--apply");

async function getJson(path) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { accept: "application/json" } });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error ?? `${path} failed (${res.status})`);
  }
  return data;
}

async function del(path) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "DELETE",
    headers: { accept: "application/json", "x-actor": "DPH roster purge" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `DELETE ${path} failed (${res.status})`);
  }
}

const members = await getJson("/dph?all=1");
const ranks = await getJson("/dph/ranks");
const groups = await getJson("/dph/groups");

console.log(`API: ${BASE}`);
console.log(`members: ${members.length}, ranks: ${ranks.length}, title groups: ${groups.length}`);

if (!APPLY) {
  console.log("\nDRY RUN — re-run with --apply to delete.");
  process.exit(0);
}

for (const member of members) {
  await del(`/dph/${member.id}`);
  console.log(`removed member id=${member.id}`);
}

for (const rank of ranks) {
  await del(`/dph/ranks/${rank.id}`);
  console.log(`removed rank id=${rank.id} '${rank.name}'`);
}

for (const group of groups) {
  await del(`/dph/groups/${group.id}`);
  console.log(`removed title group id=${group.id} '${group.name}'`);
}

const after = {
  members: (await getJson("/dph?all=1")).length,
  ranks: (await getJson("/dph/ranks")).length,
  groups: (await getJson("/dph/groups")).length,
};
console.log("\nDone.", after);
