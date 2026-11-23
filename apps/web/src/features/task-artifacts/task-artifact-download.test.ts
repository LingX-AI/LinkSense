import { supportedLocales } from "@linksense/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  isMac: false,
  begin: vi.fn(),
  beginPreview: vi.fn(),
  arm: vi.fn(),
  cancel: vi.fn(),
  reveal: vi.fn(),
  subscribe: vi.fn(),
  downloadApiFile: vi.fn(),
  downloadBlob: vi.fn(),
  downloadUrl: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
  revokeObjectURL: vi.fn(),
  t: vi.fn((key: string, options?: { name?: string }) =>
    options?.name ? `${key}:${options.name}` : key
  ),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isDesktopHost: () => mocks.isMac,
  isMacDesktopHost: () => mocks.isMac,
  beginDesktopArtifactDownload: mocks.begin,
  beginDesktopArtifactPreview: mocks.beginPreview,
  armDesktopArtifactDownload: mocks.arm,
  cancelDesktopArtifactDownload: mocks.cancel,
  revealDesktopArtifactDownload: mocks.reveal,
  subscribeDesktopArtifactSaved: mocks.subscribe,
}))
vi.mock("@/api/client", () => ({ downloadApiFile: mocks.downloadApiFile }))
vi.mock("@/lib/download-blob", () => ({
  downloadBlob: mocks.downloadBlob,
  downloadUrl: mocks.downloadUrl,
}))
vi.mock("@/components/feedback/notification", () => ({
  notify: {
    success: mocks.success,
    error: mocks.error,
    dismiss: mocks.dismiss,
  },
}))
vi.mock("@/i18n", () => ({ default: { t: mocks.t } }))

import type { TaskArtifact } from "./task-artifact-api"
import { taskArtifactDownloadMessages } from "./messages"

