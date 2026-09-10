import DOMPurify from "dompurify"
import { officeAnnotationCursor } from "@/components/media/office-preview/office-annotation-cursor"
import { installOfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover-controller"
import { maximumOfficeAnnotationCount } from "@linksense/shared"
import {
  htmlPreviewAnnotationFocusMessageType,
  htmlPreviewAnnotationsMessageType,
  htmlPreviewAnnotationFramesMessageType,
  installHtmlPreviewAnnotationsController,
} from "./html-preview-annotations"

import {
  htmlPreviewCurrentPageSelector,
  htmlPreviewReadyMessageType,
  htmlPreviewZoomMessageType,
} from "@/components/media/html-preview/html-preview-fit"
import {
  htmlPreviewAnnotationModeMessageType,
  htmlPreviewSelectionMessageType,
  htmlPreviewSelectionClearMessageType,
  htmlSelectableAttribute,
  htmlSelectedAttribute,
  htmlAnnotatedAttribute,
  htmlSelectionOverlayAttribute,
  installHtmlPreviewAnnotationController,
  maximumHtmlSelectionCount,
} from "@/components/media/html-preview/html-preview-selection"

export type HtmlPreviewDocumentMode = "annotation" | "interaction"

export const htmlPreviewAnnotationDocumentAttribute =
  "data-linksense-annotation-document"

export type HtmlPreviewTrustedRuntime = Readonly<{
  scriptUrl: string
  additionalScriptUrls?: readonly string[]
  bootstrapScript: string
  allowUnrestrictedScripts?: boolean
}>

const alwaysForbiddenTags = [
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "link",
  "meta",
  "object",
] as const

const unsafeUrlAttributes = [
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "longdesc",
  "poster",
  "src",
  "srcset",
  "xlink:href",
] as const

const interactiveInlineScriptTypes = new Set([
  "",
  "application/javascript",
  "module",
  "text/javascript",
])

function normalizeTrustedRuntimeUrl(value: string) {
  const url = new URL(value, window.location.href)
  if (url.origin !== window.location.origin) {
    throw new Error("HTML preview runtime must use the LinkSense origin")
  }
  return url
}

function previewCsp(
  mode: HtmlPreviewDocumentMode,
  trustedRuntimeUrls: readonly URL[] = [],
  allowUnrestrictedScripts = false
) {
  if (mode === "annotation" || allowUnrestrictedScripts) {
    return null
  }
  const scriptSource =
    mode === "interaction"
      ? [
          "script-src 'unsafe-inline'",
          ...trustedRuntimeUrls.map((url) => url.href),
        ].join(" ")
      : "script-src 'none'"
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "child-src 'none'",
    "connect-src 'none'",
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src data:",
    "media-src data:",
    "object-src 'none'",
    scriptSource,
    "style-src 'unsafe-inline'",
    "worker-src 'none'",
  ].join("; ")
}

const selectionStyles = `
:root {
  color-scheme: light;
  min-height: 100%;
  background: Canvas;
  color: CanvasText;
}

body {
  min-height: 100%;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

[data-linksense-selectable="true"] {
  cursor: default;
}

[data-linksense-overlay-root="true"] {
  position: fixed !important;
  z-index: 2147483647 !important;
  inset: 0 !important;
  pointer-events: none !important;
}

.selecto-selection {
  border: 1px solid Highlight !important;
  background: color-mix(in srgb, Highlight 12%, transparent) !important;
}
`

/**
 * Opaque-origin iframes intentionally cannot access persistent browser
 * storage. Generated documents frequently probe Storage without catching the
 * resulting SecurityError, so provide an isolated in-memory implementation
 * instead of relaxing the sandbox's origin boundary.
 *
 * Keep this function self-contained: its source is injected into the isolated
 * preview runtime below.
 */
export function installHtmlPreviewStorageFallback(targetWindow: Window) {
  const createMemoryStorage = () => {
    const values = new Map<string, string>()
    return {
      get length() {
        return values.size
      },
      clear() {
        values.clear()
      },
      getItem(key: string) {
        return values.get(String(key)) ?? null
      },
      key(index: number) {
        return Array.from(values.keys())[index] ?? null
      },
      removeItem(key: string) {
        values.delete(String(key))
      },
      setItem(key: string, value: string) {
        values.set(String(key), String(value))
      },
    } satisfies Storage
  }

  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      Reflect.get(targetWindow, name)
    } catch {
      Reflect.defineProperty(targetWindow, name, {
        configurable: true,
        enumerable: true,
        value: createMemoryStorage(),
      })
    }
  }
}

