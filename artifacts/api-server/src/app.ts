// ─────────────────────────────────────────────────────────────────────────────
// app.ts  —  Express application setup
//
// Creates and exports the Express app.  Registers all middleware (CORS, JSON
// body parsing, request logging) and mounts every API router from routes/.
// Import this in index.ts to start the server, or in tests to make requests.
// ─────────────────────────────────────────────────────────────────────────────
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use("/api", router);

export default app;
