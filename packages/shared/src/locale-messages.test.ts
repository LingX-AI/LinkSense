import { describe, expect, it } from "vitest";
import { auditTranslationResource } from "./audit-i18n.js";
import { supportedLocales } from "./common.js";
import { errorCatalog, type ErrorCode } from "./errors.js";
import { localizedErrorMessage } from "./locale-messages.js";

const tokens = (value: string) => [...value.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token).sort();

describe("complete locale catalogs", () => {
  it.each(supportedLocales)("provides every error and preserves parameters in %s", (locale) => {
    for (const code of Object.keys(errorCatalog) as ErrorCode[]) {
      const translated = localizedErrorMessage(code, locale);
      const source = errorCatalog[code].messages["en-US"];
      expect(translated, code).toBeTypeOf("string");
      expect(translated.trim(), code).not.toBe("");
      expect(tokens(translated), code).toEqual(tokens(source));
      if (locale !== "en-US") expect(translated, code).not.toBe(source);
    }
  });

  it.each(supportedLocales)("provides every audit action, target, and result in %s", (locale) => {
    const source = auditTranslationResource("en-US");
    const translated = auditTranslationResource(locale);
    for (const kind of ["actions", "targetTypes", "results"] as const) {
      expect(Object.keys(translated[kind]).sort(), kind).toEqual(Object.keys(source[kind]).sort());
      for (const [key, value] of Object.entries(translated[kind])) {
        expect(value.trim(), `${kind}.${key}`).not.toBe("");
        expect(tokens(value), `${kind}.${key}`).toEqual(tokens(source[kind][key]!));
        if (locale !== "en-US" && kind === "actions") expect(value, key).not.toBe(source[kind][key]);
      }
    }
  });
});
