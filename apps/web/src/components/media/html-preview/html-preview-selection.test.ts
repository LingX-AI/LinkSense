import { afterEach, describe, expect, it, vi } from "vitest"

import {
  htmlPreviewAnnotationFocusMessageType,
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionMessageType,
  htmlSelectableAttribute,
  htmlSelectedAttribute,
  htmlSelectionAnchor,
  htmlSelectionOverlayAttribute,
  installHtmlPreviewAnnotationController,
  maximumHtmlSelectionCount,
  parseHtmlPreviewSelectionMessage,
  postHtmlPreviewAnnotationFocus,
  postHtmlPreviewAnnotationMode,
  type HtmlPreviewAnnotationController,
} from "@/components/media/html-preview/html-preview-selection"

function rect(input: Partial<DOMRect>): DOMRect {
  const left = input.left ?? 0
  const top = input.top ?? 0
  const width = input.width ?? 0
  const height = input.height ?? 0
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}

const controllers: HtmlPreviewAnnotationController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy()
  Reflect.deleteProperty(window, "Selecto")
  document.body.replaceChildren()
  document.head
    .querySelectorAll("[data-linksense-preview-styles]")
    .forEach((element) => element.remove())
  vi.restoreAllMocks()
})

function installController() {
  let selectEnd:
    ((event: Readonly<{ selected: readonly Element[] }>) => void) | null = null
  const state = {
    destroyed: false,
    selected: [] as readonly Element[],
    options: null as Readonly<Record<string, unknown>> | null,
  }
  class SelectoMock {
    constructor(options: Readonly<Record<string, unknown>>) {
      state.options = options
    }

    on(
      event: "selectEnd",
      listener: (event: Readonly<{ selected: readonly Element[] }>) => void
    ) {
      if (event === "selectEnd") selectEnd = listener
      return this
    }

    setSelectedTargets(elements: readonly Element[]) {
      state.selected = elements
    }

    findSelectableTargets() {}

    destroy() {
      state.destroyed = true
    }
  }
  Reflect.set(window, "Selecto", SelectoMock)
  const controller = installHtmlPreviewAnnotationController(window, {
    focusMessageType: htmlPreviewAnnotationFocusMessageType,
    modeMessageType: htmlPreviewAnnotationModeMessageType,
    selectionMessageType: htmlPreviewSelectionMessageType,
    selectableAttribute: htmlSelectableAttribute,
    selectedAttribute: htmlSelectedAttribute,
    overlayAttribute: htmlSelectionOverlayAttribute,
    maximumSelectionCount: maximumHtmlSelectionCount,
  })
  controllers.push(controller)
  return {
    controller,
    state,
    select: (elements: readonly Element[]) =>
      selectEnd?.({ selected: elements }),
  }
}

function setAnnotationMode(enabled: boolean) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: { type: htmlPreviewAnnotationModeMessageType, enabled },
    })
  )
}

