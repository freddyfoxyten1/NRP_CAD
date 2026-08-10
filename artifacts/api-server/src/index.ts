// index.ts  -  API server entry point
//
// Starts the HTTP server on API_PORT (fallback PORT, default 8080).
// The Express app itself (middleware, routes) is configured in app.ts.
import "./bootstrap-env";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env.API_PORT ?? process.env.PORT ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

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
});
