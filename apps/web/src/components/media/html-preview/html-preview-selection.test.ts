import {
  htmlPreviewAnnotationFocusMessageType,
  postHtmlPreviewAnnotationFocus,
} from "./html-preview-annotations"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent } from "@testing-library/react"
import { officeAnnotationCursor } from "@/components/media/office-preview/office-annotation-cursor"
import { installOfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover-controller"

import {
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionMessageType,
  htmlPreviewSelectionClearMessageType,
  htmlSelectableAttribute,
  htmlSelectedAttribute,
  htmlAnnotatedAttribute,
  htmlSelectionAnchor,
  htmlSelectionOverlayAttribute,
  installHtmlPreviewAnnotationController,
  maximumHtmlSelectionCount,
  parseHtmlPreviewSelectionMessage,
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
  vi.useRealTimers()
  Reflect.deleteProperty(window, "Selecto")
  document.body.replaceChildren()
  document.head
    .querySelectorAll("[data-linksense-preview-styles]")
    .forEach((element) => element.remove())
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty("--app-selection")
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
  })
  controllers.push(controller)
  return {
    controller,
    state,
    select: (elements: readonly Element[]) =>
      selectEnd?.({ selected: elements }),
  }
}

function setAnnotationMode(enabled: boolean, selectionColor = "#0b73e0") {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        type: htmlPreviewAnnotationModeMessageType,
        enabled,
        selectionColor,
      },
    })
  )
}

