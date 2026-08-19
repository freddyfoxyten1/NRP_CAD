// ─────────────────────────────────────────────────────────────────────────────
// routes/resource-files.ts  —  File-based department resources (PDF / DOCX)
//
// POST /resources/upload    — multipart upload of a .pdf or .docx.
//                             DOCX files are converted to PDF locally via
//                             LibreOffice; only the final PDF is stored.
// GET  /resources/:id/file  — serves the stored PDF inline.
//
// Pipeline: upload → validate (extension + magic bytes + size) → detect type
//           → convert if DOCX → validate generated PDF → store → respond.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import multer from "multer";
import { pool, isMongoStore, resourcesRepo } from "@workspace/db";
import { ConversionError, convertDocxToPdf, isDocx, isLegacyDoc, isPdf } from "../lib/docx-to-pdf";
import { tryServeGoogleDocFile } from "../lib/google-doc-resource";

const router = Router();

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

// NOTE: the file_data column migration lives in routes/resources.ts, in the
// same ordered migration block that creates the dps_resources table.

// ── POST /resources/upload ────────────────────────────────────────────────────
router.post("/resources/upload", (req, res) => {
  upload.single("file")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      const tooBig = multerErr instanceof multer.MulterError && multerErr.code === "LIMIT_FILE_SIZE";
      req.log.warn({ err: multerErr }, "resource upload rejected by multer");
      res.status(tooBig ? 413 : 400).json({
        error: tooBig ? "File is too large. The maximum size is 20 MB." : "Invalid upload request.",
      });
      return;
    }

    const file = req.file;
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const createdBy = typeof req.body.created_by === "string" ? req.body.created_by : null;

    if (!file) { res.status(400).json({ error: "A file is required." }); return; }
    if (!title) { res.status(400).json({ error: "Title is required." }); return; }

    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    req.log.info({ name: file.originalname, size: file.size, ext }, "resource upload started");

    if (file.size === 0) {
      res.status(400).json({ error: "The uploaded file is empty." });
      return;
    }

    let pdf: Buffer;

    try {
      // Never trust the extension alone — sniff the real content.
      if (ext === "pdf" && isPdf(file.buffer)) {
        pdf = file.buffer;
      } else if (ext === "docx" && isDocx(file.buffer)) {
        const startedAt = Date.now();
        req.log.info({ name: file.originalname }, "docx conversion started");
        pdf = await convertDocxToPdf(file.buffer);
        req.log.info(
          { name: file.originalname, durationMs: Date.now() - startedAt, pdfBytes: pdf.length },
          "docx conversion completed",
        );
      } else if (isLegacyDoc(file.buffer)) {
        res.status(400).json({ error: "Legacy .doc files are not supported. Please save the document as .docx and try again." });
        return;
      } else {
        req.log.warn({ name: file.originalname, ext }, "resource upload validation failed");
        res.status(400).json({ error: "Unsupported file type. Only PDF (.pdf) and Word (.docx) files are accepted." });
        return;
      }
    } catch (err) {
      req.log.error({ err, name: file.originalname }, "docx conversion error");
      const msg = err instanceof ConversionError ? err.message : "Failed to process the document. Please try again.";
      res.status(422).json({ error: msg });
      return;
    }

    try {
      const divisionIdRaw = typeof req.body.division_id === "string" ? req.body.division_id.trim() : "";
      const divisionIdParsed = divisionIdRaw ? parseInt(divisionIdRaw, 10) : NaN;
      const divisionId = Number.isInteger(divisionIdParsed) && divisionIdParsed > 0 ? divisionIdParsed : null;
      const divisionOnlyRaw = typeof req.body.division_only === "string" ? req.body.division_only.trim() : "";
      const divisionOnly = divisionId != null && (divisionOnlyRaw === "1" || divisionOnlyRaw.toLowerCase() === "true");
      let allowedRanks: string[] = [];
      if (typeof req.body.allowed_ranks === "string" && req.body.allowed_ranks.trim()) {
        try {
          const parsed = JSON.parse(req.body.allowed_ranks) as unknown;
          if (Array.isArray(parsed)) allowedRanks = parsed.map(String).map(s => s.trim()).filter(Boolean);
        } catch { /* ignore */ }
      }
      const personnelOnlyRaw = typeof req.body.personnel_only === "string" ? req.body.personnel_only.trim() : "";
      let allowedDpsRanks: string[] = [];
      if (typeof req.body.allowed_dps_ranks === "string" && req.body.allowed_dps_ranks.trim()) {
        try {
          const parsed = JSON.parse(req.body.allowed_dps_ranks) as unknown;
          if (Array.isArray(parsed)) allowedDpsRanks = parsed.map(String).map(s => s.trim()).filter(Boolean);
        } catch { /* ignore */ }
      }
      const personnelOnly = divisionId == null
        && (personnelOnlyRaw === "1" || personnelOnlyRaw.toLowerCase() === "true" || allowedDpsRanks.length > 0);
      const savedDpsRanks = divisionId == null ? allowedDpsRanks : [];
      if (isMongoStore()) {
        const row = await resourcesRepo.insertResource("dps", {
          title,
          type: "pdf",
          created_by: createdBy,
          division_id: divisionId,
          division_only: divisionOnly,
          allowed_ranks: JSON.stringify(allowedRanks),
          personnel_only: personnelOnly,
          allowed_dps_ranks: JSON.stringify(savedDpsRanks),
        });
        const resourceId = Number(row.id);
        await resourcesRepo.saveResourceFile("dps", resourceId, pdf, "application/pdf", `${title}.pdf`);
        req.log.info({ id: resourceId, title, divisionId, divisionOnly, personnelOnly }, "resource upload completed");
        res.status(201).json({
          ...row,
          id: resourceId,
          division_only: Boolean(divisionOnly),
          allowed_ranks: allowedRanks,
          personnel_only: Boolean(personnelOnly),
          allowed_dps_ranks: savedDpsRanks,
        });
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO dps_resources
           (title, type, created_by, file_data, division_id, division_only, allowed_ranks, personnel_only, allowed_dps_ranks)
         VALUES ($1, 'pdf', $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, type, logo_url, created_by, created_at, updated_at, division_id,
                   division_only, allowed_ranks, personnel_only, allowed_dps_ranks`,
        [title, createdBy, pdf, divisionId, divisionOnly, JSON.stringify(allowedRanks), personnelOnly, JSON.stringify(savedDpsRanks)],
      );
      req.log.info({ id: rows[0].id, title, divisionId, divisionOnly, personnelOnly }, "resource upload completed");
      const row = rows[0] as Record<string, unknown>;
      const parseRanks = (v: unknown): string[] => {
        if (Array.isArray(v)) return v.map(String);
        if (typeof v === "string") {
          try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
        }
        return [];
      };
      res.status(201).json({
        ...row,
        division_only: Boolean(row.division_only),
        allowed_ranks: parseRanks(row.allowed_ranks),
        personnel_only: Boolean(row.personnel_only),
        allowed_dps_ranks: parseRanks(row.allowed_dps_ranks),
      });
    } catch (e) {
      req.log.error({ err: e }, "resource upload db insert failed");
      res.status(500).json({ error: "Failed to save the resource." });
    }
  });
});

// ── GET /resources/:id/file — serve the stored PDF ───────────────────────────
router.get("/resources/:id/file", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    if (await tryServeGoogleDocFile(req, res, "dps", id)) return;
    if (isMongoStore()) {
      const file = await resourcesRepo.getResourceFile("dps", id);
      if (!file) { res.status(404).json({ error: "File not found." }); return; }
      const meta = await resourcesRepo.getResource("dps", id);
      const safeName = String(meta?.title || "resource").replace(/[^\w\- ]+/g, "").trim() || "resource";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      res.send(file.data);
      return;
    }
    const { rows } = await pool.query(
      `SELECT title, file_data FROM dps_resources WHERE id = $1 AND file_data IS NOT NULL`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "File not found." }); return; }
    const safeName = (rows[0].title as string).replace(/[^\w\- ]+/g, "").trim() || "resource";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
    res.send(rows[0].file_data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch file." });
  }
});

export default router;
