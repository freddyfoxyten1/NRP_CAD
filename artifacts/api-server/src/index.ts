// index.ts  -  API server entry point
//
// Starts the HTTP server on API_PORT (fallback PORT, default 8080).
// The Express app itself (middleware, routes) is configured in app.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./bootstrap-env";
import { initDataStores, shutdownDataStores, isMongoStore, pingMongo, pingRedis, pool } from "@workspace/db";
import app from "./app";
import { startDiscordGateway, stopDiscordGateway } from "./lib/discord-realtime-sync";
import { logger } from "./lib/logger";

function loadBuildInfo(): { commit: string; short: string; builtAt: string } {
  try {
    const distDir = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(distDir, "build-info.json"), "utf8");
    const parsed = JSON.parse(raw) as { commit?: string; short?: string; builtAt?: string };
    return {
      commit: parsed.commit ?? "unknown",
      short: parsed.short ?? "unknown",
      builtAt: parsed.builtAt ?? "unknown",
    };
  } catch {
    return { commit: "unknown", short: "unknown", builtAt: "unknown" };
  }
}

const rawPort = process.env.API_PORT ?? process.env.PORT ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  app.get("/api/health/db", async (_req, res) => {
    const mongo = isMongoStore() ? await pingMongo() : null;
    const redis = (process.env.REDIS_URL ?? "").trim() ? await pingRedis() : null;
    const production = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
    const postgresUrl = Boolean((process.env.DATABASE_URL ?? "").trim());
    let postgres = false;
    if (!isMongoStore() && postgresUrl) {
      try {
        await pool.query("SELECT 1");
        postgres = true;
      } catch {
        postgres = false;
      }
    }
    const ok = isMongoStore() ? Boolean(mongo) : postgresUrl ? postgres : !production;
    res.status(ok ? 200 : 503).json({
      dataStore: isMongoStore() ? "mongo" : postgresUrl ? "postgres" : "sql",
      mongo,
      postgres,
      redis,
      ok,
    });
  });

  app.get("/api/health/version", (_req, res) => {
    res.json(loadBuildInfo());
  });

  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EADDRINUSE") {
          logger.error(
            { err, port },
            `Port ${port} is already in use. Stop the other API process (or free the port), then run bun dev again.`,
          );
        } else {
          logger.error({ err }, "Error listening on port");
        }
        reject(err);
        return;
      }
      resolve();
    });
  });

  logger.info({ port }, "Server listening");
  startDiscordGateway();

  try {
    const stores = await initDataStores();
    logger.info(
      { dataStore: isMongoStore() ? "mongo" : "sql", mongo: stores.mongo, postgres: stores.postgres, redis: stores.redis },
      "Data stores initialized",
    );
  } catch (err) {
    logger.error(
      { err },
      isMongoStore()
        ? "Failed to initialize MongoDB — production cannot serve roster or CAD data without Atlas"
        : "Failed to initialize data stores",
    );
    if (isMongoStore() && (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
      process.exit(1);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopDiscordGateway();
    void shutdownDataStores().finally(() => process.exit(0));
  });
}

void start().catch((err) => {
  logger.error({ err }, "API startup failed");
  process.exit(1);
});
