import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from "framer-motion"
import {
  ArrowUpRightIcon,
  GlobeIcon,
  GripVerticalIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { z } from "zod"
import type { localBrowserPreviewSchema } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { browserExtensionRequest } from "./bridge"
import {
  nearestPreviewCorner,
  previewCornerPosition,
  readPreviewCorner,
  type PreviewCorner,
} from "./preview-position"

type Preview = z.infer<typeof localBrowserPreviewSchema>

export function LocalBrowserPreview({
  userId,
  conversationId,
}: {
  userId: string
  conversationId: string
}) {
  const [dismissedTab, setDismissedTab] = useState<number | null>(null)
  const query = useQuery({
    queryKey: ["local-browser-preview", userId, conversationId],
    queryFn: () =>
      browserExtensionRequest("preview", undefined, {
        owner_id: userId,
        conversation_id: conversationId,
      }),
    retry: false,
    gcTime: 0,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 1500 : false,
    refetchOnWindowFocus: "always",
  })
  const preview = query.data?.preview
  if (!preview || preview.tab_id === dismissedTab) return null
  return (
    <PreviewCard
      key={`${userId}:${conversationId}:${preview.tab_id}`}
      userId={userId}
      conversationId={conversationId}
      preview={preview}
      onClose={() => setDismissedTab(preview.tab_id)}
    />
  )
}

function PreviewCard({
  userId,
  conversationId,
  preview,
  onClose,
}: {
  userId: string
  conversationId: string
  preview: Preview
  onClose: () => void
}) {
  const { t } = useTranslation()
  const boundary = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const controls = useDragControls()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const reducedMotion = useReducedMotion()
  const preferenceKey = `linksense.browser-preview-corner:${userId}`
  const [corner, setCorner] = useState(() => readPreviewCorner(preferenceKey))
  const cornerRef = useRef(corner)
  const dragged = useRef(false)
  const dragging = useRef(false)
  const activation = useMutation({
    mutationFn: async () => {
      const result = await browserExtensionRequest("activate", undefined, {
        owner_id: userId,
        conversation_id: conversationId,
        tab_id: preview.tab_id,
      })
      if (!result.ok) throw new Error("browser tab unavailable")
    },
    retry: false,
  })
  useLayoutEffect(() => {
    const container = boundary.current
    const card = panel.current
    if (!container || !card) return
    const fit = () => {
      if (dragging.current) return
      const target = previewCornerPosition(
        cornerRef.current,
        container.getBoundingClientRect(),
        card.getBoundingClientRect()
      )
      x.stop()
      y.stop()
      x.set(target.x)
      y.set(target.y)
    }
    fit()
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit)
    observer?.observe(container)
    observer?.observe(card)
    window.addEventListener("resize", fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", fit)
      x.stop()
      y.stop()
    }
  }, [x, y])

  const snap = (next: PreviewCorner) => {
    if (!boundary.current || !panel.current) return
    cornerRef.current = next
    setCorner(next)
    try {
      localStorage.setItem(preferenceKey, next)
    } catch {
      /* Position memory is optional. */
    }
    const target = previewCornerPosition(
      next,
      boundary.current.getBoundingClientRect(),
      panel.current.getBoundingClientRect()
    )
    x.stop()
    y.stop()
    if (reducedMotion) {
      x.set(target.x)
      y.set(target.y)
    } else {
      animate(x, target.x, { type: "spring", stiffness: 400, damping: 40 })
      animate(y, target.y, { type: "spring", stiffness: 400, damping: 40 })
    }
  }
  const keyboardMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = cornerRef.current
    const destinations: Record<string, PreviewCorner> = {
      ArrowLeft: current.startsWith("top") ? "top-left" : "bottom-left",
      ArrowRight: current.startsWith("top") ? "top-right" : "bottom-right",
      ArrowUp: current.endsWith("left") ? "top-left" : "top-right",
      ArrowDown: current.endsWith("left") ? "bottom-left" : "bottom-right",
    }
    const next = destinations[event.key]
    if (next) {
      event.preventDefault()
      snap(next)
    }
  }
  const startDrag = (event: PointerEvent) => {
    if (event.button !== 0) return
    dragged.current = false
    x.stop()
    y.stop()
    event.currentTarget.setPointerCapture(event.pointerId)
    controls.start(event)
  }

  return (
    <div
      ref={boundary}
      className="pointer-events-none absolute inset-x-3 top-[calc(var(--conversation-top-bar-height,0px)+12px)] bottom-[calc(var(--conversation-bottom-stack-height,0px)+30px)] z-40"
      data-local-browser-preview-boundary=""
    >
      <motion.aside
        ref={panel}
        aria-label={t("localBrowser.previewTitle")}
        data-corner={corner}
        className="pointer-events-auto absolute top-0 left-0 flex max-h-full w-72 max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
        style={{ x, y }}
        drag
        dragControls={controls}
        dragListener={false}
        dragConstraints={boundary}
        dragMomentum={false}
        dragElastic={0}
        onDragStart={() => {
          dragged.current = true
          dragging.current = true
        }}
        onDragEnd={() => {
          dragging.current = false
          if (boundary.current && panel.current)
            snap(
              nearestPreviewCorner(
                { x: x.get(), y: y.get() },
                boundary.current.getBoundingClientRect(),
                panel.current.getBoundingClientRect()
              )
            )
        }}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
          <Button
            type="button"
            variant="plain"
            className="flex h-8 min-h-8 min-w-0 flex-1 cursor-grab touch-none items-center justify-start gap-2 rounded-md px-1 text-xs font-normal text-muted-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            aria-label={t("localBrowser.previewMove")}
            onPointerDown={startDrag}
            onKeyDown={keyboardMove}
          >
            <GripVerticalIcon
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <GlobeIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("localBrowser.previewTitle")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("localBrowser.previewClose")}
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <Button
          type="button"
          variant="plain"
          className="group relative aspect-video h-auto min-h-0 w-full shrink touch-none overflow-hidden rounded-none bg-muted p-0 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-wait"
          aria-label={t("localBrowser.previewActivate", {
            title: preview.title || new URL(preview.url).host,
          })}
          disabled={activation.isPending}
          onPointerDown={startDrag}
          onClick={(event) => {
            if (event.detail === 0 || !dragged.current) activation.mutate()
          }}
        >
          <img
            src={`data:image/jpeg;base64,${preview.image}`}
            alt={preview.title}
            draggable={false}
            className="size-full object-contain"
          />
          <span className="absolute right-2 bottom-2 rounded-md bg-background/90 p-1.5 text-foreground shadow-sm transition-opacity group-hover:opacity-100 motion-safe:md:opacity-0">
            <ArrowUpRightIcon className="size-4" aria-hidden="true" />
          </span>
        </Button>
        <p
          className="shrink-0 truncate px-3 py-2 text-xs text-muted-foreground"
          title={preview.url}
        >
          {preview.title || new URL(preview.url).host}
        </p>
        {activation.isError && (
          <p
            role="alert"
            className="shrink-0 px-3 pb-2 text-xs text-destructive"
          >
            {t("localBrowser.previewUnavailable")}
          </p>
        )}
      </motion.aside>
    </div>
  )
}
