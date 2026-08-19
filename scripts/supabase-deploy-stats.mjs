/**
 * Deploy the public-stats Supabase Edge Function (Discord member/online counts).
 *
 * Requires in .env:
 *   SUPABASE_ACCESS_TOKEN — Supabase dashboard → Account → Access Tokens
 *
 * After deploy, set function secrets in Supabase (Project Settings → Edge Functions):
 *   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID=1539452857592324116
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import("./load-env.mjs");

const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (!token) {
  console.error(
    [
      "SUPABASE_ACCESS_TOKEN is missing from .env",
      "",
      "1. Create a token: https://supabase.com/dashboard/account/tokens",
      "2. Add SUPABASE_ACCESS_TOKEN=... to .env",
      "3. Re-run: bun run supabase:deploy-stats",
      "",
      "Then set function secrets (DISCORD_BOT_TOKEN, DISCORD_GUILD_ID) in:",
      "https://supabase.com/dashboard/project/vmkfcsbbzuzznwauzsxe/functions",
    ].join("\n"),
  );
  process.exit(1);
}

const cli = spawnSync("npx", ["supabase", "--version"], { encoding: "utf8" });
if (cli.error || cli.status !== 0) {
  console.error("Could not run Supabase CLI. Install with: npm i -g supabase");
  process.exit(1);
}

const deploy = spawnSync(
  "npx",
  [
    "supabase",
    "functions",
    "deploy",
    "public-stats",
    "--project-ref",
    "vmkfcsbbzuzznwauzsxe",
    "--no-verify-jwt",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  },
);

if (deploy.status !== 0) process.exit(deploy.status ?? 1);

console.log(
  [
    "",
    "Deployed public-stats.",
    "Test: https://vmkfcsbbzuzznwauzsxe.supabase.co/functions/v1/public-stats",
    "",
    "If counts are zero, add DISCORD_BOT_TOKEN + DISCORD_GUILD_ID as function secrets.",
  ].join("\n"),
);
