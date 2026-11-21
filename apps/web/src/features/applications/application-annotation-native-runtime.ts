import type {
  HtmlAnnotationMarker,
  HtmlSelection,
} from "@/components/media/html-preview/html-preview.types"
import {
  htmlPreviewAnnotationFocusMessage,
  htmlPreviewAnnotationsMessage,
  parseHtmlPreviewAnnotationFrames,
} from "@/components/media/html-preview/html-preview-annotations"
import {
  htmlPreviewAnnotationModeMessage,
  htmlPreviewSelectionClearMessage,
  htmlPreviewSelectionColor,
  parseHtmlPreviewSelectionMessage,
} from "@/components/media/html-preview/html-preview-selection"
import {
  applicationAnnotationRuntimeLocation,
  desktopApplicationAnnotationClosedMessageType,
  desktopApplicationAnnotationDestroyMessageType,
  desktopApplicationAnnotationInitializeMessageType,
  desktopApplicationAnnotationLocationQueryMessageType,
  desktopApplicationAnnotationLocationSchema,
  desktopApplicationAnnotationParentOrigin,
  desktopApplicationAnnotationReadySchema,
} from "./application-annotation-bridge"

const nativeAnnotationReadyTimeoutMs = 5_000
const nativeAnnotationConfirmTimeoutMs = 1_000

export type ApplicationAnnotationNativeRuntimeOptions = Readonly<{
  /** Exact packaged API origin, supplied by the native host information. */
  frameOrigin: string
  /** The real top frame origin; the child rejects anything else. */
  parentOrigin: string
}>

export type ApplicationAnnotationNativeRuntimeHandlers = Readonly<{
  onReady: (path: string) => void
  /** A same-document route report; null means the live route left the ticket. */
  onLocation: (path: string | null) => void
  onError: () => void
  onMessage: (message: unknown) => void
}>

export type ApplicationAnnotationNativeRuntime = Readonly<{
  cleanup: () => void
  /** Read the live route back over the port before releasing a page. */
  confirmPage: () => Promise<string | null>
  setMode: (enabled: boolean) => void
  setMarkers: (markers: readonly HtmlAnnotationMarker[]) => void
  clearSelection: (selection: HtmlSelection) => void
  focus: (selection: HtmlSelection) => void
}>

function unavailableRuntime(): ApplicationAnnotationNativeRuntime {
  const noop = () => {}
  return {
    cleanup: noop,
    confirmPage: () => Promise.resolve(null),
    setMode: noop,
    setMarkers: noop,
    clearSelection: noop,
    focus: noop,
  }
}

type ResolvedNativeRuntime = Readonly<{
  frameWindow: Window
  targetOrigin: string
  ticket: string
}>

function resolveNativeRuntime(
  frame: HTMLIFrameElement,
  source: string,
  options: ApplicationAnnotationNativeRuntimeOptions
): ResolvedNativeRuntime | null {
  try {
    const sourceUrl = new URL(source, window.location.href)
    if (
      options.frameOrigin === "null" ||
      options.parentOrigin === "null" ||
      options.parentOrigin !== desktopApplicationAnnotationParentOrigin ||
      sourceUrl.origin !== options.frameOrigin ||
      frame.ownerDocument !== document ||
      !frame.isConnected ||
      !frame.contentWindow
    )
      return null
    const location = applicationAnnotationRuntimeLocation(sourceUrl.pathname)
    if (!location) return null
    return {
      frameWindow: frame.contentWindow,
      targetOrigin: options.frameOrigin,
      ticket: location.ticket,
    }
  } catch {
    return null
  }
}

/**
 * Host side of the Mac application annotation bridge. The selected frame is
 * bound to a fresh port per page load, with the existing annotation schemas
 * validating the values received over that port.
 */
export function installApplicationAnnotationNativeRuntime(
  frame: HTMLIFrameElement,
  source: string,
  options: ApplicationAnnotationNativeRuntimeOptions,
  handlers: ApplicationAnnotationNativeRuntimeHandlers
): ApplicationAnnotationNativeRuntime {
  const resolved = resolveNativeRuntime(frame, source, options)
  if (!resolved) {
    handlers.onError()
    return unavailableRuntime()
  }
  const { frameWindow, targetOrigin, ticket } = resolved
  const { port1, port2 } = new MessageChannel()
  let active = true
  let ready = false
  const timeout = window.setTimeout(fail, nativeAnnotationReadyTimeoutMs)
  let query: {
    id: number
    timer: number
    resolve: (path: string | null) => void
  } | null = null
  let nextQueryId = 0

  function settleQuery(path: string | null) {
    const pending = query
    if (!pending) return
    query = null
    window.clearTimeout(pending.timer)
    pending.resolve(path)
  }
  function cleanup() {
    if (!active) return
    active = false
    window.clearTimeout(timeout)
    settleQuery(null)
    port1.postMessage(desktopApplicationAnnotationDestroyMessageType)
    port1.close()
    port1.onmessage = null
  }
  function fail() {
    if (!active) return
    cleanup()
    handlers.onError()
  }
  function confirmPage() {
    if (!active || !ready) return Promise.resolve(null)
    // A send is serialized, but a superseded confirmation must not release
    // the page.
    settleQuery(null)
    return new Promise<string | null>((resolve) => {
      const id = ++nextQueryId
      const timer = window.setTimeout(() => {
        if (query?.id !== id) return
        query = null
        resolve(null)
      }, nativeAnnotationConfirmTimeoutMs)
      query = { id, timer, resolve }
      port1.postMessage({
        type: desktopApplicationAnnotationLocationQueryMessageType,
        id,
      })
    })
  }
  const send = (message: Record<string, unknown>) => {
    if (active && ready) port1.postMessage(message)
  }
  // The transferred port is the only channel the child can answer on; the
  // window message that delivered it was already pinned to the frame origin.
  port1.onmessage = (event: MessageEvent<unknown>) => {
    if (!active) return
    if (event.data === desktopApplicationAnnotationClosedMessageType) {
      fail()
      return
    }
    if (!ready) {
      const greeting = desktopApplicationAnnotationReadySchema.safeParse(event.data)
      if (!greeting.success || greeting.data.ticket !== ticket) return
      ready = true
      window.clearTimeout(timeout)
      handlers.onReady(greeting.data.path)
      return
    }
    const location = desktopApplicationAnnotationLocationSchema.safeParse(
      event.data
    )
    if (location.success && location.data.ticket === ticket) {
      handlers.onLocation(location.data.path)
      if (location.data.queryId !== undefined && query?.id === location.data.queryId) {
        const { path } = location.data
        settleQuery(path)
      }
      return
    }
    if (
      parseHtmlPreviewAnnotationFrames(event.data) !== null ||
      parseHtmlPreviewSelectionMessage(event.data) !== null
    ) handlers.onMessage(event.data)
  }
  // Port transfer is tied to the selected frame and origin. No ticket is sent.
  frameWindow.postMessage(
    desktopApplicationAnnotationInitializeMessageType,
    targetOrigin,
    [port2]
  )

  return {
    cleanup,
    confirmPage,
    setMode: (enabled) =>
      send(
        htmlPreviewAnnotationModeMessage(
          enabled,
          htmlPreviewSelectionColor(frame.ownerDocument)
        )
      ),
    setMarkers: (markers) =>
      send(htmlPreviewAnnotationsMessage(markers)),
    clearSelection: (selection) =>
      send(htmlPreviewSelectionClearMessage(selection)),
    focus: (selection) => send(htmlPreviewAnnotationFocusMessage(selection)),
  }
}
