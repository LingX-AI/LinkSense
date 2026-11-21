import { z } from "zod"
import { applicationAnnotationPagePathSchema } from "@linksense/shared"

/**
 * First-party protocol between the packaged Mac host page and the runtime
 * iframe it embeds. The controller itself never travels in a message: the
 * native preload bundles it at build time and only values pass over
 * postMessage.
 */
export const desktopApplicationAnnotationBridgeVersion = 1
export const desktopApplicationAnnotationConfigGlobal =
  "__linksenseDesktopApplicationAnnotationConfig"
export const desktopApplicationAnnotationParentOrigin = "mygo://localhost"
const messagePrefix = "linksense:desktop-application-annotation"
export const desktopApplicationAnnotationInitializeMessageType = `${messagePrefix}:initialize`
export const desktopApplicationAnnotationReadyMessageType = `${messagePrefix}:ready`
export const desktopApplicationAnnotationDestroyMessageType = `${messagePrefix}:destroy`
export const desktopApplicationAnnotationClosedMessageType = `${messagePrefix}:closed`
export const desktopApplicationAnnotationLocationMessageType = `${messagePrefix}:location`
export const desktopApplicationAnnotationLocationQueryMessageType = `${messagePrefix}:location-query`
export const applicationAnnotationRuntimePathPrefix =
  "/api/v1/interactive-app-runtime/"
const applicationAnnotationTicketPattern = /^[A-Za-z0-9_-]{43}$/u

export type ApplicationAnnotationRuntimeLocation = Readonly<{
  ticket: string
  path: string
}>

/** The page path is relative to its ticket root, never an absolute URL. */
export function applicationAnnotationRuntimeLocation(
  pathname: string
): ApplicationAnnotationRuntimeLocation | null {
  if (!pathname.startsWith(applicationAnnotationRuntimePathPrefix)) return null
  const relative = pathname.slice(applicationAnnotationRuntimePathPrefix.length)
  const slash = relative.indexOf("/")
  if (slash <= 0) return null
  const ticket = relative.slice(0, slash)
  const path = relative.slice(slash + 1)
  if (
    !applicationAnnotationTicketPattern.test(ticket) ||
    !path ||
    !/\.html?$/iu.test(path)
  )
    return null
  const parsed = applicationAnnotationPagePathSchema.safeParse(path)
  return parsed.success ? { ticket, path: parsed.data } : null
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/gu, "")
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  )
}

/**
 * The native host supplies the exact packaged API origin. It is accepted only
 * when it is already a serialized origin, uses HTTPS, or uses loopback HTTP
 * for development and whitebox builds.
 */
export const desktopApplicationAnnotationConfigSchema = z
  .strictObject({
    version: z.literal(desktopApplicationAnnotationBridgeVersion),
    serverOrigin: z.string().min(1).max(2_048),
    parentOrigin: z.literal(desktopApplicationAnnotationParentOrigin),
  })
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value.serverOrigin)
    } catch {
      context.addIssue({ code: "custom", message: "invalid_server_origin" })
      return
    }
    if (url.origin !== value.serverOrigin) {
      context.addIssue({
        code: "custom",
        message: "server_origin_not_serialized",
      })
      return
    }
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHostname(url.hostname))
    ) {
      context.addIssue({
        code: "custom",
        message: "server_origin_requires_https",
      })
    }
  })

export type DesktopApplicationAnnotationConfig = z.infer<
  typeof desktopApplicationAnnotationConfigSchema
>

/** Read and remove the host-provided value before any page script runs. */
export function readDesktopApplicationAnnotationConfig(
  targetWindow: Window
): DesktopApplicationAnnotationConfig | null {
  const value = Reflect.get(
    targetWindow,
    desktopApplicationAnnotationConfigGlobal
  )
  Reflect.deleteProperty(targetWindow, desktopApplicationAnnotationConfigGlobal)
  const parsed = desktopApplicationAnnotationConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const applicationAnnotationHtmlPathSchema = applicationAnnotationPagePathSchema.refine(
  (value) => /\.html?$/iu.test(value)
)

export const desktopApplicationAnnotationReadySchema = z.strictObject({
  type: z.literal(desktopApplicationAnnotationReadyMessageType),
  ticket: z.string().regex(applicationAnnotationTicketPattern),
  path: applicationAnnotationHtmlPathSchema,
})

/**
 * A same-document route report, or the answer to a host location query. A null
 * path means the live route is outside the selected ticket, so the current
 * page must not be released for annotation.
 */
export const desktopApplicationAnnotationLocationSchema = z.strictObject({
  type: z.literal(desktopApplicationAnnotationLocationMessageType),
  ticket: z.string().regex(applicationAnnotationTicketPattern),
  path: applicationAnnotationHtmlPathSchema.nullable(),
  queryId: z.number().int().nonnegative().max(1_000_000).optional(),
})

/** The child accepts only its real parent, at the exact native origin. */
export function isDesktopApplicationAnnotationParentEvent(
  event: Readonly<{ isTrusted: boolean; origin: string; source: unknown }>,
  parent: Window,
  parentOrigin: string
): boolean {
  return (
    parentOrigin === desktopApplicationAnnotationParentOrigin &&
    event.isTrusted &&
    event.origin === parentOrigin &&
    event.source === parent
  )
}
