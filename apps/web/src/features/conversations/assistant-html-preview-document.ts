import {
  htmlPreviewShellInitializeMessageType,
  htmlPreviewShellReadyMessageType,
  isHtmlPreviewShellReadyMessage,
} from "@/components/media/html-preview/html-preview-shell"
import { buildSafeHtmlDocument } from "@/components/media/html-preview/html-preview-sanitizer"
import { z } from "zod"

export const assistantHtmlPreviewReadyMessageType =
  "linksense:assistant-html-preview:ready"
export const assistantHtmlPreviewErrorMessageType =
  "linksense:assistant-html-preview:error"
export const assistantHtmlPreviewResizeMessageType =
  "linksense:assistant-html-preview:resize"
export const assistantHtmlPreviewWheelMessageType =
  "linksense:assistant-html-preview:wheel"
export const assistantHtmlPreviewShellReadyMessageType =
  htmlPreviewShellReadyMessageType
export const assistantHtmlPreviewShellInitializeMessageType =
  htmlPreviewShellInitializeMessageType
export const assistantHtmlPreviewCaptureRequestMessageType =
  "linksense:assistant-html-preview:capture"
export const assistantHtmlPreviewCaptureSnapshotMessageType =
  "linksense:assistant-html-preview:capture-snapshot"
export const assistantHtmlPreviewCaptureErrorMessageType =
  "linksense:assistant-html-preview:capture-error"
export const maximumAssistantHtmlPreviewLength = 256 * 1024
export const maximumAssistantHtmlPreviewHeight = 100_000
export const maximumAssistantHtmlPreviewWheelDelta = 10_000
export const maximumAssistantHtmlPreviewCaptureSnapshotLength = 4 * 1024 * 1024

const assistantHtmlPreviewSizingCss = `
html[data-linksense-assistant-preview-root="true"],
html[data-linksense-assistant-preview-root="true"] body {
  height: auto !important;
  min-height: 0 !important;
  overflow: visible !important;
}

html[data-linksense-assistant-preview-root="true"] body > :is(
  [class~="h-screen"],
  [class~="min-h-screen"],
  [class~="h-dvh"],
  [class~="min-h-dvh"],
  [class~="h-svh"],
  [class~="min-h-svh"],
  [class~="h-lvh"],
  [class~="min-h-lvh"],
  [class*=":h-screen"],
  [class*=":min-h-screen"],
  [class*=":h-dvh"],
  [class*=":min-h-dvh"],
  [class*=":h-svh"],
  [class*=":min-h-svh"],
  [class*=":h-lvh"],
  [class*=":min-h-lvh"],
  [style*="100vh" i],
  [style*="100dvh" i],
  [style*="100svh" i],
  [style*="100lvh" i]
) {
  height: auto !important;
  min-height: 0 !important;
}
`

type AssistantHtmlPreviewLifecycleMessage = Readonly<{
  type:
    | typeof assistantHtmlPreviewReadyMessageType
    | typeof assistantHtmlPreviewErrorMessageType
  previewId: string
}>

type AssistantHtmlPreviewResizeMessage = Readonly<{
  type: typeof assistantHtmlPreviewResizeMessageType
  previewId: string
  height: number
}>

type AssistantHtmlPreviewWheelMessage = Readonly<{
  type: typeof assistantHtmlPreviewWheelMessageType
  previewId: string
  deltaX: number
  deltaY: number
}>

export type AssistantHtmlPreviewCaptureSnapshot = Readonly<{
  html: string
  viewportWidth: number
  width: number
  height: number
}>

type AssistantHtmlPreviewCaptureSnapshotMessage =
  AssistantHtmlPreviewCaptureSnapshot &
    Readonly<{
      type: typeof assistantHtmlPreviewCaptureSnapshotMessageType
      previewId: string
      requestId: string
    }>

type AssistantHtmlPreviewCaptureErrorMessage = Readonly<{
  type: typeof assistantHtmlPreviewCaptureErrorMessageType
  previewId: string
  requestId: string
}>

