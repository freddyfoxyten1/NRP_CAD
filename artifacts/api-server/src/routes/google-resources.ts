import { Router, type Request, type Response, type NextFunction } from "express";
import type { ResourceDepartment } from "@workspace/db";
import { ensureGoogleResourceTables } from "../lib/ensure-google-tables";
import { createGoogleDocResource, sendGoogleAuthError } from "../lib/google-doc-resource";

const router = Router();
const ADMIN_CODE = process.env.ADMIN_PORTAL_CODE ?? "ADMIN2026";

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["x-admin-code"] !== ADMIN_CODE) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
};

function departmentHandler(department: ResourceDepartment) {
  return async (req: Request, res: Response) => {
    const body = req.body as {
      title?: string;
      created_by?: string;
      google_file_id?: string;
      google_url?: string;
      google_integration_id?: number;
      division_id?: number | null;
      division_only?: boolean;
      allowed_ranks?: unknown;
      personnel_only?: boolean;
      allowed_dps_ranks?: unknown;
      allowed_dph_ranks?: unknown;
    };
    try {
      await ensureGoogleResourceTables();
      const created = await createGoogleDocResource({
        department,
        title: body.title,
        created_by: body.created_by ?? null,
        google_file_id: body.google_file_id,
        google_url: body.google_url,
        google_integration_id: body.google_integration_id == null ? null : Number(body.google_integration_id),
        visibility: {
          division_id: body.division_id,
          division_only: body.division_only,
          allowed_ranks: body.allowed_ranks,
          personnel_only: body.personnel_only,
          allowed_dps_ranks: body.allowed_dps_ranks,
          allowed_dph_ranks: body.allowed_dph_ranks,
        },
      });
      res.status(201).json(created);
    } catch (err) {
      sendGoogleAuthError(res, err);
    }
  };
}

router.post("/resources/google", departmentHandler("dps"));
router.post("/dph/resources/google", departmentHandler("dph"));
router.post("/staff/resources/google", requireAdmin, departmentHandler("staff"));

export default router;
