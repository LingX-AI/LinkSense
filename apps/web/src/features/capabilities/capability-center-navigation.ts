const capabilityCenterSections = [
  "plugin",
  "skill",
  "mcp",
  "application",
] as const
const capabilityCenterScopes = ["personal", "public", "clawhub"] as const

export type CapabilityCenterSection = (typeof capabilityCenterSections)[number]
export type CapabilityCenterScope = (typeof capabilityCenterScopes)[number]

export type CapabilityCenterLocation = {
  section: CapabilityCenterSection
  scope: CapabilityCenterScope
  search: string
}

export type CapabilityCenterSettingsState = {
  settingsReturnTo: string
}

const internalOrigin = "https://linksense.local"

function normalizeCapabilityCenterScope(
  section: CapabilityCenterSection,
  scope: CapabilityCenterScope
): CapabilityCenterScope {
  if (scope === "public" && section === "mcp") return "personal"
  if (scope === "clawhub" && section !== "skill") return "personal"
  return scope
}

function isCapabilityCenterSection(
  value: string | null
): value is CapabilityCenterSection {
  return (
    value !== null &&
    (capabilityCenterSections as readonly string[]).includes(value)
  )
}

function isCapabilityCenterScope(
  value: string | null
): value is CapabilityCenterScope {
  return (
    value !== null &&
    (capabilityCenterScopes as readonly string[]).includes(value)
  )
}

export function capabilityCenterLocationFromSearch(
  search: string
): CapabilityCenterLocation {
  const parameters = new URLSearchParams(search)
  const sectionParameter = parameters.get("section")
  const section = isCapabilityCenterSection(sectionParameter)
    ? sectionParameter
    : "application"
  const scopeParameter = parameters.get("scope")
  const scope = isCapabilityCenterScope(scopeParameter)
    ? scopeParameter
    : "personal"
  return {
    section,
    scope: normalizeCapabilityCenterScope(section, scope),
    search: parameters.get("search") ?? "",
  }
}

export function capabilityCenterPath(
  location: CapabilityCenterLocation
): string {
  const parameters = new URLSearchParams({
    section: location.section,
    scope: location.scope,
  })
  if (location.search) parameters.set("search", location.search)
  return `/capabilities?${parameters.toString()}`
}

export function capabilityCenterSettingsState(
  location: CapabilityCenterLocation
): CapabilityCenterSettingsState {
  return { settingsReturnTo: capabilityCenterPath(location) }
}

export function resolveCapabilityCenterSettingsReturn(
  state: unknown
): string | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !("settingsReturnTo" in state) ||
    typeof state.settingsReturnTo !== "string"
  ) {
    return null
  }

  try {
    const target = new URL(state.settingsReturnTo, internalOrigin)
    if (
      target.origin !== internalOrigin ||
      target.pathname !== "/capabilities"
    ) {
      return null
    }
    return capabilityCenterPath(
      capabilityCenterLocationFromSearch(target.search)
    )
  } catch {
    return null
  }
}
