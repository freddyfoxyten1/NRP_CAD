import { describe, expect, test } from "bun:test";
import { readApiJson } from "./fetch-api-json";

describe("readApiJson", () => {
  test("parses JSON bodies", async () => {
    const res = new Response(JSON.stringify({ url: "https://example.com" }), {
      headers: { "content-type": "application/json" },
    });
    await expect(readApiJson<{ url: string }>(res)).resolves.toEqual({ url: "https://example.com" });
  });

  test("rejects HTML (SPA / nginx fallback) instead of throwing a JSON parse error", async () => {
    const res = new Response("<!DOCTYPE html><html><body>CAD</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await expect(readApiJson(res)).rejects.toThrow(/not on the live VPS yet/i);
  });
});