type SavedOfferOptions = {
  id: string
  action: { label: string; onClick: () => void }
  onAutoClose: () => void
  onDismiss: () => void
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const handle = "a".repeat(43)
const secondHandle = "b".repeat(43)
const sourceHandle = "c".repeat(43)
const firstSaveHandle = "d".repeat(43)
const secondSaveHandle = "e".repeat(43)
const artifact: TaskArtifact = {
  id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: null,
  kind: "artifact",
  source: "agent_generated",
  status: "registered",
  filename: "report.txt",
  mime_type: "text/plain",
  size_bytes: 18,
  storage_backend: "minio",
  downloadable: true,
  created_at: "2026-07-11T08:00:00Z",
  updated_at: "2026-07-11T08:00:00Z",
  task: {
    id: "20000000-0000-4000-8000-000000000001",
    title: "Task",
    archive_status: "active",
  },
  name: "report.txt",
  size: 18,
  download_available: true,
}

let savedListener:
  ((saved: { handle: string; name: string }) => void) | undefined

async function loadHelper() {
  vi.resetModules()
  const download = await import("./task-artifact-download")
  // The download module and this test must share one login-boundary instance.
  const session = await import("@/api/session")
  return { ...download, session }
}

describe("task artifact download", () => {
  beforeEach(() => {
    savedListener = undefined
    window.localStorage.clear()
    vi.clearAllMocks()
    mocks.isMac = false
    mocks.subscribe.mockImplementation(
      (listener: (saved: { handle: string; name: string }) => void) => {
        savedListener = listener
        return vi.fn()
      }
    )
    mocks.begin.mockResolvedValue(null)
    mocks.beginPreview.mockResolvedValue(null)
    mocks.arm.mockResolvedValue(undefined)
    mocks.cancel.mockResolvedValue(undefined)
    mocks.reveal.mockResolvedValue(undefined)
    mocks.downloadApiFile.mockResolvedValue(new Blob(["authenticated bytes"]))
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mygo://localhost/saved"),
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectURL,
    })
  })

  it("keeps browser and Windows behavior through the existing blob save", async () => {
    const { downloadTaskArtifact } = await loadHelper()
    await downloadTaskArtifact(artifact)

    expect(mocks.begin).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "report.txt"
    )
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it("keeps browser preview load and save on the existing blob path", async () => {
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const content = await loadTaskArtifactContent(artifact)

    await saveTaskArtifactBlob(
      new Blob([new Uint8Array(content)]),
      "browser-preview.txt",
      content
    )
    expect(mocks.isMac).toBe(false)
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadApiFile).toHaveBeenCalledOnce()
    expect(mocks.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "browser-preview.txt"
    )
  })

  it("starts the Mac ticket before the fetch and never offers Finder on failure", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    mocks.downloadApiFile.mockRejectedValue(new Error("ARTIFACT_NOT_FOUND"))
    const { downloadTaskArtifact } = await loadHelper()

    await expect(downloadTaskArtifact(artifact)).rejects.toThrow(
      "ARTIFACT_NOT_FOUND"
    )
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.downloadApiFile.mock.invocationCallOrder[0] ?? Infinity
    )
    expect(mocks.cancel).toHaveBeenCalledWith(handle)
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it("fails closed before fetching when a Mac ticket cannot be established", async () => {
    mocks.isMac = true
    mocks.begin.mockRejectedValue(new Error("AUTH_REQUIRED"))
    mocks.beginPreview.mockRejectedValue(new Error("AUTH_REQUIRED"))
    const { downloadTaskArtifact, loadTaskArtifactContent } = await loadHelper()

    await expect(downloadTaskArtifact(artifact)).rejects.toThrow(
      "AUTH_REQUIRED"
    )
    await expect(loadTaskArtifactContent(artifact)).rejects.toThrow(
      "AUTH_REQUIRED"
    )
    expect(mocks.downloadApiFile).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it("offers the keyboard action only after the exact native save and reveals only on click", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    const { downloadTaskArtifact } = await loadHelper()

    await downloadTaskArtifact(artifact)
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.downloadApiFile.mock.invocationCallOrder[0] ?? Infinity
    )
    expect(mocks.arm).toHaveBeenCalledWith(
      handle,
      "blob:mygo://localhost/saved"
    )
    expect(mocks.downloadUrl).toHaveBeenCalledWith(
      "blob:mygo://localhost/saved",
      "report.txt"
    )
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.reveal).not.toHaveBeenCalled()

    expect(savedListener).toBeTypeOf("function")
    savedListener?.({ handle, name: "report.txt" })
    expect(mocks.success).toHaveBeenCalledOnce()
    const [message, options] = mocks.success.mock.calls[0] as [
      string,
      SavedOfferOptions,
    ]
    expect(message).toBe("taskArtifacts.saved:report.txt")
    expect(options.id).toBe(`task-artifact-saved-${handle}`)
    expect(options.action.label).toBe("taskArtifacts.showInFinder")
    expect(mocks.reveal).not.toHaveBeenCalled()

    options.action.onClick()
    expect(mocks.dismiss).toHaveBeenCalledWith(`task-artifact-saved-${handle}`)
    await vi.waitFor(() => expect(mocks.reveal).toHaveBeenCalledWith(handle))
  })

  it("releases nine completed offers whose toasts expire or are dismissed without reveal", async () => {
    mocks.isMac = true
    const completedHandles = Array.from({ length: 9 }, (_, index) =>
      String(index).padStart(43, "0")
    )
    const { downloadTaskArtifact } = await loadHelper()
    for (const [index, ticket] of completedHandles.entries()) {
      mocks.begin.mockResolvedValueOnce(ticket)
      await downloadTaskArtifact(artifact)
      savedListener?.({ handle: ticket, name: `report-${index}.txt` })
      const options = mocks.success.mock.calls.at(-1)?.[1] as SavedOfferOptions
      expect(options.onAutoClose).toBeTypeOf("function")
      expect(options.onDismiss).toBeTypeOf("function")
      if (index % 2 === 0) options.onAutoClose()
      else options.onDismiss()
      // Sonner may report both close paths for one removal.
      options.onAutoClose()
      options.onDismiss()
    }

    expect(mocks.begin).toHaveBeenCalledTimes(9)
    expect(mocks.success).toHaveBeenCalledTimes(9)
    expect(mocks.downloadUrl).toHaveBeenCalledTimes(9)
    expect(mocks.cancel.mock.calls).toEqual(
      completedHandles.map((ticket) => [ticket])
    )
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it("claims an explicit reveal before dismissal and keeps a pending reveal alive", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    let finishReveal: (() => void) | undefined
    mocks.reveal.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReveal = resolve
        })
    )
    const { downloadTaskArtifact } = await loadHelper()
    await downloadTaskArtifact(artifact)
    savedListener?.({ handle, name: "report.txt" })
    const options = mocks.success.mock.calls[0]?.[1] as SavedOfferOptions

    expect(mocks.reveal).not.toHaveBeenCalled()
    options.action.onClick()
    expect(mocks.dismiss).toHaveBeenCalledWith(`task-artifact-saved-${handle}`)
    expect(mocks.reveal).toHaveBeenCalledWith(handle)

    options.onDismiss()
    options.onAutoClose()
    expect(mocks.cancel).not.toHaveBeenCalled()

    finishReveal?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it("keeps a stale or failed reveal from claiming success", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    mocks.reveal.mockRejectedValue(new Error("DESKTOP_DOWNLOAD_STALE"))
    const { downloadTaskArtifact } = await loadHelper()
    await downloadTaskArtifact(artifact)
    savedListener?.({ handle, name: "report.txt" })

    const options = mocks.success.mock.calls[0]?.[1] as SavedOfferOptions
    options.action.onClick()
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("taskArtifacts.revealFailed")
    )
    await vi.waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
    )
    options.onDismiss()
    options.onAutoClose()
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it("derives two independent saves from one preview load without a second fetch", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    mocks.begin
      .mockResolvedValueOnce(firstSaveHandle)
      .mockResolvedValueOnce(secondSaveHandle)
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:mygo://localhost/first")
      .mockReturnValueOnce("blob:mygo://localhost/second")
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()

    const content = await loadTaskArtifactContent(artifact)
    expect(mocks.beginPreview).toHaveBeenCalledOnce()
    expect(mocks.beginPreview.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.downloadApiFile.mock.invocationCallOrder[0] ?? Infinity
    )
    expect(mocks.downloadApiFile).toHaveBeenCalledOnce()

    const firstBlob = new Blob([new Uint8Array(content)], {
      type: artifact.mime_type ?? undefined,
    })
    await saveTaskArtifactBlob(firstBlob, "preview.txt", content)
    await saveTaskArtifactBlob(firstBlob, "preview.txt", content)

    expect(mocks.begin).toHaveBeenCalledTimes(2)
    expect(mocks.begin).toHaveBeenNthCalledWith(1, sourceHandle)
    expect(mocks.begin).toHaveBeenNthCalledWith(2, sourceHandle)
    expect(mocks.downloadApiFile).toHaveBeenCalledOnce()
    expect(mocks.arm).toHaveBeenNthCalledWith(
      1,
      firstSaveHandle,
      "blob:mygo://localhost/first"
    )
    expect(mocks.arm).toHaveBeenNthCalledWith(
      2,
      secondSaveHandle,
      "blob:mygo://localhost/second"
    )
    expect(mocks.downloadUrl).toHaveBeenCalledTimes(2)
    expect(mocks.downloadUrl).toHaveBeenNthCalledWith(
      1,
      "blob:mygo://localhost/first",
      "preview.txt"
    )
    expect(mocks.downloadUrl).toHaveBeenNthCalledWith(
      2,
      "blob:mygo://localhost/second",
      "preview.txt"
    )
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    for (const [blob] of createObjectURL.mock.calls as [Blob][]) {
      expect(blob).toBe(firstBlob)
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(content)
    }
    expect(savedListener).toBeTypeOf("function")
  })

  it("fails a second preview save closed when the source provenance is stale", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    mocks.begin
      .mockResolvedValueOnce(firstSaveHandle)
      .mockRejectedValueOnce(new Error("DESKTOP_DOWNLOAD_STALE"))
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const content = await loadTaskArtifactContent(artifact)

    await saveTaskArtifactBlob(
      new Blob([new Uint8Array(content)]),
      "preview.txt",
      content
    )
    await expect(
      saveTaskArtifactBlob(
        new Blob([new Uint8Array(content)]),
        "preview.txt",
        content
      )
    ).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.downloadApiFile).toHaveBeenCalledOnce()
    expect(mocks.arm).toHaveBeenCalledOnce()
    expect(mocks.downloadUrl).toHaveBeenCalledOnce()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it("cancels only the derived save ticket when arming fails", async () => {
    mocks.isMac = true
    const failedUrl = "blob:mygo://localhost/arm-failed"
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => failedUrl),
    })
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    mocks.begin.mockResolvedValue(firstSaveHandle)
    mocks.arm.mockRejectedValue(new Error("AUTH_REQUIRED"))
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const content = await loadTaskArtifactContent(artifact)

    await expect(
      saveTaskArtifactBlob(
        new Blob([new Uint8Array(content)]),
        "preview.txt",
        content
      )
    ).rejects.toThrow("AUTH_REQUIRED")
    expect(mocks.begin).toHaveBeenCalledWith(sourceHandle)
    expect(mocks.cancel).toHaveBeenCalledWith(firstSaveHandle)
    expect(mocks.cancel).not.toHaveBeenCalledWith(sourceHandle)
    expect(
      mocks.revokeObjectURL.mock.calls.filter(([url]) => url === failedUrl)
    ).toEqual([[failedUrl]])
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("defers one Blob URL revocation until after the native download is dispatched", async () => {
    mocks.isMac = true
    const deferredUrl = "blob:mygo://localhost/deferred"
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => deferredUrl),
    })
    mocks.begin.mockResolvedValue(handle)
    const { downloadTaskArtifact } = await loadHelper()
    await downloadTaskArtifact(artifact)

    expect(mocks.downloadUrl).toHaveBeenCalledWith(deferredUrl, "report.txt")
    expect(
      mocks.revokeObjectURL.mock.calls.filter(([url]) => url === deferredUrl)
    ).toEqual([])
    await vi.waitFor(() =>
      expect(
        mocks.revokeObjectURL.mock.calls.filter(([url]) => url === deferredUrl)
      ).toEqual([[deferredUrl]])
    )
  })

  it("refuses preview bytes when the native source lease was replaced", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    mocks.begin.mockRejectedValue(new Error("AUTH_REQUIRED"))
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const content = await loadTaskArtifactContent(artifact)

    await expect(
      saveTaskArtifactBlob(
        new Blob([new Uint8Array(content)]),
        "preview.txt",
        content
      )
    ).rejects.toThrow("AUTH_REQUIRED")
    expect(mocks.begin).toHaveBeenCalledWith(sourceHandle)
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("cancels an aborted preview source and never saves its bytes", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const controller = new AbortController()
    const content = await loadTaskArtifactContent(artifact, controller.signal)

    controller.abort()
    expect(mocks.cancel).toHaveBeenCalledWith(sourceHandle)
    await expect(
      saveTaskArtifactBlob(
        new Blob([new Uint8Array(content)]),
        "preview.txt",
        content
      )
    ).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it("separates out-of-order preview loads and aborts the replaced one", async () => {
    mocks.isMac = true
    mocks.beginPreview
      .mockResolvedValueOnce(sourceHandle)
      .mockResolvedValueOnce(secondHandle)
    mocks.begin.mockResolvedValue(firstSaveHandle)
    let resolveFirst: ((blob: Blob) => void) | undefined
    let resolveSecond: ((blob: Blob) => void) | undefined
    mocks.downloadApiFile
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((resolve) => {
            resolveSecond = resolve
          })
      )
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstLoad = loadTaskArtifactContent(artifact, firstController.signal)
    await vi.waitFor(() =>
      expect(mocks.downloadApiFile).toHaveBeenCalledTimes(1)
    )
    const secondLoad = loadTaskArtifactContent(
      artifact,
      secondController.signal
    )
    await vi.waitFor(() =>
      expect(mocks.downloadApiFile).toHaveBeenCalledTimes(2)
    )

    resolveFirst?.(new Blob(["first bytes"]))
    const firstContent = await firstLoad
    firstController.abort()
    expect(mocks.cancel).toHaveBeenCalledWith(sourceHandle)
    await expect(
      saveTaskArtifactBlob(
        new Blob([new Uint8Array(firstContent)]),
        "first-preview.txt",
        firstContent
      )
    ).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.arm).not.toHaveBeenCalled()

    resolveSecond?.(new Blob(["second bytes"]))
    const secondContent = await secondLoad
    await saveTaskArtifactBlob(
      new Blob([new Uint8Array(secondContent)]),
      "second-preview.txt",
      secondContent
    )
    expect(mocks.begin).toHaveBeenCalledOnce()
    expect(mocks.begin).toHaveBeenCalledWith(secondHandle)
    expect(mocks.arm).toHaveBeenCalledOnce()
    expect(mocks.arm).toHaveBeenCalledWith(
      firstSaveHandle,
      "blob:mygo://localhost/saved"
    )
    expect(mocks.downloadUrl).toHaveBeenCalledWith(
      "blob:mygo://localhost/saved",
      "second-preview.txt"
    )
    expect(mocks.downloadApiFile).toHaveBeenCalledTimes(2)
  })

  it("dismisses the outgoing login's Finder offers and accepts the replacement login's save", async () => {
    const endedOfferHandle = "f".repeat(43)
    const endedPendingHandle = "g".repeat(43)
    const replacementHandle = "h".repeat(43)
    mocks.isMac = true
    mocks.begin
      .mockResolvedValueOnce(endedOfferHandle)
      .mockResolvedValueOnce(endedPendingHandle)
      .mockResolvedValueOnce(replacementHandle)
    const { downloadTaskArtifact, session } = await loadHelper()

    // Account A completes one save (a visible offer) and has another save
    // armed whose native completion has not arrived yet.
    await downloadTaskArtifact(artifact)
    savedListener?.({ handle: endedOfferHandle, name: "report-a.txt" })
    const endedOffer = mocks.success.mock.calls[0]?.[1] as SavedOfferOptions
    await downloadTaskArtifact(artifact)
    expect(mocks.success).toHaveBeenCalledOnce()
    expect(mocks.downloadUrl).toHaveBeenCalledTimes(2)

    // Sign-out intent ends A without waiting for the token clear or logout.
    session.beginLoginSession()
    expect(mocks.dismiss.mock.calls).toEqual([
      [`task-artifact-saved-${endedOfferHandle}`],
    ])
    expect(mocks.cancel.mock.calls).toHaveLength(2)
    expect(mocks.cancel.mock.calls).toEqual(
      expect.arrayContaining([[endedOfferHandle], [endedPendingHandle]])
    )

    // A completion queued for A's pending ticket must not show its name,
    // create an offer, or acquire a callback.
    savedListener?.({
      handle: endedPendingHandle,
      name: "private-a-pending.txt",
    })
    expect(mocks.success).toHaveBeenCalledOnce()
    expect(mocks.t).not.toHaveBeenCalledWith("taskArtifacts.saved", {
      name: "private-a-pending.txt",
    })
    expect(mocks.dismiss).toHaveBeenCalledOnce()

    // A stale click on the dismissed offer neither reveals nor reports.
    endedOffer.action.onClick()
    expect(mocks.reveal).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.dismiss).toHaveBeenCalledOnce()

    // Account B is accepted (the same boundary advance plus credential as
    // acceptSession) and can still save. The offer appears only after B's own
    // completion, and Finder opens only on the explicit click.
    session.beginLoginSession()
    session.setAccessToken(
      "account-b-access-token",
      Date.now() + 60 * 60 * 1000
    )
    expect(mocks.dismiss).toHaveBeenCalledOnce()
    await downloadTaskArtifact(artifact)
    savedListener?.({ handle: replacementHandle, name: "report-b.txt" })
    expect(mocks.success).toHaveBeenCalledTimes(2)
    const replacementOffer = mocks.success.mock
      .calls[1]?.[1] as SavedOfferOptions
    expect(replacementOffer.id).toBe(`task-artifact-saved-${replacementHandle}`)
    expect(mocks.reveal).not.toHaveBeenCalled()
    replacementOffer.action.onClick()
    await vi.waitFor(() =>
      expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(replacementHandle)
    )

    // Saved bytes and the exact filename are unchanged for every save, and
    // only artifact-owned toast ids are ever dismissed.
    expect(mocks.downloadUrl).toHaveBeenCalledTimes(3)
    for (const call of mocks.downloadUrl.mock.calls) {
      expect(call).toEqual(["blob:mygo://localhost/saved", "report.txt"])
    }
    for (const [id] of mocks.dismiss.mock.calls) {
      expect(id).toMatch(/^task-artifact-saved-/u)
    }
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it("fences a reveal rejected after its login ended", async () => {
    const endedRevealHandle = "i".repeat(43)
    mocks.isMac = true
    mocks.begin.mockResolvedValue(endedRevealHandle)
    let rejectReveal: ((error: Error) => void) | undefined
    mocks.reveal.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectReveal = reject
        })
    )
    const { downloadTaskArtifact, session } = await loadHelper()
    await downloadTaskArtifact(artifact)
    savedListener?.({ handle: endedRevealHandle, name: "report.txt" })
    const offer = mocks.success.mock.calls[0]?.[1] as SavedOfferOptions

    offer.action.onClick()
    expect(mocks.reveal).toHaveBeenCalledWith(endedRevealHandle)
    expect(mocks.dismiss).toHaveBeenCalledWith(
      `task-artifact-saved-${endedRevealHandle}`
    )
    session.beginLoginSession()
    rejectReveal?.(new Error("DESKTOP_DOWNLOAD_STALE"))
    await vi.waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith(endedRevealHandle)
    )
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it("keeps valid Finder offers through an ordinary access-token rotation", async () => {
    const rotatedOfferHandle = "j".repeat(43)
    mocks.isMac = true
    mocks.begin.mockResolvedValue(rotatedOfferHandle)
    const { downloadTaskArtifact, session } = await loadHelper()
    await downloadTaskArtifact(artifact)
    savedListener?.({ handle: rotatedOfferHandle, name: "report.txt" })
    const offer = mocks.success.mock.calls[0]?.[1] as SavedOfferOptions

    session.setAccessToken("rotated-access-token", Date.now() + 60 * 60 * 1000)
    expect(mocks.dismiss).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()

    offer.action.onClick()
    await vi.waitFor(() =>
      expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(rotatedOfferHandle)
    )
  })

  it("cancels a download ticket that resolves after its login was replaced", async () => {
    mocks.isMac = true
    const ticket = deferred<string | null>()
    mocks.begin.mockReturnValue(ticket.promise)
    const { downloadTaskArtifact, session } = await loadHelper()

    const download = downloadTaskArtifact(artifact)
    await vi.waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce())
    session.beginLoginSession()
    ticket.resolve(handle)

    await expect(download).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.downloadApiFile).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("cancels a preview source that resolves after its login was replaced", async () => {
    mocks.isMac = true
    const source = deferred<string | null>()
    mocks.beginPreview.mockReturnValue(source.promise)
    const { loadTaskArtifactContent, session } = await loadHelper()

    const load = loadTaskArtifactContent(artifact)
    await vi.waitFor(() => expect(mocks.beginPreview).toHaveBeenCalledOnce())
    session.beginLoginSession()
    source.resolve(sourceHandle)

    await expect(load).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(sourceHandle)
    expect(mocks.downloadApiFile).not.toHaveBeenCalled()
  })

  it("drops preview bytes delivered after the loading login was replaced", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    const contentResponse = deferred<Blob>()
    mocks.downloadApiFile.mockReturnValue(contentResponse.promise)
    const { loadTaskArtifactContent, session } = await loadHelper()

    const load = loadTaskArtifactContent(artifact)
    await vi.waitFor(() => expect(mocks.downloadApiFile).toHaveBeenCalledOnce())
    session.beginLoginSession()
    contentResponse.resolve(new Blob(["private-a-bytes"]))

    await expect(load).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(sourceHandle)
  })

  it("stops a completed download from arming or offering after replacement", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    const downloadResponse = deferred<Blob>()
    mocks.downloadApiFile.mockReturnValue(downloadResponse.promise)
    const { downloadTaskArtifact, session } = await loadHelper()

    const download = downloadTaskArtifact(artifact)
    await vi.waitFor(() => expect(mocks.downloadApiFile).toHaveBeenCalledOnce())
    session.beginLoginSession()
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
    downloadResponse.resolve(new Blob(["private-a-bytes"]))

    await expect(download).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
  })

  it("skips the anchor click when logout wins while the ticket is arming", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    const armCall = deferred<void>()
    mocks.arm.mockReturnValue(armCall.promise)
    const { downloadTaskArtifact, session } = await loadHelper()

    const download = downloadTaskArtifact(artifact)
    await vi.waitFor(() => expect(mocks.arm).toHaveBeenCalledOnce())
    session.beginLoginSession()
    armCall.resolve()

    await expect(download).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(
      mocks.revokeObjectURL.mock.calls.filter(
        ([url]) => url === "blob:mygo://localhost/saved"
      )
    ).toEqual([["blob:mygo://localhost/saved"]])
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
  })

  it("does not cancel twice when arming fails after its login was replaced", async () => {
    mocks.isMac = true
    mocks.begin.mockResolvedValue(handle)
    const armCall = deferred<void>()
    mocks.arm.mockReturnValue(armCall.promise)
    const { downloadTaskArtifact, session } = await loadHelper()

    const download = downloadTaskArtifact(artifact)
    await vi.waitFor(() => expect(mocks.arm).toHaveBeenCalledOnce())
    // The login listener owns the release while the arm is still in flight.
    session.beginLoginSession()
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
    armCall.reject(new Error("DESKTOP_DOWNLOAD_STALE"))

    await expect(download).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(handle)
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("never clicks a ticket that age cleanup released during a deferred arm", async () => {
    mocks.isMac = true
    const realNow = Date.now.bind(Date)
    let clockOffset = 0
    const now = vi
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() + clockOffset)
    mocks.begin
      .mockResolvedValueOnce(firstSaveHandle)
      .mockResolvedValueOnce(secondHandle)
    const armCall = deferred<void>()
    mocks.arm.mockReturnValueOnce(armCall.promise)
    mocks.downloadApiFile
      .mockResolvedValueOnce(new Blob(["first bytes"]))
      .mockRejectedValueOnce(new Error("ARTIFACT_NOT_FOUND"))
    const { downloadTaskArtifact } = await loadHelper()

    const first = downloadTaskArtifact(artifact)
    await vi.waitFor(() => expect(mocks.arm).toHaveBeenCalledOnce())
    expect(mocks.cancel).not.toHaveBeenCalled()

    // A later save, more than the pending lifetime later, prunes the first
    // ticket while its arm is still deferred. The login is unchanged.
    clockOffset = 15 * 60 * 1000 + 1
    await expect(downloadTaskArtifact(artifact)).rejects.toThrow(
      "ARTIFACT_NOT_FOUND"
    )
    expect(mocks.cancel).toHaveBeenCalledWith(firstSaveHandle)
    now.mockRestore()

    armCall.resolve()
    await expect(first).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    const firstUrl = "blob:mygo://localhost/saved"
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(
      mocks.revokeObjectURL.mock.calls.filter(([url]) => url === firstUrl)
    ).toEqual([[firstUrl]])
    expect(
      mocks.cancel.mock.calls.filter(([ticket]) => ticket === firstSaveHandle)
    ).toEqual([[firstSaveHandle]])
  })

  it("frees an overflow-evicted live ticket when its fetch later fails", async () => {
    mocks.isMac = true
    const pending: ReturnType<typeof deferred<Blob>>[] = []
    mocks.downloadApiFile.mockImplementation(() => {
      const response = deferred<Blob>()
      pending.push(response)
      return response.promise
    })
    const handles: string[] = []
    mocks.begin.mockImplementation(async () => {
      const ticket = String(handles.length).padStart(43, "0")
      handles.push(ticket)
      return ticket
    })
    const { downloadTaskArtifact } = await loadHelper()

    // Two more than the tracked maximum leave the two oldest live tickets
    // evicted without cancelling them.
    const downloads = Array.from({ length: 66 }, () =>
      downloadTaskArtifact(artifact)
    )
    await vi.waitFor(() =>
      expect(mocks.downloadApiFile).toHaveBeenCalledTimes(66)
    )

    pending[0]?.reject(new Error("ARTIFACT_NOT_FOUND"))
    await expect(downloads[0]).rejects.toThrow("ARTIFACT_NOT_FOUND")
    expect(mocks.cancel.mock.calls).toEqual([[handles[0]]])

    for (const response of pending.slice(1)) {
      response.reject(new Error("ARTIFACT_NOT_FOUND"))
    }
    await Promise.allSettled(downloads.slice(1))
    expect(mocks.cancel).toHaveBeenCalledTimes(66)
    expect(new Set(mocks.cancel.mock.calls.map(([ticket]) => ticket)).size).toBe(
      66
    )
  })

  it("releases an overflow-evicted ticket whose fetch settles after its login was replaced", async () => {
    mocks.isMac = true
    const pending: ReturnType<typeof deferred<Blob>>[] = []
    mocks.downloadApiFile.mockImplementation(() => {
      const response = deferred<Blob>()
      pending.push(response)
      return response.promise
    })
    const handles: string[] = []
    mocks.begin.mockImplementation(async () => {
      const ticket = String(handles.length).padStart(43, "0")
      handles.push(ticket)
      return ticket
    })
    const { downloadTaskArtifact, session } = await loadHelper()

    const downloads = Array.from({ length: 66 }, () =>
      downloadTaskArtifact(artifact)
    )
    await vi.waitFor(() =>
      expect(mocks.downloadApiFile).toHaveBeenCalledTimes(66)
    )
    // The two oldest tickets leave the bounded map without being cancelled.
    expect(handles).toHaveLength(66)
    expect(mocks.cancel).not.toHaveBeenCalled()

    session.beginLoginSession()
    // Before any evicted fetch settles, the replacement releases exactly the 64
    // tracked records and neither of the two earliest handles.
    const releasedAtLogin = mocks.cancel.mock.calls.map(([ticket]) => ticket)
    expect(releasedAtLogin).toHaveLength(64)
    expect(releasedAtLogin).toEqual(handles.slice(2))
    expect(releasedAtLogin).not.toContain(handles[0])
    expect(releasedAtLogin).not.toContain(handles[1])

    pending[0]?.resolve(new Blob(["private-a-bytes"]))
    pending[1]?.resolve(new Blob(["private-a-bytes"]))
    await expect(downloads[0]).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    await expect(downloads[1]).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    // Each evicted ticket is freed exactly once by its own stale guard.
    for (const evicted of handles.slice(0, 2)) {
      expect(
        mocks.cancel.mock.calls.filter(([ticket]) => ticket === evicted)
      ).toEqual([[evicted]])
    }

    for (const response of pending.slice(2)) {
      response.resolve(new Blob(["private-a-bytes"]))
    }
    await Promise.allSettled(downloads)
    expect(mocks.cancel).toHaveBeenCalledTimes(66)
    expect(new Set(mocks.cancel.mock.calls.map(([ticket]) => ticket)).size).toBe(
      66
    )
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.reveal).not.toHaveBeenCalled()
  })

  it("refuses a save ticket derived from an earlier login's preview", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    const { loadTaskArtifactContent, saveTaskArtifactBlob, session } =
      await loadHelper()
    const content = await loadTaskArtifactContent(artifact)
    session.beginLoginSession()

    await expect(
      saveTaskArtifactBlob(
        new Blob([new Uint8Array(content)]),
        "preview.txt",
        content
      )
    ).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(sourceHandle)
  })

  it("cancels a derived save ticket that resolves after its login was replaced", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    const { loadTaskArtifactContent, saveTaskArtifactBlob, session } =
      await loadHelper()
    const content = await loadTaskArtifactContent(artifact)
    const ticket = deferred<string | null>()
    mocks.begin.mockReturnValue(ticket.promise)

    const save = saveTaskArtifactBlob(
      new Blob([new Uint8Array(content)]),
      "preview.txt",
      content
    )
    await vi.waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce())
    session.beginLoginSession()
    ticket.resolve(firstSaveHandle)

    await expect(save).rejects.toThrow("DESKTOP_DOWNLOAD_STALE")
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(firstSaveHandle)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.arm).not.toHaveBeenCalled()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
  })

  it("keeps a ticket that starts through an ordinary access-token rotation", async () => {
    mocks.isMac = true
    const ticket = deferred<string | null>()
    mocks.begin.mockReturnValue(ticket.promise)
    const { downloadTaskArtifact, session } = await loadHelper()

    const download = downloadTaskArtifact(artifact)
    await vi.waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce())
    session.setAccessToken("rotated-access-token", Date.now() + 60 * 60 * 1000)
    ticket.resolve(handle)

    await expect(download).resolves.toBeUndefined()
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.downloadApiFile).toHaveBeenCalledOnce()
    expect(mocks.arm).toHaveBeenCalledWith(
      handle,
      "blob:mygo://localhost/saved"
    )
    expect(mocks.downloadUrl).toHaveBeenCalledWith(
      "blob:mygo://localhost/saved",
      "report.txt"
    )
  })

  it("keeps same-byte preview saves through an ordinary access-token rotation", async () => {
    mocks.isMac = true
    mocks.beginPreview.mockResolvedValue(sourceHandle)
    mocks.begin
      .mockResolvedValueOnce(firstSaveHandle)
      .mockResolvedValueOnce(secondSaveHandle)
    const { loadTaskArtifactContent, saveTaskArtifactBlob, session } =
      await loadHelper()
    const content = await loadTaskArtifactContent(artifact)

    await saveTaskArtifactBlob(
      new Blob([new Uint8Array(content)]),
      "preview.txt",
      content
    )
    session.setAccessToken("rotated-access-token", Date.now() + 60 * 60 * 1000)
    await saveTaskArtifactBlob(
      new Blob([new Uint8Array(content)]),
      "preview.txt",
      content
    )

    expect(mocks.begin).toHaveBeenNthCalledWith(1, sourceHandle)
    expect(mocks.begin).toHaveBeenNthCalledWith(2, sourceHandle)
    expect(mocks.downloadUrl).toHaveBeenCalledTimes(2)
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it("authors every supported locale with the same keys and interpolation", () => {
    const sourceKeys = Object.keys(taskArtifactDownloadMessages["zh-CN"]).sort()
    for (const locale of supportedLocales) {
      const messages = taskArtifactDownloadMessages[locale]
      expect(Object.keys(messages).sort()).toEqual(sourceKeys)
      expect(messages.showInFinder.trim()).not.toBe("")
      expect(messages.revealFailed.trim()).not.toBe("")
      expect(messages.saved).toContain("{{name}}")
    }
  })
})
