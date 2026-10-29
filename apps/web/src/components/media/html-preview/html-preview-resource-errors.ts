import { z } from "zod"

export const resourceErrorMessageType = "linksense:html-preview:resource-error"
export const resourceErrorMessageSchema = z.object({
  type: z.literal(resourceErrorMessageType),
  resource: z.string().min(1).max(240),
})

/** Serialized into the sandbox before artifact scripts start. Never report signed URLs. */
export function installHtmlResourceDiagnostics(
  target: Window,
  messageType: string
) {
  const reported = new Set<string>()
  const report = (value: string) => {
    if (reported.size >= 50) return
    let resource: string
    try {
      const url = new URL(value, target.document.baseURI)
      resource =
        url.protocol === "http:" || url.protocol === "https:"
          ? url.pathname
              .replace(/^\/html-preview\/[^/]+\//u, "")
              .split("/")
              .filter(Boolean)
              .slice(-3)
              .join("/")
          : url.protocol
    } catch {
      return
    }
    resource = resource.slice(0, 240)
    if (!resource || reported.has(resource)) return
    reported.add(resource)
    target.parent.postMessage({ type: messageType, resource }, "*")
  }
  target.addEventListener(
    "error",
    (event) => {
      const element = event.target
      if (
        element &&
        "getAttribute" in element &&
        typeof element.getAttribute === "function"
      ) {
        const value: unknown =
          element.getAttribute("src") ?? element.getAttribute("href")
        if (typeof value === "string") report(value)
      }
    },
    true
  )
  target.document.addEventListener("securitypolicyviolation", (event) => {
    if (event.blockedURI && !["inline", "eval"].includes(event.blockedURI))
      report(event.blockedURI)
  })
}
