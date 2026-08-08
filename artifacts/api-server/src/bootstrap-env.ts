import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function findEnvFile(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function applyEnvFile(envPath: string): void {
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
}

const startDir = dirname(fileURLToPath(import.meta.url));
const envPath = findEnvFile(startDir);

if (!envPath) {
  process.env.__DOJCAD_ENV_LOADED__ = "missing";
} else {
  applyEnvFile(envPath);
  process.env.__DOJCAD_ENV_LOADED__ = envPath;
}