export type AssistantHtmlPreviewFrameMessage =
  | AssistantHtmlPreviewLifecycleMessage
  | AssistantHtmlPreviewResizeMessage
  | AssistantHtmlPreviewWheelMessage
  | AssistantHtmlPreviewCaptureSnapshotMessage
  | AssistantHtmlPreviewCaptureErrorMessage

const assistantHtmlPreviewFrameMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.union([
      z.literal(assistantHtmlPreviewReadyMessageType),
      z.literal(assistantHtmlPreviewErrorMessageType),
    ]),
    previewId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal(assistantHtmlPreviewResizeMessageType),
    previewId: z.string().min(1).max(256),
    height: z.number().int().positive().max(maximumAssistantHtmlPreviewHeight),
  }),
  z.object({
    type: z.literal(assistantHtmlPreviewWheelMessageType),
    previewId: z.string().min(1).max(256),
    deltaX: z
      .number()
      .min(-maximumAssistantHtmlPreviewWheelDelta)
      .max(maximumAssistantHtmlPreviewWheelDelta),
    deltaY: z
      .number()
      .min(-maximumAssistantHtmlPreviewWheelDelta)
      .max(maximumAssistantHtmlPreviewWheelDelta),
  }),
  z.object({
    type: z.literal(assistantHtmlPreviewCaptureSnapshotMessageType),
    previewId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
    html: z
      .string()
      .min(1)
      .max(maximumAssistantHtmlPreviewCaptureSnapshotLength),
    viewportWidth: z
      .number()
      .int()
      .positive()
      .max(maximumAssistantHtmlPreviewHeight),
    width: z.number().int().positive().max(maximumAssistantHtmlPreviewHeight),
    height: z.number().int().positive().max(maximumAssistantHtmlPreviewHeight),
  }),
  z.object({
    type: z.literal(assistantHtmlPreviewCaptureErrorMessageType),
    previewId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
  }),
])

export function isAssistantHtmlPreviewFrameMessage(
  value: unknown,
  previewId: string
): value is AssistantHtmlPreviewFrameMessage {
  const parsed = assistantHtmlPreviewFrameMessageSchema.safeParse(value)
  return parsed.success && parsed.data.previewId === previewId
}

export function isAssistantHtmlPreviewShellReadyMessage(
  value: unknown,
  previewId: string
) {
  return isHtmlPreviewShellReadyMessage(value, previewId)
}

