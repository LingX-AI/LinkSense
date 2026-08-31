import { afterEach, describe, expect, it, vi } from "vitest"

import {
  boundHtmlPreviewZoom,
  fitHtmlDocumentToViewport,
  htmlPreviewReadyMessageType,
  htmlPreviewZoomMessageType,
  isHtmlPreviewReadyResponse,
  postHtmlPreviewZoom,
} from "@/components/media/html-preview/html-preview-fit"

const originalInnerWidth = window.innerWidth
const originalRootClientWidth = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "clientWidth"
)
const originalRootScrollWidth = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "scrollWidth"
)

afterEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  })
  if (originalRootClientWidth) {
    Object.defineProperty(
      document.documentElement,
      "clientWidth",
      originalRootClientWidth
    )
  } else {
    Reflect.deleteProperty(document.documentElement, "clientWidth")
  }
  if (originalRootScrollWidth) {
    Object.defineProperty(
      document.documentElement,
      "scrollWidth",
      originalRootScrollWidth
    )
  } else {
    Reflect.deleteProperty(document.documentElement, "scrollWidth")
  }
  document.documentElement.removeAttribute("style")
  delete document.documentElement.dataset.linksenseFitScale
  delete document.documentElement.dataset.linksenseAppliedScale
  document.body.replaceChildren()
})

describe("HTML preview fit-to-width", () => {
  it("fits fixed-width HTML to the usable viewport excluding scrollbars", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      get: () => (document.documentElement.style.zoom === "0.65" ? 1_200 : 780),
    })
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      value: 1_200,
    })

    const expectedFit = {
      fitScale: 0.65,
      appliedScale: 0.65,
    }

    expect(fitHtmlDocumentToViewport(document, 1)).toEqual(expectedFit)
    expect(document.documentElement.style.zoom).toBe("0.65")
    expect(fitHtmlDocumentToViewport(document, 1)).toEqual(expectedFit)
    expect(document.documentElement.style.zoom).toBe("0.65")

    expect(fitHtmlDocumentToViewport(document, 1.5).appliedScale).toBeCloseTo(
      0.975
    )
  })

  it("fits the current canvas instead of the full horizontal document strip", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 960,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 960,
    })
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      value: 5_760,
    })
    const strip = document.createElement("div")
    strip.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 5_760,
        bottom: 1_080,
        width: 5_760,
        height: 1_080,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(strip)
    const canvas = document.createElement("main")
    canvas.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1_920,
        bottom: 1_080,
        width: 1_920,
        height: 1_080,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(canvas)
    const offscreenSlide = document.createElement("section")
    offscreenSlide.getBoundingClientRect = () =>
      ({
        x: 3_840,
        y: 0,
        left: 3_840,
        top: 0,
        right: 11_840,
        bottom: 1_080,
        width: 8_000,
        height: 1_080,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(offscreenSlide)
    const hiddenDecoration = document.createElement("aside")
    hiddenDecoration.style.visibility = "hidden"
    hiddenDecoration.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1_200,
        bottom: 800,
        width: 1_200,
        height: 800,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(hiddenDecoration)

    expect(fitHtmlDocumentToViewport(document, 1)).toEqual({
      fitScale: 0.5,
      appliedScale: 0.5,
    })
  })

  it("preserves a current page that already scaled and centered itself", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 960,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 960,
    })
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      value: 5_760,
    })
    const strip = document.createElement("div")
    strip.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 5_760,
        bottom: 1_080,
        width: 5_760,
        height: 1_080,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(strip)
    const currentPage = document.createElement("section")
    currentPage.className = "slide active"
    currentPage.style.transform = "translateX(80px) scale(0.5)"
    currentPage.getBoundingClientRect = () =>
      ({
        x: 80,
        y: 160,
        left: 80,
        top: 160,
        right: 880,
        bottom: 610,
        width: 800,
        height: 450,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(currentPage)

    expect(fitHtmlDocumentToViewport(document, 1)).toEqual({
      fitScale: 1,
      appliedScale: 1,
    })
    expect(document.documentElement.style.zoom).toBe("1")
    expect(currentPage.style.transform).toBe("translateX(80px) scale(0.5)")
  })

  it("ignores a small page marker when locating the current page surface", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 960,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 960,
    })
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      value: 5_760,
    })
    const pageMarker = document.createElement("button")
    pageMarker.setAttribute("aria-current", "page")
    pageMarker.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 20,
        left: 20,
        top: 20,
        right: 140,
        bottom: 60,
        width: 120,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(pageMarker)
    const currentPage = document.createElement("section")
    currentPage.className = "slide active"
    currentPage.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1_200,
        bottom: 675,
        width: 1_200,
        height: 675,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.append(currentPage)

    expect(fitHtmlDocumentToViewport(document, 1)).toEqual({
      fitScale: 0.8,
      appliedScale: 0.8,
    })
  })

  it("does not collapse the document while the iframe viewport has no layout width", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      value: 1_920,
    })

    expect(fitHtmlDocumentToViewport(document, 1)).toEqual({
      fitScale: 1,
      appliedScale: 1,
    })
    expect(document.documentElement.style.zoom).toBe("1")
  })

  it("bounds zoom messages before sending them to the isolated iframe", () => {
    const postMessage = vi.fn()
    const frame = document.createElement("iframe")
    Object.defineProperty(frame, "contentWindow", {
      configurable: true,
      value: { postMessage },
    })

    postHtmlPreviewZoom(frame, 10)

    expect(postMessage).toHaveBeenCalledWith(
      { type: htmlPreviewZoomMessageType, zoom: 2 },
      "*"
    )
    expect(boundHtmlPreviewZoom(0)).toBe(0.5)
  })

  it("validates the isolated iframe readiness response", () => {
    expect(
      isHtmlPreviewReadyResponse({
        type: htmlPreviewReadyMessageType,
        deferredFit: false,
      })
    ).toBe(true)
    expect(
      isHtmlPreviewReadyResponse({ type: htmlPreviewReadyMessageType })
    ).toBe(false)
    expect(isHtmlPreviewReadyResponse({ type: "ready" })).toBe(false)
  })
})
