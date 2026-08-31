import { describe, expect, it } from "vitest"
import initialDocument from "../../index.html?raw"

import {
  applyProductMetadata,
  formatFirstPartyCapabilityName,
  productFilenamePrefix,
} from "@/app/product-branding"

describe("product branding", () => {
  it("uses LinkSense for browser-visible metadata before bootstrap loads", () => {
    const targetDocument = new DOMParser().parseFromString(
      initialDocument,
      "text/html"
    )

    expect(targetDocument.title).toBe("LinkSense")
    expect(
      targetDocument
        .querySelector('meta[name="application-name"]')
        ?.getAttribute("content")
    ).toBe("LinkSense")
    expect(
      targetDocument
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
    ).toBe("LinkSense")
  })

  it("prevents mobile browsers from pinch-zooming the LinkSense shell", () => {
    const targetDocument = new DOMParser().parseFromString(
      initialDocument,
      "text/html"
    )
    const viewport = targetDocument
      .querySelector('meta[name="viewport"]')
      ?.getAttribute("content")

    expect(viewport).toContain("width=device-width")
    expect(viewport).toContain("initial-scale=1.0")
    expect(viewport).toContain("minimum-scale=1.0")
    expect(viewport).toContain("maximum-scale=1.0")
    expect(viewport).toContain("user-scalable=no")
  })

  it("updates browser-visible metadata from the configured product name", () => {
    const targetDocument = document.implementation.createHTMLDocument()
    targetDocument.head.innerHTML = `
      <meta name="application-name" content="AI Assistant">
      <meta name="description" content="AI Assistant">
      <title>AI Assistant</title>
    `

    applyProductMetadata(targetDocument, "  MOSS 工作台  ")

    expect(targetDocument.title).toBe("MOSS 工作台")
    expect(
      targetDocument
        .querySelector('meta[name="application-name"]')
        ?.getAttribute("content")
    ).toBe("MOSS 工作台")
    expect(
      targetDocument
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
    ).toBe("MOSS 工作台")
  })

  it("uses a safe configured-name prefix for downloaded files", () => {
    expect(productFilenamePrefix("  MOSS / 华东:*  ")).toBe("MOSS-华东")
  })

  it("renames only known first-party capability labels", () => {
    expect(
      formatFirstPartyCapabilityName("LinkSense File Service", "MOSS")
    ).toBe("MOSS File Service")
    expect(formatFirstPartyCapabilityName("LinkSense Personal", "MOSS")).toBe(
      "MOSS Personal"
    )
    expect(
      formatFirstPartyCapabilityName("LinkSense Skill Creator", "MOSS")
    ).toBe("MOSS Skill Creator")
    expect(formatFirstPartyCapabilityName("LinkSense Custom", "MOSS")).toBe(
      "LinkSense Custom"
    )
  })
})
