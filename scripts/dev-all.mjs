/**
 * Cross-platform API + web dev launcher.
 * Avoids `cmd1 & cmd2`, which is unreliable on Windows shells.
 */
import { spawn } from "node:child_process";

const children = [
  spawn("bun", ["run", "dev:api"], { stdio: "inherit", shell: true }),
  spawn("bun", ["run", "dev:web"], { stdio: "inherit", shell: true }),
];

let exiting = false;
function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (exiting) return;
    if (signal) shutdown(1);
    else shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
