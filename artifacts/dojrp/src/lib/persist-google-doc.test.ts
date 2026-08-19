import { persistGoogleDocResource } from "./persist-google-doc";

describe("persistGoogleDocResource", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("creates on the live resource API then stores the share-link id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: 91, title: "SOPs", type: "google_doc" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: 91,
          title: "SOPs",
          type: "google_doc",
          header_config: { google_file_id: "abcDEF1234567890xyz" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const saved = await persistGoogleDocResource({
      department: "dps",
      title: "SOPs",
      createdBy: "chief",
      fileId: "abcDEF1234567890xyz",
      url: "https://docs.google.com/document/d/abcDEF1234567890xyz/edit",
      visibility: { personnel_only: true },
    });

    expect(calls[0]?.url).toBe("/api/resources");
    expect(calls[0]?.init?.method).toBe("POST");
    const createdBody = JSON.parse(String(calls[0]?.init?.body)) as {
      type: string;
      title: string;
      personnel_only: boolean;
    };
    expect(createdBody.type).toBe("google_doc");
    expect(createdBody.title).toBe("SOPs");
    expect(createdBody.personnel_only).toBe(true);

    expect(calls[1]?.url).toBe("/api/resources/91");
    expect(calls[1]?.init?.method).toBe("PATCH");
    const patchedBody = JSON.parse(String(calls[1]?.init?.body)) as {
      logo_url: string;
      header_config: { google_file_id: string };
    };
    expect(patchedBody.header_config.google_file_id).toBe("abcDEF1234567890xyz");
    expect(patchedBody.logo_url).toContain("abcDEF1234567890xyz");

    expect(saved.id).toBe(91);
    expect(saved.google_file_id).toBe("abcDEF1234567890xyz");
    expect(saved.type).toBe("google_doc");
  });
});
