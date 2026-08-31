const internalPlatformNamePattern = /codex/iu

export function containsInternalPlatformName(value: string): boolean {
  return internalPlatformNamePattern.test(value)
}

export function formatPublicTechnicalIdentifier(value: string): string {
  return value.replace(/codex/giu, (match) => {
    if (match === match.toUpperCase()) return "RUNTIME"
    if (match === match.toLowerCase()) return "runtime"
    return "Runtime"
  })
}

export function getPublicRuntimeMessage(
  value: string | null | undefined,
  fallback: string
): string {
  const message = value?.trim()
  if (!message || containsInternalPlatformName(message)) return fallback
  return message
}