const fitRuntime = `
(() => {
  const installStorageFallback = (${installHtmlPreviewStorageFallback.toString()});
  installStorageFallback(window);
  const installAnnotationController = (${installHtmlPreviewAnnotationController.toString()});
  const annotationController = installAnnotationController(window, {
    modeMessageType: ${JSON.stringify(htmlPreviewAnnotationModeMessageType)},
    selectionMessageType: ${JSON.stringify(htmlPreviewSelectionMessageType)},
    clearMessageType: ${JSON.stringify(htmlPreviewSelectionClearMessageType)},
    selectableAttribute: ${JSON.stringify(htmlSelectableAttribute)},
    selectedAttribute: ${JSON.stringify(htmlSelectedAttribute)},
    annotatedAttribute: ${JSON.stringify(htmlAnnotatedAttribute)},
    overlayAttribute: ${JSON.stringify(htmlSelectionOverlayAttribute)},
    maximumSelectionCount: ${maximumHtmlSelectionCount},
    annotationCursor: ${JSON.stringify(officeAnnotationCursor)},
    installHover: (${installOfficeAnnotationHover.toString()}),
  });
  const installAnnotations = (${installHtmlPreviewAnnotationsController.toString()});
  const annotationsController = installAnnotations(window, {
    markersMessageType: ${JSON.stringify(htmlPreviewAnnotationsMessageType)},
    framesMessageType: ${JSON.stringify(htmlPreviewAnnotationFramesMessageType)},
    focusMessageType: ${JSON.stringify(htmlPreviewAnnotationFocusMessageType)},
    maximumMarkers: ${maximumOfficeAnnotationCount},
    maximumElements: ${maximumHtmlSelectionCount},
    annotatedAttribute: ${JSON.stringify(htmlAnnotatedAttribute)},
  });
  const minimumZoom = 0.5;
  const maximumZoom = 2;
  const minimumViewportWidth = 32;
  const measurementTolerance = 0.5;
  const minimumPageWidthRatio = 0.5;
  const currentPageSelector = ${JSON.stringify(htmlPreviewCurrentPageSelector)};
  let requestedZoom = 1;
  let hasReportedReady = false;
  let deferredFit = false;

  const intersectsViewport = (
    bounds,
    rootBounds,
    viewportWidth,
    viewportHeight
  ) =>
    bounds.right > rootBounds.left &&
    bounds.left < rootBounds.left + viewportWidth &&
    (
      viewportHeight <= 0 ||
      (
        bounds.bottom > rootBounds.top &&
        bounds.top < rootBounds.top + viewportHeight
      )
    );

  const isVisibleElement = (
    element,
    bounds,
    rootBounds,
    viewportWidth,
    viewportHeight
  ) => {
    if (
      !Number.isFinite(bounds.left) ||
      !Number.isFinite(bounds.right) ||
      !Number.isFinite(bounds.top) ||
      !Number.isFinite(bounds.bottom) ||
      (bounds.width === 0 && bounds.height === 0) ||
      !intersectsViewport(
        bounds,
        rootBounds,
        viewportWidth,
        viewportHeight
      )
    ) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0"
    );
  };

  const visibleContentWidth = (root, viewportWidth, viewportHeight) => {
    const rootBounds = root.getBoundingClientRect();
    for (const element of document.querySelectorAll(currentPageSelector)) {
      const bounds = element.getBoundingClientRect();
      if (
        isVisibleElement(
          element,
          bounds,
          rootBounds,
          viewportWidth,
          viewportHeight
        ) &&
        bounds.width >= viewportWidth * minimumPageWidthRatio
      ) {
        return Math.max(viewportWidth, bounds.width);
      }
    }

    let hasVisibleContent = false;
    let closestVisibleWidth = Number.POSITIVE_INFINITY;
    document.body?.querySelectorAll("*").forEach((element) => {
      if (element.closest("[data-linksense-overlay-root]")) return;
      const bounds = element.getBoundingClientRect();
      if (
        !isVisibleElement(
          element,
          bounds,
          rootBounds,
          viewportWidth,
          viewportHeight
        )
      ) {
        return;
      }
      hasVisibleContent = true;
      if (bounds.width + measurementTolerance >= viewportWidth) {
        closestVisibleWidth = Math.min(closestVisibleWidth, bounds.width);
      }
    });
    if (!hasVisibleContent) return null;
    return Number.isFinite(closestVisibleWidth)
      ? Math.max(viewportWidth, closestVisibleWidth)
      : viewportWidth;
  };

  const fitToWidth = () => {
    const root = document.documentElement;
    const body = document.body;
    root.style.zoom = "1";
    const viewportWidth = Math.max(
      0,
      root.clientWidth || window.innerWidth || 0
    );
    const viewportHeight = Math.max(
      0,
      root.clientHeight || window.innerHeight || 0
    );
    if (viewportWidth < minimumViewportWidth) {
      deferredFit = true;
      root.style.zoom = String(requestedZoom);
      root.dataset.linksenseFitScale = "1";
      root.dataset.linksenseAppliedScale = String(requestedZoom);
      return false;
    }
    const visibleWidth = visibleContentWidth(
      root,
      viewportWidth,
      viewportHeight
    );
    const contentWidth =
      visibleWidth ??
      Math.max(
        viewportWidth,
        root.scrollWidth,
        root.offsetWidth,
        body?.scrollWidth ?? 0,
        body?.offsetWidth ?? 0
      );
    const fitScale = Math.min(1, viewportWidth / contentWidth);
    const appliedScale = fitScale * requestedZoom;
    root.style.zoom = String(appliedScale);
    root.dataset.linksenseFitScale = String(fitScale);
    root.dataset.linksenseAppliedScale = String(appliedScale);
    annotationController.refresh();
    annotationsController.refresh();
    if (!hasReportedReady) {
      hasReportedReady = true;
      parent.postMessage(
        {
          type: ${JSON.stringify(htmlPreviewReadyMessageType)},
          deferredFit,
        },
        "*"
      );
    }
    return true;
  };

  window.addEventListener("message", (event) => {
    if (event.source !== parent) {
      return;
    }
    if (
      event.data?.type !== ${JSON.stringify(htmlPreviewZoomMessageType)} ||
      typeof event.data.zoom !== "number" ||
      !Number.isFinite(event.data.zoom)
    ) {
      return;
    }
    requestedZoom = Math.min(
      maximumZoom,
      Math.max(minimumZoom, event.data.zoom)
    );
    requestAnimationFrame(fitToWidth);
  });
  window.addEventListener("resize", () => requestAnimationFrame(fitToWidth));
  window.addEventListener("load", () => requestAnimationFrame(fitToWidth));
  requestAnimationFrame(fitToWidth);
})();
`

