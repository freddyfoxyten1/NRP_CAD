import { rmSync } from 'node:fs';

const userAgent = process.env.npm_config_user_agent ?? '';

// Allow both bun and pnpm to install. Bun is the primary package manager now.
if (!/^(bun|pnpm)\//.test(userAgent)) {
  console.error(`Unsupported package manager. Use bun or pnpm. (got: ${userAgent})`);
  process.exit(1);
}

for (const lockfile of ['package-lock.json', 'yarn.lock']) {
  try {
    rmSync(lockfile);
  } catch {
    // ignore missing lockfiles
  }
}
