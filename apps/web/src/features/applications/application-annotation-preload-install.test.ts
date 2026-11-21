import { afterEach, describe, expect, it, vi } from "vitest"
import { htmlPreviewAnnotationFocusMessage } from "@/components/media/html-preview/html-preview-annotations"
import {
  htmlPreviewAnnotationModeMessage,
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
  type DesktopApplicationAnnotationConfig,
} from "./application-annotation-bridge"
import { installDesktopApplicationAnnotationBridge } from "./application-annotation-preload-install"

const ticket = "a".repeat(43)
const runtimePath = `/api/v1/interactive-app-runtime/${ticket}/index.html`

const selectoMock = vi.hoisted(() => {
  type Listener = (event: unknown) => void
  class MockSelecto {
    static instances: MockSelecto[] = []
    readonly listeners = new Map<string, Listener[]>()
    readonly options: unknown
    selectedTargets: unknown[] = []
    constructor(options: unknown) {
      this.options = options
      MockSelecto.instances.push(this)
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      return this
    }
    setSelectedTargets(targets: unknown[]) {
      this.selectedTargets = targets
    }
    findSelectableTargets() {}
    destroy() {
      this.selectedTargets = []
    }
  }
  return { MockSelecto }
})

vi.mock("selecto", () => ({ default: selectoMock.MockSelecto }))

type ChildFixture = Readonly<{
  parent: Window
  config: DesktopApplicationAnnotationConfig
  host: MessagePort
  deliver: (event: Record<string, unknown>) => void
}>

const fixtures: ChildFixture[] = []
const cleanups: Array<() => void> = []
const originalParent = Object.getOwnPropertyDescriptor(window, "parent")
const originalTop = Object.getOwnPropertyDescriptor(window, "top")
const originalNavigation = Object.getOwnPropertyDescriptor(window, "navigation")

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  for (const fixture of fixtures.splice(0)) fixture.host.close()
  selectoMock.MockSelecto.instances = []
  if (originalParent) Object.defineProperty(window, "parent", originalParent)
  if (originalTop) Object.defineProperty(window, "top", originalTop)
  if (originalNavigation)
    Object.defineProperty(window, "navigation", originalNavigation)
  else Reflect.deleteProperty(window, "navigation")
  window.history.replaceState({}, "", "/")
  document.body.replaceChildren()
  document.head
    .querySelectorAll("[data-linksense-preview-styles]")
    .forEach((element) => element.remove())
  vi.restoreAllMocks()
})

function createChild(pathname = runtimePath): ChildFixture {
  document.body.innerHTML =
    '<button id="run">Run task</button><form id="form"><button type="submit">Save</button></form>'
  window.history.replaceState({}, "", pathname)
  const parent = { name: "trusted-parent" } as unknown as Window
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  })
  Object.defineProperty(window, "top", {
    configurable: true,
    value: parent,
  })
  const config: DesktopApplicationAnnotationConfig = {
    version: 1,
    serverOrigin: window.location.origin,
    parentOrigin: desktopApplicationAnnotationParentOrigin,
  }
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {}
  // jsdom cannot mark a script event trusted. Capture the preload's window
  // listener and hand it the exact shape WebKit dispatches (isTrusted true,
  // real parent, origin and transferred ports), as the WebKit probe recorded.
  type WindowAddEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) => void
  const add = window.addEventListener.bind(window) as WindowAddEventListener
  let handler: ((event: MessageEvent<unknown>) => void) | null = null
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) => {
    if (type === "message" && typeof listener === "function") {
      handler = listener as (event: MessageEvent<unknown>) => void
      return
    }
    add(type, listener, options)
  }) as unknown as typeof window.addEventListener)
  const fixture = {
    parent,
    config,
    host: channel.port1,
    deliver: (event: Record<string, unknown>) => {
      if (!handler) throw new Error("missing bridge message listener")
      handler(event as unknown as MessageEvent<unknown>)
    },
  }
  fixtures.push(fixture)
  return fixture
}

function install(fixture: ChildFixture) {
  const cleanup = installDesktopApplicationAnnotationBridge(window, fixture.config)
  cleanups.push(cleanup)
  return cleanup
}