describe("HTML preview live selection", () => {
  it("selects the real rendered element without cloning or changing its animation", () => {
    document.body.innerHTML = `
      <section id="intro">
        <h1 id="hero" class="title" style="animation: reveal 2s 1s both">欢迎</h1>
      </section>
    `
    const section = document.querySelector("section") as HTMLElement
    const heading = document.querySelector("h1") as HTMLElement
    const originalHeading = heading
    heading.getBoundingClientRect = () =>
      rect({ left: 12, top: 24, width: 180, height: 48 })
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined)
    const { select, state } = installController()

    setAnnotationMode(true)
    select([section, heading])

    expect(document.querySelector("#hero")).toBe(originalHeading)
    expect(heading.style.animation).toBe("reveal 2s 1s both")
    expect(heading).toHaveAttribute(htmlSelectableAttribute)
    expect(heading).toHaveAttribute(htmlSelectedAttribute)
    expect(state.selected).toEqual([heading])
    expect(state.options?.selectableTargets).toEqual([
      expect.stringContaining(htmlSelectableAttribute),
    ])

    const message = parseHtmlPreviewSelectionMessage(
      postMessage.mock.calls.at(-1)?.[0]
    )
    expect(message).toMatchObject({
      type: htmlPreviewSelectionMessageType,
      selection: {
        elements: [
          {
            selector: "#hero",
            tagName: "h1",
            text: "欢迎",
            bounds: { x: 12, y: 24, width: 180, height: 48 },
          },
        ],
      },
      anchor: { right: 192, top: 24, bottom: 72 },
    })

    setAnnotationMode(false)

    expect(document.querySelector("#hero")).toBe(originalHeading)
    expect(heading.style.animation).toBe("reveal 2s 1s both")
    expect(heading).not.toHaveAttribute(htmlSelectableAttribute)
    expect(heading).not.toHaveAttribute(htmlSelectedAttribute)
    expect(
      document.querySelector(`[${htmlSelectionOverlayAttribute}]`)
    ).toBeNull()
    expect(state.destroyed).toBe(true)
  })

  it("marks content added by the live page while annotation mode is active", async () => {
    document.body.innerHTML = "<main><h1>第一页</h1></main>"
    vi.spyOn(window, "postMessage").mockImplementation(() => undefined)
    installController()
    setAnnotationMode(true)

    const nextPage = document.createElement("section")
    nextPage.innerHTML = "<h2>动画结束后出现的内容</h2>"
    document.body.append(nextPage)
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(nextPage).toHaveAttribute(htmlSelectableAttribute)
    expect(nextPage.querySelector("h2")).toHaveAttribute(
      htmlSelectableAttribute
    )
  })

  it("validates selection messages and maps the iframe anchor into the pane", () => {
    const frame = document.createElement("iframe")
    const postMessage = vi.fn()
    Object.defineProperty(frame, "contentWindow", {
      configurable: true,
      value: { postMessage },
    })
    postHtmlPreviewAnnotationMode(frame, true)
    expect(postMessage).toHaveBeenCalledWith(
      { type: htmlPreviewAnnotationModeMessageType, enabled: true },
      "*"
    )
    postHtmlPreviewAnnotationFocus(frame, {
      elements: [
        {
          selector: "#hero",
          domPath: [0],
          tagName: "h1",
          classNames: [],
          attributes: {},
          bounds: { x: 100, y: 200, width: 300, height: 80 },
        },
      ],
    })
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: htmlPreviewAnnotationFocusMessageType,
        bounds: { left: 100, top: 200, width: 300, height: 80 },
      },
      "*"
    )

    const pane = document.createElement("section")
    document.body.append(pane, frame)
    Object.defineProperty(pane, "clientWidth", { value: 800 })
    Object.defineProperty(pane, "clientHeight", { value: 600 })
    pane.getBoundingClientRect = () =>
      rect({ left: 250, top: 50, width: 800, height: 600 })
    frame.getBoundingClientRect = () =>
      rect({ left: 300, top: 100, width: 700, height: 500 })

    expect(
      htmlSelectionAnchor(pane, frame, { right: 120, top: 40, bottom: 60 })
    ).toEqual({ left: 170, top: 100 })
    expect(
      parseHtmlPreviewSelectionMessage({
        type: htmlPreviewSelectionMessageType,
        selection: null,
        anchor: { right: 120, top: 40, bottom: 60 },
      })
    ).toBeNull()
  })

  it("scrolls the live HTML document to a requested saved annotation", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    installController()

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: htmlPreviewAnnotationFocusMessageType,
          bounds: { left: 1_000, top: 800, width: 200, height: 100 },
        },
      })
    )

    expect(scrollTo).toHaveBeenCalledWith({
      left: Math.max(0, 1_100 - window.innerWidth / 2),
      top: Math.max(0, 850 - window.innerHeight / 2),
      behavior: "smooth",
    })
  })
})
