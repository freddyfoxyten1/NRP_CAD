import fs from "fs";

const src =
  "C:/Users/fredd/OneDrive/Documents/DOJCAD/artifacts/dojrp/src/pages/DepartmentOfPublicSafety.tsx";
const dst =
  "C:/Users/fredd/OneDrive/Documents/DOJCAD/artifacts/dojrp/src/pages/DepartmentOfPublicHealth.tsx";

let t = fs.readFileSync(src, "utf8");

const pairs = [
  ["DepartmentOfPublicSafety", "DepartmentOfPublicHealth"],
  ["Department of Public Safety", "Department of Public Health"],
  ["Dept. of Public Safety", "Dept. of Public Health"],
  ["/api/roster", "/api/dph"],
  ["/api/resources", "/api/dph/resources"],
  ["allowed_dps_ranks", "allowed_dph_ranks"],
  ["DpsRank", "DphRank"],
  ["DpsGroup", "DphGroup"],
  ["DpsResource", "DphResource"],
  ["DpsEvent", "DphEvent"],
  ["DpsDiscordRole", "DphDiscordRole"],
  ["DpsDivision", "DphDivision"],
  ["dps_rank", "dph_rank"],
  ["dps_role", "dph_role"],
  ["myDpsRank", "myDphRank"],
];

for (const [a, b] of pairs) t = t.split(a).join(b);

t = t.replaceAll("/dps?tab=", "/dph?tab=");
t = t.replaceAll("'/dps'", "'/dph'");
t = t.replaceAll('"/dps"', '"/dph"');
t = t.replaceAll("/dps/internal-affairs", "/dph");

const injectProps = (tag) => {
  const re = new RegExp(`<${tag}(\\s)`, "g");
  t = t.replace(
    re,
    `<${tag} apiBase="/api/dph" resourcesBase="/api/dph/resources"$1`,
  );
};
injectProps("DivisionRosterView");
injectProps("DivisionsInformationView");
injectProps("DivisionPanelSection");

t = t.replace(
  /<DocumentEditor(\s)/g,
  '<DocumentEditor apiBase="/api/dph/resources"$1',
);

fs.writeFileSync(dst, t);
console.log("Wrote", dst);
console.log("bytes", t.length);
console.log("api/dph", (t.match(/\/api\/dph/g) || []).length);
console.log("api/roster leftover", (t.match(/\/api\/roster/g) || []).length);
console.log(
  "DepartmentOfPublicSafety leftover",
  t.includes("DepartmentOfPublicSafety"),
);
