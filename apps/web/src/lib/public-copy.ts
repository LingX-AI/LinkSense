import { modelGatewayErrorMessages } from "@linksense/shared"
import { z } from "zod"

const internalPlatformNamePattern = /codex/iu
const gatewayErrorSchema = z.object({
  error: z.object({ code: z.string() }),
})

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
  fallback: string,
  translate?: (key: string) => string
): string {
  const message = value?.trim()
  if (message) {
    const jsonStart = message.indexOf("{")
    if (jsonStart >= 0 || message.startsWith("[")) {
      try {
        const json: unknown = JSON.parse(
          message.slice(jsonStart >= 0 ? jsonStart : 0)
        )
        const parsed = gatewayErrorSchema.safeParse(json)
        if (
          parsed.success &&
          Object.hasOwn(modelGatewayErrorMessages, parsed.data.error.code)
        ) {
          return (
            translate?.(`errors.modelGateway.${parsed.data.error.code}`) ??
            fallback
          )
        }
      } catch {
        // Historical runtime messages can contain truncated JSON bodies.
      }
      return fallback
    }
    for (const [code, text] of Object.entries(modelGatewayErrorMessages)) {
      if (message === text)
        return translate?.(`errors.modelGateway.${code}`) ?? fallback
    }
  }
  if (!message || containsInternalPlatformName(message)) return fallback
  return message
}
