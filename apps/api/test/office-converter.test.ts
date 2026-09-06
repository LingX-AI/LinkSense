import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  LocalUnoserverRuntime,
  officeConversionTarget,
  UnoOfficeDocumentConverter,
  type OfficeConversionRuntime,
} from "../src/modules/knowledge-processing/office-converter.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  )
})

describe("UnoOfficeDocumentConverter", () => {
  it.each([
    ["doc", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xls", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["ppt", "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["vsdx", "pdf", "application/pdf"],
  ] as const)(
    "converts .%s into the Docling-compatible .%s target",
    async (sourceFormat, targetExtension, contentType) => {
      const temporaryRoot = await createTemporaryRoot()
      const runtime = copyingRuntime()
      const converter = new UnoOfficeDocumentConverter(runtime, {
        temporaryRoot,
        maximumOutputBytes: 1024,
      })

      const prepared = await converter.prepare({
        sourceFormat,
        source: {
          filename: `Quarterly.Report.${sourceFormat}`,
          contentType: "application/octet-stream",
          openStream: async () => Readable.from("office-content"),
        },
      })

      expect(prepared.filename).toBe(`Quarterly.Report.${targetExtension}`)
      expect(prepared.contentType).toBe(contentType)
      expect(runtime.convert).toHaveBeenCalledWith(
        expect.objectContaining({ targetExtension }),
      )
      expect(await streamText(await prepared.openStream())).toBe(
        "office-content",
      )
      expect(await readdir(temporaryRoot)).toHaveLength(1)

      await prepared.dispose()
      expect(await readdir(temporaryRoot)).toEqual([])
    },
  )

  it("passes formats already supported by Docling through without conversion", async () => {
    const runtime = copyingRuntime()
    const converter = new UnoOfficeDocumentConverter(runtime)
    const source = {
      filename: "policy.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      openStream: async () => Readable.from("docx"),
    }

    const prepared = await converter.prepare({ source, sourceFormat: "docx" })

    expect(prepared.filename).toBe(source.filename)
    expect(runtime.convert).not.toHaveBeenCalled()
    await expect(prepared.dispose()).resolves.toBeUndefined()
  })

  it("serializes conversions through one LibreOffice listener", async () => {
    const temporaryRoot = await createTemporaryRoot()
    let active = 0
    let maximumActive = 0
    const runtime = copyingRuntime(async (input) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await copyFile(input.sourcePath, input.destinationPath)
      active -= 1
    })
    const converter = new UnoOfficeDocumentConverter(runtime, {
      temporaryRoot,
    })

    const prepared = await Promise.all(
      ["doc", "xls", "ppt"].map((sourceFormat) =>
        converter.prepare({
          sourceFormat,
          source: {
            filename: `document.${sourceFormat}`,
            contentType: "application/octet-stream",
            openStream: async () => Readable.from(sourceFormat),
          },
        }),
      ),
    )

    expect(maximumActive).toBe(1)
    await Promise.all(prepared.map((value) => value.dispose()))
  })

  it("removes temporary files when conversion fails", async () => {
    const temporaryRoot = await createTemporaryRoot()
    const runtime = copyingRuntime(async () => {
      throw new Error("private converter detail")
    })
    const converter = new UnoOfficeDocumentConverter(runtime, {
      temporaryRoot,
    })

    await expect(
      converter.prepare({
        sourceFormat: "doc",
        source: {
          filename: "broken.doc",
          contentType: "application/msword",
          openStream: async () => Readable.from("broken"),
        },
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_OFFICE_CONVERSION_FAILED" })
    expect(await readdir(temporaryRoot)).toEqual([])
  })

  it("publishes only the four explicit conversion mappings", () => {
    expect(officeConversionTarget("VSDX")).toMatchObject({ extension: "pdf" })
    expect(officeConversionTarget("docx")).toBeNull()
    expect(officeConversionTarget("exe")).toBeNull()
  })
})

describe("LocalUnoserverRuntime", () => {
  it("reuses a healthy listener left behind by development hot reload", async () => {
    const onProcessStarted = vi.fn()
    const runtime = new LocalUnoserverRuntime({
      pingCommand: "/usr/bin/true",
      serverCommand: "command-that-must-not-be-started",
      onProcessStarted,
    })

    await expect(runtime.start()).resolves.toBeUndefined()
    expect(onProcessStarted).toHaveBeenCalledOnce()
    await expect(runtime.health()).resolves.toBeUndefined()
    await expect(runtime.close()).resolves.toBeUndefined()
  })
})

function copyingRuntime(
  implementation: OfficeConversionRuntime["convert"] = async (input) =>
    copyFile(input.sourcePath, input.destinationPath),
): OfficeConversionRuntime & { convert: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn(async () => undefined),
    health: vi.fn(async () => undefined),
    convert: vi.fn(implementation),
    close: vi.fn(async () => undefined),
  }
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "linksense-office-test-"))
  temporaryRoots.push(root)
  return root
}

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}
