import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ArchivePreview from "@/components/media/archive-preview/archive-preview"
import {
  buildArchivePreviewManifest,
  type ArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-utils"
import i18n from "@/i18n"

const archiveLoader = vi.hoisted(() => ({
  loadEntry: vi.fn(),
  loadManifest: vi.fn(),
}))

vi.mock(
  "@/components/media/archive-preview/archive-preview-loader",
  () => ({
    loadArchivePreviewEntry: archiveLoader.loadEntry,
    loadArchivePreviewManifest: archiveLoader.loadManifest,
  })
)

vi.mock("react-pdf", () => ({
  Document: ({ children }: { children: ReactNode }) => <>{children}</>,
  Page: () => <div>PDF page</div>,
  pdfjs: { GlobalWorkerOptions: {} },
}))

function manifest(): ArchivePreviewManifest {
  return buildArchivePreviewManifest([
    {
      filename: "README.md",
      directory: false,
      encrypted: false,
      compressedSize: 10,
      uncompressedSize: 12,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      externalFileAttributes: 0,
    },
    {
      filename: "docs/readme.txt",
      directory: false,
      encrypted: true,
      compressedSize: 20,
      uncompressedSize: 24,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      externalFileAttributes: 0,
    },
    {
      filename: "docs/guide.md",
      directory: false,
      encrypted: false,
      compressedSize: 24,
      uncompressedSize: 30,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      externalFileAttributes: 0,
    },
    {
      filename: "index.html",
      directory: false,
      encrypted: false,
      compressedSize: 36,
      uncompressedSize: 48,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      externalFileAttributes: 0,
    },
    {
      filename: "LICENSE",
      directory: false,
      encrypted: false,
      compressedSize: 12,
      uncompressedSize: 16,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      externalFileAttributes: 0,
    },
  ])
}

describe("ArchivePreview", () => {
  beforeEach(async () => {
    archiveLoader.loadEntry.mockReset()
    archiveLoader.loadManifest.mockReset()
    archiveLoader.loadManifest.mockResolvedValue(manifest())
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("shows ZIP folders, lets people navigate, search, and download the original archive", async () => {
    const onDownload = vi.fn()
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onDownload={onDownload}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByText("5 个文件 · 1 个文件夹")).toBeVisible()
    expect(screen.getAllByRole("button", { name: "根目录" })).toHaveLength(2)
    await userEvent.click(screen.getAllByRole("button", { name: "docs" })[0])
    expect(await screen.findByText("readme.txt")).toBeVisible()
    expect(screen.getByText("已加密")).toBeVisible()

    await userEvent.clear(screen.getByRole("textbox", { name: "搜索压缩包内容" }))
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索压缩包内容" }),
      "README"
    )
    expect(await screen.findByText("README.md")).toBeVisible()

    await userEvent.click(
      screen.getByRole("button", { name: "下载文档 bundle.zip" })
    )
    expect(onDownload).toHaveBeenCalledOnce()
  })

  it("uses a hyphen for unavailable folder sizes and modified time", async () => {
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onClose={vi.fn()}
      />
    )

    const folderRow = await screen.findByRole("row", {
      name: /docs\s+文件夹/u,
    })
    expect(folderRow.textContent?.match(/-/gu)).toHaveLength(3)
    expect(folderRow).not.toHaveTextContent("—")
  })

  it("uses the shared error state when the ZIP directory cannot be read", async () => {
    archiveLoader.loadManifest.mockRejectedValueOnce(new Error("broken archive"))
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="broken.zip"
        mimeType="application/zip"
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByText("无法读取此压缩包，请下载后打开。")
      ).toBeVisible()
    )
  })

  it("keeps macro-enabled Office files and archive containers list-only", async () => {
    archiveLoader.loadManifest.mockResolvedValueOnce(
      buildArchivePreviewManifest([
        {
          filename: "office/ledger.xlsm",
          directory: false,
          encrypted: false,
          compressedSize: 12,
          uncompressedSize: 18,
          modifiedAt: "2026-07-18T00:00:00.000Z",
          externalFileAttributes: 0,
        },
        {
          filename: "archives/comic.cbz",
          directory: false,
          encrypted: false,
          compressedSize: 12,
          uncompressedSize: 18,
          modifiedAt: "2026-07-18T00:00:00.000Z",
          externalFileAttributes: 0,
        },
      ])
    )
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onClose={vi.fn()}
      />
    )

    await screen.findByText("2 个文件 · 2 个文件夹")
    await userEvent.click(screen.getAllByRole("button", { name: "office" })[0])
    expect(
      screen.queryByRole("button", { name: "预览 ledger.xlsm" })
    ).toBeNull()

    await userEvent.click(screen.getAllByRole("button", { name: "根目录" })[0])
    await userEvent.click(
      screen.getAllByRole("button", { name: "archives" })[0]
    )
    expect(
      screen.queryByRole("button", { name: "预览 comic.cbz" })
    ).toBeNull()
  })

  it("opens safe archive entries in the shared read-only preview and keeps list state when returning", async () => {
    const user = userEvent.setup()
    archiveLoader.loadEntry.mockResolvedValueOnce(
      new TextEncoder().encode("# Archive guide\n\nSafe read-only content")
    )
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onClose={vi.fn()}
      />
    )

    await screen.findByText("5 个文件 · 1 个文件夹")
    const search = screen.getByRole("textbox", { name: "搜索压缩包内容" })
    await user.type(search, "README")
    await user.click(
      screen.getByRole("button", { name: "预览 README.md" })
    )

    await waitFor(() =>
      expect(archiveLoader.loadEntry).toHaveBeenLastCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({ path: "README.md" }),
        expect.any(AbortSignal)
      )
    )
    expect(await screen.findByTestId("markdown-file-preview")).toHaveTextContent(
      "Safe read-only content"
    )
    expect(screen.queryByText("问 LinkSense")).toBeNull()
    expect(document.querySelectorAll(".office-preview-pane")).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "返回文件列表" }))
    expect(
      await screen.findByRole("button", { name: "预览 README.md" })
    ).toBeVisible()
    expect(
      screen.getByRole("textbox", { name: "搜索压缩包内容" })
    ).toHaveValue("README")
  })

  it("opens HTML entries as read-only source instead of executing their page", async () => {
    const user = userEvent.setup()
    archiveLoader.loadEntry.mockResolvedValueOnce(
      new TextEncoder().encode(
        '<main><button type="button">Archive-only control</button></main>'
      )
    )
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onClose={vi.fn()}
      />
    )

    await screen.findByText("5 个文件 · 1 个文件夹")
    await user.click(screen.getByRole("button", { name: "预览 index.html" }))

    const codePreview = await screen.findByTestId("code-file-preview")
    expect(codePreview).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Archive-only control" })
    ).toBeNull()
    expect(screen.queryByText("问 LinkSense")).toBeNull()

    const wrapButton = screen.getByRole("button", {
      name: "关闭自动换行",
    })
    expect(wrapButton).toHaveAttribute("aria-pressed", "true")
    expect(
      document.querySelector(".archive-preview-entry-toolbar")
    ).toContainElement(wrapButton)
    expect(codePreview).not.toContainElement(wrapButton)
    expect(screen.getByText("只读")).toHaveClass(
      "archive-preview-entry-read-only"
    )

    await user.click(wrapButton)
    expect(wrapButton).toHaveAttribute("aria-pressed", "false")
    expect(wrapButton).toHaveAccessibleName("开启自动换行")
  })

  it("opens extensionless text files with the generic read-only text preview", async () => {
    const user = userEvent.setup()
    archiveLoader.loadEntry.mockResolvedValueOnce(
      new TextEncoder().encode("Copyright 2026 LinkSense")
    )
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onClose={vi.fn()}
      />
    )

    await screen.findByText("5 个文件 · 1 个文件夹")
    await user.click(screen.getByRole("button", { name: "预览 LICENSE" }))

    expect(await screen.findByTestId("code-file-preview")).toBeVisible()
    expect(screen.queryByText("问 LinkSense")).toBeNull()
  })

  it("keeps encrypted inner files list-only and lets people retry a failed safe preview", async () => {
    const user = userEvent.setup()
    archiveLoader.loadEntry
      .mockRejectedValueOnce(new Error("entry unavailable"))
      .mockResolvedValueOnce(new TextEncoder().encode("# Retried guide"))
    render(
      <ArchivePreview
        document={{ status: "ready", content: new Uint8Array([1, 2, 3]) }}
        fileName="bundle.zip"
        mimeType="application/zip"
        onClose={vi.fn()}
      />
    )

    await screen.findByText("5 个文件 · 1 个文件夹")
    expect(
      screen.queryByRole("button", { name: "预览 readme.txt" })
    ).toBeNull()

    await user.click(screen.getAllByRole("button", { name: "docs" })[0])
    await user.click(screen.getByRole("button", { name: "预览 guide.md" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法读取压缩包内的此文件，请重试。"
    )

    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByTestId("markdown-file-preview")).toHaveTextContent(
      "Retried guide"
    )
    expect(archiveLoader.loadEntry).toHaveBeenCalledTimes(2)
  })
})
