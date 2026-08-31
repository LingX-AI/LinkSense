import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

import {
  processDoclingAssets,
  type SafeKnowledgeAsset,
} from "../src/modules/knowledge-processing/asset-processor.js"
import {
  createSafeDoclingMarkdown,
  ingestDoclingArchive,
} from "../src/modules/knowledge-processing/docling-ingestion.js"

const originalSha256 = "a".repeat(64)
const imageBearingCases = [
  {
    itemType: "picture",
    expectedSelfRef: "#/pictures/0",
  },
  {
    itemType: "table",
    expectedSelfRef: "#/tables/0",
  },
  {
    itemType: "code",
    expectedSelfRef: "#/texts/0",
  },
  {
    itemType: "form",
    expectedSelfRef: "#/form_items/0",
  },
  {
    itemType: "key-value",
    expectedSelfRef: "#/key_value_items/0",
  },
  {
    itemType: "page",
    expectedSelfRef: "#/pages/1",
  },
] as const

type ImageBearingItemType = (typeof imageBearingCases)[number]["itemType"]

describe("Docling result safety boundary", () => {
  it("rewrites only authorized assets and leaves structure and code in place", () => {
    const asset = safeAsset()
    const markdown = [
      "# 标题",
      "",
      "| 表头 | 内容 |",
      "| --- | --- |",
      "| A | ![图](artifacts/image.png) |",
      "",
      "<script>alert(1)</script>",
      "",
      "```html",
      "<script>code sample</script>",
      "```",
      "",
    ].join("\n")

    expect(
      createSafeDoclingMarkdown({ markdown, assets: [asset] }),
    ).toBe(
      [
        "# 标题",
        "",
        "| 表头 | 内容 |",
        "| --- | --- |",
        `| A | ![图](kb-asset://${asset.assetReferenceId}) |`,
        "",
        "&lt;script>alert(1)&lt;/script>",
        "",
        "```html",
        "<script>code sample</script>",
        "```",
        "",
      ].join("\n"),
    )
  })

  it.each([
    "![remote](https://images.example.test/image.png)",
    "![remote](http://10.168.1.113:9000/image.png)",
    "![inline](data:image/png;base64,AAAA)",
    "[local](file:///tmp/document.txt)",
    "[script](javascript:alert(1))",
    "[legacy-script](vbscript:alert(1))",
    "![protocol-relative](//images.example.test/image.png)",
  ])("preserves a source Markdown reference: %s", (markdown) => {
    expect(createSafeDoclingMarkdown({ markdown, assets: [] })).toBe(markdown)
  })

  it("rejects an unknown local artifact reference", () => {
    const markdown = "![unknown](artifacts/missing.png)"
    expect(() =>
      createSafeDoclingMarkdown({ markdown, assets: [] }),
    ).toThrowError(
      expect.objectContaining({ code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE" }),
    )
  })

  it("fully decodes and deterministically re-encodes referenced images", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linksense-asset-"))
    const artifacts = join(directory, "artifacts")
    const path = join(artifacts, "image.png")
    try {
      await mkdir(artifacts)
      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toFile(path)

      const [firstResult, secondResult] = await Promise.all([
        processDoclingAssets({
          doclingJson: doclingDocumentWithPicture("artifacts/image.png"),
          assetPaths: [path],
          originalSha256,
        }),
        processDoclingAssets({
          doclingJson: doclingDocumentWithPicture("./artifacts/image.png"),
          assetPaths: [path],
          originalSha256,
        }),
      ])
      const [first, second] = [firstResult.assets, secondResult.assets]

      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({
        selfRef: "#/pictures/0",
        sourceUri: "artifacts/image.png",
        contentType: "image/png",
        safeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        assetReferenceId: expect.stringMatching(
          /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
        ),
      })
      expect(second[0]?.assetReferenceId).toBe(first[0]?.assetReferenceId)
      expect(second[0]?.bytes.equals(first[0]!.bytes)).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("promotes a valid inline Docling image into a deterministic managed asset", async () => {
    const sourceBytes = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const inlineUri = `data:image/png;base64,${sourceBytes.toString("base64")}`
    const sourceDocument = doclingDocumentWithPicture(inlineUri)

    const [first, second] = await Promise.all([
      processDoclingAssets({
        doclingJson: sourceDocument,
        assetPaths: [],
        originalSha256,
      }),
      processDoclingAssets({
        doclingJson: sourceDocument,
        assetPaths: [],
        originalSha256,
      }),
    ])

    expect(first.assets).toHaveLength(1)
    const asset = first.assets[0]!
    const managedUri = `artifacts/linksense-inline/${asset.safeSha256}.png`
    expect(asset).toMatchObject({
      selfRef: "#/pictures/0",
      sourceUri: managedUri,
      contentType: "image/png",
    })
    expect(pictureImageUri(first.doclingJson)).toBe(managedUri)
    expect(pictureImageUri(sourceDocument)).toBe(inlineUri)
    expect(second.assets[0]?.assetReferenceId).toBe(asset.assetReferenceId)
    expect(second.assets[0]?.bytes.equals(asset.bytes)).toBe(true)
    expect(await sharp(asset.bytes).metadata()).toMatchObject({
      format: "png",
      width: 3,
      height: 2,
    })
    expect(first.doclingJsonBytes).toEqual(
      Buffer.from(JSON.stringify(first.doclingJson), "utf8"),
    )
    expect(first.doclingJsonBytes.includes(Buffer.from("data:image"))).toBe(
      false,
    )
  })

  it("persists normalized Docling JSON bytes after promoting an inline image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linksense-ingestion-"))
    const archivePath = join(directory, "source.zip")
    const markdownPath = join(directory, "document.md")
    const jsonPath = join(directory, "document.json")
    try {
      const sourceBytes = await sharp({
        create: {
          width: 3,
          height: 2,
          channels: 4,
          background: { r: 120, g: 130, b: 140, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
      const sourceDocument = doclingDocumentWithPicture(
        `data:image/png;base64,${sourceBytes.toString("base64")}`,
      )
      await Promise.all([
        writeFile(archivePath, "fixture"),
        writeFile(markdownPath, "# Fixture\n"),
        writeFile(jsonPath, JSON.stringify(sourceDocument)),
      ])

      const result = await ingestDoclingArchive({
        extracted: {
          directory,
          archivePath,
          markdownPath,
          jsonPath,
          assetPaths: [],
          cleanup: async () => undefined,
        },
        originalSha256,
      })

      expect(result.assets).toHaveLength(1)
      expect(result.doclingJsonBytes.includes(Buffer.from("data:image"))).toBe(
        false,
      )
      expect(pictureImageUri(result.doclingJson)).toBe(
        result.assets[0]?.sourceUri,
      )
      const persisted: unknown = JSON.parse(
        result.doclingJsonBytes.toString("utf8"),
      )
      if (
        typeof persisted !== "object" ||
        persisted === null ||
        Array.isArray(persisted)
      ) {
        throw new Error("Invalid persisted Docling fixture")
      }
      expect(pictureImageUri(persisted)).toBe(result.assets[0]?.sourceUri)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("accepts referenced ZIP assets together with an inline Docling image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linksense-asset-"))
    const artifacts = join(directory, "artifacts")
    const firstPath = join(artifacts, "first.png")
    const secondPath = join(artifacts, "second.png")
    try {
      await mkdir(artifacts)
      const inlineBytes = await sharp({
        create: {
          width: 4,
          height: 2,
          channels: 4,
          background: { r: 60, g: 70, b: 80, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
      await Promise.all([
        sharp({
          create: {
            width: 2,
            height: 2,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 },
          },
        })
          .png()
          .toFile(firstPath),
        sharp({
          create: {
            width: 2,
            height: 3,
            channels: 4,
            background: { r: 0, g: 0, b: 255, alpha: 1 },
          },
        })
          .png()
          .toFile(secondPath),
      ])

      const sourceDocument = doclingDocumentWithPicture(
        "artifacts/first.png",
      )
      appendPicture(sourceDocument, "artifacts/second.png")
      appendPicture(
        sourceDocument,
        `data:image/png;base64,${inlineBytes.toString("base64")}`,
      )

      const result = await processDoclingAssets({
        doclingJson: sourceDocument,
        assetPaths: [firstPath, secondPath],
        originalSha256,
      })

      expect(result.assets).toHaveLength(3)
      expect(pictureImageUri(result.doclingJson, 0)).toBe(
        "artifacts/first.png",
      )
      expect(pictureImageUri(result.doclingJson, 1)).toBe(
        "artifacts/second.png",
      )
      expect(pictureImageUri(result.doclingJson, 2)).toMatch(
        /^artifacts\/linksense-inline\/[a-f0-9]{64}\.png$/u,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("rejects malformed, unsupported, mismatched, or oversized inline images", async () => {
    const sourceBytes = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 90, g: 100, b: 110, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const encoded = sourceBytes.toString("base64")
    const cases = [
      {
        uri: `data:image/png;base64,${encoded}\n`,
        mimeType: "image/png",
      },
      {
        uri: `data:image/png;charset=utf-8;base64,${encoded}`,
        mimeType: "image/png",
      },
      {
        uri: `data:image/jpeg;base64,${encoded}`,
        mimeType: "image/jpeg",
      },
      {
        uri: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
        mimeType: "image/svg+xml",
      },
    ]

    for (const invalid of cases) {
      const document = doclingDocumentWithPicture(invalid.uri)
      setPictureMimeType(document, invalid.mimeType)
      await expect(
        processDoclingAssets({
          doclingJson: document,
          assetPaths: [],
          originalSha256,
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE",
      })
    }

    await expect(
      processDoclingAssets({
        doclingJson: doclingDocumentWithPicture(
          `data:image/png;base64,${encoded}`,
        ),
        assetPaths: [],
        originalSha256,
        limits: {
          maximumInputBytes: sourceBytes.length - 1,
          maximumOutputBytes: 1024 * 1024,
          maximumPixels: 1_000,
        },
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE",
    })

    for (const limits of [
      {
        maximumInputBytes: 1024 * 1024,
        maximumOutputBytes: 1024 * 1024,
        maximumPixels: 5,
      },
      {
        maximumInputBytes: 1024 * 1024,
        maximumOutputBytes: 1,
        maximumPixels: 1_000,
      },
    ]) {
      await expect(
        processDoclingAssets({
          doclingJson: doclingDocumentWithPicture(
            `data:image/png;base64,${encoded}`,
          ),
          assetPaths: [],
          originalSha256,
          limits,
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE",
      })
    }
  })

  it("reserves the managed inline namespace from ZIP-provided assets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linksense-asset-"))
    const managedDirectory = join(
      directory,
      "artifacts",
      "linksense-inline",
    )
    const path = join(managedDirectory, `${"b".repeat(64)}.png`)
    try {
      await mkdir(managedDirectory, { recursive: true })
      await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      })
        .png()
        .toFile(path)

      await expect(
        processDoclingAssets({
          doclingJson: doclingDocumentWithPicture(
            `artifacts/linksense-inline/${"b".repeat(64)}.png`,
          ),
          assetPaths: [path],
          originalSha256,
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE",
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(imageBearingCases)(
    "accepts an official $itemType image reference",
    async ({ itemType, expectedSelfRef }) => {
      const directory = await mkdtemp(join(tmpdir(), "linksense-asset-"))
      const artifacts = join(directory, "artifacts")
      const path = join(artifacts, "image.png")
      try {
        await mkdir(artifacts)
        await sharp({
          create: {
            width: 2,
            height: 2,
            channels: 4,
            background: { r: 0, g: 0, b: 255, alpha: 1 },
          },
        })
          .png()
          .toFile(path)

        const { assets } = await processDoclingAssets({
          doclingJson: doclingDocumentWithImageBearingItem(
            itemType,
            "artifacts/image.png",
          ),
          assetPaths: [path],
          originalSha256,
        })

        expect(assets).toHaveLength(1)
        expect(assets[0]).toMatchObject({
          selfRef: expectedSelfRef,
          sourceUri: "artifacts/image.png",
          contentType: "image/png",
        })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it("rejects archive assets that are not referenced by Docling JSON", async () => {
    await expect(
      processDoclingAssets({
        doclingJson: doclingDocumentWithPicture(undefined),
        assetPaths: ["/tmp/unreferenced.png"],
        originalSha256,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCLING_RESULT_UNSAFE",
    })
  })
})

function safeAsset(): SafeKnowledgeAsset {
  return {
    selfRef: "#/pictures/0",
    sourceUri: "artifacts/image.png",
    assetReferenceId: "90000000-0000-5000-8000-000000000001",
    safeSha256: "b".repeat(64),
    bytes: Buffer.from("safe"),
    contentType: "image/png",
  }
}

function pictureImageUri(
  document: object,
  index = 0,
): string {
  const pictures = Reflect.get(document, "pictures")
  const picture = Array.isArray(pictures) ? pictures[index] : undefined
  const image =
    typeof picture === "object" && picture !== null
      ? Reflect.get(picture, "image")
      : undefined
  const uri =
    typeof image === "object" && image !== null
      ? Reflect.get(image, "uri")
      : undefined
  if (typeof uri !== "string") throw new Error("Missing fixture image URI")
  return uri
}

function setPictureMimeType(
  document: Record<string, unknown>,
  mimeType: string,
  index = 0,
): void {
  const pictures = Reflect.get(document, "pictures")
  const picture = Array.isArray(pictures) ? pictures[index] : undefined
  const image =
    typeof picture === "object" && picture !== null
      ? Reflect.get(picture, "image")
      : undefined
  if (typeof image !== "object" || image === null) {
    throw new Error("Missing fixture image")
  }
  Reflect.set(image, "mimetype", mimeType)
}

function appendPicture(
  document: Record<string, unknown>,
  uri: string,
): void {
  const pictures = Reflect.get(document, "pictures")
  const body = Reflect.get(document, "body")
  const children =
    typeof body === "object" && body !== null
      ? Reflect.get(body, "children")
      : undefined
  if (!Array.isArray(pictures) || !Array.isArray(children)) {
    throw new Error("Missing fixture picture collection")
  }
  const selfRef = `#/pictures/${pictures.length}`
  pictures.push({
    self_ref: selfRef,
    parent: { $ref: "#/body" },
    children: [],
    content_layer: "body",
    label: "picture",
    prov: [],
    captions: [],
    references: [],
    footnotes: [],
    image: {
      mimetype: "image/png",
      dpi: 72,
      size: { width: 2, height: 2 },
      uri,
    },
    annotations: [],
  })
  children.push({ $ref: selfRef })
}

function doclingDocumentWithPicture(
  uri: string | undefined,
): Record<string, unknown> {
  return doclingDocumentWithImageBearingItem("picture", uri)
}

function doclingDocumentWithImageBearingItem(
  itemType: ImageBearingItemType,
  uri: string | undefined,
): Record<string, unknown> {
  const image = uri
    ? {
        mimetype: "image/png",
        dpi: 72,
        size: { width: 2, height: 2 },
        uri,
      }
    : null
  const body = root("body")
  const document: Record<string, unknown> = {
    schema_name: "DoclingDocument",
    version: "1.10.0",
    name: "fixture",
    origin: null,
    body,
    furniture: root("furniture"),
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    key_value_items: [],
    form_items: [],
    field_regions: [],
    field_items: [],
    pages: {},
  }

  switch (itemType) {
    case "picture":
      attachBodyItem(document, body, "pictures", {
        self_ref: "#/pictures/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "picture",
        prov: [],
        captions: [],
        references: [],
        footnotes: [],
        image,
        annotations: [],
      })
      break
    case "table":
      attachBodyItem(document, body, "tables", {
        self_ref: "#/tables/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "table",
        prov: [],
        captions: [],
        references: [],
        footnotes: [],
        image,
        data: {
          table_cells: [],
          num_rows: 0,
          num_cols: 0,
          orientation: "rot_0",
        },
        annotations: [],
      })
      break
    case "code":
      attachBodyItem(document, body, "texts", {
        self_ref: "#/texts/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "code",
        prov: [],
        orig: "const value = 1",
        text: "const value = 1",
        captions: [],
        references: [],
        footnotes: [],
        image,
        code_language: "TypeScript",
      })
      break
    case "form":
      attachBodyItem(document, body, "form_items", {
        self_ref: "#/form_items/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "form",
        prov: [],
        captions: [],
        references: [],
        footnotes: [],
        image,
        graph: { cells: [], links: [] },
      })
      break
    case "key-value":
      attachBodyItem(document, body, "key_value_items", {
        self_ref: "#/key_value_items/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "key_value_region",
        prov: [],
        captions: [],
        references: [],
        footnotes: [],
        image,
        graph: { cells: [], links: [] },
      })
      break
    case "page":
      Reflect.set(document, "pages", {
        "1": {
          size: { width: 2, height: 2 },
          image,
          page_no: 1,
        },
      })
      break
  }
  return document
}

function attachBodyItem(
  document: Record<string, unknown>,
  body: ReturnType<typeof root>,
  collectionName: string,
  item: Record<string, unknown>,
): void {
  const collection = Reflect.get(document, collectionName)
  if (!Array.isArray(collection)) {
    throw new Error(`Missing ${collectionName} fixture collection`)
  }
  const selfRef = Reflect.get(item, "self_ref")
  if (typeof selfRef !== "string") {
    throw new Error(`Missing ${collectionName} fixture self_ref`)
  }
  collection.push(item)
  body.children.push({ $ref: selfRef })
}

function root(
  layer: "body" | "furniture",
): {
  self_ref: string
  parent: null
  children: Array<{ $ref: string }>
  content_layer: "body" | "furniture"
  name: string
  label: string
} {
  return {
    self_ref: `#/${layer}`,
    parent: null,
    children: [],
    content_layer: layer,
    name: "_root_",
    label: "unspecified",
  }
}
