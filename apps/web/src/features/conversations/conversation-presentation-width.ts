export const DEFAULT_CONVERSATION_PREVIEW_VIEWPORT_RATIO = 2 / 5
export const DEFAULT_PRESENTATION_PREVIEW_VIEWPORT_RATIO =
  DEFAULT_CONVERSATION_PREVIEW_VIEWPORT_RATIO
export const DEFAULT_SUBAGENT_DETAIL_VIEWPORT_RATIO =
  DEFAULT_CONVERSATION_PREVIEW_VIEWPORT_RATIO
export const MIN_CONVERSATION_WORKSPACE_WIDTH = 320
export const MIN_PRESENTATION_PREVIEW_WIDTH = 480
export const MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH =
  MIN_CONVERSATION_WORKSPACE_WIDTH + MIN_PRESENTATION_PREVIEW_WIDTH

type WorkspaceWidthBounds = Readonly<{
  minimum: number
  maximum: number
}>

export function getConversationWorkspaceWidthBounds(
  layoutWidth: number
): WorkspaceWidthBounds {
  const normalizedLayoutWidth = Math.max(0, Math.round(layoutWidth))
  const maximum = Math.max(
    0,
    normalizedLayoutWidth - MIN_PRESENTATION_PREVIEW_WIDTH
  )
  return {
    minimum: Math.min(MIN_CONVERSATION_WORKSPACE_WIDTH, maximum),
    maximum,
  }
}

export function resolveConversationWorkspaceWidth({
  layoutWidth,
  viewportWidth,
  customRatio,
  defaultPreviewViewportRatio = DEFAULT_PRESENTATION_PREVIEW_VIEWPORT_RATIO,
}: Readonly<{
  layoutWidth: number
  viewportWidth: number
  customRatio: number | null
  defaultPreviewViewportRatio?: number
}>) {
  const bounds = getConversationWorkspaceWidthBounds(layoutWidth)
  const preferredWidth =
    customRatio === null
      ? layoutWidth - viewportWidth * defaultPreviewViewportRatio
      : layoutWidth * customRatio
  const normalizedWidth = Number.isFinite(preferredWidth)
    ? Math.round(preferredWidth)
    : bounds.minimum
  return Math.min(bounds.maximum, Math.max(bounds.minimum, normalizedWidth))
}

export function shouldOverlayPresentationPreview(layoutWidth: number) {
  return (
    layoutWidth > 0 && layoutWidth <= MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH
  )
}
