import { readFile } from "node:fs/promises"
import { Readable } from "node:stream"

import JSZip from "jszip"
import { describe, expect, it, vi } from "vitest"

const { createReadStreamMock } = vi.hoisted(() => ({ createReadStreamMock: vi.fn() }))
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>()
  createReadStreamMock.mockImplementation(original.createReadStream)
  return { ...original, createReadStream: createReadStreamMock }
})

import { extractDoclingArchive } from "../src/modules/knowledge-processing/docling.js"

async function archiveBytes(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file("document.md", "# Document")
  zip.file("document.json", "{}")
  return zip.generateAsync({ type: "nodebuffer" })
}

describe("Docling archive stream isolation", () => {
  it("contains a local archive read error and allows the next extraction", async () => {
    const source = new Readable({ read() { this.destroy(new Error("archive disk read failed")) } })
    createReadStreamMock.mockReturnValueOnce(source)
    await expect(extractDoclingArchive(Readable.from(await archiveBytes())))
      .rejects.toMatchObject({ code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE" })
    expect(source.destroyed).toBe(true)

    const extracted = await extractDoclingArchive(Readable.from(await archiveBytes()))
    try {
      expect(await readFile(extracted.markdownPath, "utf8")).toBe("# Document")
      expect(await readFile(extracted.jsonPath, "utf8")).toBe("{}")
    } finally {
      await extracted.cleanup()
    }
  })

  it("contains a malformed archive without leaving a pending parser", async () => {
    await expect(extractDoclingArchive(Readable.from(Buffer.from("not a ZIP archive"))))
      .rejects.toMatchObject({ code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE" })
  })

  it("contains an interrupted download before extraction", async () => {
    const input = new Readable({ read() { this.destroy(new Error("download reset")) } })
    await expect(extractDoclingArchive(input))
      .rejects.toMatchObject({ code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE" })
    expect(input.destroyed).toBe(true)
  })

  it("still rejects traversal entries while closing the parser", async () => {
    const zip = new JSZip()
    zip.file("../escape.md", "must not escape")
    const input = Readable.from(await zip.generateAsync({ type: "nodebuffer" }))
    await expect(extractDoclingArchive(input))
      .rejects.toMatchObject({ code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE" })
    expect(input.destroyed).toBe(true)
  })

  it("still enforces archive limits when extraction stops early", async () => {
    await expect(extractDoclingArchive(Readable.from(await archiveBytes()), {
      maximumEntries: 1,
      maximumEntryBytes: 1_024,
      maximumTotalBytes: 2_048,
      maximumCompressionRatio: 200,
    })).rejects.toMatchObject({ code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE" })
  })
})