function buildAssistantHtmlPreviewBootstrap(
  previewId: string,
  tailwindRuntimeUrl: string
) {
  return `
(() => {
  const previewId = ${JSON.stringify(previewId)};
  const tailwindRuntimeUrl = ${JSON.stringify(tailwindRuntimeUrl)};
  const readyType = ${JSON.stringify(assistantHtmlPreviewReadyMessageType)};
  const errorType = ${JSON.stringify(assistantHtmlPreviewErrorMessageType)};
  const resizeType = ${JSON.stringify(assistantHtmlPreviewResizeMessageType)};
  const wheelType = ${JSON.stringify(assistantHtmlPreviewWheelMessageType)};
  const captureRequestType = ${JSON.stringify(assistantHtmlPreviewCaptureRequestMessageType)};
  const captureSnapshotType = ${JSON.stringify(assistantHtmlPreviewCaptureSnapshotMessageType)};
  const captureErrorType = ${JSON.stringify(assistantHtmlPreviewCaptureErrorMessageType)};
  const maximumHeight = ${maximumAssistantHtmlPreviewHeight};
  const maximumWheelDelta = ${maximumAssistantHtmlPreviewWheelDelta};
  const maximumCaptureSnapshotLength = ${maximumAssistantHtmlPreviewCaptureSnapshotLength};
  const loadingAttribute = "data-linksense-assistant-preview-loading";
  let settled = false;
  let tailwindObserver;
  let tailwindProbe;
  let heightObserver;
  let contentObserver;
  let heightFrame = 0;
  let lastHeight = 0;
  let timeout;

  document.documentElement.setAttribute(loadingAttribute, "true");
  document.documentElement.setAttribute(
    "data-linksense-assistant-preview-root",
    "true"
  );
  const loadingStyle = document.createElement("style");
  loadingStyle.setAttribute("data-linksense-assistant-preview-loading-style", "true");
  loadingStyle.textContent =
    "html[" + loadingAttribute + "] body { visibility: hidden !important; }";
  document.head.append(loadingStyle);

  const sizingStyle = document.createElement("style");
  sizingStyle.setAttribute("data-linksense-preview-sizing-style", "true");
  sizingStyle.textContent = ${JSON.stringify(assistantHtmlPreviewSizingCss)};
  document.head.append(sizingStyle);

  const readDocumentHeight = () => {
    const body = document.body;
    if (!body) return 1;
    const bodyBounds = body.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    let bottom = Math.max(bodyBounds.bottom, body.offsetTop + body.offsetHeight);
    for (const element of body.querySelectorAll("*")) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 && bounds.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      bottom = Math.max(bottom, bounds.bottom + marginBottom);
    }
    const bodyMarginBottom = Number.parseFloat(bodyStyle.marginBottom) || 0;
    return Math.min(
      maximumHeight,
      Math.max(1, Math.ceil(bottom + bodyMarginBottom))
    );
  };

  const canScrollInDirection = (target, deltaX, deltaY) => {
    let element = target instanceof Element ? target : target?.parentElement;
    while (element && element !== document.body) {
      const style = getComputedStyle(element);
      const canScrollY =
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 1 &&
        ((deltaY < 0 && element.scrollTop > 0) ||
          (deltaY > 0 &&
            element.scrollTop + element.clientHeight < element.scrollHeight - 1));
      const canScrollX =
        /(auto|scroll|overlay)/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth + 1 &&
        ((deltaX < 0 && element.scrollLeft > 0) ||
          (deltaX > 0 &&
            element.scrollLeft + element.clientWidth < element.scrollWidth - 1));
      if (canScrollX || canScrollY) return true;
      element = element.parentElement;
    }
    return false;
  };

  const normalizeWheelDelta = (event) => {
    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? Math.max(1, window.innerHeight)
          : 1;
    return {
      deltaX: Math.max(
        -maximumWheelDelta,
        Math.min(maximumWheelDelta, event.deltaX * multiplier)
      ),
      deltaY: Math.max(
        -maximumWheelDelta,
        Math.min(maximumWheelDelta, event.deltaY * multiplier)
      ),
    };
  };

  window.addEventListener("wheel", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    const delta = normalizeWheelDelta(event);
    if (
      (delta.deltaX === 0 && delta.deltaY === 0) ||
      canScrollInDirection(event.target, delta.deltaX, delta.deltaY)
    ) {
      return;
    }
    event.preventDefault();
    parent.postMessage({ type: wheelType, previewId, ...delta }, "*");
  }, { passive: false });

  const syncCaptureState = (sourceRoot, cloneRoot) => {
    const sourceElements = sourceRoot.querySelectorAll("*");
    const cloneElements = cloneRoot.querySelectorAll("*");
    for (let index = 0; index < sourceElements.length; index += 1) {
      const source = sourceElements[index];
      const clone = cloneElements[index];
      if (!clone) continue;
      if (source.scrollTop !== 0) {
        clone.setAttribute("data-linksense-capture-scroll-top", String(source.scrollTop));
      }
      if (source.scrollLeft !== 0) {
        clone.setAttribute("data-linksense-capture-scroll-left", String(source.scrollLeft));
      }
    }

    const sourceControls = sourceRoot.querySelectorAll(
      "input, textarea, select, details"
    );
    const cloneControls = cloneRoot.querySelectorAll(
      "input, textarea, select, details"
    );
    for (let index = 0; index < sourceControls.length; index += 1) {
      const source = sourceControls[index];
      const clone = cloneControls[index];
      if (!clone) continue;
      if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
        clone.setAttribute("value", source.value);
        clone.toggleAttribute("checked", source.checked);
      } else if (
        source instanceof HTMLTextAreaElement &&
        clone instanceof HTMLTextAreaElement
      ) {
        clone.textContent = source.value;
      } else if (
        source instanceof HTMLSelectElement &&
        clone instanceof HTMLSelectElement
      ) {
        for (let optionIndex = 0; optionIndex < source.options.length; optionIndex += 1) {
          clone.options[optionIndex]?.toggleAttribute(
            "selected",
            source.options[optionIndex].selected
          );
        }
      } else if (
        source instanceof HTMLDetailsElement &&
        clone instanceof HTMLDetailsElement
      ) {
        clone.toggleAttribute("open", source.open);
      }
    }

    const sourceImages = sourceRoot.querySelectorAll("img");
    const cloneImages = cloneRoot.querySelectorAll("img");
    for (let index = 0; index < sourceImages.length; index += 1) {
      const currentSource = sourceImages[index].currentSrc;
      if (!currentSource || !cloneImages[index]) continue;
      cloneImages[index].src = currentSource;
      cloneImages[index].removeAttribute("srcset");
    }

    const sourceCanvases = sourceRoot.querySelectorAll("canvas");
    const cloneCanvases = cloneRoot.querySelectorAll("canvas");
    for (let index = 0; index < sourceCanvases.length; index += 1) {
      const source = sourceCanvases[index];
      const clone = cloneCanvases[index];
      if (!clone) continue;
      try {
        const replacement = document.createElement("img");
        for (const attribute of clone.attributes) {
          replacement.setAttribute(attribute.name, attribute.value);
        }
        replacement.src = source.toDataURL("image/png");
        replacement.width = source.width;
        replacement.height = source.height;
        clone.replaceWith(replacement);
      } catch {
        // A tainted canvas cannot be serialized; leave its blank clone in place.
      }
    }
  };

  const buildCaptureSnapshot = () => {
    const root = document.documentElement;
    const body = document.body;
    const clone = root.cloneNode(true);
    syncCaptureState(root, clone);
    clone.removeAttribute(loadingAttribute);
    clone.querySelectorAll("script, iframe, frame, object, embed, base").forEach(
      (element) => element.remove()
    );
    clone.querySelectorAll("link[rel='preload'], link[rel='modulepreload']").forEach(
      (element) => element.remove()
    );
    for (const element of clone.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.toLowerCase().startsWith("on")) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    clone.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').forEach(
      (element) => element.remove()
    );
    const captureCsp = document.createElement("meta");
    captureCsp.setAttribute("http-equiv", "Content-Security-Policy");
    captureCsp.setAttribute(
      "content",
      "default-src http: https: data: blob:; base-uri 'none'; connect-src 'none'; frame-src 'self' data: blob:; object-src 'none'; script-src 'none'; img-src http: https: data: blob:; font-src http: https: data:; style-src http: https: data: blob: 'unsafe-inline'"
    );
    clone.querySelector("head")?.prepend(captureCsp);
    const html = "<!doctype html>\\n" + clone.outerHTML;
    if (html.length > maximumCaptureSnapshotLength) {
      throw new Error("HTML preview capture snapshot is too large");
    }
    return {
      html,
      viewportWidth: Math.min(
        maximumHeight,
        Math.max(1, Math.ceil(root.clientWidth || window.innerWidth || 0))
      ),
      width: Math.min(
        maximumHeight,
        Math.max(1, Math.ceil(Math.max(root.scrollWidth, body?.scrollWidth || 0)))
      ),
      height: Math.min(
        maximumHeight,
        Math.max(1, Math.ceil(Math.max(root.scrollHeight, body?.scrollHeight || 0)))
      ),
    };
  };

  const capturePreview = (requestId) => {
    try {
      const snapshot = buildCaptureSnapshot();
      parent.postMessage(
        { type: captureSnapshotType, previewId, requestId, ...snapshot },
        "*"
      );
    } catch {
      parent.postMessage(
        { type: captureErrorType, previewId, requestId },
        "*"
      );
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (
      !message ||
      typeof message !== "object" ||
      message.type !== captureRequestType ||
      message.previewId !== previewId ||
      typeof message.requestId !== "string" ||
      message.requestId.length < 1 ||
      message.requestId.length > 256
    ) {
      return;
    }
    capturePreview(message.requestId);
  });

  const reportHeight = () => {
    const height = readDocumentHeight();
    if (height === lastHeight) return;
    lastHeight = height;
    parent.postMessage({ type: resizeType, previewId, height }, "*");
  };

  const scheduleHeightReport = () => {
    if (heightFrame) cancelAnimationFrame(heightFrame);
    heightFrame = requestAnimationFrame(() => {
      heightFrame = 0;
      reportHeight();
    });
  };

  const observeHeight = () => {
    reportHeight();
    if (typeof ResizeObserver === "function") {
      heightObserver = new ResizeObserver(scheduleHeightReport);
      heightObserver.observe(document.documentElement);
      if (document.body) heightObserver.observe(document.body);
    }
    contentObserver = new MutationObserver(scheduleHeightReport);
    contentObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    window.addEventListener("resize", scheduleHeightReport);
  };

  const finish = (type) => {
    if (settled) return;
    settled = true;
    tailwindObserver?.disconnect();
    tailwindProbe?.remove();
    clearTimeout(timeout);
    if (type === readyType) {
      document.documentElement.removeAttribute(loadingAttribute);
      observeHeight();
    }
    parent.postMessage({ type, previewId }, "*");
  };

  const ensureTailwindProbe = () => {
    if (tailwindProbe?.isConnected) return tailwindProbe;
    if (!document.body) return null;
    tailwindProbe = document.createElement("span");
    tailwindProbe.setAttribute("aria-hidden", "true");
    tailwindProbe.className = "[--linksense-preview-ready:1]";
    tailwindProbe.style.cssText =
      "position:fixed;left:-10000px;top:0;pointer-events:none;visibility:hidden";
    document.body.append(tailwindProbe);
    return tailwindProbe;
  };

  const hasCompiledTailwind = () => {
    const probe = ensureTailwindProbe();
    return Boolean(
      probe &&
        getComputedStyle(probe)
          .getPropertyValue("--linksense-preview-ready")
          .trim() === "1"
    );
  };

  const checkReady = () => {
    if (hasCompiledTailwind()) {
      finish(readyType);
    }
  };

  tailwindObserver = new MutationObserver(checkReady);
  tailwindObserver.observe(document.head, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  window.addEventListener(
    "error",
    (event) => {
      if (
        event.target instanceof HTMLScriptElement &&
        event.target.src === tailwindRuntimeUrl
      ) {
        finish(errorType);
      }
    },
    true
  );
  document.addEventListener("DOMContentLoaded", checkReady, { once: true });
  window.addEventListener("load", checkReady, { once: true });
  timeout = setTimeout(() => finish(errorType), 8000);
  checkReady();
})();
`
}

export function buildAssistantHtmlPreviewDocument(
  rawHtml: string,
  options: Readonly<{
    previewId: string
    tailwindRuntimeUrl: string
  }>
) {
  if (rawHtml.length > maximumAssistantHtmlPreviewLength) {
    throw new Error("Assistant HTML preview is too large")
  }

  const tailwindRuntimeUrl = new URL(
    options.tailwindRuntimeUrl,
    window.location.href
  ).href
  return buildSafeHtmlDocument(rawHtml, "interaction", {
    scriptUrl: tailwindRuntimeUrl,
    bootstrapScript: buildAssistantHtmlPreviewBootstrap(
      options.previewId,
      tailwindRuntimeUrl
    ),
    allowUnrestrictedScripts: true,
  })
}
