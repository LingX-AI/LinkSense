import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import JSZip from "jszip"
import { describe, expect, it, vi } from "vitest"

import { AppError } from "../src/lib/errors.js"
import {
  MinioKnowledgeDocumentIngestionAdapter,
  knowledgeIngestionTesting,
  type KnowledgeUploadObjectStore,
} from "../src/modules/knowledge/ingestion.js"

const ODF_FORMATS = [
  ["odt", "application/vnd.oasis.opendocument.text"],
  ["ods", "application/vnd.oasis.opendocument.spreadsheet"],
  ["odp", "application/vnd.oasis.opendocument.presentation"],
] as const

describe("MinioKnowledgeDocumentIngestionAdapter", () => {
  it("streams a validated document into an immutable object with a safe name", async () => {
    const fixture = await createFixture()
    try {
      const result = await fixture.adapter.registerUpload({
        ...fixture.registration,
        filename: "../部门\\Ａ计划.md",
        declaredMimeType: "text/plain; charset=utf-8",
        stream: Readable.from([Buffer.from("# 计划\n"), Buffer.from("正文\n")]),
      })

      expect(result.originalFilename).toBe("A计划.md")
      expect(result.normalizedDisplayName).toBe("a计划.md")
      expect(result.canonicalExtension).toBe("md")
      expect(result.canonicalMimeType).toBe("text/markdown")
      expect(result.original.sizeBytes).toBe(BigInt(Buffer.byteLength("# 计划\n正文\n")))
      expect(fixture.store.objects.get(result.original.objectKey)?.toString("utf8"))
        .toBe("# 计划\n正文\n")
      expect(await readdir(fixture.temporaryRoot)).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects an oversized stream before writing MinIO", async () => {
    const fixture = await createFixture()
    try {
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "notes.txt",
          declaredMimeType: "text/plain",
          maxSizeBytes: 4,
          stream: Readable.from([Buffer.from("123"), Buffer.from("45")]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_TOO_LARGE" })
      expect(fixture.store.putCalls).toBe(0)
      expect(await readdir(fixture.temporaryRoot)).toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  it("keeps the exact reservation when a failed upload cannot be removed", async () => {
    const fixture = await createFixture()
    const reserveStorage = vi.fn(async () => undefined)
    const releaseStorageReservation = vi.fn(async () => undefined)
    const objectStore: KnowledgeUploadObjectStore = {
      putImmutable: async (input) => {
        await fixture.store.putImmutable(input)
        throw new Error("post-write failure")
      },
      remove: vi.fn(async () => {
        throw new Error("MinIO unavailable")
      }),
    }
    const adapter = new MinioKnowledgeDocumentIngestionAdapter(
      objectStore,
      fixture.temporaryRoot,
    )
    try {
      await expect(
        adapter.registerUpload({
          ...fixture.registration,
          reserveStorage,
          releaseStorageReservation,
          filename: "notes.txt",
          declaredMimeType: "text/plain",
          stream: Readable.from("reserved"),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_INVALID" })

      expect(reserveStorage).toHaveBeenCalledWith({
        sizeBytes: 8n,
        objectKeys: [expect.stringMatching(/\/original\/[0-9a-f-]{36}\.txt$/u)],
      })
      expect(releaseStorageReservation).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects a file whose magic does not match its extension", async () => {
    const fixture = await createFixture()
    try {
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "not-a-pdf.pdf",
          declaredMimeType: "application/pdf",
          stream: Readable.from([validPng()]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_INVALID" })
      expect(fixture.store.putCalls).toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })

  it("validates OOXML container structure and rejects embedded macros", async () => {
    const fixture = await createFixture()
    try {
      const valid = await wordArchive()
      const accepted = await fixture.adapter.registerUpload({
        ...fixture.registration,
        filename: "policy.docx",
        declaredMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        stream: Readable.from([valid]),
      })
      expect(accepted.canonicalExtension).toBe("docx")

      const macro = await wordArchive(true)
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          documentVersionId: randomUUID(),
          filename: "macro-hidden.docx",
          declaredMimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          stream: Readable.from([macro]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED" })
    } finally {
      await fixture.cleanup()
    }
  })

  it("classifies an encrypted OOXML compound container before parsing", async () => {
    const fixture = await createFixture()
    try {
      const encryptedContainer = Buffer.concat([
        Buffer.from("d0cf11e0a1b11ae1", "hex"),
        Buffer.alloc(512),
      ])
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "protected.docx",
          declaredMimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          stream: Readable.from([encryptedContainer]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_ENCRYPTED" })
      expect(fixture.store.putCalls).toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })

  it.each([
    ["doc", "application/msword"],
    ["xls", "application/vnd.ms-excel"],
    ["ppt", "application/vnd.ms-powerpoint"],
    ["vsdx", "application/vnd.ms-visio.drawing"],
  ] as const)(
    "accepts .%s for asynchronous LibreOffice conversion",
    async (extension, mimeType) => {
      const fixture = await createFixture()
      try {
        const accepted = await fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: `policy.${extension}`,
          declaredMimeType: mimeType,
          stream: Readable.from("conversion-input"),
        })

        expect(accepted.canonicalExtension).toBe(extension)
        expect(accepted.canonicalMimeType).toBe(mimeType)
        expect(fixture.store.putCalls).toBe(1)
      } finally {
        await fixture.cleanup()
      }
    },
  )

  it("defers mismatched MIME and malformed VSDX content to LibreOffice", async () => {
    const fixture = await createFixture()
    try {
      const accepted = await fixture.adapter.registerUpload({
        ...fixture.registration,
        filename: "workflow.vsdx",
        declaredMimeType: "application/zip",
        stream: Readable.from(Buffer.from("PK\u0003\u0004truncated-vsdx")),
      })

      expect(accepted.canonicalExtension).toBe("vsdx")
      expect(accepted.canonicalMimeType).toBe(
        "application/vnd.ms-visio.drawing",
      )
      expect(fixture.store.putCalls).toBe(1)
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects encrypted ODF manifests", async () => {
    const fixture = await createFixture()
    try {
      const zip = new JSZip()
      zip.file("mimetype", "application/vnd.oasis.opendocument.text", {
        compression: "STORE",
      })
      zip.file("content.xml", "<office:document-content/>")
      zip.file(
        "META-INF/manifest.xml",
        "<manifest:manifest><manifest:encryption-data/></manifest:manifest>",
      )
      const encrypted = await zip.generateAsync({ type: "nodebuffer" })
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "protected.odt",
          declaredMimeType: "application/vnd.oasis.opendocument.text",
          stream: Readable.from([encrypted]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_ENCRYPTED" })
    } finally {
      await fixture.cleanup()
    }
  })

  it.each(ODF_FORMATS)(
    "accepts a passive .%s container and rejects Basic or Scripts payloads",
    async (extension, mimeType) => {
      const fixture = await createFixture()
      try {
        const accepted = await fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: `passive.${extension}`,
          declaredMimeType: mimeType,
          stream: Readable.from([await odfArchive(mimeType)]),
        })
        expect(accepted.canonicalExtension).toBe(extension)

        for (const activePath of [
          "Basic/Standard/Module1.xml",
          "Scripts/python/embedded.py",
        ]) {
          await expect(
            fixture.adapter.registerUpload({
              ...fixture.registration,
              documentVersionId: randomUUID(),
              filename: `active.${extension}`,
              declaredMimeType: mimeType,
              stream: Readable.from([
                await odfArchive(mimeType, { activePath }),
              ]),
            }),
          ).rejects.toMatchObject({
            code: "KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED",
          })
        }
      } finally {
        await fixture.cleanup()
      }
    },
  )

  it.each([
    [
      "inline script",
      '<office:scripts><office:script script:language="Basic">Main</office:script></office:scripts>',
    ],
    [
      "event listener",
      '<script:event-listener script:event-name="office:load" script:macro-name="vnd.sun.star.script:Standard.Module1.Main"/>',
    ],
    ["text script", '<text:script xlink:href="embedded-script"/>'],
    ["text macro execution", "<text:execute-macro/>"],
    ["spreadsheet error macro", '<table:error-macro table:execute="true"/>'],
    ["embedded plugin", '<draw:plugin xlink:href="plugin.class"/>'],
    ["embedded OLE object", '<draw:object-ole xlink:href="Object 1"/>'],
    ["script-enabled drawing", '<draw:frame draw:may-script="true"/>'],
    ["floating frame", '<draw:floating-frame xlink:href="https://example.test"/>'],
    ["interactive form", "<office:forms><form:form/></office:forms>"],
  ])("rejects ODF %s active content", async (_label, activeXml) => {
    const fixture = await createFixture()
    try {
      const mimeType = ODF_FORMATS[0][1]
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "active.odt",
          declaredMimeType: mimeType,
          stream: Readable.from([
            await odfArchive(mimeType, { activeXml }),
          ]),
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED",
      })
      expect(fixture.store.putCalls).toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects script media types declared only in the ODF manifest", async () => {
    const fixture = await createFixture()
    try {
      const mimeType = ODF_FORMATS[0][1]
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "manifest-script.odt",
          declaredMimeType: mimeType,
          stream: Readable.from([
            await odfArchive(mimeType, {
              manifestEntry:
                '<manifest:file-entry manifest:full-path="MacroLibrary/" manifest:media-type="application/vnd.sun.star.basic-library"/>',
            }),
          ]),
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED",
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it("detects ODF encryption with an arbitrary manifest namespace prefix", async () => {
    const fixture = await createFixture()
    try {
      const mimeType = ODF_FORMATS[0][1]
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "aliased-encryption.odt",
          declaredMimeType: mimeType,
          stream: Readable.from([
            await odfArchive(mimeType, {
              manifestEntry:
                '<m:encryption-data xmlns:m="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>',
            }),
          ]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_ENCRYPTED" })
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects an ODF XML token that exceeds the streaming parser budget", async () => {
    const fixture = await createFixture()
    try {
      const mimeType = ODF_FORMATS[0][1]
      await expect(
        fixture.adapter.registerUpload({
          ...fixture.registration,
          filename: "oversized-xml.odt",
          declaredMimeType: mimeType,
          stream: Readable.from([
            await odfArchive(mimeType, {
              activeXml: `<office:body office:name="${"x".repeat(256 * 1024 + 1)}"/>`,
            }),
          ]),
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_INVALID" })
    } finally {
      await fixture.cleanup()
    }
  })

  it("bounds aggregate ODF XML inspection independently from ZIP expansion", () => {
    const limit = 256 * 1024 * 1024
    expect(knowledgeIngestionTesting.nextOdfXmlInspectionBytes(0, limit)).toBe(
      limit,
    )
    expect(() =>
      knowledgeIngestionTesting.nextOdfXmlInspectionBytes(limit, 1),
    ).toThrowError(expect.objectContaining({ code: "KNOWLEDGE_DOCUMENT_INVALID" }))
  })

  it("does not allow discard to cross a knowledge-base object prefix", async () => {
    const fixture = await createFixture()
    try {
      await expect(
        fixture.adapter.discardRegisteredUpload({
          knowledgeBaseId: fixture.registration.knowledgeBaseId,
          object: {
            id: randomUUID(),
            objectKey: `knowledge-bases/${randomUUID()}/documents/${randomUUID()}`,
            mimeType: "text/plain",
            sizeBytes: 1n,
            checksumSha256: "a".repeat(64),
          },
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_INVALID" })
    } finally {
      await fixture.cleanup()
    }
  })
})

describe("knowledge ingestion filename rules", () => {
  it("normalizes archive paths and rejects traversal", () => {
    expect(knowledgeIngestionTesting.normalizedZipPath("WORD/document.xml"))
      .toBe("word/document.xml")
    expect(() => knowledgeIngestionTesting.normalizedZipPath("../secret"))
      .toThrow(AppError)
  })
})

class FakeKnowledgeObjectStore implements KnowledgeUploadObjectStore {
  readonly objects = new Map<string, Buffer>()
  putCalls = 0

  async putImmutable(
    input: Parameters<KnowledgeUploadObjectStore["putImmutable"]>[0],
  ): Promise<{ key: string; sha256: string; size: number }> {
    this.putCalls += 1
    const chunks: Buffer[] = []
    for await (const rawChunk of input.stream) {
      chunks.push(Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk))
    }
    const bytes = Buffer.concat(chunks)
    const key = [
      "knowledge-bases",
      input.identity.knowledgeBaseId,
      "documents",
      input.identity.documentId,
      "versions",
      input.identity.versionId,
      input.identity.objectType,
      `${input.identity.objectId}.${input.identity.extension}`,
    ].join("/")
    this.objects.set(key, bytes)
    return {
      key,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
    }
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

async function createFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "linksense-ingestion-test-"))
  const store = new FakeKnowledgeObjectStore()
  return {
    temporaryRoot,
    store,
    adapter: new MinioKnowledgeDocumentIngestionAdapter(store, temporaryRoot),
    registration: {
      knowledgeBaseId: randomUUID(),
      documentId: randomUUID(),
      documentVersionId: randomUUID(),
      processingGeneration: randomUUID(),
      maxSizeBytes: 200 * 1024 * 1024,
      reserveStorage: async () => undefined,
      heartbeatStorageReservation: async () => undefined,
      releaseStorageReservation: async () => undefined,
    },
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
  }
}

async function wordArchive(includeMacro = false): Promise<Buffer> {
  const zip = new JSZip()
  const macroContentType = includeMacro
    ? '<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/>'
    : ""
  zip.file(
    "[Content_Types].xml",
    `<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"/>${macroContentType}</Types>`,
  )
  zip.file("_rels/.rels", "<Relationships/>")
  zip.file("word/document.xml", "<w:document/>")
  if (includeMacro) zip.file("word/vbaProject.bin", Buffer.from([1, 2, 3]))
  return zip.generateAsync({ type: "nodebuffer" })
}

async function odfArchive(
  mimeType: string,
  options: {
    activePath?: string
    activeXml?: string
    manifestEntry?: string
  } = {},
): Promise<Buffer> {
  const zip = new JSZip()
  zip.file("mimetype", mimeType, { compression: "STORE" })
  zip.file(
    "content.xml",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:form="urn:oasis:names:tc:opendocument:xmlns:form:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">`,
      options.activeXml ?? "<office:body/>",
      "</office:document-content>",
    ].join(""),
  )
  zip.file(
    "META-INF/manifest.xml",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">',
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="${mimeType}"/>`,
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
      options.manifestEntry ?? "",
      "</manifest:manifest>",
    ].join(""),
  )
  if (options.activePath) {
    zip.file(options.activePath, "embedded active content")
  }
  return zip.generateAsync({ type: "nodebuffer" })
}

function validPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  )
}
