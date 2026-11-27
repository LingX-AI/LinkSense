import { z } from "zod"
export { interactiveHtmlPreviewSandbox } from "@linksense/shared"

export const htmlPreviewShellPath = "/assistant-html-preview-shell.html"
export const htmlPreviewShellReadyMessageType =
  "linksense:assistant-html-preview:shell-ready"
export const htmlPreviewShellInitializeMessageType =
  "linksense:assistant-html-preview:initialize"

const htmlPreviewShellReadyMessageSchema = z.object({
  type: z.literal(htmlPreviewShellReadyMessageType),
  previewId: z.string().min(1).max(256),
})

export function buildHtmlPreviewShellSource(
  previewId: string,
  attempt: number,
  entryUrl = htmlPreviewShellPath
) {
  return `${entryUrl}?previewId=${encodeURIComponent(
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
