import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as desktop from "@/adapters/desktop/desktop-adapter"
import { beginLoginSession } from "@/api/session"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"

import type { TaskArtifact } from "./task-artifact-api"
import { TaskArtifactPreview } from "./task-artifact-preview"

// The markdown and media previews share a module with the PDF worker, which
// does not run in jsdom.
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}))

const file: TaskArtifact = {
  id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: null,
  kind: "artifact",
  source: "agent_generated",
  status: "registered",
  filename: "report.md",
  mime_type: "text/markdown",
  size_bytes: 3,
  storage_backend: "minio",
  downloadable: true,
  created_at: "2026-07-11T08:00:00Z",
  updated_at: "2026-07-11T08:00:00Z",
  task: {
    id: "20000000-0000-4000-8000-000000000001",
    title: "Task",
    archive_status: "active",
  },
  name: "report.md",
  size: 3,
  download_available: true,
}

const audio = {
  ...file,
  name: "recording.mp3",
  filename: "recording.mp3",
  mime_type: "audio/mpeg",
}
const previewHandle = "p".repeat(43)
const saveHandle = "s".repeat(43)
const fileContent = "abc"

describe("task artifact preview", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    { kind: "loaded bytes", artifact: file, source: previewHandle },
    { kind: "preview source", artifact: audio, source: undefined },
  ])("drops a pending Mac save from $kind after its login is replaced", async ({
    artifact,
    source,
  }) => {
    const { begin, cancel, anchor, toast, fetchMock } = mockMacPreview()
    let resolveTicket: ((handle: string) => void) | undefined
    begin.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveTicket = resolve
      })
    )
    const save = await renderPreview(artifact)
    fireEvent.click(save)
    fireEvent.click(save)
    await waitFor(() =>
      expect(begin).toHaveBeenCalledExactlyOnceWith(
        ...(source === undefined ? [] : [source])
      )
    )
    await act(async () => {
      beginLoginSession()
      resolveTicket?.(saveHandle)
    })
    expect(cancel).toHaveBeenCalledExactlyOnceWith(saveHandle)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(anchor).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it("shows a rejected save for the current login and allows the loaded bytes to be saved again", async () => {
    const { begin, anchor, toast, fetchMock } = mockMacPreview()
    begin
      .mockRejectedValueOnce(new Error("DESKTOP_DOWNLOAD_STALE"))
      .mockResolvedValueOnce(saveHandle)
      .mockResolvedValueOnce("t".repeat(43))
    const createdBlobs: Blob[] = []
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL(blob: Blob) {
        createdBlobs.push(blob)
        return `blob:http://localhost/save-${createdBlobs.length}`
      }
      static revokeObjectURL() {}
    })
    const save = await renderPreview(file)

    fireEvent.click(save)
    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith(i18n.t("errors.unknown"))
    )
    fireEvent.click(save)
    await waitFor(() => expect(anchor).toHaveBeenCalledOnce())
    fireEvent.click(save)
    await waitFor(() => expect(anchor).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledOnce()
    expect(createdBlobs).toHaveLength(2)
    for (const blob of createdBlobs) {
      expect(await blob.text()).toBe(fileContent)
      expect(blob.type).toBe(file.mime_type)
    }
  })
})

async function renderPreview(artifact: TaskArtifact) {
  render(<TaskArtifactPreview file={artifact} onClose={vi.fn()} />)
  return screen.findByRole("button", {
    name: `Download document ${artifact.name}`,
  })
}

function mockMacPreview() {
  vi.spyOn(desktop, "isMacDesktopHost").mockReturnValue(true)
  vi.spyOn(desktop, "beginDesktopArtifactPreview").mockResolvedValue(
    previewHandle
  )
  vi.spyOn(desktop, "armDesktopArtifactDownload").mockResolvedValue(undefined)
  const begin = vi.spyOn(desktop, "beginDesktopArtifactDownload")
  const cancel = vi
    .spyOn(desktop, "cancelDesktopArtifactDownload")
    .mockResolvedValue(undefined)
  const toast = vi.spyOn(notify, "error").mockReturnValue("preview-error")
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined)
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname.endsWith("/content")) return new Response(fileContent)
    if (url.pathname.endsWith("/preview")) {
      return Response.json({
        success: true,
        data: {
          url: `${window.location.origin}/preview/recording.mp3`,
          expires_at: "2030-01-01T00:00:00.000Z",
        },
      })
    }
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  return { begin, cancel, anchor, toast, fetchMock }
}
