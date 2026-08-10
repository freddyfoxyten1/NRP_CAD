// ─────────────────────────────────────────────────────────────────────────────
// routes/image-upload.ts  —  Generic image upload / serve
//
// POST /images/upload  — multipart upload (GridFS when DATA_STORE=mongo).
// GET  /images/:id     — serves the raw image with correct Content-Type.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import multer from "multer";
import { isMongoStore, pool, mediaRepo } from "@workspace/db";

const router = Router();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/x-png": "png",
};

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 6
    && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
    && (buf[4] === 0x39 || buf[4] === 0x37) && buf[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12
    && buf.toString("ascii", 0, 4) === "RIFF"
    && buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function resolveMime(file: Express.Multer.File): string | null {
  const reported = (file.mimetype || "").toLowerCase().trim();
  if (ALLOWED_MIME[reported]) {
    return reported === "image/jpg" || reported === "image/pjpeg"
      ? "image/jpeg"
      : reported === "image/x-png"
        ? "image/png"
        : reported;
  }
  if (!reported || reported === "application/octet-stream" || reported === "binary/octet-stream") {
    return sniffImageMime(file.buffer);
  }
  return sniffImageMime(file.buffer);
}

if (!isMongoStore()) {
  (async () => {
    try {
      await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_images (
        id         SERIAL PRIMARY KEY,
        mime_type  TEXT NOT NULL,
        data       BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    } catch (e) {
      console.error("dps_images migration failed:", e);
    }
  })();
}

router.post("/images/upload", (req, res) => {
  upload.single("file")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      const tooBig = multerErr instanceof multer.MulterError && multerErr.code === "LIMIT_FILE_SIZE";
      req.log?.warn?.({ err: multerErr }, "image upload rejected by multer");
      res.status(tooBig ? 413 : 400).json({
        error: tooBig ? "Image is too large. Maximum size is 8 MB." : "Invalid upload request.",
      });
      return;
    }

    const file = req.file;
    if (!file) { res.status(400).json({ error: "A file is required." }); return; }

    if (file.size === 0 || !file.buffer?.length) {
      res.status(400).json({ error: "The uploaded file is empty." });
      return;
    }

    const mime = resolveMime(file);
    if (!mime || !ALLOWED_MIME[mime]) {
      res.status(400).json({ error: "Unsupported image type. Accepted: JPG, PNG, GIF, WebP." });
      return;
    }

    try {
      if (isMongoStore()) {
        const saved = await mediaRepo.saveImage(file.buffer, mime, file.originalname);
        res.status(201).json(saved);
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO dps_images (mime_type, data) VALUES ($1, $2) RETURNING id`,
        [mime, file.buffer],
      );
      const id: number = Number(rows[0]?.id);
      if (!Number.isFinite(id)) {
        res.status(500).json({ error: "Failed to save the image." });
        return;
      }
      res.status(201).json({ id, url: `/api/images/${id}` });
    } catch (e) {
      console.error("image upload db insert failed:", e);
      req.log?.error?.({ err: e }, "image upload db insert failed");
      res.status(500).json({ error: "Failed to save the image." });
    }
  });
});

router.get("/images/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    if (isMongoStore()) {
      const img = await mediaRepo.getImage(id);
      if (!img) { res.status(404).json({ error: "Image not found." }); return; }
      res.setHeader("Content-Type", img.mime_type || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(img.data);
      return;
    }

    const { rows } = await pool.query(
      `SELECT mime_type, data FROM dps_images WHERE id = $1`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "Image not found." }); return; }

    let data = rows[0].data as Buffer | Uint8Array | string | null;
    if (data == null) {
      res.status(404).json({ error: "Image not found." });
      return;
    }
    if (typeof data === "string") {
      data = Buffer.from(data, "binary");
    } else if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    res.setHeader("Content-Type", String(rows[0].mime_type || "application/octet-stream"));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(data);
  } catch (e) {
    console.error("image serve error:", e);
    res.status(500).json({ error: "Failed to fetch image." });
  }
});

export default router;
