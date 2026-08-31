import type { AssistantHtmlPreviewCaptureSnapshot } from "@/features/conversations/assistant-html-preview-document"

const maximumCaptureDimension = 16_384
const maximumCapturePixels = 20_000_000
const captureFrameLoadTimeout = 10_000
const captureRenderTimeout = 30_000
const captureAssetLoadTimeout = 5_000
const captureScrollTopAttribute = "data-linksense-capture-scroll-top"
const captureScrollLeftAttribute = "data-linksense-capture-scroll-left"

function waitForFrameLoad(frame: HTMLIFrameElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("HTML preview capture frame timed out"))
    }, captureFrameLoadTimeout)
    frame.addEventListener(
      "load",
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      { once: true }
    )
  })
}

function restoreSnapshotScroll(document: Document) {
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${captureScrollTopAttribute}], [${captureScrollLeftAttribute}]`
  )) {
    const scrollTop = Number(element.getAttribute(captureScrollTopAttribute))
    const scrollLeft = Number(element.getAttribute(captureScrollLeftAttribute))
    if (Number.isFinite(scrollTop)) element.scrollTop = scrollTop
    if (Number.isFinite(scrollLeft)) element.scrollLeft = scrollLeft
    element.removeAttribute(captureScrollTopAttribute)
    element.removeAttribute(captureScrollLeftAttribute)
  }
}

async function waitForSnapshotAssets(document: Document) {
  const images = Array.from(document.images, (image) => {
    if (image.complete || !image.currentSrc) return Promise.resolve()
    return new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true })
      image.addEventListener("error", () => resolve(), { once: true })
    })
  })
  const fonts = document.fonts?.ready ?? Promise.resolve()
  let timeout = 0
  await Promise.race([
    Promise.all([fonts, ...images]),
    new Promise<void>((resolve) => {
      timeout = window.setTimeout(resolve, captureAssetLoadTimeout)
    }),
  ])
  window.clearTimeout(timeout)
}

function captureScale(width: number, height: number) {
  const requestedScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const scale = Math.min(
    requestedScale,
    maximumCaptureDimension / width,
    maximumCaptureDimension / height,
    Math.sqrt(maximumCapturePixels / (width * height))
  )
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("HTML preview dimensions cannot be captured")
  }
  return scale
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Unable to encode HTML preview image"))
    }, "image/png")
  })
}

export async function renderAssistantHtmlPreviewSnapshot(
  snapshot: AssistantHtmlPreviewCaptureSnapshot
) {
  const frame = document.createElement("iframe")
  frame.className =
    "pointer-events-none fixed top-0 -left-[100000px] border-0 opacity-0"
  frame.width = String(snapshot.viewportWidth)
  frame.height = String(snapshot.height)
  frame.tabIndex = -1
  frame.setAttribute("aria-hidden", "true")
  frame.setAttribute("sandbox", "allow-same-origin")
  frame.referrerPolicy = "no-referrer"

  const loaded = waitForFrameLoad(frame)
  frame.srcdoc = snapshot.html
  document.body.append(frame)

  const controller = new AbortController()
  const renderTimeout = window.setTimeout(
    () => controller.abort(),
    captureRenderTimeout
  )
  try {
    await loaded
    const captureDocument = frame.contentDocument
    if (!captureDocument?.documentElement || !captureDocument.body) {
      throw new Error("Unable to access HTML preview capture frame")
    }
    restoreSnapshotScroll(captureDocument)
    await waitForSnapshotAssets(captureDocument)

    const root = captureDocument.documentElement
    const body = captureDocument.body
    const width = Math.max(
      snapshot.width,
      root.scrollWidth,
      body.scrollWidth,
      1
    )
    const height = Math.max(
      snapshot.height,
      root.scrollHeight,
      body.scrollHeight,
      1
    )
    const { default: html2canvas } = await import("html2canvas-pro")
    const canvas = await html2canvas(body, {
      backgroundColor: null,
      height,
      imageSmoothing: true,
      imageSmoothingQuality: "high",
      logging: false,
      scale: captureScale(width, height),
      signal: controller.signal,
      useCORS: true,
      width,
      windowHeight: height,
      windowWidth: snapshot.viewportWidth,
    })
    return await canvasToPng(canvas)
  } finally {
    window.clearTimeout(renderTimeout)
    frame.remove()
  }
}
