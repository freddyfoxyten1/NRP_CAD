import { describe, expect, test } from "bun:test";
import { parseGoogleDocId } from "./google-doc-url";

describe("parseGoogleDocId", () => {
  test("accepts normal and multi-account share links", () => {
    expect(parseGoogleDocId("https://docs.google.com/document/d/abcDEF1234567890xyz/edit?usp=sharing"))
      .toBe("abcDEF1234567890xyz");
    expect(parseGoogleDocId("https://docs.google.com/document/u/0/d/abcDEF1234567890xyz/edit"))
      .toBe("abcDEF1234567890xyz");
  });

  test("rejects junk", () => {
    expect(parseGoogleDocId("https://example.com")).toBeNull();
    expect(parseGoogleDocId("")).toBeNull();
  });
});
