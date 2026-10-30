import {
  htmlPreviewShellInitializeMessageType,
  htmlPreviewShellReadyMessageType,
  isHtmlPreviewShellReadyMessage,
} from "@/components/media/html-preview/html-preview-shell"
import { buildSafeHtmlDocument } from "@/components/media/html-preview/html-preview-sanitizer"
import {
  htmlPreviewResourceStateSchema,
  htmlPreviewResourceWaitMs,
  installHtmlPreviewReadiness,
  type HtmlPreviewResourceState,
} from "@/components/media/html-preview/html-preview-readiness"
import { z } from "zod"

export const assistantHtmlPreviewReadyMessageType =
  "linksense:assistant-html-preview:ready"
export const assistantHtmlPreviewErrorMessageType =
  "linksense:assistant-html-preview:error"
export const assistantHtmlPreviewWheelMessageType =
  "linksense:assistant-html-preview:wheel"
export const assistantHtmlPreviewLayoutMessageType =
  "linksense:assistant-html-preview:layout"
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
const maximumAssistantHtmlPreviewCaptureDimension = 100_000
export const maximumAssistantHtmlPreviewWheelDelta = 10_000
export const maximumAssistantHtmlPreviewCaptureSnapshotLength = 4 * 1024 * 1024

type AssistantHtmlPreviewLifecycleMessage =
  | Readonly<{
      type: typeof assistantHtmlPreviewReadyMessageType
      resourceState: HtmlPreviewResourceState
      previewId: string
    }>
  | Readonly<{
      type: typeof assistantHtmlPreviewErrorMessageType
      previewId: string
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
  viewportHeight: number
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
  | AssistantHtmlPreviewWheelMessage
  | AssistantHtmlPreviewCaptureSnapshotMessage
  | AssistantHtmlPreviewCaptureErrorMessage

const assistantHtmlPreviewFrameMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(assistantHtmlPreviewReadyMessageType),
    resourceState: htmlPreviewResourceStateSchema,
    previewId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal(assistantHtmlPreviewErrorMessageType),
    previewId: z.string().min(1).max(256),
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
      .max(maximumAssistantHtmlPreviewCaptureDimension),
    viewportHeight: z
      .number()
      .int()
      .positive()
      .max(maximumAssistantHtmlPreviewCaptureDimension),
    width: z
      .number()
      .int()
      .positive()
      .max(maximumAssistantHtmlPreviewCaptureDimension),
    height: z
      .number()
      .int()
      .positive()
      .max(maximumAssistantHtmlPreviewCaptureDimension),
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

function buildAssistantHtmlPreviewBootstrap(previewId: string) {
  return `
(() => {
  const previewId = ${JSON.stringify(previewId)};
  const readyType = ${JSON.stringify(assistantHtmlPreviewReadyMessageType)};
  const wheelType = ${JSON.stringify(assistantHtmlPreviewWheelMessageType)};
  const layoutType = ${JSON.stringify(assistantHtmlPreviewLayoutMessageType)};
  const captureRequestType = ${JSON.stringify(assistantHtmlPreviewCaptureRequestMessageType)};
  const captureSnapshotType = ${JSON.stringify(assistantHtmlPreviewCaptureSnapshotMessageType)};
  const captureErrorType = ${JSON.stringify(assistantHtmlPreviewCaptureErrorMessageType)};
  const maximumCaptureDimension = ${maximumAssistantHtmlPreviewCaptureDimension};
  const maximumWheelDelta = ${maximumAssistantHtmlPreviewWheelDelta};
  const maximumCaptureSnapshotLength = ${maximumAssistantHtmlPreviewCaptureSnapshotLength};
  const loadingAttribute = "data-linksense-assistant-preview-loading";
  let settled = false;
  let fullscreen = false;

  document.documentElement.setAttribute(loadingAttribute, "true");
  const loadingStyle = document.createElement("style");
  loadingStyle.setAttribute("data-linksense-assistant-preview-loading-style", "true");
  loadingStyle.textContent =
    "html[" + loadingAttribute + "] body { visibility: hidden !important; }";
  document.head.append(loadingStyle);

  const canScrollInDirection = (target, deltaX, deltaY) => {
    let element = target instanceof Element ? target : target?.parentElement;
    const scrollRoot = document.scrollingElement || document.documentElement;
    const rootStyle = getComputedStyle(scrollRoot);
    const bodyOverflowIsViewport = scrollRoot === document.documentElement &&
      (!rootStyle.overflowX || rootStyle.overflowX === "visible") &&
      (!rootStyle.overflowY || rootStyle.overflowY === "visible");
    while (element) {
      const isRoot = element === scrollRoot;
      if (element === document.body && !isRoot && bodyOverflowIsViewport) {
        // Propagated body overflow does not create a second scroll container.
        element = element.parentElement;
        continue;
      }
      const style = isRoot ? rootStyle : getComputedStyle(element);
      // A visible root propagates body overflow to the viewport. Its default
      // visible overflow scrolls, but authored hidden/clip must stay respected.
      const bodyStyle = isRoot && bodyOverflowIsViewport && document.body
        ? getComputedStyle(document.body)
        : null;
      const overflowY = bodyStyle?.overflowY || style.overflowY;
      const overflowX = bodyStyle?.overflowX || style.overflowX;
      const canScrollY =
        (/(auto|scroll|overlay)/.test(overflowY) ||
          (isRoot && !/(hidden|clip)/.test(overflowY))) &&
        element.scrollHeight > element.clientHeight + 1 &&
        ((deltaY < 0 && element.scrollTop > 0) ||
          (deltaY > 0 &&
            element.scrollTop + element.clientHeight < element.scrollHeight - 1));
      const canScrollX =
        (/(auto|scroll|overlay)/.test(overflowX) ||
          (isRoot && !/(hidden|clip)/.test(overflowX))) &&
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
    if (fullscreen || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
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
        maximumCaptureDimension,
        Math.max(1, Math.ceil(root.clientWidth || window.innerWidth || 0))
      ),
      viewportHeight: Math.min(
        maximumCaptureDimension,
        Math.max(1, Math.ceil(root.clientHeight || window.innerHeight || 0))
      ),
      width: Math.min(
        maximumCaptureDimension,
        Math.max(1, Math.ceil(Math.max(root.scrollWidth, body?.scrollWidth || 0)))
      ),
      height: Math.min(
        maximumCaptureDimension,
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
      message.previewId !== previewId
    ) {
      return;
    }
    if (message.type === layoutType) {
      if (message.mode !== "inline" && message.mode !== "fullscreen") return;
      fullscreen = message.mode === "fullscreen";
      return;
    }
    if (
      message.type !== captureRequestType ||
      typeof message.requestId !== "string" ||
      message.requestId.length < 1 ||
      message.requestId.length > 256
    ) {
      return;
    }
    capturePreview(message.requestId);
  });

  const finish = (resourceState) => {
    if (settled) return;
    settled = true;
    document.documentElement.removeAttribute(loadingAttribute);
    parent.postMessage({ type: readyType, previewId, resourceState }, "*");
  };

  (${installHtmlPreviewReadiness.toString()})(window, {
    timeoutMs: ${htmlPreviewResourceWaitMs},
    prepare: () => document.documentElement.getBoundingClientRect(),
    onReady: finish,
  });
})();
`
}

export function buildAssistantHtmlPreviewDocument(
  rawHtml: string,
  options: Readonly<{
    previewId: string
  }>
) {
  if (rawHtml.length > maximumAssistantHtmlPreviewLength) {
    throw new Error("Assistant HTML preview is too large")
  }

  return buildSafeHtmlDocument(rawHtml, "interaction", {
    bootstrapScript: buildAssistantHtmlPreviewBootstrap(options.previewId),
    allowUnrestrictedScripts: true,
  })
}
