import { describe, expect, test } from "bun:test";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  exportGoogleDocPdf,
  exportSharedGoogleDocPdf,
  getGoogleDocMeta,
  GoogleAuthError,
  parseGoogleDocId,
  refreshGoogleAccessToken,
  type GoogleHttp,
} from "./google-oauth";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseGoogleDocId", () => {
  test("extracts a Docs URL file id", () => {
    expect(parseGoogleDocId("https://docs.google.com/document/d/abcDEF1234567890xyz/edit")).toBe("abcDEF1234567890xyz");
    expect(parseGoogleDocId("https://docs.google.com/document/d/abcDEF1234567890xyz/edit?usp=sharing")).toBe("abcDEF1234567890xyz");
    expect(parseGoogleDocId("https://docs.google.com/document/u/0/d/abcDEF1234567890xyz/edit")).toBe("abcDEF1234567890xyz");
  });

  test("accepts a raw Drive file id", () => {
    expect(parseGoogleDocId("abcDEF1234567890xyz_id")).toBe("abcDEF1234567890xyz_id");
  });

  test("rejects junk", () => {
    expect(parseGoogleDocId("not a doc")).toBeNull();
    expect(parseGoogleDocId("")).toBeNull();
  });
});

describe("Google OAuth", () => {
  test("buildGoogleAuthUrl includes offline consent and Drive readonly", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    const url = new URL(buildGoogleAuthUrl("http://localhost:4173/dojcad/google-callback", "state123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope") ?? "").toContain("drive.readonly");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4173/dojcad/google-callback");
  });

  test("exchangeGoogleCode stores account metadata and never returns secrets in the account object", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    const http: GoogleHttp = async (url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse(200, {
          access_token: "ya29.access",
          refresh_token: "1//refresh",
          expires_in: 3600,
        });
      }
      return jsonResponse(200, { id: "google-user-1", email: "writer@example.com" });
    };
    const result = await exchangeGoogleCode("auth-code", "http://localhost:4173/dojcad/google-callback", http);
    expect(result.account).toEqual({ id: "google-user-1", email: "writer@example.com" });
    expect(result.access_token).toBe("ya29.access");
    expect(result.refresh_token).toBe("1//refresh");
  });

  test("refreshGoogleAccessToken maps revoked grants", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    const http: GoogleHttp = async () => jsonResponse(400, { error: "invalid_grant", error_description: "Token has been revoked." });
    try {
      await refreshGoogleAccessToken("stale-refresh", http);
      throw new Error("expected failure");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleAuthError);
      expect((err as GoogleAuthError).code).toBe("revoked");
      expect((err as GoogleAuthError).httpStatus).toBe(401);
    }
  });
});

describe("Google Drive document access", () => {
  test("getGoogleDocMeta succeeds for an accessible Google Doc", async () => {
    const http: GoogleHttp = async () => jsonResponse(200, {
      id: "doc-1",
      name: "SOP",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-08-18T00:00:00.000Z",
      trashed: false,
    });
    const meta = await getGoogleDocMeta("token", "doc-1", http);
    expect(meta.id).toBe("doc-1");
    expect(meta.name).toBe("SOP");
  });

  test("deleted/trashed docs become not_found", async () => {
    const http: GoogleHttp = async () => jsonResponse(200, {
      id: "doc-1",
      name: "Gone",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-08-18T00:00:00.000Z",
      trashed: true,
    });
    try {
      await getGoogleDocMeta("token", "doc-1", http);
      throw new Error("expected failure");
    } catch (err) {
      expect((err as GoogleAuthError).code).toBe("not_found");
    }
  });

  test("inaccessible docs become forbidden", async () => {
    const http: GoogleHttp = async () => jsonResponse(403, { error: { message: "forbidden" } });
    try {
      await getGoogleDocMeta("token", "doc-1", http);
      throw new Error("expected failure");
    } catch (err) {
      expect((err as GoogleAuthError).code).toBe("forbidden");
      expect((err as GoogleAuthError).httpStatus).toBe(403);
    }
  });

  test("exportGoogleDocPdf returns PDF bytes and rejects non-PDF payloads", async () => {
    const ok: GoogleHttp = async () => new Response("%PDF-1.4 fake", { status: 200 });
    const pdf = await exportGoogleDocPdf("token", "doc-1", ok);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const bad: GoogleHttp = async () => new Response("<html>not a pdf</html>", { status: 200 });
    try {
      await exportGoogleDocPdf("token", "doc-1", bad);
      throw new Error("expected failure");
    } catch (err) {
      expect((err as GoogleAuthError).code).toBe("parse_failed");
    }
  });

  test("exportSharedGoogleDocPdf uses the public share-link export", async () => {
    const http: GoogleHttp = async (url) => {
      expect(url).toContain("/document/d/abcDEF1234567890xyz/export?format=pdf");
      return new Response("%PDF-1.4 shared", { status: 200 });
    };
    const pdf = await exportSharedGoogleDocPdf("abcDEF1234567890xyz", http);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("exportSharedGoogleDocPdf tells the user to share Anyone with the link", async () => {
    const http: GoogleHttp = async () => new Response("<!DOCTYPE html><html>Sign in</html>", { status: 200 });
    try {
      await exportSharedGoogleDocPdf("abcDEF1234567890xyz", http);
      throw new Error("expected failure");
    } catch (err) {
      expect((err as GoogleAuthError).code).toBe("forbidden");
      expect((err as GoogleAuthError).message).toMatch(/Anyone with the link/i);
    }
  });
});
