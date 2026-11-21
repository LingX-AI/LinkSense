import { afterEach, describe, expect, it, vi } from "vitest"
import {
  htmlPreviewAnnotationFramesMessageType,
  htmlPreviewAnnotationFocusMessageType,
  htmlPreviewAnnotationFocusMessage,
  htmlPreviewAnnotationsMessage,
  htmlPreviewAnnotationsMessageType,
} from "@/components/media/html-preview/html-preview-annotations"
import {
  htmlPreviewAnnotationModeMessage,
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionClearMessage,
  htmlPreviewSelectionClearMessageType,
  htmlPreviewSelectionMessageType,
} from "@/components/media/html-preview/html-preview-selection"
import {
  desktopApplicationAnnotationClosedMessageType,
  desktopApplicationAnnotationDestroyMessageType,
  desktopApplicationAnnotationInitializeMessageType,
  desktopApplicationAnnotationLocationMessageType,
  desktopApplicationAnnotationLocationQueryMessageType,
  desktopApplicationAnnotationParentOrigin,
  desktopApplicationAnnotationReadyMessageType,
} from "./application-annotation-bridge"
import { installApplicationAnnotationNativeRuntime } from "./application-annotation-native-runtime"

const ticket = "a".repeat(43)
const frameOrigin = "https://example.test"
const source = `${frameOrigin}/api/v1/interactive-app-runtime/${ticket}/index.html`
const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
  document.documentElement.style.removeProperty("--app-selection")
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type PostCall = readonly [
  message: unknown,
  targetOrigin: string,
  transfer?: readonly Transferable[],
]

type Fixture = ReturnType<typeof install>

function install(
  overrides: Partial<{
    frameOrigin: string
    parentOrigin: string
    source: string
    connect: boolean
  }> = {}
) {
  const frame = document.createElement("iframe")
  document.body.append(frame)
  if (overrides.connect === false) frame.remove()
  const frameWindow = frame.contentWindow
  if (!frameWindow) throw new Error("missing fixture frame")
  const postMessage = vi
    .spyOn(frameWindow, "postMessage")
    .mockImplementation(() => {})
  const handlers = {
    onReady: vi.fn(),
    onLocation: vi.fn(),
    onError: vi.fn(),
    onMessage: vi.fn(),
  }
  const runtime = installApplicationAnnotationNativeRuntime(
    frame,
    overrides.source ?? source,
    {
      frameOrigin: overrides.frameOrigin ?? frameOrigin,
      parentOrigin:
        overrides.parentOrigin ?? desktopApplicationAnnotationParentOrigin,
    },
    handlers
  )
  cleanups.push(runtime.cleanup)
  return { frame, frameWindow, postMessage, handlers, runtime }
}

function initializeCall(fixture: Fixture) {
  const call = fixture.postMessage.mock.calls[0] as unknown as
    | PostCall
    | undefined
  if (!call) throw new Error("missing initialize message")
  return call
}

function childPort(fixture: Fixture): MessagePort {
  const transfer = initializeCall(fixture)[2]
  if (!transfer || transfer.length !== 1)
    throw new Error("missing transferred port")
  return transfer[0] as MessagePort
}

/** Resolve after the port's queued messages reached their handlers. */
function settle() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function readyMessage(path = "index.html", value = ticket) {
  return {
    type: desktopApplicationAnnotationReadyMessageType,
    ticket: value,
    path,
  }
}

function locationMessage(path: string | null, queryId?: number) {
  return {
    type: desktopApplicationAnnotationLocationMessageType,
    ticket,
    path,
    ...(queryId === undefined ? {} : { queryId }),
  }
}

