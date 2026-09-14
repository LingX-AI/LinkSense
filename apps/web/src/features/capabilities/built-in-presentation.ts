import { capabilityDisplayName } from "@linksense/shared"
import type { TFunction } from "i18next"

import type { CapabilitySummary } from "@/api/contracts"

const capabilityTranslationKeys = {
  "linksense-browser": "browser",
  "linksense-document-reader": "documentReader",
  "linksense-docs": "docs",
  "linksense-file-service": "fileService",
  "linksense-image-generation": "imageGeneration",
  "linksense-knowledge-base": "knowledgeBase",
  "linksense-skill-creator": "skillCreator",
} as const

export function capabilityPresentation(
  capability: CapabilitySummary,
  t: TFunction,
  productName: string
): { name: string; description: string | null } {
  if (!capability.is_builtin || capability.builtin_key === null) {
    return {
      name: capabilityDisplayName(capability),
      description: capability.description,
    }
  }
  const key =
    capabilityTranslationKeys[
      capability.builtin_key as keyof typeof capabilityTranslationKeys
    ]
  if (!key)
    return {
      name: capabilityDisplayName(capability),
      description: capability.description,
    }
  return {
    name: t(`capability.builtIns.${key}.name`, { productName }),
    description: t(`capability.builtIns.${key}.description`, { productName }),
  }
}

export function coreMcpPresentation(
  t: TFunction,
  productName: string
): { name: string; description: string } {
  return {
    name: t("capability.builtIns.coreMcp.name", { productName }),
    description: t("capability.builtIns.coreMcp.description", { productName }),
  }
}
