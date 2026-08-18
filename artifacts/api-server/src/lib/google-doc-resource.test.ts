import { describe, expect, test } from "bun:test";
import {
  cachedPdfIfFresh,
  GOOGLE_DOC_CACHE_TTL_MS,
  isGoogleDocType,
  sanitizeResourceForClient,
  sendGoogleAuthError,
} from "./google-doc-resource";
import { GoogleAuthError } from "./google-oauth";

describe("Google Doc resource model", () => {
  test("creates a reference-shaped resource rather than stored file bytes", () => {
    const created = sanitizeResourceForClient({
      id: 44,
      title: "Duty Handbook",
      type: "google_doc",
      google_file_id: "abcDEF1234567890xyz",
      google_integration_id: 7,
      google_modified_time: "2026-08-18T01:00:00.000Z",
      file_data: Buffer.from("%PDF-1.4 should never leak"),
      refresh_token: "1//secret",
      access_token: "ya29.secret",
    });
    expect(created.type).toBe("google_doc");
    expect(created.google_file_id).toBe("abcDEF1234567890xyz");
    expect(created.file_data).toBeUndefined();
    expect(created.refresh_token).toBeUndefined();
    expect(created.access_token).toBeUndefined();
    expect(isGoogleDocType(created.type)).toBe(true);
  });

  test("public responses never include integration or credential fields", () => {
    const pub = sanitizeResourceForClient({
      id: 44,
      title: "Duty Handbook",
      type: "google_doc",
      google_file_id: "abcDEF1234567890xyz",
      google_integration_id: 7,
      google_refresh_token: "1//secret",
      google_access_token: "ya29.secret",
      gridFsId: "grid",
    }, { public: true });
    expect(pub.google_integration_id).toBeUndefined();
    expect(pub.google_refresh_token).toBeUndefined();
    expect(pub.google_access_token).toBeUndefined();
    expect(pub.gridFsId).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain("secret");
    expect(JSON.stringify(pub)).not.toContain("ya29");
  });

  test("share-link resources do not need a Google account integration", () => {
    const created = sanitizeResourceForClient({
      id: 50,
      title: "Shared SOP",
      type: "google_doc",
      google_file_id: "abcDEF1234567890xyz",
      google_integration_id: null,
    });
    expect(created.type).toBe("google_doc");
    expect(created.google_file_id).toBe("abcDEF1234567890xyz");
    expect(created.google_integration_id).toBeNull();
  });

  test("existing PDF resources keep their type and are not treated as Google Docs", () => {
    const pdf = sanitizeResourceForClient({
      id: 9,
      title: "Posted Orders",
      type: "pdf",
      created_by: "admin",
    });
    expect(pdf.type).toBe("pdf");
    expect(isGoogleDocType(pdf.type)).toBe(false);
    expect(pdf.title).toBe("Posted Orders");
  });
});

describe("live Google Doc cache", () => {
  test("reuses the cached PDF when the revision is unchanged and the TTL has not expired", () => {
    const pdf = Buffer.from("%PDF-1.4 v1");
    const cached = { revision: "rev-1", pdf, fetchedAt: Date.now() };
    expect(cachedPdfIfFresh(cached, "rev-1")).toBe(pdf);
  });

  test("downloads again when the Google Doc revision changes", () => {
    const cached = { revision: "rev-1", pdf: Buffer.from("%PDF-1.4 v1"), fetchedAt: Date.now() };
    expect(cachedPdfIfFresh(cached, "rev-2")).toBeNull();
  });

  test("does not cache indefinitely", () => {
    const cached = {
      revision: "rev-1",
      pdf: Buffer.from("%PDF-1.4 v1"),
      fetchedAt: Date.now() - GOOGLE_DOC_CACHE_TTL_MS - 1,
    };
    expect(cachedPdfIfFresh(cached, "rev-1")).toBeNull();
  });
});

describe("public preview errors", () => {
  test("maps expired/revoked auth and deleted docs to JSON without credentials", () => {
    const captured: { status?: number; body?: Record<string, unknown> } = {};
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        captured.body = body;
      },
    };
    sendGoogleAuthError(res as never, new GoogleAuthError("Google access expired. Reconnect your Google account.", "token_expired", 401));
    expect(captured.status).toBe(401);
    expect(captured.body?.code).toBe("token_expired");
    expect(JSON.stringify(captured.body)).not.toContain("ya29");
    expect(JSON.stringify(captured.body)).not.toContain("refresh");

    sendGoogleAuthError(res as never, new GoogleAuthError("That Google Doc was deleted or no longer exists.", "not_found", 404));
    expect(captured.status).toBe(404);
    expect(captured.body?.code).toBe("not_found");
  });
});
