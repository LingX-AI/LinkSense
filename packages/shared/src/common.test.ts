import { describe, expect, it } from "vitest";

import { isLocale, localeSchema, supportedLocales } from "./common.js";

describe("locale contract", () => {
  it("keeps all supported locales in one canonical schema", () => {
    expect(supportedLocales).toEqual([
      "zh-CN",
      "en-US",
      "es-ES",
      "pt-BR",
      "fr-FR",
      "ja-JP",
    ]);
    expect(localeSchema.options).toEqual(supportedLocales);
  });

  it.each(supportedLocales)("accepts %s", (locale) => {
    expect(isLocale(locale)).toBe(true);
  });

  it("rejects unsupported locales", () => {
    expect(isLocale("de-DE")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