describe("HTML preview live selection", () => {
  it("tints selected images without replacing their content and clears the tint on deselection", () => {
    document.body.innerHTML =
      '<img id="photo" src="data:image/png;base64,AA==" style="background: red">'
    const target = document.getElementById("photo")
    if (!target) throw new Error("Missing selected image")
    let bounds = new DOMRect(30, 40, 120, 80)
    target.getBoundingClientRect = () => bounds
    const { select } = installController()
    setAnnotationMode(true)
    const overlay = document.querySelector<SVGSVGElement>(
      ".html-preview-selection-fill-overlay"
    )
    if (!overlay) throw new Error("Missing selected fill overlay")
    overlay.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    select([target])
    expect(overlay.querySelector("path")).toHaveAttribute(
      "d",
      "M30,40H150V120H30Z"
    )
    expect(target).toHaveAttribute("style", "background: red")
    expect(
      document.querySelector("[data-linksense-preview-styles]")?.textContent
    ).toContain("fill: color-mix(in srgb, rgb(11, 115, 224) 12%, transparent)")
    bounds = new DOMRect(15, 20, 180, 120)
    fireEvent.scroll(document)
    expect(overlay.querySelector("path")).toHaveAttribute(
      "d",
      "M15,20H195V140H15Z"
    )
    target.setAttribute(htmlAnnotatedAttribute, "true")
    fireEvent.scroll(document)
    expect(overlay.querySelector("path")).toHaveAttribute("d", "")
    target.removeAttribute(htmlAnnotatedAttribute)
    select([])
    expect(overlay.querySelector("path")).toHaveAttribute("d", "")
    setAnnotationMode(false)
    expect(overlay).not.toBeInTheDocument()
  })

  it("uses the shared blue and updates its color without clearing the selected elements", () => {
    document.body.innerHTML = '<p id="target">Selected text</p>'
    const target = document.getElementById("target")
    if (!target) throw new Error("Selected element expected")
    target.getBoundingClientRect = () => rect({ width: 160, height: 32 })
    const { select, state } = installController()

    setAnnotationMode(true)
    select([target])

    const styles = document.querySelector("[data-linksense-preview-styles]")
    expect(styles?.textContent).toContain(
      "outline: 2px dashed rgb(11, 115, 224)"
    )
    expect(styles?.textContent).not.toContain("Highlight")

    setAnnotationMode(true, "#5ca8ff")

    expect(styles?.textContent).toContain(
      "outline: 2px dashed rgb(92, 168, 255)"
    )
    expect(styles?.textContent).toContain("border: 1px solid rgb(92, 168, 255)")
    expect(state.selected).toEqual([target])
    expect(target).toHaveAttribute(htmlSelectedAttribute)
  })

  it("clears a submitted selection without leaving its outline or disabling annotation mode", () => {
    document.body.innerHTML = '<h1 id="hero">欢迎</h1><p id="next">下一条</p>'
    const heading = document.getElementById("hero")
    const next = document.getElementById("next")
    if (!heading || !next) throw new Error("Missing selection fixture")
    heading.getBoundingClientRect = () =>
      rect({ left: 10, top: 20, width: 100, height: 40 })
    next.getBoundingClientRect = () =>
      rect({ left: 10, top: 80, width: 100, height: 40 })
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {})
    const { select, state } = installController()
    const clearSubmitted = (source: Window | null = window) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          data: {
            type: htmlPreviewSelectionClearMessageType,
            selectors: ["#hero"],
          },
        })
      )
    setAnnotationMode(true)
    select([heading])
    clearSubmitted(null)
    expect(heading).toHaveAttribute(htmlSelectedAttribute)
    clearSubmitted()
    expect(heading).not.toHaveAttribute(htmlSelectedAttribute)
    expect(state.selected).toEqual([])
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: htmlPreviewSelectionMessageType,
        selection: null,
        anchor: null,
      },
      "*"
    )
    expect(state.destroyed).toBe(false)
    expect(heading).toHaveAttribute(htmlSelectableAttribute)
    select([next])
    clearSubmitted()
    expect(next).toHaveAttribute(htmlSelectedAttribute)
    expect(state.selected).toEqual([next])
  })

  it("previews hovered elements without selecting them and restores the cursor on exit", () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p id="hover-target">Text</p>'
    const target = document.getElementById("hover-target")
    if (!target) throw new Error("Missing hover target")
    document.body.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    let bounds = new DOMRect(100, 80, 240, 60)
    target.getBoundingClientRect = () => bounds
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target)
    vi.spyOn(window, "postMessage").mockImplementation(() => {})
    const { state, select } = installController()
    setAnnotationMode(true)
    const overlay = document.querySelector<SVGSVGElement>(
      ".office-annotation-hover-overlay"
    )
    if (!overlay) throw new Error("Missing hover overlay")
    overlay.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    const path = overlay.querySelector("path")
    fireEvent.pointerMove(target, {
      pointerType: "mouse",
      buttons: 0,
      clientX: 120,
      clientY: 90,
    })
    vi.advanceTimersByTime(20)
    expect(path).toHaveAttribute("d", "M100,80H340V140H100Z")
    expect(state.selected).toEqual([])
    expect(target).not.toHaveAttribute(htmlSelectedAttribute)
    expect(
      document.body.style.getPropertyValue("--office-annotation-cursor")
    ).toBe(officeAnnotationCursor)
    bounds = new DOMRect(80, 40, 360, 90)
    vi.advanceTimersByTime(20)
    expect(path).toHaveAttribute("d", "M80,40H440V130H80Z")
    target.setAttribute(htmlAnnotatedAttribute, "true")
    vi.advanceTimersByTime(20)
    expect(path).toHaveAttribute("d", "")
    target.removeAttribute(htmlAnnotatedAttribute)
    select([target])
    vi.advanceTimersByTime(20)
    expect(path).toHaveAttribute("d", "")
    setAnnotationMode(false)
    expect(document.body).not.toHaveAttribute("data-office-annotation-scope")
    expect(overlay).not.toBeInTheDocument()
  })

  it("rejects malformed selection colors without injecting CSS", () => {
    installController()

    setAnnotationMode(true, "red; } body { display: none; }")

    expect(document.querySelector("[data-linksense-preview-styles]")).toBeNull()
  })

  it("does not add another dashed outline when an annotated element is selected again", () => {
    document.body.innerHTML = '<h1 id="hero">欢迎</h1>'
    const heading = document.getElementById("hero")
    if (!heading) throw new Error("Missing selection fixture")
    heading.getBoundingClientRect = () =>
      rect({ left: 10, top: 20, width: 100, height: 40 })
    vi.spyOn(window, "postMessage").mockImplementation(() => {})
    const { select, state } = installController()
    setAnnotationMode(true)
    select([heading])
    expect(window.getComputedStyle(heading).outline).toContain("dashed")
    heading.setAttribute(htmlAnnotatedAttribute, "true")
    select([heading])
    expect(window.getComputedStyle(heading).outline).not.toContain("dashed")
    expect(state.selected).toEqual([heading])
    heading.removeAttribute(htmlAnnotatedAttribute)
    expect(window.getComputedStyle(heading).outline).toContain("dashed")
  })

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

  it("validates selection messages and maps the iframe selection's bottom-right corner into the viewport", () => {
    const frame = document.createElement("iframe")
    const postMessage = vi.fn()
    Object.defineProperty(frame, "contentWindow", {
      configurable: true,
      value: { postMessage },
    })
    document.documentElement.style.setProperty("--app-selection", "#0b73e0")
    postHtmlPreviewAnnotationMode(frame, true)
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: htmlPreviewAnnotationModeMessageType,
        enabled: true,
        selectionColor: "#0b73e0",
      },
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
        selectors: ["#hero"],
      },
      "*"
    )

    document.body.append(frame)
    frame.getBoundingClientRect = () =>
      rect({ left: 300, top: 100, width: 700, height: 500 })

    expect(
      htmlSelectionAnchor(frame, { right: 120, top: 40, bottom: 60 })
    ).toEqual({ left: 420, top: 160 })
    expect(htmlSelectionAnchor(frame, null)).toBeNull()
    expect(
      parseHtmlPreviewSelectionMessage({
        type: htmlPreviewSelectionMessageType,
        selection: null,
        anchor: { right: 120, top: 40, bottom: 60 },
      })
    ).toBeNull()
  })
})
