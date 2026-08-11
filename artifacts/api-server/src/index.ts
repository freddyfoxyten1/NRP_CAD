// index.ts  -  API server entry point
//
// Starts the HTTP server on API_PORT (fallback PORT, default 8080).
// The Express app itself (middleware, routes) is configured in app.ts.
import "./bootstrap-env";
import { initDataStores, shutdownDataStores, isMongoStore, pingMongo, pingRedis } from "@workspace/db";
import app from "./app";
import { startDiscordGateway, stopDiscordGateway } from "./lib/discord-realtime-sync";
import { logger } from "./lib/logger";

const rawPort = process.env.API_PORT ?? process.env.PORT ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  try {
    const stores = await initDataStores();
    logger.info(
      { dataStore: isMongoStore() ? "mongo" : "sql", mongo: stores.mongo, redis: stores.redis },
      "Data stores initialized",
    );
  } catch (err) {
    logger.error({ err }, "Failed to initialize data stores");
    if (isMongoStore()) process.exit(1);
  }

  app.get("/api/health/db", async (_req, res) => {
    const mongo = isMongoStore() ? await pingMongo() : null;
    const redis = (process.env.REDIS_URL ?? "").trim() ? await pingRedis() : null;
    res.json({
      dataStore: isMongoStore() ? "mongo" : "sql",
      mongo,
      redis,
      ok: isMongoStore() ? Boolean(mongo) : true,
    });
  });

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
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startDiscordGateway();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopDiscordGateway();
    void shutdownDataStores().finally(() => process.exit(0));
  });
}

void start();