function selectionMessage() {
  return {
    type: htmlPreviewSelectionMessageType,
    selection: {
      elements: [
        {
          selector: "#run",
          domPath: [0],
          tagName: "button",
          classNames: [],
          attributes: {},
          text: "Run",
          bounds: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
    },
    anchor: { right: 10, top: 0, bottom: 10 },
  }
}

function framesMessage() {
  return {
    type: htmlPreviewAnnotationFramesMessageType,
    frames: [
      {
        id: "draft-1",
        index: 1,
        left: 10.5,
        top: 20.25,
        width: 100,
        height: 40,
      },
    ],
  }
}

const markerSelection = {
  elements: [
    {
      selector: "#run",
      domPath: [0],
      tagName: "button",
      classNames: [],
      attributes: {},
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    },
  ],
}

describe("desktop application annotation host runtime", () => {
  it("transfers one port to the selected frame at the exact packaged origin", () => {
    const fixture = install()
    const [message, targetOrigin, transfer] = initializeCall(fixture)
    expect(message).toBe(desktopApplicationAnnotationInitializeMessageType)
    expect(targetOrigin).toBe(frameOrigin)
    expect(transfer).toHaveLength(1)
    expect(typeof (transfer?.[0] as MessagePort).postMessage).toBe("function")
    // The handoff carries no ticket, token, or controller code.
    expect(message).not.toContain(ticket)
    expect(fixture.postMessage).toHaveBeenCalledOnce()
    expect(fixture.handlers.onError).not.toHaveBeenCalled()
  })

  it.each([
    [
      "another source origin",
      {
        source: `https://other.test/api/v1/interactive-app-runtime/${ticket}/index.html`,
      },
    ],
    ["an opaque frame origin", { frameOrigin: "null" }],
    ["an unexpected parent origin", { parentOrigin: "https://example.test" }],
    [
      "a route outside the runtime prefix",
      { source: `${frameOrigin}/other/${ticket}/index.html` },
    ],
    [
      "a ticket that is not 43 URL-safe characters",
      {
        source: `${frameOrigin}/api/v1/interactive-app-runtime/short/index.html`,
      },
    ],
    [
      "a non-HTML runtime entry",
      {
        source: `${frameOrigin}/api/v1/interactive-app-runtime/${ticket}/index.js`,
      },
    ],
  ])("refuses %s", (_name, overrides) => {
    const fixture = install(overrides)
    expect(fixture.handlers.onError).toHaveBeenCalledOnce()
    expect(fixture.postMessage).not.toHaveBeenCalled()
  })

  it("refuses a frame that is not attached to the host document", () => {
    const fixture = install({ connect: false })
    expect(fixture.handlers.onError).toHaveBeenCalledOnce()
    expect(fixture.postMessage).not.toHaveBeenCalled()
  })

  it("accepts only a ready report bound to the ticket derived from the frame source", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage("index.html", "b".repeat(43)))
    port.postMessage({ ...readyMessage(), extra: "value" })
    port.postMessage(readyMessage("../index.html"))
    port.postMessage(readyMessage("index.html"))
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )
    expect(fixture.handlers.onReady).toHaveBeenCalledWith("index.html")

    // A second greeting cannot move the ready page or re-enable commands.
    port.postMessage(readyMessage("details.html"))
    port.postMessage(selectionMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onMessage).toHaveBeenCalledOnce()
    )
    expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
  })

  it("forwards only the existing annotation contracts from the bound port", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage())
    port.postMessage({ type: "linksense:unrelated" })
    port.postMessage({
      type: htmlPreviewAnnotationFramesMessageType,
      frames: [
        { id: "a", index: 1, left: Infinity, top: 0, width: 1, height: 1 },
      ],
    })
    port.postMessage(framesMessage())
    port.postMessage(selectionMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onMessage).toHaveBeenCalledTimes(2)
    )
    expect(fixture.handlers.onMessage.mock.calls).toEqual([
      [framesMessage()],
      [selectionMessage()],
    ])
  })

  it("sends the shared controller messages only over the transferred port", async () => {
    const fixture = install()
    const port = childPort(fixture)
    const received: unknown[] = []
    port.onmessage = (event) => received.push(event.data)
    port.postMessage(readyMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )
    document.documentElement.style.setProperty("--app-selection", "#0b73e0")
    fixture.postMessage.mockClear()

    fixture.runtime.setMode(true)
    fixture.runtime.setMarkers([
      { id: "draft-1", index: 1, selection: markerSelection },
    ])
    fixture.runtime.clearSelection(markerSelection)
    fixture.runtime.focus(markerSelection)
    await vi.waitFor(() => expect(received).toHaveLength(4))

    expect(received).toEqual([
      htmlPreviewAnnotationModeMessage(true, "#0b73e0"),
      htmlPreviewAnnotationsMessage([
        { id: "draft-1", index: 1, selection: markerSelection },
      ]),
      htmlPreviewSelectionClearMessage(markerSelection),
      htmlPreviewAnnotationFocusMessage(markerSelection),
    ])
    expect(received.map((message) => Reflect.get(message as object, "type"))).toEqual([
      htmlPreviewAnnotationModeMessageType,
      htmlPreviewAnnotationsMessageType,
      htmlPreviewSelectionClearMessageType,
      htmlPreviewAnnotationFocusMessageType,
    ])
    // Commands never travel through the window after the port handoff.
    expect(fixture.postMessage).not.toHaveBeenCalled()
  })

  it("waits for the ready greeting before sending commands", () => {
    const fixture = install()
    const port = childPort(fixture)
    const received: unknown[] = []
    port.onmessage = (event) => received.push(event.data)
    fixture.runtime.setMode(true)
    fixture.runtime.focus(markerSelection)
    expect(received).toEqual([])
  })

  it("reports unavailable when the child never answers", () => {
    vi.useFakeTimers()
    const fixture = install()
    vi.advanceTimersByTime(5_000)
    expect(fixture.handlers.onError).toHaveBeenCalledOnce()
    expect(fixture.handlers.onReady).not.toHaveBeenCalled()
  })

  it("closes the port on cleanup and discards detached reports", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )
    const received: unknown[] = []
    port.onmessage = (event) => received.push(event.data)
    fixture.postMessage.mockClear()

    fixture.runtime.cleanup()
    await vi.waitFor(() =>
      expect(received).toEqual([desktopApplicationAnnotationDestroyMessageType])
    )
    fixture.runtime.cleanup()
    await settle()
    expect(received).toHaveLength(1)

    fixture.runtime.setMode(true)
    port.postMessage(selectionMessage())
    port.postMessage(readyMessage("details.html"))
    await settle()
    expect(fixture.handlers.onMessage).not.toHaveBeenCalled()
    expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    expect(fixture.postMessage).not.toHaveBeenCalled()
  })

  it("treats the child closed report as the end of this document generation", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )
    port.postMessage(desktopApplicationAnnotationClosedMessageType)
    await vi.waitFor(() =>
      expect(fixture.handlers.onError).toHaveBeenCalledOnce()
    )
    port.postMessage(selectionMessage())
    await settle()
    expect(fixture.handlers.onMessage).not.toHaveBeenCalled()
  })

  it("accepts same-document location reports only for the bound ticket and route", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )

    port.postMessage(locationMessage("details.html"))
    await vi.waitFor(() =>
      expect(fixture.handlers.onLocation).toHaveBeenLastCalledWith(
        "details.html"
      )
    )
    port.postMessage(locationMessage(null))
    await vi.waitFor(() =>
      expect(fixture.handlers.onLocation).toHaveBeenLastCalledWith(null)
    )

    fixture.handlers.onLocation.mockClear()
    port.postMessage({
      type: desktopApplicationAnnotationLocationMessageType,
      ticket: "b".repeat(43),
      path: null,
    })
    port.postMessage(locationMessage("../escape.html"))
    port.postMessage(locationMessage("index.js"))
    await settle()
    expect(fixture.handlers.onLocation).not.toHaveBeenCalled()
  })

  it("confirms the live page over the bound port before sending", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )
    const queries: unknown[] = []
    port.onmessage = (event) => {
      queries.push(event.data)
      const data = event.data as { type?: unknown; id?: unknown }
      if (
        data.type === desktopApplicationAnnotationLocationQueryMessageType &&
        typeof data.id === "number"
      ) {
        port.postMessage(locationMessage("details.html", data.id))
      }
    }

    await expect(fixture.runtime.confirmPage()).resolves.toBe("details.html")
    expect(queries).toEqual([
      {
        type: desktopApplicationAnnotationLocationQueryMessageType,
        id: expect.any(Number),
      },
    ])
    expect(fixture.handlers.onLocation).toHaveBeenCalledWith("details.html")
  })

  it("fails closed when the generation ends while confirming the page", async () => {
    const fixture = install()
    const port = childPort(fixture)
    port.postMessage(readyMessage())
    await vi.waitFor(() =>
      expect(fixture.handlers.onReady).toHaveBeenCalledOnce()
    )
    const pending = fixture.runtime.confirmPage()
    fixture.runtime.cleanup()
    await expect(pending).resolves.toBeNull()
  })
})
