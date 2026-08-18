import { googleFileIdFromResource, isPdfLikeResource, resourceFileUrl, resourceTypeLabel } from "./resource-type";

describe("resource type helpers", () => {
  test("Google Docs use the same preview path as PDFs", () => {
    expect(isPdfLikeResource("google_doc")).toBe(true);
    expect(isPdfLikeResource("pdf")).toBe(true);
    expect(isPdfLikeResource("document")).toBe(false);
    expect(resourceTypeLabel("google_doc")).toBe("Google Doc");
  });

  test("existing PDF resources are unchanged", () => {
    expect(resourceTypeLabel("pdf")).toBe("PDF");
    expect(isPdfLikeResource("pdf")).toBe(true);
  });

  test("share-link ids survive on live list fields when google_file_id is missing", () => {
    const saved = {
      type: "document",
      logo_url: "https://docs.google.com/document/d/abcDEF1234567890xyz/edit",
      header_config: { google_file_id: "abcDEF1234567890xyz" },
    };
    expect(googleFileIdFromResource(saved)).toBe("abcDEF1234567890xyz");
    expect(isPdfLikeResource(saved)).toBe(true);
    expect(resourceTypeLabel(saved)).toBe("Google Doc");
    expect(resourceFileUrl("dps", 91, saved)).toBe("/api/google/export?file_id=abcDEF1234567890xyz");
  });

  test("Google Doc files use the unpublished Google route; PDFs keep the stored-file route", () => {
    expect(resourceFileUrl("dps", 44, "google_doc")).toBe("/api/google/file/dps/44");
    expect(resourceFileUrl("dps", 9, "pdf")).toBe("/api/resources/9/file");
    expect(resourceFileUrl("dph", 3, "google_doc")).toBe("/api/google/file/dph/3");
    expect(resourceFileUrl("staff", 2, "pdf")).toBe("/api/staff/resources/2/file");
  });
});
