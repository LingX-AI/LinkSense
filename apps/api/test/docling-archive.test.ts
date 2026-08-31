import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { readExtractedDoclingArchive } from "../src/modules/knowledge-processing/docling.js"

describe("Docling result archive", () => {
  it("accepts an empty official Markdown projection when JSON is present", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linksense-docling-result-"))
    const archivePath = join(directory, "source.zip")
    const markdownPath = join(directory, "document.md")
    const jsonPath = join(directory, "document.json")
    await Promise.all([
      writeFile(archivePath, "zip fixture"),
      writeFile(markdownPath, ""),
      writeFile(jsonPath, JSON.stringify({ name: "fixture" })),
    ])

    try {
      await expect(
        readExtractedDoclingArchive({
          directory,
          archivePath,
          markdownPath,
          jsonPath,
          assetPaths: [],
          cleanup: () => rm(directory, { recursive: true, force: true }),
        }),
      ).resolves.toEqual({
        markdown: "",
        markdownBytes: Buffer.alloc(0),
        json: { name: "fixture" },
        jsonBytes: Buffer.from(JSON.stringify({ name: "fixture" })),
        assetPaths: [],
        archivePath,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
