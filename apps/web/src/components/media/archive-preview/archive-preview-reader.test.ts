import JSZip from "jszip"
import { describe, expect, it } from "vitest"

import { readArchivePreviewManifest } from "@/components/media/archive-preview/archive-preview-reader"

async function createArchiveWithUnflaggedFilename(
  rawFilename: Uint8Array
): Promise<Uint8Array> {
  const placeholder = "x".repeat(rawFilename.byteLength)
  const zip = new JSZip()
  zip.file(placeholder, "content")
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  replaceFilename(bytes, view, 0x04034b50, 6, 26, 30, rawFilename)
  replaceFilename(bytes, view, 0x02014b50, 8, 28, 46, rawFilename)
  return bytes
}

function replaceFilename(
  bytes: Uint8Array,
  view: DataView,
  signature: number,
  flagsOffset: number,
  filenameLengthOffset: number,
  filenameOffset: number,
  rawFilename: Uint8Array
): void {
  const headerOffset = findSignature(view, signature)
  expect(view.getUint16(headerOffset + filenameLengthOffset, true)).toBe(
    rawFilename.byteLength
  )
  const flags = view.getUint16(headerOffset + flagsOffset, true)
  view.setUint16(headerOffset + flagsOffset, flags & ~0x0800, true)
  bytes.set(rawFilename, headerOffset + filenameOffset)
}

function findSignature(view: DataView, signature: number): number {
  for (let offset = 0; offset <= view.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  throw new Error(`ZIP signature not found: ${signature.toString(16)}`)
}

describe("archive preview reader", () => {
  it("reads real ZIP central-directory metadata without extracting files", async () => {
    const zip = new JSZip()
    zip.file("README.md", "Archive preview")
    zip.file("docs/readme.txt", "Hello")
    zip.folder("empty")
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    })

    const manifest = await readArchivePreviewManifest(
      new Blob([new Uint8Array(bytes)], { type: "application/zip" })
    )

    expect(manifest.totalFiles).toBe(2)
    expect(manifest.totalFolders).toBe(2)
    expect(manifest.entries.map((item) => item.path)).toEqual([
      "docs",
      "empty",
      "README.md",
      "docs/readme.txt",
    ])
  })

  it("decodes unflagged UTF-8 filenames produced by Info-ZIP on Linux", async () => {
    const filename = "中文语音.mp3"
    const bytes = await createArchiveWithUnflaggedFilename(
      new TextEncoder().encode(filename)
    )

    const manifest = await readArchivePreviewManifest(
      new Blob([new Uint8Array(bytes)], { type: "application/zip" })
    )

    expect(manifest.entries.map((item) => item.path)).toEqual([filename])
  })

  it("keeps the CP437 fallback for genuinely legacy filenames", async () => {
    const bytes = await createArchiveWithUnflaggedFilename(
      Uint8Array.of(0x82, 0x2e, 0x74, 0x78, 0x74)
    )

    const manifest = await readArchivePreviewManifest(
      new Blob([new Uint8Array(bytes)], { type: "application/zip" })
    )

    expect(manifest.entries.map((item) => item.path)).toEqual(["é.txt"])
  })
})
