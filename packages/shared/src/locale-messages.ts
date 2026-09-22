import type { Locale } from "./common.js";
import { errorCatalog, type ErrorCode } from "./errors.js";
import { auditMessages as esAudit, errorMessages as esErrors } from "./locales/es-ES.js";
import { auditMessages as ptAudit, errorMessages as ptErrors } from "./locales/pt-BR.js";
import { auditMessages as frAudit, errorMessages as frErrors } from "./locales/fr-FR.js";
import { auditMessages as jaAudit, errorMessages as jaErrors } from "./locales/ja-JP.js";

export type AdditionalLocale = Exclude<Locale, "zh-CN" | "en-US">;

export const localizedErrorMessages = {
  "es-ES": esErrors,
  "pt-BR": ptErrors,
  "fr-FR": frErrors,
  "ja-JP": jaErrors,
} satisfies Record<AdditionalLocale, Record<ErrorCode, string>>;

export const localizedAuditMessages = {
  "es-ES": esAudit,
  "pt-BR": ptAudit,
  "fr-FR": frAudit,
  "ja-JP": jaAudit,
} satisfies Record<AdditionalLocale, {
  actions: Record<string, string>;
  targetTypes: Record<string, string>;
  results: Record<string, string>;
}>;

export function localizedErrorMessage(code: ErrorCode, locale: Locale): string {
  return locale === "zh-CN" || locale === "en-US"
    ? errorCatalog[code].messages[locale]
    : localizedErrorMessages[locale][code];
}
