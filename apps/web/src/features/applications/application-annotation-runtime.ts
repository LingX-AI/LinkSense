import {
  applicationAnnotationPagePathSchema,
  maximumOfficeAnnotationCount,
} from "@linksense/shared"
import selectoBrowserRuntimeUrl from "selecto/dist/selecto.min.js?url"
import {
  htmlAnnotatedAttribute,
  htmlSelectedAttribute,
  htmlSelectableAttribute,
  htmlSelectionOverlayAttribute,
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionMessageType,
  htmlPreviewSelectionClearMessageType,
  maximumHtmlSelectionCount,
  installHtmlPreviewAnnotationController,
  type SelectoConstructor,
} from "@/components/media/html-preview/html-preview-selection"
import {
  htmlPreviewAnnotationsMessageType,
  htmlPreviewAnnotationFramesMessageType,
  htmlPreviewAnnotationFocusMessageType,
  installHtmlPreviewAnnotationsController,
} from "@/components/media/html-preview/html-preview-annotations"
import { getHtmlPreviewBoundingRect } from "@/components/media/html-preview/html-preview-geometry"
import { installOfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover-controller"
import { officeAnnotationCursor } from "@/components/media/office-preview/office-annotation-cursor"

function isSelectoConstructor(value: unknown): value is SelectoConstructor {
  if (typeof value !== "function") return false
  const prototype: unknown = Reflect.get(value, "prototype")
  return (
    typeof prototype === "object" &&
    prototype !== null &&
    typeof Reflect.get(prototype, "on") === "function" &&
    typeof Reflect.get(prototype, "destroy") === "function"
  )
}

/** Return a source-relative locator, never the signed runtime URL or its query. */
export function applicationAnnotationPagePath(
  source: string,
  current: string,
  origin: string
): string | null {
  const runtime = new URL(source, origin)
  const page = new URL(current, origin)
  if (
    runtime.origin !== origin ||
    page.origin !== origin ||
    !runtime.pathname.startsWith("/api/v1/interactive-app-runtime/")
  )
    return null
  const root = runtime.pathname.slice(0, runtime.pathname.lastIndexOf("/") + 1)
  if (!page.pathname.startsWith(root)) return null
  const parsed = applicationAnnotationPagePathSchema.safeParse(
    page.pathname.slice(root.length)
  )
  return parsed.success && /\.html?$/iu.test(parsed.data) ? parsed.data : null
}

/** Use the existing HTML selection engine in this same-origin application's DOM. */
export function installApplicationAnnotationRuntime(
  frame: HTMLIFrameElement,
  source: string,
  onReady: (path: string) => void,
  onError: () => void,
  onMessage: (message: unknown) => void
): () => void {
  let cleanup = () => {}
  try {
    const target = frame.contentWindow
    if (!target) throw new Error("missing_preview_window")
    const path = applicationAnnotationPagePath(
      source,
      target.location.href,
      window.location.origin
    )
    if (!path) throw new Error("invalid_preview_location")
    const document = target.document
    const previousSelecto = Object.getOwnPropertyDescriptor(target, "Selecto")
    let selectoRestored = false
    const restoreSelecto = () => {
      if (selectoRestored) return
      selectoRestored = true
      if (previousSelecto)
        Object.defineProperty(target, "Selecto", previousSelecto)
      else Reflect.deleteProperty(target, "Selecto")
    }
    const script = document.createElement("script")
    script.src = new URL(selectoBrowserRuntimeUrl, window.location.href).href
    let disposed = false
    let destroyControllers = () => {}
    // These controllers run in the host's realm. postMessage would identify
    // the host as the sender, not this iframe. Report through this frame-bound
    // callback instead; sandboxed HTML previews use their own message transport.
    const reportMessage = (message: unknown) => {
      if (disposed) return
      try {
        if (frame.contentWindow !== target || target.document !== document)
          return
      } catch {
        return
      }
      onMessage(message)
    }
    const timeout = window.setTimeout(() => {
      cleanup()
      onError()
    }, 15_000)
    script.onerror = () => {
      cleanup()
      onError()
    }
    script.onload = () => {
      if (disposed) return
      window.clearTimeout(timeout)
      const Selecto: unknown = Reflect.get(target, "Selecto")
      restoreSelecto()
      if (!isSelectoConstructor(Selecto)) {
        cleanup()
        onError()
        return
      }
      const selection = installHtmlPreviewAnnotationController(target, {
        reportMessage,
        blockApplicationEvents: true,
        selectoConstructor: Selecto,
        modeMessageType: htmlPreviewAnnotationModeMessageType,
        selectionMessageType: htmlPreviewSelectionMessageType,
        clearMessageType: htmlPreviewSelectionClearMessageType,
        selectableAttribute: htmlSelectableAttribute,
        selectedAttribute: htmlSelectedAttribute,
        annotatedAttribute: htmlAnnotatedAttribute,
        overlayAttribute: htmlSelectionOverlayAttribute,
        maximumSelectionCount: maximumHtmlSelectionCount,
        annotationCursor: officeAnnotationCursor,
        installHover: installOfficeAnnotationHover,
        getBoundingRect: getHtmlPreviewBoundingRect,
      })
      const markers = installHtmlPreviewAnnotationsController(target, {
        reportMessage,
        markersMessageType: htmlPreviewAnnotationsMessageType,
        framesMessageType: htmlPreviewAnnotationFramesMessageType,
        focusMessageType: htmlPreviewAnnotationFocusMessageType,
        maximumMarkers: maximumOfficeAnnotationCount,
        maximumElements: maximumHtmlSelectionCount,
        annotatedAttribute: htmlAnnotatedAttribute,
        getBoundingRect: getHtmlPreviewBoundingRect,
      })
      destroyControllers = () => {
        selection.destroy()
        markers.destroy()
      }
      onReady(path)
    }
    cleanup = () => {
      if (disposed) return
      disposed = true
      window.clearTimeout(timeout)
      script.onload = null
      script.onerror = null
      script.remove()
      destroyControllers()
      restoreSelecto()
    }
    document.head.append(script)
  } catch {
    cleanup()
    onError()
  }
  return cleanup
}
