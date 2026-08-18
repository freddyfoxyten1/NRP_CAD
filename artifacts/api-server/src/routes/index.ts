// ─────────────────────────────────────────────────────────────────────────────
// routes/index.ts  —  Route registry
//
// Imports every domain router and mounts it at its base path.
// app.ts imports this single file — add new route files here rather than
// touching app.ts.  See src/README.md for the full route-path table.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cadProfilesRouter from "./cad-profiles";
import cadAuthRouter from "./cad-auth";
import adminRouter from "./admin";
import statsRouter from "./stats";
import announcementsRouter from "./announcements";
import settingsRouter from "./settings";
import portalRouter from "./portal";
import civilianRouter from "./civilian";
import { phoneRouter } from "./phone";
import rosterRouter from "./roster";
import staffRouter from "./staff";
import staffResourcesRouter from "./staff-resources";
import moderationsRouter from "./moderations";
import discordRouter from "./discord";
import unitsRouter from "./units";
import erlcRouter from "./erlc";
import reportsRouter from "./reports";
import cadCallsRouter from "./cad-calls";
import docRouter from "./doc";
import dphRouter from "./dph";
import dphDivisionsRouter from "./dph-divisions";
import dphResourcesRouter from "./dph-resources";
import resourcesRouter from "./resources";
import resourceFilesRouter from "./resource-files";
import googleRouter from "./google";
import googleResourcesRouter from "./google-resources";
import imageUploadRouter from "./image-upload";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cadProfilesRouter);
router.use(cadAuthRouter);
router.use(adminRouter);
router.use(statsRouter);
router.use(announcementsRouter);
router.use(settingsRouter);
router.use(portalRouter);
router.use(civilianRouter);
router.use(phoneRouter);
router.use(rosterRouter);
router.use(staffResourcesRouter);
router.use(staffRouter);
router.use(moderationsRouter);
router.use(discordRouter);
router.use(unitsRouter);
router.use(erlcRouter);
router.use(reportsRouter);
router.use(cadCallsRouter);
router.use(docRouter);
// Division / resource sub-routers first so their /dph/<segment>/... paths are
// matched before dphRouter's single-segment /dph/:id handlers.
router.use(dphDivisionsRouter);
router.use(googleResourcesRouter);
router.use(googleRouter);
router.use(dphResourcesRouter);
router.use(dphRouter);
router.use(resourcesRouter);
router.use(resourceFilesRouter);
router.use(imageUploadRouter);
router.use(publicRouter);

export default router;
