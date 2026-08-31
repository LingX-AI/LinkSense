import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"

import { SidebarResizer } from "@/components/shell/sidebar-resizer"
import {
  DEFAULT_PRESENTATION_PREVIEW_VIEWPORT_RATIO,
  getConversationWorkspaceWidthBounds,
  resolveConversationWorkspaceWidth,
  shouldOverlayPresentationPreview,
} from "@/features/conversations/conversation-presentation-width"

function measureWidth(element: HTMLElement) {
  const rectWidth = element.getBoundingClientRect().width
  return Math.max(0, Math.round(rectWidth || element.clientWidth))
}

export function ConversationOfficeLayout({
  children,
  preview,
  resizeLabel,
  defaultPreviewViewportRatio = DEFAULT_PRESENTATION_PREVIEW_VIEWPORT_RATIO,
  taskOverviewOpen = false,
}: Readonly<{
  children: ReactNode
  preview?: ReactNode
  resizeLabel: string
  defaultPreviewViewportRatio?: number
  taskOverviewOpen?: boolean
}>) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [layoutWidth, setLayoutWidth] = useState(0)
  const [customWorkspaceRatio, setCustomWorkspaceRatio] = useState<
    number | null
  >(null)
  const [resizing, setResizing] = useState(false)

  const updateLayoutWidth = useCallback((element: HTMLElement) => {
    const nextWidth = measureWidth(element)
    setLayoutWidth((currentWidth) =>
      currentWidth === nextWidth ? currentWidth : nextWidth
    )
  }, [])

  const setLayoutNode = useCallback(
    (element: HTMLDivElement | null) => {
      layoutRef.current = element
      if (element) updateLayoutWidth(element)
    },
    [updateLayoutWidth]
  )

  useEffect(() => {
    const element = layoutRef.current
    if (!element) return

    const handleResize = () => updateLayoutWidth(element)
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(handleResize)
    resizeObserver?.observe(element)
    window.addEventListener("resize", handleResize)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener("resize", handleResize)
    }
  }, [updateLayoutWidth])

  const viewportWidth =
    typeof window === "undefined" ? layoutWidth : window.innerWidth
  const workspaceWidth = resolveConversationWorkspaceWidth({
    layoutWidth,
    viewportWidth,
    customRatio: customWorkspaceRatio,
    defaultPreviewViewportRatio,
  })
  const bounds = getConversationWorkspaceWidthBounds(layoutWidth)
  const overlayPreview = shouldOverlayPresentationPreview(layoutWidth)
  const layoutStyle = {
    "--conversation-workspace-width":
      layoutWidth > 0
        ? `${workspaceWidth}px`
        : `calc(100% - ${defaultPreviewViewportRatio * 100}vw)`,
  } as CSSProperties

  return (
    <div
      ref={setLayoutNode}
      className="conversation-office-layout conversation-presentation-layout"
      data-has-office-preview={preview ? "true" : undefined}
      data-has-presentation-preview={preview ? "true" : undefined}
      data-overlay-office-preview={
        preview && overlayPreview ? "true" : undefined
      }
      data-overlay-presentation-preview={
        preview && overlayPreview ? "true" : undefined
      }
      data-preview-resizing={resizing ? "true" : undefined}
      style={layoutStyle}
    >
      <div
        className="conversation-workspace"
        data-task-overview-open={taskOverviewOpen ? "true" : undefined}
      >
        {children}
      </div>
      {preview && layoutWidth > 0 && !overlayPreview && (
        <SidebarResizer
          label={resizeLabel}
          value={workspaceWidth}
          minValue={bounds.minimum}
          maxValue={bounds.maximum}
          className="office-preview-resize-handle presentation-preview-resize-handle"
          onResize={(nextWidth) =>
            setCustomWorkspaceRatio(nextWidth / layoutWidth)
          }
          onResizeStart={() => setResizing(true)}
          onResizeEnd={() => setResizing(false)}
        />
      )}
      {preview}
    </div>
  )
}

/** @deprecated Use ConversationOfficeLayout. */
export const ConversationPresentationLayout = ConversationOfficeLayout
