import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import appDocument from "../../index.html?raw"

const manifestSchema = z.object({
  id: z.literal("/"),
  name: z.literal("LinkSense"),
  short_name: z.literal("LinkSense"),
  start_url: z.literal("/"),
  scope: z.literal("/"),
  display: z.literal("standalone"),
  icons: z
    .array(
      z.object({
        src: z.literal("/linksense-appicon.svg"),
        sizes: z.literal("any"),
        type: z.literal("image/svg+xml"),
      })
    )
    .min(1),
})

describe("home screen launch", () => {
  it("declares standalone launch to iOS before application scripts load", () => {
    const page = new DOMParser().parseFromString(appDocument, "text/html")

    expect(
      page
        .querySelector('meta[name="apple-mobile-web-app-capable"]')
        ?.getAttribute("content")
    ).toBe("yes")
    expect(
      page
        .querySelector('meta[name="mobile-web-app-capable"]')
        ?.getAttribute("content")
    ).toBe("yes")
  })

  it("links a public manifest that keeps all application routes in standalone scope", () => {
    const page = new DOMParser().parseFromString(appDocument, "text/html")
    expect(
      page.querySelector('link[rel="manifest"]')?.getAttribute("href")
    ).toBe("/manifest.json")

    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync("public/manifest.json", "utf8"))
    )
    const icon = readFileSync(
      `public${manifest.icons[0].src}`,
      "utf8"
    )
    expect(icon).toContain("<svg")
  })
})
