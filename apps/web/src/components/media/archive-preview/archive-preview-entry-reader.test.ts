import JSZip from "jszip"
import { describe, expect, it } from "vitest"

import {
  readArchivePreviewEntry,
  readArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-reader"
import {
  ARCHIVE_PREVIEW_LIMITS,
  type ArchivePreviewItem,
} from "@/components/media/archive-preview/archive-preview-utils"

async function createArchive(
  filename: string,
  content: string
): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(filename, content)
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
}

function findSignature(view: DataView, signature: number): number {
  for (let offset = 0; offset <= view.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  throw new Error(`ZIP signature not found: ${signature.toString(16)}`)
}

function markSingleEntryEncrypted(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (const [signature, flagsOffset] of [
    [0x04034b50, 6],
    [0x02014b50, 8],
  ] as const) {
    const offset = findSignature(view, signature)
    view.setUint16(
      offset + flagsOffset,
      view.getUint16(offset + flagsOffset, true) | 1,
      true
    )
  }
}

function replaceSingleEntryFilename(bytes: Uint8Array, filename: string): void {
  const encodedFilename = new TextEncoder().encode(filename)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (const [signature, filenameLengthOffset, filenameOffset] of [
    [0x04034b50, 26, 30],
    [0x02014b50, 28, 46],
  ] as const) {
    const offset = findSignature(view, signature)
    expect(view.getUint16(offset + filenameLengthOffset, true)).toBe(
      encodedFilename.byteLength
    )
    bytes.set(encodedFilename, offset + filenameOffset)
  }
}

function setSingleEntryUncompressedSize(
  bytes: Uint8Array,
  uncompressedSize: number
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (const [signature, uncompressedSizeOffset] of [
    [0x04034b50, 22],
    [0x02014b50, 24],
  ] as const) {
    const offset = findSignature(view, signature)
    view.setUint32(offset + uncompressedSizeOffset, uncompressedSize, true)
  }
}

function asZipBlob(bytes: Uint8Array) {
  return new Blob([new Uint8Array(bytes)], { type: "application/zip" })
}

async function getManifestItem(bytes: Uint8Array, path: string) {
  const manifest = await readArchivePreviewManifest(asZipBlob(bytes))
  const item = manifest.entries.find((candidate) => candidate.path === path)
  expect(item).toBeDefined()
  return item as ArchivePreviewItem
}

function fileItem(path: string): ArchivePreviewItem {
  const parts = path.split("/")
  return {
    id: `file:${path}`,
    path,
    parentPath: parts.slice(0, -1).join("/"),
    name: parts.at(-1) ?? path,
    kind: "file",
    encrypted: false,
    compressedSize: 1,
    uncompressedSize: 1,
    modifiedAt: null,
  }
}

describe("archive preview entry reader security", () => {
  it("extracts a safe, unencrypted entry", async () => {
    const bytes = await createArchive("docs/guide.md", "# Safe preview")
    const item = await getManifestItem(bytes, "docs/guide.md")

    expect(
      Array.from(await readArchivePreviewEntry(asZipBlob(bytes), item))
    ).toEqual(Array.from(new TextEncoder().encode("# Safe preview")))
  })

  it("never extracts an encrypted entry", async () => {
    const bytes = await createArchive("private.txt", "do not expose")
    markSingleEntryEncrypted(bytes)
    const item = await getManifestItem(bytes, "private.txt")

    await expect(
      readArchivePreviewEntry(asZipBlob(bytes), { ...item, encrypted: false })
    ).rejects.toMatchObject({ code: "entry_encrypted" })
  })

  it("never extracts a directory even if a forged item calls it a file", async () => {
    const bytes = await createArchive("docs/guide.md", "# Safe preview")
    const directory = await getManifestItem(bytes, "docs")

    await expect(
      readArchivePreviewEntry(asZipBlob(bytes), {
        ...directory,
        id: "file:docs",
        kind: "file",
      })
    ).rejects.toMatchObject({ code: "entry_not_found" })
  })

  it("does not extract a path-traversal entry even when its raw path is requested", async () => {
    const unsafePath = "../escape.txt"
    const bytes = await createArchive("safe-file.txt", "not reachable")
    replaceSingleEntryFilename(bytes, unsafePath)

    const manifest = await readArchivePreviewManifest(asZipBlob(bytes))
    expect(manifest.entries).toEqual([])
    expect(manifest.skippedEntryCount).toBe(1)

    await expect(
      readArchivePreviewEntry(asZipBlob(bytes), fileItem(unsafePath))
    ).rejects.toMatchObject({ code: "entry_not_found" })
  })

  it("rejects an entry whose declared uncompressed size exceeds the preview cap before extraction", async () => {
    const bytes = await createArchive("too-large.txt", "small payload")
    const item = await getManifestItem(bytes, "too-large.txt")
    setSingleEntryUncompressedSize(
      bytes,
      ARCHIVE_PREVIEW_LIMITS.maxEntryUncompressedBytes + 1
    )

    await expect(
      readArchivePreviewEntry(asZipBlob(bytes), item)
    ).rejects.toMatchObject({ code: "limit_exceeded" })
  })
})
