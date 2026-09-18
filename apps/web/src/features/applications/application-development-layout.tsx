import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { SidebarResizer } from "@/components/shell/sidebar-resizer"
import {
  getConversationWorkspaceWidthBounds,
  MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH,
  resolveConversationWorkspaceWidth,
} from "@/features/conversations/conversation-presentation-width"
import { cn } from "@/lib/utils"

export function ApplicationDevelopmentLayout({
  children,
  preview,
}: Readonly<{
  children: ReactNode
  preview?: ReactNode
}>) {
  const { t } = useTranslation()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [layoutWidth, setLayoutWidth] = useState(0)
  const [chatRatio, setChatRatio] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const measure = useCallback((element: HTMLElement) => {
    const width = Math.max(
      0,
      Math.round(element.getBoundingClientRect().width || element.clientWidth)
    )
    setLayoutWidth(width)
    if (width <= MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH) setResizing(false)
  }, [])
  const setLayoutNode = useCallback(
    (element: HTMLDivElement | null) => {
      layoutRef.current = element
      if (element) measure(element)
    },
    [measure]
  )

  useEffect(() => {
    const element = layoutRef.current
    if (!element) return
    const update = () => measure(element)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [measure])

  const compact = layoutWidth <= MIN_RESIZABLE_PRESENTATION_LAYOUT_WIDTH
  const chatWidth = resolveConversationWorkspaceWidth({
    layoutWidth,
    viewportWidth: layoutWidth,
    customRatio: chatRatio,
    defaultPreviewViewportRatio: 0.6,
  })
  const bounds = getConversationWorkspaceWidthBounds(layoutWidth)
  // Dynamic geometry is passed to Tailwind through a CSS variable, as in the other split layouts.
  const layoutStyle: CSSProperties & {
    "--application-development-chat-width": string
  } = {
    "--application-development-chat-width": `${chatWidth}px`,
  }
  return (
    <div
      ref={setLayoutNode}
      style={layoutStyle}
      data-compact={compact ? "true" : undefined}
      data-resizing={resizing && preview ? "true" : undefined}
      className={cn(
        "relative grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-1",
        preview &&
          (compact
            ? "grid-rows-2"
            : "grid-cols-[var(--application-development-chat-width)_minmax(0,1fr)]"),
        resizing &&
          preview &&
          "cursor-col-resize select-none [&_*]:cursor-col-resize [&_iframe]:pointer-events-none"
      )}
    >
      <div className="min-h-0 min-w-0">{children}</div>
      {preview && !compact && (
        <SidebarResizer
          label={t("applicationDevelopment.resizePreview")}
          value={chatWidth}
          minValue={bounds.minimum}
          maxValue={bounds.maximum}
          className="top-0! bottom-0! left-[var(--application-development-chat-width)]! z-50! block!"
          onResize={(width) => setChatRatio(width / layoutWidth)}
          onResizeStart={() => setResizing(true)}
          onResizeEnd={() => setResizing(false)}
        />
      )}
      {preview && (
        <div
          className={cn(
            "min-h-0 min-w-0 overflow-hidden border-[color:var(--app-border)]",
            compact ? "border-t" : "border-l"
          )}
        >
          {preview}
        </div>
      )}
    </div>
  )
}
