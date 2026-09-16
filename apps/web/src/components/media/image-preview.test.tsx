import { useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadApiFile } from "@/api/client"
import {
  ImagePreviewDialog,
  ImagePreviewViewer,
  ImageThumbnail,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import i18n from "@/i18n"

vi.mock("@/api/client", () => ({
  buildApiUrl: (path: string, query?: Record<string, string>) => {
    const url = new URL(`/api/v1${path}`, window.location.origin)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value))
      }
    }
    return `${url.pathname}${url.search}`
  },
  downloadApiFile: vi.fn(),
}))

const images: ImagePreviewItem[] = [
  {
    id: "first",
    name: "preview.png",
    src: "blob:preview",
  },
  {
    id: "second",
    name: "diagram.webp",
    src: "blob:diagram",
  },
]

function PreviewHarness({
  items = images,
  onDownload,
}: {
  items?: readonly ImagePreviewItem[]
  onDownload?: (item: ImagePreviewItem) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  return (
    <>
      {items.map((item) => (
        <ImageThumbnail key={item.id} item={item} onPreview={setActiveId} />
      ))}
      <ImagePreviewDialog
        items={items}
        activeId={activeId}
        onActiveIdChange={setActiveId}
        onDownload={onDownload}
      />
    </>
  )
}

function OpenPreviewHarness({
  items = images,
  onDownload,
}: {
  items?: readonly ImagePreviewItem[]
  onDownload?: (item: ImagePreviewItem) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)
  return (
    <ImagePreviewDialog
      items={items}
      activeId={activeId}
      onActiveIdChange={setActiveId}
      onDownload={onDownload}
    />
  )
}

describe("image preview", () => {
  beforeEach(async () => {
    i18n.addResourceBundle(
      "zh-CN",
      "translation",
      {
        common: {
          close: "关闭",
          download: "下载",
        },
        conversation: {
          previewImage: "预览图片 {{name}}",
          removeAttachment: "移除附件 {{name}}",
          imagePreviewTitle: "图片预览：{{name}}",
          imagePreviewDescription: "正在预览图片 {{name}}",
          previousImage: "上一张图片",
          nextImage: "下一张图片",
          zoomOut: "缩小图片",
          zoomIn: "放大图片",
          previewLoadFailed: "无法加载图片预览。",
        },
      },
      true,
      true
    )
    await i18n.changeLanguage("zh-CN")
    vi.mocked(downloadApiFile).mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows inline image zoom controls by default and hides them when requested", async () => {
    const item = {
      id: "preview",
      name: "preview.png",
      src: "data:image/png,test",
    }
    const view = render(<ImagePreviewViewer item={item} />)
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "放大图片" }))
    expect(screen.getByText("125%")).toBeInTheDocument()
    view.rerender(<ImagePreviewViewer item={item} showZoomControls={false} />)
    expect(screen.queryByRole("button", { name: "放大图片" })).toBeNull()
    expect(screen.queryByRole("button", { name: "缩小图片" })).toBeNull()
    expect(screen.queryByText("125%")).toBeNull()
    expect(screen.getByRole("img")).toHaveAttribute("data-zoom", "125")
  })

  it("clamps opt-in wheel zoom and removes the wheel listener when disabled", () => {
    const item = {
      id: "wheel",
      name: "preview.png",
      src: "data:image/png,test",
    }
    const view = render(<ImagePreviewViewer item={item} wheelZoom />)
    const image = screen.getByRole("img")
    const stage = image.closest<HTMLElement>(".image-preview-stage")!
    const wheel = (deltaY: number) =>
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY })
    for (let index = 0; index < 10; index++) fireEvent(stage, wheel(-100))
    expect(image).toHaveAttribute("data-zoom", "300")
    expect(screen.getByRole("button", { name: "放大图片" })).toBeDisabled()
    for (let index = 0; index < 15; index++) fireEvent(stage, wheel(100))
    expect(image).toHaveAttribute("data-zoom", "50")
    expect(screen.getByRole("button", { name: "缩小图片" })).toBeDisabled()
    view.rerender(<ImagePreviewViewer item={item} />)
    const scroll = wheel(-100)
    fireEvent(stage, scroll)
    expect(scroll.defaultPrevented).toBe(false)
    expect(image).toHaveAttribute("data-zoom", "50")
  })

  it.each([
    { deltaMode: 1, deltaY: -3, zoom: "110" },
    { deltaMode: 2, deltaY: -1, zoom: "122" },
  ])(
    "normalizes wheel delta mode $deltaMode",
    ({ deltaMode, deltaY, zoom }) => {
      render(
        <ImagePreviewViewer
          item={{
            id: "wheel",
            name: "preview.png",
            src: "data:image/png,test",
          }}
          wheelZoom
        />
      )
      const image = screen.getByRole("img")
      const stage = image.closest<HTMLElement>(".image-preview-stage")!
      Object.defineProperty(stage, "clientHeight", {
        configurable: true,
        value: 480,
      })
      fireEvent(
        stage,
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY,
          deltaMode,
        })
      )
      expect(image).toHaveAttribute("data-zoom", zoom)
    }
  )

  it("opens from a thumbnail, traps focus, and returns focus after Escape", async () => {
    const interaction = userEvent.setup()
    render(<PreviewHarness />)
    const trigger = screen.getByRole("button", {
      name: "预览图片 preview.png",
    })

    await interaction.click(trigger)

    const dialog = await screen.findByRole("dialog", {
      name: "图片预览：preview.png",
    })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(
      within(dialog).getByRole("img", { name: "preview.png" })
    ).toHaveAttribute("data-zoom", "100")

    await interaction.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await interaction.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(trigger).toHaveFocus()
  })

  it("replaces the centered dialog translation with viewport positioning", () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)

    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveClass(
      "top-0",
      "left-0",
      "translate-x-0",
      "translate-y-0"
    )
    expect(dialog).not.toHaveClass(
      "top-1/2",
      "left-1/2",
      "-translate-x-1/2",
      "-translate-y-1/2"
    )
  })

  it("navigates with controls and arrow keys and resets zoom on image changes", async () => {
    const interaction = userEvent.setup()
    render(<OpenPreviewHarness />)

    expect(screen.getByRole("button", { name: "上一张图片" })).toBeDisabled()
    await interaction.click(screen.getByRole("button", { name: "放大图片" }))
    expect(screen.getByText("125%")).toBeVisible()

    await interaction.keyboard("{ArrowRight}")
    expect(
      await screen.findByRole("img", { name: "diagram.webp" })
    ).toHaveAttribute("data-zoom", "100")
    expect(screen.getByRole("button", { name: "下一张图片" })).toBeDisabled()

    await interaction.click(screen.getByRole("button", { name: "上一张图片" }))
    expect(
      await screen.findByRole("img", { name: "preview.png" })
    ).toBeVisible()
  })

  it("supports keyboard zoom, clamps its range, and resets with zero", async () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)
    const dialog = screen.getByRole("dialog")

    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(dialog, { key: "+" })
    }
    expect(screen.getByText("300%")).toBeVisible()
    expect(screen.getByRole("button", { name: "放大图片" })).toBeDisabled()

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(dialog, { key: "-" })
    }
    expect(screen.getByText("50%")).toBeVisible()
    expect(screen.getByRole("button", { name: "缩小图片" })).toBeDisabled()

    fireEvent.keyDown(dialog, { key: "0" })
    expect(screen.getByText("100%")).toBeVisible()
  })

  it("zooms with a trackpad pinch without treating two-finger scrolling as zoom", () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)
    const stage = document.querySelector<HTMLElement>(".image-preview-stage")!
    const image = screen.getByRole("img", { name: "preview.png" })

    const twoFingerScrollEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    })
    fireEvent(stage, twoFingerScrollEvent)
    expect(screen.getByText("100%")).toBeVisible()
    expect(twoFingerScrollEvent.defaultPrevented).toBe(false)

    const trackpadPinchEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -10,
    })
    fireEvent(stage, trackpadPinchEvent)
    expect(screen.getByText("110%")).toBeVisible()
    expect(image).toHaveStyle({ "--image-preview-scale": "1.1" })
  })

  it("zooms with a two-finger touch pinch", () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)
    const stage = document.querySelector<HTMLElement>(".image-preview-stage")!
    const image = screen.getByRole("img", { name: "preview.png" })

    const touch = (identifier: number, clientX: number, clientY: number) => ({
      identifier,
      target: stage,
      clientX,
      clientY,
      pageX: clientX,
      pageY: clientY,
      screenX: clientX,
      screenY: clientY,
    })
    const firstTouch = touch(1, 100, 100)
    const secondTouch = touch(2, 200, 100)
    fireEvent.touchStart(stage, {
      touches: [firstTouch, secondTouch],
      targetTouches: [firstTouch, secondTouch],
      changedTouches: [firstTouch, secondTouch],
    })

    const expandedSecondTouch = touch(2, 300, 100)
    fireEvent.touchMove(stage, {
      touches: [firstTouch, expandedSecondTouch],
      targetTouches: [firstTouch, expandedSecondTouch],
      changedTouches: [expandedSecondTouch],
    })

    expect(screen.getByText("200%")).toBeVisible()
    expect(image).toHaveStyle({ "--image-preview-scale": "2" })
  })

  it("keeps the image fitted initially and allows bounded panning at 100%", () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)
    const stage = document.querySelector<HTMLElement>(".image-preview-stage")!
    const image = screen.getByRole("img", { name: "preview.png" })

    Object.defineProperties(image, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    })
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    expect(image).toHaveAttribute("data-zoom", "100")
    expect(stage).toHaveAttribute("data-pannable", "true")

    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    })
    fireEvent.pointerMove(stage, {
      buttons: 1,
      clientX: 500,
      clientY: 350,
      pointerId: 1,
    })
    fireEvent.pointerUp(stage, {
      button: 0,
      buttons: 0,
      clientX: 500,
      clientY: 350,
      pointerId: 1,
    })

    expect(image).toHaveAttribute("data-pan-x", "64")
    expect(image).toHaveAttribute("data-pan-y", "48")
    expect(image).toHaveStyle({
      "--image-preview-translate-x": "64px",
      "--image-preview-translate-y": "48px",
    })
  })

  it("resets the drag position while keeping panning available at 100%", () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)
    const stage = document.querySelector<HTMLElement>(".image-preview-stage")!
    const image = screen.getByRole("img", { name: "preview.png" })

    Object.defineProperties(image, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    })
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "放大图片" }))
    }
    fireEvent.pointerDown(stage, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    })
    fireEvent.pointerMove(stage, {
      buttons: 1,
      clientX: 250,
      clientY: 150,
      pointerId: 1,
    })
    fireEvent.pointerUp(stage, {
      button: 0,
      buttons: 0,
      clientX: 250,
      clientY: 150,
      pointerId: 1,
    })
    expect(image).toHaveAttribute("data-pan-x", "150")

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "0" })

    expect(image).toHaveAttribute("data-pan-x", "0")
    expect(image).toHaveAttribute("data-pan-y", "0")
    expect(stage).toHaveAttribute("data-pannable", "true")
  })

  it("downloads the active image, hides single-image navigation, and handles load errors", async () => {
    const interaction = userEvent.setup()
    const onDownload = vi.fn()
    render(<OpenPreviewHarness items={[images[0]!]} onDownload={onDownload} />)

    expect(
      screen.queryByRole("button", { name: "上一张图片" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "下一张图片" })
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("button", { name: "下载" }))
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onDownload).toHaveBeenCalledWith(images[0])

    fireEvent.error(screen.getByRole("img", { name: "preview.png" }))
    expect(screen.getByText("无法加载图片预览。")).toBeVisible()
  })

  it("downloads external images through the API proxy instead of fetching the image URL directly", async () => {
    const interaction = userEvent.setup()
    const remoteImage = {
      id: "remote",
      name: "remote.png",
      src: "https://cdn.example.com/images/remote.png",
    } satisfies ImagePreviewItem
    const blob = new Blob(["proxied image"], { type: "image/png" })
    vi.mocked(downloadApiFile).mockResolvedValue(blob)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unexpected"))
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:proxied-download"),
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })

    render(<OpenPreviewHarness items={[remoteImage]} />)

    await interaction.click(screen.getByRole("button", { name: "下载" }))

    expect(downloadApiFile).toHaveBeenCalledWith("/external-images/download", {
      url: remoteImage.src,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledOnce()
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      remoteImage.name
    )
  })

  it("keeps preview and remove controls as siblings and removes without opening", async () => {
    const interaction = userEvent.setup()
    const onPreview = vi.fn()
    const onRemove = vi.fn()
    const { container } = render(
      <ImageThumbnail
        item={images[0]!}
        onPreview={onPreview}
        onRemove={onRemove}
      />
    )
    const preview = screen.getByRole("button", {
      name: "预览图片 preview.png",
    })
    const remove = screen.getByRole("button", {
      name: "移除附件 preview.png",
    })

    expect(preview.contains(remove)).toBe(false)
    expect(remove.contains(preview)).toBe(false)
    expect(container.querySelector("button button")).toBeNull()

    await interaction.click(remove)
    expect(onRemove).toHaveBeenCalledWith("first")
    expect(onPreview).not.toHaveBeenCalled()
  })

  it("fits the whole image into the available stage on its first load", () => {
    render(<OpenPreviewHarness items={[images[0]!]} />)
    const stage = document.querySelector<HTMLElement>(".image-preview-stage")!
    const image = screen.getByRole("img", { name: "preview.png" })

    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 1_800 },
      naturalWidth: { configurable: true, value: 1_200 },
    })

    fireEvent.load(image)

    expect(image.style.getPropertyValue("--image-preview-fit-width")).toBe(
      "400px"
    )
    expect(image.style.getPropertyValue("--image-preview-fit-height")).toBe(
      "600px"
    )
    expect(image).toHaveAttribute("data-zoom", "100")
  })

  it("opens an already-cached image without repeatedly reattaching preview refs", async () => {
    const interaction = userEvent.setup()
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true
    )
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      1_200
    )
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get"
    ).mockReturnValue(1_800)
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        bottom: 600,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    )

    render(<PreviewHarness items={[images[0]!]} />)
    await interaction.click(
      screen.getByRole("button", { name: "预览图片 preview.png" })
    )

    const image = await screen.findByRole("img", { name: "preview.png" })
    await waitFor(() =>
      expect(image.style.getPropertyValue("--image-preview-fit-height")).toBe(
        "600px"
      )
    )
    expect(screen.getByRole("dialog")).toBeVisible()
  })

  it("shows a top-right download control and downloads through the current page", async () => {
    const interaction = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("blocked by content security policy"))
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)

    render(<OpenPreviewHarness items={[images[0]!]} />)

    await interaction.click(screen.getByRole("button", { name: "下载" }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe(images[0]!.src)
    expect(anchor.download).toBe(images[0]!.name)
    expect(anchor.isConnected).toBe(false)
  })
})
