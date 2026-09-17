import { describe, expect, it } from "vitest";

import { auditFlatTranslations, auditTranslationKey } from "../src/audit-i18n.js";

describe("maintenance expiry audit translations", () => {
  it.each([
    ["zh-CN", "维护已结束并自动清空设置"],
    ["en-US", "Maintenance ended and settings cleared automatically"],
  ] as const)("describes automatic expiry in %s", (locale, expected) => {
    const key = auditTranslationKey("actions", "maintenance_settings_expired");
    expect(auditFlatTranslations(locale)[key]).toBe(expected);
  });
});
