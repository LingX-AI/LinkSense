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
  MIN_CONVERSATION_WORKSPACE_WIDTH,
  MIN_PRESENTATION_PREVIEW_WIDTH,
  MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH,
  getConversationWorkspaceWidthBounds,
  resolveConversationWorkspaceWidth,
} from "@/features/conversations/conversation-presentation-width"

export const DEFAULT_INTERACTIVE_APPLICATION_CHAT_RATIO = 1 / 3

function measureWidth(element: HTMLElement) {
  const rectWidth = element.getBoundingClientRect().width
  return Math.max(0, Math.round(rectWidth || element.clientWidth))
}

function resolveWorkspaceCssWidth(customRatio: number | null) {
  const customPercentage =
    customRatio === null ? null : Number((customRatio * 100).toFixed(4))
  const preferredWidth =
    customPercentage === null
      ? `${(1 - DEFAULT_INTERACTIVE_APPLICATION_CHAT_RATIO) * 100}%`
      : `${customPercentage}%`
  return `clamp(${MIN_CONVERSATION_WORKSPACE_WIDTH}px, ${preferredWidth}, calc(100% - ${MIN_PRESENTATION_PREVIEW_WIDTH}px))`
}

export function InteractiveApplicationSplitLayout({
  application,
  chat,
  chatOpen,
  resizeLabel,
}: Readonly<{
  application: ReactNode
  chat: ReactNode
  chatOpen: boolean
  resizeLabel: string
}>) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [layoutWidth, setLayoutWidth] = useState(0)
  const [customApplicationRatio, setCustomApplicationRatio] = useState<
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

  const applicationWidth = resolveConversationWorkspaceWidth({
    layoutWidth,
    viewportWidth: layoutWidth,
    customRatio: customApplicationRatio,
    defaultPreviewViewportRatio: DEFAULT_INTERACTIVE_APPLICATION_CHAT_RATIO,
  })
  const bounds = getConversationWorkspaceWidthBounds(layoutWidth)
  const compact =
    layoutWidth > 0 && layoutWidth <= MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH
  const layoutStyle = {
    // Keep the computed declaration stable while an ancestor changes width.
    // The browser can then resize both panes in the same layout pass instead of
    // restarting this grid's transition for every ResizeObserver measurement.
    "--interactive-application-workspace-width": resolveWorkspaceCssWidth(
      customApplicationRatio
    ),
  } as CSSProperties

  return (
    <div
      ref={setLayoutNode}
      className="interactive-application-layout"
      data-chat-open={chatOpen ? "true" : "false"}
      data-compact={compact ? "true" : undefined}
      data-chat-resizing={resizing ? "true" : undefined}
      style={layoutStyle}
    >
      <div
        className="interactive-application-workspace"
        aria-hidden={compact && chatOpen}
        inert={compact && chatOpen}
      >
        {application}
      </div>
      {chatOpen && layoutWidth > 0 && !compact && (
        <SidebarResizer
          label={resizeLabel}
          value={applicationWidth}
          minValue={bounds.minimum}
          maxValue={bounds.maximum}
          className="interactive-application-chat-resize-handle"
          onResize={(nextWidth) =>
            setCustomApplicationRatio(nextWidth / layoutWidth)
          }
          onResizeStart={() => setResizing(true)}
          onResizeEnd={() => setResizing(false)}
        />
      )}
      <div
        className="interactive-application-chat-pane"
        aria-hidden={!chatOpen}
        inert={!chatOpen}
      >
        {chat}
      </div>
    </div>
  )
}
