import {
  auditActionCodes,
  auditTranslationKey,
  type AuditTranslationKind,
} from "@linksense/shared"
import type { TFunction } from "i18next"

import { formatPublicTechnicalIdentifier } from "@/lib/public-copy"

export type AuditActionOption = {
  code: string
  label: string
}

export function translateAuditValue(
  t: TFunction,
  kind: AuditTranslationKind,
  code: string
): string {
  return t(auditTranslationKey(kind, code), {
    defaultValue: formatPublicTechnicalIdentifier(code),
  })
}

export function auditActionOptions(t: TFunction): AuditActionOption[] {
  return auditActionCodes
    .map((code) => ({
      code,
      label: translateAuditValue(t, "actions", code),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}