function sendInitialize(
  fixture: ChildFixture,
  {
    port,
    data = desktopApplicationAnnotationInitializeMessageType,
    source = fixture.parent,
    origin = desktopApplicationAnnotationParentOrigin,
    trusted = true,
    ports = true,
  }: Partial<{
    port: MessagePort
    data: unknown
    source: unknown
    origin: string
    trusted: boolean
    ports: boolean
  }> = {}
) {
  fixture.deliver({
    data,
    origin,
    source,
    ports: ports ? [port ?? new MessageChannel().port2] : [],
    isTrusted: trusted,
    stopImmediatePropagation: vi.fn(),
  })
}

function firstMessage(port: MessagePort) {
  return new Promise<unknown>((resolve) => {
    port.onmessage = (event) => resolve(event.data)
  })
}

function settle() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function selection() {
  return {
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
}

describe("desktop application annotation iframe bridge", () => {
  it("installs only for a trusted real parent at the exact runtime origin and path", async () => {
    const fixture = createChild()
    const cleanup = install(fixture)
    const rejection = new MessageChannel()
    const rejected: unknown[] = []
    rejection.port1.onmessage = (event) => rejected.push(event.data)
    sendInitialize(fixture, {
      port: rejection.port2,
      origin: "https://example.test",
    })
    sendInitialize(fixture, { port: rejection.port2, trusted: false })
    sendInitialize(fixture, { port: rejection.port2, source: {} })
    sendInitialize(fixture, { port: rejection.port2, ports: false })
    sendInitialize(fixture, {
      port: rejection.port2,
      data: { type: desktopApplicationAnnotationInitializeMessageType },
    })
    // A rejected initialize returns synchronously; no ready can be queued.
    expect(rejected).toEqual([])
    rejection.port1.close()

    const accepted = new MessageChannel()
    sendInitialize(fixture, { port: accepted.port2 })
    expect(await firstMessage(accepted.port1)).toEqual({
      type: desktopApplicationAnnotationReadyMessageType,
      ticket,
      path: "index.html",
    })
    cleanup()
    accepted.port1.close()
  })

  it("ignores initialization after the live document path changed", () => {
    const fixture = createChild()
    install(fixture)
    window.history.pushState(
      {},
      "",
      `/api/v1/interactive-app-runtime/${ticket}/details.html`
    )
    const channel = new MessageChannel()
    const messages: unknown[] = []
    channel.port1.onmessage = (event) => messages.push(event.data)
    sendInitialize(fixture, { port: channel.port2 })
    expect(messages).toEqual([])
    channel.port1.close()
  })

  it("suppresses capture-phase clicks and submits only while selection is active", async () => {
    const fixture = createChild()
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    channel.port1.onmessage = () => {}

    const captured = vi.fn()
    const clicked = vi.fn()
    const submitted = vi.fn()
    window.addEventListener("click", captured, true)
    document.querySelector("#run")?.addEventListener("click", clicked)
    document.querySelector("#form")?.addEventListener("submit", submitted)

    document.querySelector<HTMLElement>("#run")?.click()
    expect(captured).toHaveBeenCalledOnce()
    expect(clicked).toHaveBeenCalledOnce()

    channel.port1.postMessage(htmlPreviewAnnotationModeMessage(true, "#0b73e0"))
    await vi.waitFor(() =>
      expect(document.body).toHaveAttribute(
        "data-office-annotation-scope",
        "true"
      )
    )
    captured.mockClear()
    clicked.mockClear()
    submitted.mockClear()
    document.querySelector<HTMLElement>("#run")?.click()
    expect(captured).not.toHaveBeenCalled()
    expect(clicked).not.toHaveBeenCalled()
    document
      .querySelector("#form")
      ?.dispatchEvent(new Event("submit", { bubbles: true }))
    expect(submitted).not.toHaveBeenCalled()

    channel.port1.postMessage(
      htmlPreviewAnnotationModeMessage(false, "#0b73e0")
    )
    await vi.waitFor(() =>
      expect(document.body).not.toHaveAttribute(
        "data-office-annotation-scope"
      )
    )
    document.querySelector<HTMLElement>("#run")?.click()
    expect(captured).toHaveBeenCalledOnce()
    expect(clicked).toHaveBeenCalledOnce()
    cleanup()
    channel.port1.close()
  })

  it("reports selection over the port and ignores the window transport", async () => {
    const fixture = createChild()
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    const reports: Array<Record<string, unknown>> = []
    channel.port1.onmessage = (event) =>
      reports.push(event.data as Record<string, unknown>)

    channel.port1.postMessage(htmlPreviewAnnotationModeMessage(true, "#0b73e0"))
    await vi.waitFor(() =>
      expect(document.body).toHaveAttribute(
        "data-office-annotation-scope",
        "true"
      )
    )
    const button = document.querySelector("#run")
    if (!button) throw new Error("missing fixture button")
    button.getBoundingClientRect = () =>
      ({ left: 20, top: 30, width: 100, height: 40 }) as DOMRect
    const selecto = selectoMock.MockSelecto.instances.at(-1)
    if (!selecto) throw new Error("missing Selecto fixture")
    selecto.listeners.get("selectEnd")?.[0]?.({ selected: [button] })
    await vi.waitFor(() =>
      expect(
        reports.some(
          (message) =>
            message.type === htmlPreviewSelectionMessageType &&
            message.selection !== null
        )
      ).toBe(true)
    )
    const selectionMessage = reports.findLast(
      (message) => message.type === htmlPreviewSelectionMessageType
    ) as
      | {
          selection: { elements: Array<{ selector: string }> } | null
          anchor: unknown
        }
      | undefined
    expect(selectionMessage?.selection?.elements).toEqual([
      expect.objectContaining({ selector: "#run" }),
    ])
    expect(selectionMessage?.anchor).toEqual({
      right: 120,
      top: 30,
      bottom: 70,
    })

    // A window message that mimics the old transport must not clear or move.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: fixture.parent,
        data: {
          type: "linksense:html-preview:selection-clear",
          selectors: ["#run"],
        },
      })
    )
    expect(button).toHaveAttribute("data-linksense-selected")
    channel.port1.postMessage(htmlPreviewAnnotationModeMessage(false, "#0b73e0"))
    await vi.waitFor(() =>
      expect(button).not.toHaveAttribute("data-linksense-selected")
    )
    cleanup()
    channel.port1.close()
  })

  it("moves focus only for the bound port and drops late reports after pagehide", async () => {
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView)
    scrollIntoView.mockClear()
    const fixture = createChild()
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    channel.port1.onmessage = vi.fn()
    channel.port1.postMessage(htmlPreviewAnnotationFocusMessage(selection()))
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())

    // The same command on the window transport cannot move focus.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: fixture.parent,
        data: htmlPreviewAnnotationFocusMessage(selection()),
      })
    )
    expect(scrollIntoView).toHaveBeenCalledOnce()

    const closed: unknown[] = []
    channel.port1.addEventListener("message", (event) =>
      closed.push(event.data)
    )
    window.dispatchEvent(new Event("pagehide"))
    await vi.waitFor(() =>
      expect(closed).toContain(desktopApplicationAnnotationClosedMessageType)
    )
    channel.port1.postMessage(htmlPreviewAnnotationFocusMessage(selection()))
    channel.port1.postMessage(htmlPreviewAnnotationModeMessage(true, "#0b73e0"))
    await settle()
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(document.body).not.toHaveAttribute("data-office-annotation-scope")
    cleanup()
    channel.port1.close()
  })

  it("closes the port and restores activation when the host detaches", async () => {
    const fixture = createChild()
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    channel.port1.onmessage = vi.fn()
    channel.port1.postMessage(htmlPreviewAnnotationModeMessage(true, "#0b73e0"))
    await vi.waitFor(() =>
      expect(document.body).toHaveAttribute(
        "data-office-annotation-scope",
        "true"
      )
    )
    const closed: unknown[] = []
    channel.port1.addEventListener("message", (event) =>
      closed.push(event.data)
    )
    channel.port1.postMessage(desktopApplicationAnnotationDestroyMessageType)
    await vi.waitFor(() =>
      expect(closed).toContain(desktopApplicationAnnotationClosedMessageType)
    )
    expect(document.body).not.toHaveAttribute("data-office-annotation-scope")
    const clicked = vi.fn()
    document.querySelector("#run")?.addEventListener("click", clicked)
    document.querySelector<HTMLElement>("#run")?.click()
    expect(clicked).toHaveBeenCalledOnce()
    cleanup()
    channel.port1.close()
  })

  it("reports same-document History changes over the port without closing the generation", async () => {
    const fixture = createChild()
    const historyPush = window.history.pushState
    const replaceWithoutBridge = window.history.replaceState.bind(
      window.history
    )
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    const messages: unknown[] = []
    channel.port1.onmessage = (event) => messages.push(event.data)
    const detailsPath = `/api/v1/interactive-app-runtime/${ticket}/details.html`

    window.history.pushState({}, "", detailsPath)
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "details.html",
      })
    )
    expect(messages).not.toContain(
      desktopApplicationAnnotationClosedMessageType
    )

    window.history.replaceState({}, "", "/conversations")
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: null,
      })
    )

    // Back/forward changes the URL without calling pushState or replaceState.
    replaceWithoutBridge({}, "", runtimePath)
    window.dispatchEvent(new PopStateEvent("popstate"))
    await vi.waitFor(() =>
      expect(messages.at(-1)).toEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "index.html",
      })
    )

    replaceWithoutBridge({}, "", `${detailsPath}#section`)
    window.dispatchEvent(new Event("hashchange"))
    await vi.waitFor(() =>
      expect(messages.at(-1)).toEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "details.html",
      })
    )
    expect(messages).not.toContain(
      desktopApplicationAnnotationClosedMessageType
    )
    cleanup()
    expect(window.history.pushState).toBe(historyPush)
    channel.port1.close()
  })

  it("answers a host location query with the live route", async () => {
    const fixture = createChild()
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    const messages: unknown[] = []
    channel.port1.onmessage = (event) => messages.push(event.data)

    channel.port1.postMessage({
      type: desktopApplicationAnnotationLocationQueryMessageType,
      id: 7,
    })
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "index.html",
        queryId: 7,
      })
    )

    window.history.pushState(
      {},
      "",
      `/api/v1/interactive-app-runtime/${ticket}/details.html`
    )
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "details.html",
      })
    )
    channel.port1.postMessage({
      type: desktopApplicationAnnotationLocationQueryMessageType,
      id: 8,
    })
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "details.html",
        queryId: 8,
      })
    )
    cleanup()
    channel.port1.close()
  })

  it("uses the Navigation API instead of wrapping History when available", async () => {
    const listeners = new Set<() => void>()
    const navigation = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "currententrychange") listeners.add(listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "currententrychange") listeners.delete(listener)
      }),
    }
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: navigation,
    })
    const historyPush = window.history.pushState
    const fixture = createChild()
    const cleanup = install(fixture)
    expect(window.history.pushState).toBe(historyPush)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    const messages: unknown[] = []
    channel.port1.onmessage = (event) => messages.push(event.data)

    window.history.pushState(
      {},
      "",
      `/api/v1/interactive-app-runtime/${ticket}/details.html`
    )
    expect(listeners.size).toBe(1)
    for (const listener of listeners) listener()
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "details.html",
      })
    )
    cleanup()
    expect(listeners.size).toBe(0)
    channel.port1.close()
  })

  it("stops suppressing application activation after a same-document route change", async () => {
    const fixture = createChild()
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    await firstMessage(channel.port1)
    const messages: unknown[] = []
    channel.port1.onmessage = (event) => messages.push(event.data)
    channel.port1.postMessage(htmlPreviewAnnotationModeMessage(true, "#0b73e0"))
    await vi.waitFor(() =>
      expect(document.body).toHaveAttribute(
        "data-office-annotation-scope",
        "true"
      )
    )

    const clicked = vi.fn()
    document.querySelector("#run")?.addEventListener("click", clicked)
    window.history.pushState(
      {},
      "",
      `/api/v1/interactive-app-runtime/${ticket}/details.html`
    )
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        type: desktopApplicationAnnotationLocationMessageType,
        ticket,
        path: "details.html",
      })
    )
    document.querySelector<HTMLElement>("#run")?.click()
    expect(clicked).toHaveBeenCalledOnce()
    cleanup()
    channel.port1.close()
  })

  it("sends only the document's own ticket and page path in the ready report", async () => {
    const childPath = `/api/v1/interactive-app-runtime/${"c".repeat(43)}/pages/detail.html`
    const fixture = createChild(childPath)
    const cleanup = install(fixture)
    const channel = new MessageChannel()
    sendInitialize(fixture, { port: channel.port2 })
    expect(await firstMessage(channel.port1)).toEqual({
      type: desktopApplicationAnnotationReadyMessageType,
      ticket: "c".repeat(43),
      path: "pages/detail.html",
    })
    cleanup()
    channel.port1.close()
  })
})
