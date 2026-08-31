import { z } from "zod"

export const htmlPreviewShellPath = "/assistant-html-preview-shell.html"
export const htmlPreviewShellReadyMessageType =
  "linksense:assistant-html-preview:shell-ready"
export const htmlPreviewShellInitializeMessageType =
  "linksense:assistant-html-preview:initialize"

// Generated documents may use browser features freely, while the opaque-origin
// boundary keeps their scripts outside the LinkSense application context.
export const interactiveHtmlPreviewSandbox = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-presentation",
  "allow-scripts",
  "allow-storage-access-by-user-activation",
  "allow-top-navigation-by-user-activation",
  "allow-top-navigation-to-custom-protocols",
].join(" ")

const htmlPreviewShellReadyMessageSchema = z.object({
  type: z.literal(htmlPreviewShellReadyMessageType),
  previewId: z.string().min(1).max(256),
})

export function buildHtmlPreviewShellSource(
  previewId: string,
  attempt: number
) {
  return `${htmlPreviewShellPath}?previewId=${encodeURIComponent(
    previewId
  )}&attempt=${attempt}`
}

export function initializeHtmlPreviewShell(
  frameWindow: Window,
  previewId: string,
  html: string
) {
  frameWindow.postMessage(
    {
      type: htmlPreviewShellInitializeMessageType,
      previewId,
      html,
    },
    "*"
  )
}

export function isHtmlPreviewShellReadyMessage(
  value: unknown,
  previewId: string
) {
  const parsed = htmlPreviewShellReadyMessageSchema.safeParse(value)
  return parsed.success && parsed.data.previewId === previewId
}
