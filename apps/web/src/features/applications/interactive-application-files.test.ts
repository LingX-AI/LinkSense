import { QueryClient } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiRequest } from "@/api/client"
import {
  createInteractiveApplicationFiles,
  interactiveApplicationFilesKey,
} from "./interactive-application-files"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

const conversationId = "20000000-0000-4000-8000-000000000001"
const file = {
  id: "30000000-0000-4000-8000-000000000001",
  filename: "notes.txt",
  size_bytes: 5,
  mime_type: "text/plain",
  status: "staged",
  turn_id: null,
} as const
const setup = () => {
  const queryClient = new QueryClient()
  return {
    queryClient,
    files: createInteractiveApplicationFiles({ queryClient, conversationId }),
  }
}

describe("interactive files bridge", () => {
  it("uploads a real file as multipart, records its metadata and removes it after success", async () => {
    const { queryClient, files } = setup()
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(file)
      .mockResolvedValueOnce(undefined)
    const selected = new File(["notes"], "notes.txt", { type: "text/plain" })
    const upload = files.upload({ file: selected })
    expect(files.busy).toBe(true)
    await expect(upload).resolves.toEqual(file)
    expect(files.busy).toBe(false)
    const body = vi.mocked(apiRequest).mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get("file")).toMatchObject({
      name: selected.name,
      size: selected.size,
      type: selected.type,
    })
    expect(
      queryClient.getQueryData(interactiveApplicationFilesKey(conversationId))
    ).toEqual({ items: [file] })
    await files.remove({ file_id: file.id })
    expect(
      queryClient.getQueryData(interactiveApplicationFilesKey(conversationId))
    ).toEqual({ items: [] })
  })

  it("restores server files and retains them when removal fails", async () => {
    const { queryClient, files } = setup()
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ items: [file] })
      .mockRejectedValueOnce(
        new ApiError({ status: 409, errorCode: "CONFLICT" })
      )
    await expect(files.list()).resolves.toEqual({ items: [file] })
    await expect(files.remove({ file_id: file.id })).rejects.toMatchObject({
      errorCode: "CONFLICT",
    })
    expect(files.busy).toBe(false)
    expect(
      queryClient.getQueryData(interactiveApplicationFilesKey(conversationId))
    ).toEqual({ items: [file] })
  })

  it("does not call the API for forged files and invalid IDs, and clears pending state after upload failure", async () => {
    const { files } = setup()
    await expect(
      files.upload({ file: { name: "notes.txt" } })
    ).rejects.toThrow()
    await expect(files.remove({ file_id: "invalid" })).rejects.toThrow()
    expect(apiRequest).not.toHaveBeenCalled()
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("upload failed"))
    await expect(
      files.upload({ file: new File(["notes"], "notes.txt") })
    ).rejects.toThrow("upload failed")
    expect(files.busy).toBe(false)
  })
})
