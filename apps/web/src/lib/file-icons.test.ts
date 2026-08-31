import { describe, expect, it } from "vitest"

import codeIconSvg from "@/assets/file-icons/code.svg?raw"
import wordIconSvg from "@/assets/file-icons/word.svg?raw"
import {
  fileIconAssets,
  resolveFileIconAsset,
  resolveFileIconKind,
} from "@/lib/file-icons"

describe("file icon resolution", () => {
  it.each([
    { filename: "report.xlsx", expected: "excel" },
    { filename: "folder", mimeType: "inode/directory", expected: "folder" },
    { filename: "proposal.docx", expected: "word" },
    { filename: "slides.pptx", expected: "powerpoint" },
    { filename: "recording.mp3", expected: "audio" },
    { filename: "source.ts", expected: "code" },
    { filename: "demo.mp4", expected: "video" },
    { filename: "shortcut.url", expected: "link" },
    { filename: "photo.png", expected: "image" },
    { filename: "source.tar.gz", expected: "archive" },
    { filename: "no-extension", expected: "unknown" },
    { filename: "animation.gif", expected: "gif" },
    { filename: "installer.exe", expected: "executable" },
    { filename: "paper.pdf", expected: "pdf" },
    { filename: "notes.txt", expected: "text" },
    { filename: "form.wps", expected: "wps" },
    { filename: "backup.sql", expected: "database-server" },
    { filename: "cache.sqlite3", expected: "database" },
    { filename: "scene.glb", expected: "model-3d" },
    { filename: "message.eml", expected: "email" },
    { filename: ".env.production", expected: "configuration" },
  ] satisfies Array<{
    filename: string
    mimeType?: string
    expected: keyof typeof fileIconAssets
  }>)(
    "maps $filename to the $expected icon family",
    ({ filename, mimeType, expected }) => {
      expect(resolveFileIconKind(filename, mimeType)).toBe(expected)
    }
  )

  it("prefers the filename extension and falls back to a normalized MIME type", () => {
    expect(resolveFileIconKind("REPORT.PDF", "image/png")).toBe("pdf")
    expect(
      resolveFileIconKind("download", "application/pdf; charset=binary")
    ).toBe("pdf")
    expect(resolveFileIconKind("download", "image/gif")).toBe("gif")
  })

  it("keeps one local asset for every icon in the downloaded collection", () => {
    expect(Object.keys(fileIconAssets)).toHaveLength(21)
    expect(new Set(Object.values(fileIconAssets)).size).toBe(21)
    expect(resolveFileIconAsset("unknown.custom-format")).toBe(
      fileIconAssets.unknown
    )
  })

  it("uses the deeper blue palette for code and Word document icons", () => {
    for (const icon of [codeIconSvg, wordIconSvg]) {
      expect(icon).toContain('fill="#2563EB"')
      expect(icon).toContain('fill="#1D4ED8"')
      expect(icon).not.toContain("#53B7F4")
      expect(icon).not.toContain("#29A3D3")
    }
  })
})
