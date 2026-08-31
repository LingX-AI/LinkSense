import { describe, expect, it } from "vitest";

import {
  capabilitySourceTypeSchema,
  clawHubInstallBlockReasonSchema,
  clawHubSkillCatalogItemSchema,
  clawHubSkillCatalogSortSchema,
  errorCatalog,
} from "../src/index.js";

const item = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "useful-skill",
  display_name: "Useful Skill",
  summary: "Does useful work.",
  topics: ["productivity"],
  tags: {},
  latest_version: "1.2.3",
  latest_version_created_at: null,
  latest_version_changelog: null,
  latest_version_license: null,
  owner_handle: "publisher",
  owner_display_name: null,
  metadata: null,
  stats: { downloads: 10, installs: 2, stars: 1, comments: 0, versions: 3 },
  security_status: "unverified",
  security_has_warnings: false,
  is_suspicious: false,
  is_malware_blocked: false,
  source_created_at: "2026-08-01T00:00:00.000Z",
  source_updated_at: "2026-08-07T00:00:00.000Z",
  synced_at: "2026-08-07T00:05:00.000Z",
  canonical_url: "https://clawhub.ai/publisher/skills/useful-skill",
  available: true,
  installable: true,
  installability_reason: null,
  installed_capability_id: null,
  installed_version: null,
  update_available: false,
} as const;

describe("ClawHub shared contracts", () => {
  it("accepts a publisher-qualified local catalog projection", () => {
    expect(clawHubSkillCatalogItemSchema.parse(item)).toEqual(item);
    expect(capabilitySourceTypeSchema.parse("clawhub")).toBe("clawhub");
  });

  it("restricts local catalog sorting to downloads and stars", () => {
    expect(clawHubSkillCatalogSortSchema.options).toEqual([
      "downloads",
      "stars",
    ]);
    expect(clawHubSkillCatalogSortSchema.safeParse("updated").success).toBe(
      false,
    );
  });

  it("rejects unknown security states and ownerless identities", () => {
    expect(
      clawHubSkillCatalogItemSchema.safeParse({
        ...item,
        security_status: "pending",
      }).success,
    ).toBe(false);
    expect(
      clawHubSkillCatalogItemSchema.safeParse({
        ...item,
        owner_handle: "",
      }).success,
    ).toBe(false);
  });

  it("keeps manifest block reasons internal to live install checks", () => {
    expect(clawHubInstallBlockReasonSchema.options).toEqual([
      "files_unavailable",
      "manifest_too_large",
      "manifest_unsafe",
      "metadata_unavailable",
    ]);
    expect(
      clawHubSkillCatalogItemSchema.safeParse({
        ...item,
        installable: false,
        installability_reason: "manifest_unsafe",
      }).success,
    ).toBe(false);
  });

  it("publishes stable install-preview admission errors", () => {
    expect(errorCatalog.CLAWHUB_INSTALL_PREVIEW_BUSY.http_status).toBe(409);
    expect(
      errorCatalog.CLAWHUB_INSTALL_PREVIEW_RATE_LIMITED.http_status,
    ).toBe(429);
    expect(
      errorCatalog.CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED.http_status,
    ).toBe(429);
  });
});
