import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const commit = gitCommit();
const info = {
  commit,
  short: commit.slice(0, 7),
  builtAt: new Date().toISOString(),
};

const targets = [
  path.join(root, "artifacts", "api-server", "dist", "build-info.json"),
  path.join(root, "artifacts", "dojrp", "dist", "public", "build-info.json"),
];

for (const file of targets) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`, "utf8");
}

console.info(`[build-info] ${info.short} @ ${info.builtAt}`);
