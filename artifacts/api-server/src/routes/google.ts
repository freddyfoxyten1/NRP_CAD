import { Router } from "express";
import { isMongoStore, pool, googleIntegrationsRepo } from "@workspace/db";
import { ensureGoogleResourceTables } from "../lib/ensure-google-tables";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  exchangeGoogleCode,
  exportSharedGoogleDocPdf,
  GoogleAuthError,
  listGoogleDocs,
  parseGoogleDocId,
  resolveGoogleRedirectUri,
  takeOAuthState,
  tokenExpiryIso,
} from "../lib/google-oauth";
import { accessTokenForIntegration, sendGoogleAuthError, tryServeGoogleDocFile } from "../lib/google-doc-resource";

const router = Router();

router.get("/google/oauth/url", async (req, res) => {
  try {
    await ensureGoogleResourceTables();
    const createdBy = typeof req.query.created_by === "string" ? req.query.created_by : undefined;
    const explicit = typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : undefined;
    const redirectUri = resolveGoogleRedirectUri(req, explicit);
    const state = createOAuthState(createdBy);
    res.json({ url: buildGoogleAuthUrl(redirectUri, state), redirect_uri: redirectUri, state });
  } catch (err) {
    sendGoogleAuthError(res, err);
  }
});

router.post("/google/oauth/exchange", async (req, res) => {
  const { code, redirect_uri: explicitRedirect, state, error, created_by } = req.body as {
    code?: string;
    redirect_uri?: string;
    state?: string;
    error?: string;
    created_by?: string;
  };

  if (error === "access_denied") {
    res.status(400).json({ error: "Google sign-in was cancelled.", code: "oauth_cancelled" });
    return;
  }
  if (!code?.trim()) {
    res.status(400).json({ error: "Google did not return an authorisation code.", code: "oauth_failed" });
    return;
  }

  try {
    await ensureGoogleResourceTables();
    const pending = typeof state === "string" ? takeOAuthState(state) : null;
    const redirectUri = resolveGoogleRedirectUri(req, explicitRedirect);
    const result = await exchangeGoogleCode(code.trim(), redirectUri);
    const createdBy = pending?.createdBy ?? created_by?.trim() ?? null;
    const expiry = tokenExpiryIso(result.expires_in);

    if (isMongoStore()) {
      const saved = await googleIntegrationsRepo.upsertGoogleIntegration({
        created_by: createdBy,
        email: result.account.email,
        google_user_id: result.account.id,
        refresh_token: result.refresh_token,
        access_token: result.access_token,
        token_expiry: expiry,
      });
      res.json(googleIntegrationsRepo.publicGoogleIntegration(saved));
      return;
    }

    const existing = await pool.query(
      `SELECT id, refresh_token FROM google_integrations WHERE google_user_id = $1`,
      [result.account.id],
    );
    if (existing.rows[0]) {
      const { rows } = await pool.query(
        `UPDATE google_integrations
            SET email = $2, created_by = COALESCE($3, created_by),
                refresh_token = COALESCE(NULLIF($4, ''), refresh_token),
                access_token = $5, token_expiry = $6, updated_at = NOW()
          WHERE id = $1
          RETURNING id, email, google_user_id, created_by, created_at, updated_at`,
        [
          existing.rows[0].id,
          result.account.email,
          createdBy,
          result.refresh_token ?? "",
          result.access_token,
          expiry,
        ],
      );
      res.json(rows[0]);
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO google_integrations
         (created_by, email, google_user_id, refresh_token, access_token, token_expiry)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, google_user_id, created_by, created_at, updated_at`,
      [createdBy, result.account.email, result.account.id, result.refresh_token ?? "", result.access_token, expiry],
    );
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      sendGoogleAuthError(res, err);
      return;
    }
    req.log?.error?.({ err }, "google oauth exchange failed");
    res.status(400).json({ error: "Google authentication failed.", code: "oauth_failed" });
  }
});

router.get("/google/docs", async (req, res) => {
  const integrationId = Number(req.query.integration_id);
  if (!Number.isInteger(integrationId) || integrationId <= 0) {
    res.status(400).json({ error: "Connect a Google account first.", code: "invalid" });
    return;
  }
  try {
    await ensureGoogleResourceTables();
    const accessToken = await accessTokenForIntegration(integrationId);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const fileId = parseGoogleDocId(q);
    const docs = await listGoogleDocs(accessToken);
    const filtered = fileId
      ? docs.filter(d => d.id === fileId)
      : q
        ? docs.filter(d => d.name.toLowerCase().includes(q.toLowerCase()))
        : docs;
    res.json({ docs: filtered });
  } catch (err) {
    sendGoogleAuthError(res, err);
  }
});

router.get("/google/integrations/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid integration." });
    return;
  }
  try {
    await ensureGoogleResourceTables();
    if (isMongoStore()) {
      const row = await googleIntegrationsRepo.getGoogleIntegration(id);
      const pub = googleIntegrationsRepo.publicGoogleIntegration(row);
      if (!pub) {
        res.status(404).json({ error: "Google account is not connected." });
        return;
      }
      res.json(pub);
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, email, google_user_id, created_by, created_at, updated_at
         FROM google_integrations WHERE id = $1`,
      [id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Google account is not connected." });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    sendGoogleAuthError(res, err);
  }
});

router.get("/google/export", async (req, res) => {
  const fileId = parseGoogleDocId(typeof req.query.file_id === "string" ? req.query.file_id : "");
  if (!fileId) {
    res.status(400).json({ error: "A Google Doc share link or file id is required." });
    return;
  }
  try {
    const pdf = await exportSharedGoogleDocPdf(fileId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="google-doc.pdf"');
    res.setHeader("Cache-Control", "private, max-age=20");
    res.send(pdf);
  } catch (err) {
    sendGoogleAuthError(res, err);
  }
});

router.get("/google/file/:department/:id", async (req, res) => {
  const department = req.params.department;
  if (department !== "dps" && department !== "dph" && department !== "staff") {
    res.status(400).json({ error: "Invalid department." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    await ensureGoogleResourceTables();
    const handled = await tryServeGoogleDocFile(req, res, department, id);
    if (!handled) res.status(404).json({ error: "File not found." });
  } catch (err) {
    sendGoogleAuthError(res, err);
  }
});

export default router;
