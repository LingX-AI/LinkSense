import { describe, expect, it } from "vitest"

import {
  ARCHIVE_PREVIEW_LIMITS,
  ArchivePreviewError,
  buildArchivePreviewManifest,
  getArchiveEntryPreviewKind,
  getArchiveEntryPreviewMimeType,
  getArchivePreviewChildren,
} from "@/components/media/archive-preview/archive-preview-utils"

function entry(
  filename: string,
  overrides: Partial<{
    directory: boolean
    encrypted: boolean
    compressedSize: number
    uncompressedSize: number
    modifiedAt: string | null
    externalFileAttributes: number
  }> = {}
) {
  return {
    filename,
    directory: false,
    encrypted: false,
    compressedSize: 10,
    uncompressedSize: 12,
    modifiedAt: "2026-07-18T00:00:00.000Z",
    externalFileAttributes: 0,
    ...overrides,
  }
}

describe("archive preview manifest", () => {
  it("adds implicit folders and lists folders before files", () => {
    const manifest = buildArchivePreviewManifest([
      entry("readme.md"),
      entry("docs/guide.txt"),
      entry("empty/", { directory: true }),
    ])

    expect(manifest.totalFiles).toBe(2)
    expect(manifest.totalFolders).toBe(2)
    expect(getArchivePreviewChildren(manifest, "").map((item) => item.path)).toEqual([
      "docs",
      "empty",
      "readme.md",
    ])
    expect(getArchivePreviewChildren(manifest, "docs").map((item) => item.path)).toEqual([
      "docs/guide.txt",
    ])
  })

  it("does not flag an explicit directory that follows its implicit directory", () => {
    const manifest = buildArchivePreviewManifest([
      entry("docs/guide.txt"),
      entry("docs/", { directory: true }),
    ])

    expect(manifest.skippedEntryCount).toBe(0)
    expect(getArchivePreviewChildren(manifest, "").map((item) => item.path)).toEqual([
      "docs",
    ])
  })

  it("does not surface unsafe paths, duplicate paths, or non-regular Unix files", () => {
    const manifest = buildArchivePreviewManifest([
      entry("safe.txt"),
      entry("../secret.txt"),
      entry("/absolute.txt"),
      entry("windows\\path.txt"),
      entry("safe.txt"),
      entry("symlink", { externalFileAttributes: 0o120000 << 16 }),
      entry("fifo", { externalFileAttributes: 0o010000 << 16 }),
      entry("socket", { externalFileAttributes: 0o140000 << 16 }),
      entry("device", { externalFileAttributes: 0o060000 << 16 }),
    ])

    expect(manifest.entries.map((item) => item.path)).toEqual(["safe.txt"])
    expect(manifest.skippedEntryCount).toBe(8)
  })

  it("rejects archive declarations that exceed expansion limits", () => {
    expect(() =>
      buildArchivePreviewManifest([
        entry("large.txt", {
          compressedSize: 1,
          uncompressedSize: ARCHIVE_PREVIEW_LIMITS.maxEntryUncompressedBytes + 1,
        }),
      ])
    ).toThrow(ArchivePreviewError)

    expect(() =>
      buildArchivePreviewManifest([
        entry("ratio.txt", { compressedSize: 1, uncompressedSize: 101 }),
      ])
    ).toThrow(ArchivePreviewError)
  })

  it("only enables safe generic file formats for embedded read-only previews", () => {
    const manifest = buildArchivePreviewManifest([
      entry("docs/readme.md"),
      entry("docs/notes.txt"),
      entry("src/main.ts"),
      entry("site/index.html"),
      entry("deploy/firecrawl-.env.example"),
      entry("Dockerfile"),
      entry("LICENSE"),
      entry("templates/page.fragment"),
      entry("data/scores.csv"),
      entry("data/scores.tsv"),
      entry("data/events.jsonl"),
      entry("docs/report.pdf"),
      entry("assets/cover.png"),
      entry("media/voice.mp3"),
      entry("media/demo.mp4"),
      entry("slides/deck.pptx"),
      entry("legacy/report.doc"),
      entry("office/letter.docm"),
      entry("office/template.dotx"),
      entry("office/ledger.xlsm"),
      entry("office/binary.xlsb"),
      entry("office/slides.ppsx"),
      entry("office/theme.pptm"),
      entry("apple/deck.key"),
      entry("apple/budget.numbers"),
      entry("containers/book.epub"),
      entry("containers/comic.cbz"),
      entry("containers/image.iso"),
      entry("containers/source.tgz"),
      entry("bundle.zip"),
      entry("private.txt", { encrypted: true }),
      entry("binary.bin"),
    ])
    const itemAt = (path: string) =>
      manifest.entries.find((item) => item.path === path)!

    expect(getArchiveEntryPreviewKind(itemAt("docs/readme.md"))).toBe(
      "markdown"
    )
    expect(getArchiveEntryPreviewKind(itemAt("docs/notes.txt"))).toBe("text")
    expect(getArchiveEntryPreviewKind(itemAt("src/main.ts"))).toBe("code")
    expect(getArchiveEntryPreviewKind(itemAt("site/index.html"))).toBe(
      "code"
    )
    expect(getArchiveEntryPreviewKind(itemAt("deploy/firecrawl-.env.example"))).toBe(
      "text"
    )
    expect(getArchiveEntryPreviewKind(itemAt("Dockerfile"))).toBe("code")
    expect(getArchiveEntryPreviewKind(itemAt("LICENSE"))).toBe("text")
    expect(getArchiveEntryPreviewKind(itemAt("templates/page.fragment"))).toBe(
      "text"
    )
    expect(getArchiveEntryPreviewKind(itemAt("data/scores.csv"))).toBe("csv")
    expect(getArchiveEntryPreviewKind(itemAt("data/scores.tsv"))).toBe("csv")
    expect(getArchiveEntryPreviewKind(itemAt("data/events.jsonl"))).toBe(
      "code"
    )
    expect(getArchiveEntryPreviewKind(itemAt("docs/report.pdf"))).toBe("pdf")
    expect(getArchiveEntryPreviewKind(itemAt("assets/cover.png"))).toBe(
      "image"
    )
    expect(getArchiveEntryPreviewKind(itemAt("media/voice.mp3"))).toBe(
      "audio"
    )
    expect(getArchiveEntryPreviewKind(itemAt("media/demo.mp4"))).toBe("video")
    expect(getArchiveEntryPreviewKind(itemAt("slides/deck.pptx"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("legacy/report.doc"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("office/letter.docm"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("office/template.dotx"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("office/ledger.xlsm"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("office/binary.xlsb"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("office/slides.ppsx"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("office/theme.pptm"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("apple/deck.key"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("apple/budget.numbers"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("containers/book.epub"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("containers/comic.cbz"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("containers/image.iso"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("containers/source.tgz"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("bundle.zip"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("private.txt"))).toBeNull()
    expect(getArchiveEntryPreviewKind(itemAt("binary.bin"))).toBeNull()
  })

  it("uses a browser-safe MIME type for archive media blob URLs", () => {
    const manifest = buildArchivePreviewManifest([
      entry("assets/cover.png"),
      entry("media/intro.mp3"),
      entry("clips/demo.webm"),
      entry("docs/readme.md"),
    ])
    const itemAt = (path: string) =>
      manifest.entries.find((item) => item.path === path)!

    expect(getArchiveEntryPreviewMimeType(itemAt("assets/cover.png"))).toBe(
      "image/png"
    )
    expect(getArchiveEntryPreviewMimeType(itemAt("media/intro.mp3"))).toBe(
      "audio/mpeg"
    )
    expect(getArchiveEntryPreviewMimeType(itemAt("clips/demo.webm"))).toBe(
      "video/webm"
    )
    expect(getArchiveEntryPreviewMimeType(itemAt("docs/readme.md"))).toBe(
      "text/markdown"
    )
  })
})
