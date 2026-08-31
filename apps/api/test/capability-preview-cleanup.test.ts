import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { pruneExpiredCapabilityPreviews } from "../src/modules/capabilities/preview.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("capability preview cleanup", () => {
  it("walks beyond the former first 1000 entries through bounded cursor pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-preview-prune-"))
    roots.push(root)
    const capabilityRoot = join(root, "capabilities")
    const previewRoot = join(capabilityRoot, ".previews")
    await mkdir(previewRoot, { recursive: true })
    for (let offset = 0; offset < 1_001; offset += 100) {
      await Promise.all(
        Array.from(
          { length: Math.min(100, 1_001 - offset) },
          (_, index) =>
            mkdir(
              join(
                previewRoot,
                `preview-${String(offset + index).padStart(4, "0")}`,
              ),
            ),
        ),
      )
    }
    const outside = join(root, "outside")
    await mkdir(outside)
    await writeFile(join(outside, "must-remain.txt"), "protected")
    await symlink(outside, join(previewRoot, "zzzz-outside-link"), "dir")
    const future = new Date(Date.now() + 60 * 60 * 1_000)

    let cursor: string | undefined
    let removed = 0
    let pages = 0
    do {
      const result = await pruneExpiredCapabilityPreviews({
        capabilityRoot,
        ...(cursor ? { cursor } : {}),
        limit: 100,
        now: future,
      })
      removed += result.removed
      cursor = result.nextCursor ?? undefined
      pages += 1
    } while (cursor)

    expect(removed).toBe(1_001)
    expect(pages).toBeGreaterThan(10)
    expect(await readdir(previewRoot)).toEqual(["zzzz-outside-link"])
    await expect(access(join(outside, "must-remain.txt"))).resolves.toBeUndefined()
  })
})
