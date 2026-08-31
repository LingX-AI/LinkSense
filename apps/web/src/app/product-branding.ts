import { useContext } from "react"
import {
  DEFAULT_ORGANIZATION_DISPLAY_NAME,
  resolveOrganizationDisplayName,
} from "@linksense/shared"

export { productFilenamePrefix } from "@linksense/shared"

import { BootstrapContext } from "@/app/bootstrap-state"

const legacyFirstPartyCapabilityNames = new Set([
  "LinkSense File Service",
  "LinkSense Personal",
  "LinkSense Skill Creator",
])

export function useProductName(): string {
  const context = useContext(BootstrapContext)
  return resolveOrganizationDisplayName(context?.bootstrap?.system_name)
}

export function applyProductMetadata(
  targetDocument: Document,
  productNameInput: unknown
): void {
  const productName = resolveOrganizationDisplayName(productNameInput)
  targetDocument.title = productName
  for (const name of ["application-name", "description"] as const) {
    const selector = `meta[name="${name}"]`
    const metadata =
      targetDocument.querySelector<HTMLMetaElement>(selector) ??
      targetDocument.head.appendChild(targetDocument.createElement("meta"))
    metadata.setAttribute("name", name)
    metadata.setAttribute("content", productName)
  }
}

export function formatFirstPartyCapabilityName(
  capabilityName: string,
  productNameInput: unknown
): string {
  if (!legacyFirstPartyCapabilityNames.has(capabilityName)) {
    return capabilityName
  }
  return `${resolveOrganizationDisplayName(productNameInput)}${capabilityName.slice(
    DEFAULT_ORGANIZATION_DISPLAY_NAME.length
  )}`
}
