import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { imageGenerationCoreMcpModule } from "../src/mcp/core-services/image-generation-service.js"

const original = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const conversationId = "01900000-0000-7000-8000-000000000001"
const roots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "linksense-image-edit-"))
  roots.push(root)
  await mkdir(join(root, "attachments"))
  await writeFile(join(root, "attachments", "original.png"), original)
  const fetchMock = vi.fn<typeof fetch>(async (url) => new Response(JSON.stringify(
    String(url).endsWith("/generate") ? {
      success: true, provider: "openai", model: "gpt-image-2", image_count: 1,
      unit_price: "0.25", total_cost: "0.25", currency: "USD",
      transparency: { requested: false, strategy: "none", chroma_key: null },
      images: [{ data_base64: original.toString("base64"), mime_type: "image/png", display_name: "Edited portrait.png", has_transparency: false }],
    } : {
      success: true, artifact_id: "01900000-0000-7000-8000-000000000010",
      file_id: "01900000-0000-7000-8000-000000000011", display_name: "Edited portrait.png",
      download_card_event_id: "01900000-0000-7000-8000-000000000012",
    },
  ), { headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  const module = imageGenerationCoreMcpModule.create({ workspaceRoot: root, environment: {
    LINKSENSE_IMAGE_GENERATION_ENDPOINT: "http://images.example.test/generate",
    LINKSENSE_IMAGE_GENERATION_TOKEN: "image-token-000000000000000000000000000000",
    LINKSENSE_FILE_SERVICE_ENDPOINT: "http://files.example.test/register",
    LINKSENSE_FILE_SERVICE_TOKEN: "files-token-000000000000000000000000000000",
    LINKSENSE_CONVERSATION_ID: conversationId,
  } })
  const call = (argumentsValue: Record<string, unknown>) => module.callTool({
    toolName: "generate_image", argumentsValue: { prompt: "Change the background", image_name: "Edited portrait", ...argumentsValue },
    signal: new AbortController().signal,
  })
  return { root, fetchMock, call }
}

describe("image editing file boundary", () => {
  it("sends exact original bytes, registers a new image and allows editing that result again", async () => {
    const { root, fetchMock, call } = await harness()
    const first = await call({ input_images: ["attachments/original.png"] })
    expect(first.isError).toBe(false)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      input_images: [{ mime_type: "image/png", data_base64: original.toString("base64") }],
    })
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("attachments/original.png")
    const registration = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { workspaceRelativePath: string }
    expect(await readFile(join(root, registration.workspaceRelativePath))).toEqual(original)
    expect(await readFile(join(root, "attachments/original.png"))).toEqual(original)
    expect((await call({ input_images: [registration.workspaceRelativePath] })).isError).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it.each(["../private.png", "/etc/passwd", "https://example.test/image.png", "attachments/missing.png", "attachments"])(
    "rejects unsafe or missing image %s before any network call", async (inputPath) => {
      const { fetchMock, call } = await harness()
      expect((await call({ input_images: [inputPath] })).isError).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each(["file", "directory"])("rejects a symbolic link through a %s", async (kind) => {
    const { root, fetchMock, call } = await harness()
    if (kind === "file") await symlink(join(root, "attachments/original.png"), join(root, "attachments/link.png"))
    else await symlink(join(root, "attachments"), join(root, "linked"))
    const result = await call({ input_images: [kind === "file" ? "attachments/link.png" : "linked/original.png"] })
    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("IMAGE_GENERATION_INPUT_INVALID") }] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects non-image bytes and a different conversation without a provider request", async () => {
    const { root, fetchMock, call } = await harness()
    await writeFile(join(root, "attachments/fake.png"), "private document")
    expect((await call({ input_images: ["attachments/fake.png"] })).isError).toBe(true)
    expect((await call({ conversation_id: "01900000-0000-7000-8000-000000000099", input_images: ["attachments/original.png"] })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects images exceeding individual or combined byte limits", async () => {
    const { root, fetchMock, call } = await harness()
    await writeFile(join(root, "attachments/large.png"), Buffer.alloc(8 * 1024 * 1024 + 1))
    expect((await call({ input_images: ["attachments/large.png"] })).isError).toBe(true)
    await writeFile(join(root, "attachments/padded.png"), Buffer.concat([original, Buffer.alloc(6 * 1024 * 1024)]))
    expect((await call({ input_images: ["attachments/padded.png", "attachments/padded.png"] })).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
