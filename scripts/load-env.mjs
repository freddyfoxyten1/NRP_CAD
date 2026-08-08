import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) {
  process.env.__DOJCAD_ENV_LOADED__ = "missing";
} else {
  const raw = stripBom(readFileSync(envPath, "utf8"));
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = stripBom(trimmed.slice(0, eq).trim());
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const existing = process.env[key];
    if (existing === undefined || existing === "") {
      process.env[key] = value;
    }
  }
  process.env.__DOJCAD_ENV_LOADED__ = envPath;
}