import {
  departmentInAppResourcePath,
  departmentPortalResourcePath,
  departmentResourcePath,
  findResourceByLinkSlug,
  inAppResourceUrlMode,
  parseResourcePathname,
  parseResourceSection,
  resourceLinkSlug,
  slugifyResourceTitle,
} from "./resource-url";

describe("resource URL helpers", () => {
  test("builds stable slugs from titles", () => {
    expect(slugifyResourceTitle("SOP Manual")).toBe("sop-manual");
    expect(resourceLinkSlug("SOP Manual", 91)).toBe("sop-manual-91");
    expect(departmentResourcePath("dps", "public", "SOP Manual", 91)).toBe(
      "/dps_public_resource_sop-manual-91",
    );
    expect(departmentInAppResourcePath("dps", "SOP Manual", 91)).toBe(
      "/dps_resources-sop-manual-91",
    );
  });

  test("parses department resource paths", () => {
    expect(parseResourcePathname("/dps_public_resource_sop-manual-91")).toEqual({
      department: "dps",
      mode: "public",
      linkSlug: "sop-manual-91",
    });
    expect(parseResourcePathname("/dps_resources-sop-manual-91")).toEqual({
      department: "dps",
      mode: "public",
      linkSlug: "sop-manual-91",
      inApp: true,
    });
    expect(parseResourceSection("resources-sop-manual-91")).toEqual({
      mode: "public",
      linkSlug: "sop-manual-91",
      inApp: true,
    });
  });

  test("portal paths keep DPS/DPH on the department page", () => {
    expect(departmentPortalResourcePath("dps", false, "SOP Manual", 91)).toBe(
      "/dps_resources-sop-manual-91",
    );
    expect(departmentPortalResourcePath("dph", true, "Policy Guide", 12)).toBe(
      "/dph_resources-policy-guide-12",
    );
    expect(inAppResourceUrlMode("staff", false)).toBe("public");
  });

  test("finds resources by id suffix or title slug", () => {
    const rows = [
      { id: 91, title: "SOP Manual" },
      { id: 12, title: "Policy Guide" },
    ];
    expect(findResourceByLinkSlug(rows, "sop-manual-91")?.id).toBe(91);
    expect(findResourceByLinkSlug(rows, "policy-guide")?.id).toBe(12);
  });
});