function isSelfContainedUrl(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith("data:") || normalized.startsWith("#")
}

function sanitizeCssText(value: string) {
  return value
    .replace(/@import\s+(?:url\()?[^;]+;?/giu, "")
    .replace(
      /url\(\s*(["']?)(.*?)\1\s*\)/giu,
      (match, _quote: string, url: string) =>
        isSelfContainedUrl(url) ? match : 'url("")'
    )
}

type HtmlAnnotationStyleAsset =
  | Readonly<{
      kind: "style"
      cssText: string
      media: string | null
      type: string | null
    }>
  | Readonly<{
      kind: "stylesheet"
      href: string
      media: string | null
      type: string | null
      crossOrigin: string | null
      integrity: string | null
      referrerPolicy: string | null
    }>

function annotationStylesheetUrl(value: string) {
  if (!value.trim()) return null
  try {
    const url = new URL(value, window.location.href)
    return ["blob:", "data:", "http:", "https:"].includes(url.protocol)
      ? url.href
      : null
  } catch {
    return null
  }
}

function extractHtmlAnnotationStyleAssets(rawHtml: string) {
  const source = new DOMParser().parseFromString(rawHtml, "text/html")
  const assets: HtmlAnnotationStyleAsset[] = []
  for (const element of source.querySelectorAll("style, link")) {
    if (element instanceof HTMLStyleElement) {
      assets.push({
        kind: "style",
        cssText: element.textContent ?? "",
        media: element.getAttribute("media"),
        type: element.getAttribute("type"),
      })
      continue
    }
    if (!(element instanceof HTMLLinkElement)) continue
    const relations = new Set(
      element.rel.toLowerCase().split(/\s+/u).filter(Boolean)
    )
    if (!relations.has("stylesheet")) continue
    const href = annotationStylesheetUrl(element.getAttribute("href") ?? "")
    if (!href) continue
    assets.push({
      kind: "stylesheet",
      href,
      media: element.getAttribute("media"),
      type: element.getAttribute("type"),
      crossOrigin: element.getAttribute("crossorigin"),
      integrity: element.getAttribute("integrity"),
      referrerPolicy: element.getAttribute("referrerpolicy"),
    })
  }
  return assets
}

function restoreHtmlAnnotationStyleAssets(
  document: Document,
  assets: readonly HtmlAnnotationStyleAsset[]
) {
  document
    .querySelectorAll("style, link[rel~='stylesheet' i]")
    .forEach((element) => element.remove())
  for (const asset of assets) {
    if (asset.kind === "style") {
      const style = document.createElement("style")
      style.textContent = asset.cssText
      if (asset.media) style.setAttribute("media", asset.media)
      if (asset.type) style.setAttribute("type", asset.type)
      document.head.append(style)
      continue
    }
    const link = document.createElement("link")
    link.setAttribute("rel", "stylesheet")
    link.setAttribute("href", asset.href)
    if (asset.media) link.setAttribute("media", asset.media)
    if (asset.type) link.setAttribute("type", asset.type)
    if (asset.crossOrigin) link.setAttribute("crossorigin", asset.crossOrigin)
    if (asset.integrity) link.setAttribute("integrity", asset.integrity)
    if (asset.referrerPolicy) {
      link.setAttribute("referrerpolicy", asset.referrerPolicy)
    }
    document.head.append(link)
  }
}

function isTailwindBrowserRuntimeScript(script: HTMLScriptElement) {
  const source = script.getAttribute("src")?.trim()
  if (!source) return false
  try {
    const url = new URL(source, window.location.href)
    return (
      url.hostname === "cdn.tailwindcss.com" ||
      url.pathname.toLowerCase().includes("/@tailwindcss/browser")
    )
  } catch {
    return source.toLowerCase().includes("@tailwindcss/browser")
  }
}

function removeExternalResources(
  document: Document,
  mode: HtmlPreviewDocumentMode,
  allowUnrestrictedScripts: boolean
) {
  if (allowUnrestrictedScripts) {
    for (const script of document.querySelectorAll("script")) {
      if (isTailwindBrowserRuntimeScript(script)) script.remove()
    }
    return
  }
  for (const element of document.querySelectorAll("*")) {
    if (element.tagName.toLowerCase() === "script") {
      const script = element as HTMLScriptElement
      const type = script.getAttribute("type")?.trim().toLowerCase()
      if (
        mode !== "interaction" ||
        script.hasAttribute("src") ||
        !interactiveInlineScriptTypes.has(type ?? "")
      ) {
        script.remove()
        continue
      }
      for (const attribute of [...script.attributes]) {
        if (attribute.name !== "type") script.removeAttribute(attribute.name)
      }
    }
    for (const attribute of unsafeUrlAttributes) {
      const value = element.getAttribute(attribute)
      if (value === null) continue
      if (
        mode === "annotation" &&
        ["background", "poster", "src", "srcset"].includes(attribute)
      ) {
        continue
      }
      if (attribute === "href") {
        if (value.trim().startsWith("#")) continue
      } else if (
        (attribute === "src" ||
          attribute === "poster" ||
          attribute === "background") &&
        isSelfContainedUrl(value)
      ) {
        continue
      }
      element.removeAttribute(attribute)
    }
    element.removeAttribute("srcdoc")
    element.removeAttribute("target")

    const style = element.getAttribute("style")
    if (style !== null && mode !== "annotation") {
      element.setAttribute("style", sanitizeCssText(style))
    }
  }

  if (mode !== "annotation") {
    for (const style of document.querySelectorAll("style")) {
      style.textContent = sanitizeCssText(style.textContent ?? "")
    }
  }
}

export function decodeHtmlDocument(content: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(content)
}

export function buildSafeHtmlDocument(
  rawHtml: string,
  mode: HtmlPreviewDocumentMode = "annotation",
  trustedRuntime?: HtmlPreviewTrustedRuntime
) {
  if (trustedRuntime && mode !== "interaction") {
    throw new Error("Trusted HTML preview runtimes require interaction mode")
  }
  const trustedRuntimeUrls = trustedRuntime
    ? [
        normalizeTrustedRuntimeUrl(trustedRuntime.scriptUrl),
        ...(trustedRuntime.additionalScriptUrls ?? []).map(
          normalizeTrustedRuntimeUrl
        ),
      ]
    : []
  const allowUnrestrictedScripts =
    mode === "interaction" && trustedRuntime?.allowUnrestrictedScripts === true
  const annotationStyleAssets =
    mode === "annotation" ? extractHtmlAnnotationStyleAssets(rawHtml) : []
  const source = allowUnrestrictedScripts
    ? rawHtml
    : DOMPurify.sanitize(rawHtml, {
        WHOLE_DOCUMENT: true,
        RETURN_TRUSTED_TYPE: false,
        FORBID_TAGS: [
          ...alwaysForbiddenTags,
          ...(mode === "annotation" ? ["form", "script"] : []),
        ],
        FORBID_ATTR: ["srcdoc"],
        ...(mode === "interaction"
          ? {
              ADD_TAGS: ["script"],
              ADD_ATTR: (attributeName: string) =>
                attributeName.toLowerCase().startsWith("on"),
            }
          : {}),
      })
  const document = new DOMParser().parseFromString(source, "text/html")
  removeExternalResources(document, mode, allowUnrestrictedScripts)
  if (mode === "annotation") {
    restoreHtmlAnnotationStyleAssets(document, annotationStyleAssets)
    document.documentElement.setAttribute(
      htmlPreviewAnnotationDocumentAttribute,
      "true"
    )
  }

  for (const existingCsp of document.querySelectorAll(
    'meta[http-equiv="Content-Security-Policy" i]'
  )) {
    existingCsp.remove()
  }

  const viewport = document.createElement("meta")
  viewport.setAttribute("name", "viewport")
  viewport.setAttribute("content", "width=device-width, initial-scale=1")
  const csp = previewCsp(mode, trustedRuntimeUrls, allowUnrestrictedScripts)
  if (csp === null) {
    document.head.prepend(viewport)
  } else {
    const cspMeta = document.createElement("meta")
    cspMeta.setAttribute("http-equiv", "Content-Security-Policy")
    cspMeta.setAttribute("content", csp)
    document.head.prepend(cspMeta)
    cspMeta.after(viewport)
  }

  if (mode === "annotation") {
    const styles = document.createElement("style")
    styles.setAttribute("data-linksense-preview-styles", "true")
    styles.textContent = selectionStyles
    document.head.append(styles)
  } else if (trustedRuntimeUrls.length > 0 && trustedRuntime) {
    const bootstrap = document.createElement("script")
    bootstrap.setAttribute("data-linksense-preview-bootstrap", "true")
    bootstrap.textContent = trustedRuntime.bootstrapScript

    let insertionPoint: Element = viewport
    for (const runtimeUrl of trustedRuntimeUrls) {
      const runtime = document.createElement("script")
      runtime.setAttribute("data-linksense-trusted-preview-runtime", "true")
      runtime.setAttribute("defer", "")
      runtime.setAttribute("src", runtimeUrl.href)
      insertionPoint.after(runtime)
      insertionPoint = runtime
    }
    insertionPoint.after(bootstrap)
  } else {
    const runtime = document.createElement("script")
    runtime.setAttribute("data-linksense-preview-runtime", "true")
    runtime.textContent = fitRuntime
    viewport.after(runtime)
  }

  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

export function buildUnrestrictedHtmlPreviewDocument(
  rawHtml: string,
  tailwindRuntimeUrl: string,
  selectoRuntimeUrl: string
) {
  return buildSafeHtmlDocument(rawHtml, "interaction", {
    scriptUrl: tailwindRuntimeUrl,
    additionalScriptUrls: [selectoRuntimeUrl],
    bootstrapScript: fitRuntime,
    allowUnrestrictedScripts: true,
  })
}
