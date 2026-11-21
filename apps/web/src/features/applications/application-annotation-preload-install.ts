import Selecto from "selecto"
import { maximumOfficeAnnotationCount } from "@linksense/shared"
import {
  htmlAnnotatedAttribute,
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionClearMessageType,
  htmlPreviewSelectionMessageType,
  htmlSelectableAttribute,
  htmlSelectedAttribute,
  htmlSelectionOverlayAttribute,
  installHtmlPreviewAnnotationController,
  maximumHtmlSelectionCount,
} from "@/components/media/html-preview/html-preview-selection"
import {
  htmlPreviewAnnotationFocusMessageType,
  htmlPreviewAnnotationFramesMessageType,
  htmlPreviewAnnotationsMessageType,
  installHtmlPreviewAnnotationsController,
} from "@/components/media/html-preview/html-preview-annotations"
import { getHtmlPreviewBoundingRect } from "@/components/media/html-preview/html-preview-geometry"
import { installOfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover-controller"
import { officeAnnotationCursor } from "@/components/media/office-preview/office-annotation-cursor"
import {
  applicationAnnotationRuntimeLocation,
  desktopApplicationAnnotationClosedMessageType,
  desktopApplicationAnnotationDestroyMessageType,
  desktopApplicationAnnotationInitializeMessageType,
  desktopApplicationAnnotationLocationMessageType,
  desktopApplicationAnnotationLocationQueryMessageType,
  desktopApplicationAnnotationReadyMessageType,
  isDesktopApplicationAnnotationParentEvent,
  type DesktopApplicationAnnotationConfig,
} from "./application-annotation-bridge"

/**
 * Installed by the Mac host preload in the runtime iframe, before its own
 * scripts. It runs only as a direct child of the native window at the exact
 * packaged API origin. No native binding is available here, so every report
 * goes to the real parent at its exact origin.
 */
export function installDesktopApplicationAnnotationBridge(
  targetWindow: Window,
  config: DesktopApplicationAnnotationConfig
): () => void {
  const ignore = () => {}
  let parent: Window
  try {
    if (
      targetWindow.parent === targetWindow ||
      targetWindow.parent !== targetWindow.top
    )
      return ignore
    parent = targetWindow.parent
  } catch {
    return ignore
  }
  if (targetWindow.location.origin !== config.serverOrigin) return ignore
  const location = applicationAnnotationRuntimeLocation(
    targetWindow.location.pathname
  )
  if (!location) return ignore
  const contentType = targetWindow.document.contentType
  if (contentType && contentType !== "text/html") return ignore
  const originalPath = targetWindow.location.pathname
  const ticket = location.ticket
  // The live route must remain inside the ticket this document was handed for.
  const currentPath = (): string | null => {
    const live = applicationAnnotationRuntimeLocation(
      targetWindow.location.pathname
    )
    return live && live.ticket === ticket ? live.path : null
  }
  let stop = ignore
  let suppressActivation = () => false
  const preventActivation = (event: Event) => {
    if (!suppressActivation()) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  // Register before the application installs its own capture listeners.
  targetWindow.addEventListener("click", preventActivation, true)
  targetWindow.addEventListener("submit", preventActivation, true)
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (
      !isDesktopApplicationAnnotationParentEvent(event, parent, config.parentOrigin) ||
      event.data !== desktopApplicationAnnotationInitializeMessageType ||
      event.ports.length !== 1 ||
      targetWindow.location.pathname !== originalPath
    ) return
    event.stopImmediatePropagation()
    stop()
    const port = event.ports[0]
    if (!port) return
    let closed = false
    let dispose = ignore
    let disposeLocationWatch = ignore
    let reportedPath: string | null = location.path
    let activePath: string | null = null
    const routeActive = () =>
      !closed && activePath !== null && currentPath() === activePath
    // Same-document route changes keep this document and port alive. Only a
    // pagehide or a new document generation closes the channel.
    const sendLocation = (queryId?: number) => {
      if (closed) return
      const path = currentPath()
      if (queryId === undefined && path === reportedPath) return
      reportedPath = path
      if (activePath !== null && activePath !== path) activePath = null
      port.postMessage({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path,
        ...(queryId === undefined ? {} : { queryId }),
      })
    }
    const abort = () => {
      if (closed) return
      closed = true
      suppressActivation = () => false
      activePath = null
      port.postMessage(desktopApplicationAnnotationClosedMessageType)
      port.close()
      dispose()
      disposeLocationWatch()
      targetWindow.removeEventListener("pagehide", abort)
    }
    stop = abort
    const report = (message: unknown) => {
      if (!closed && currentPath() !== null) port.postMessage(message)
    }
    port.addEventListener("message", (message: MessageEvent<unknown>) => {
      if (message.data === desktopApplicationAnnotationDestroyMessageType) {
        abort()
        return
      }
      if (!message.data || typeof message.data !== "object") return
      const data = message.data as {
        type?: unknown
        enabled?: unknown
        id?: unknown
      }
      if (
        data.type === htmlPreviewAnnotationModeMessageType &&
        typeof data.enabled === "boolean"
      ) {
        activePath = data.enabled ? currentPath() : null
        return
      }
      if (
        data.type === desktopApplicationAnnotationLocationQueryMessageType &&
        typeof data.id === "number" &&
        Number.isInteger(data.id) &&
        data.id >= 0 &&
        data.id <= 1_000_000
      ) {
        sendLocation(data.id)
      }
    })
    const options = {
      reportMessage: report,
      messagePort: port,
      // The transferred port is the capability; the trusted parent handoff was
      // checked on the window message that delivered it.
      acceptEvent: () => !closed,
    }
    try {
      const selection = installHtmlPreviewAnnotationController(targetWindow, {
        ...options,
        blockApplicationEvents: routeActive,
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
      dispose = selection.destroy
      const annotations = installHtmlPreviewAnnotationsController(
        targetWindow,
        {
          ...options,
          markersMessageType: htmlPreviewAnnotationsMessageType,
          framesMessageType: htmlPreviewAnnotationFramesMessageType,
          focusMessageType: htmlPreviewAnnotationFocusMessageType,
          maximumMarkers: maximumOfficeAnnotationCount,
          maximumElements: maximumHtmlSelectionCount,
          annotatedAttribute: htmlAnnotatedAttribute,
          getBoundingRect: getHtmlPreviewBoundingRect,
        }
      )
      dispose = () => {
        selection.destroy()
        annotations.destroy()
      }
      suppressActivation = () => routeActive() && selection.isActive()
    } catch {
      abort()
      return
    }
    // The Navigation API reports same-document entries, including
    // pushState/replaceState. Older WebKit only has the History API, whose
    // popstate/hashchange events miss those calls, so wrap them narrowly.
    const navigation = Reflect.get(targetWindow, "navigation") as
      | {
          addEventListener?: (type: string, listener: () => void) => void
          removeEventListener?: (type: string, listener: () => void) => void
        }
      | undefined
    if (
      typeof navigation?.addEventListener === "function" &&
      typeof navigation.removeEventListener === "function"
    ) {
      const onChange = () => sendLocation()
      navigation.addEventListener("currententrychange", onChange)
      disposeLocationWatch = () =>
        navigation.removeEventListener?.("currententrychange", onChange)
    } else {
      const history = targetWindow.history
      const originalPushState = history.pushState
      const originalReplaceState = history.replaceState
      let scheduled = false
      const schedule = () => {
        if (scheduled || closed) return
        scheduled = true
        targetWindow.queueMicrotask(() => {
          scheduled = false
          sendLocation()
        })
      }
      const pushState = function (
        this: History,
        ...args: Parameters<History["pushState"]>
      ) {
        const result = originalPushState.apply(this, args)
        schedule()
        return result
      }
      const replaceState = function (
        this: History,
        ...args: Parameters<History["replaceState"]>
      ) {
        const result = originalReplaceState.apply(this, args)
        schedule()
        return result
      }
      history.pushState = pushState
      history.replaceState = replaceState
      const onHistoryEvent = () => sendLocation()
      targetWindow.addEventListener("popstate", onHistoryEvent)
      targetWindow.addEventListener("hashchange", onHistoryEvent)
      disposeLocationWatch = () => {
        if (history.pushState === pushState)
          history.pushState = originalPushState
        if (history.replaceState === replaceState)
          history.replaceState = originalReplaceState
        targetWindow.removeEventListener("popstate", onHistoryEvent)
        targetWindow.removeEventListener("hashchange", onHistoryEvent)
      }
    }
    targetWindow.addEventListener("pagehide", abort, { once: true })
    port.postMessage({ type: desktopApplicationAnnotationReadyMessageType, ...location })
    port.start()
  }
  targetWindow.addEventListener("message", handleMessage, true)
  return () => {
    targetWindow.removeEventListener("message", handleMessage, true)
    targetWindow.removeEventListener("click", preventActivation, true)
    targetWindow.removeEventListener("submit", preventActivation, true)
    stop()
  }
}
