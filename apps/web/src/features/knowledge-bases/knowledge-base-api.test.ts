import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  downloadKnowledgeDocument,
  getKnowledgeBaseCreationCapability,
  loadKnowledgeDocumentPreview,
  listKnowledgeBaseEntries,
  rebuildKnowledgeDocuments,
  uploadKnowledgeDocument,
} from "@/features/knowledge-bases/knowledge-base-api"
import {
  beginLoginSession,
  getAccessToken,
  setAccessToken,
} from "@/api/session"
import { getPendingClientBuild } from "@/app/client-build"

const apiRequest = vi.hoisted(() => vi.fn())
const downloadApiFile = vi.hoisted(() => vi.fn())

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest,
  downloadApiFile,
}))

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000002"
const documentVersionId = "00000000-0000-4000-8000-000000000003"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setAccessToken(null)
  restoreWebLocks()
})

describe("knowledge-base creation capability API", () => {
  it("requests a fresh server-side probe when the user retries", async () => {
    apiRequest.mockReset().mockResolvedValue({ status: "ready" })
    const controller = new AbortController()

    await getKnowledgeBaseCreationCapability({
      refresh: true,
      signal: controller.signal,
    })

    expect(apiRequest).toHaveBeenCalledWith(
      "/knowledge-bases/creation-capability",
      expect.objectContaining({
        query: { refresh: "true" },
        signal: controller.signal,
      })
    )
  })
})

describe("knowledge-base document upload API", () => {
  it("does not resend an upload once the account changes", async () => {
    const send = vi.fn()
    class ExpiredUploadRequest extends EventTarget {
      responseType = ""
      readonly status = 401
      readonly response = {
        success: false,
        error_code: "AUTH_SESSION_EXPIRED",
      }
      readonly upload = new EventTarget()

      open() {}
      setRequestHeader() {}
      send() {
        send()
        queueMicrotask(() => {
          if (send.mock.calls.length === 1) setAccessToken("new-account-token")
          this.dispatchEvent(new Event("load"))
        })
      }
    }

    setAccessToken("old-account-token")
    vi.stubGlobal("XMLHttpRequest", ExpiredUploadRequest)
    try {
      await expect(
        uploadKnowledgeDocument({
          knowledgeBaseId,
          file: new File(["manual"], "manual.txt", { type: "text/plain" }),
        })
      ).rejects.toMatchObject({ name: "AbortError" })
      expect(send).toHaveBeenCalledOnce()
      expect(getAccessToken()).toBe("new-account-token")
    } finally {
      setAccessToken(null)
    }
  })

  it("parses the accepted document inside the success envelope", async () => {
    let sentBody: Document | XMLHttpRequestBodyInit | null | undefined
    const document = acceptedDocument()

    class SuccessfulUploadRequest {
      responseType = ""
      readonly status = 202
      readonly response = { success: true, data: document, request_id: "req-1" }
      readonly upload = new EventTarget()
      private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
      >()

      open() {}
      setRequestHeader() {}
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null
      ) {
        if (listener === null) return
        const listeners = this.listeners.get(type) ?? new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
      }
      send(body?: Document | XMLHttpRequestBodyInit | null) {
        sentBody = body
        queueMicrotask(() => this.dispatch("load"))
      }
      abort() {
        this.dispatch("abort")
      }
      private dispatch(type: string) {
        const event = new Event(type)
        for (const listener of this.listeners.get(type) ?? []) {
          if (typeof listener === "function") listener(event)
          else listener.handleEvent(event)
        }
      }
    }

    vi.stubGlobal("XMLHttpRequest", SuccessfulUploadRequest)

    await expect(
      uploadKnowledgeDocument({
        knowledgeBaseId,
        file: new File(["manual"], "manual.txt", { type: "text/plain" }),
        relativePath: "Policies/HR/manual.txt",
        parentEntryId: documentVersionId,
        conflictResolution: "replace_path",
      })
    ).resolves.toEqual({ status: "accepted", document })
    expect(sentBody).toBeInstanceOf(FormData)
    expect((sentBody as FormData).get("ocr_enabled")).toBe("false")
    expect((sentBody as FormData).get("relative_path")).toBe(
      "Policies/HR/manual.txt"
    )
    expect((sentBody as FormData).get("parent_entry_id")).toBe(
      documentVersionId
    )
    expect((sentBody as FormData).get("conflict_resolution")).toBe(
      "replace_path"
    )
  })
})

describe("knowledge-base upload session boundary", () => {
  const existingDocument = { id: documentId, display_name: "manual.txt" }

  it("does not refresh, retry, or prompt a replacement login when an abandoned upload's 401 arrives after sign-in", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    const fetchMock = vi.fn(() =>
      Promise.resolve(authSessionResponse("account-a-refreshed".padEnd(48, "x")))
    )
    vi.stubGlobal("fetch", fetchMock)
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.setAutoResponder((request) =>
      request.respond({
        status: 409,
        body: {
          success: false,
          error_code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
          params: { existing_document_id: documentId },
        },
      })
    )

    // The upload was sent for login A. Its 401 settles only after the
    // replacement login B owns the session.
    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    uploads.requests[0]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(uploads.requests).toHaveLength(1)
    expect(uploads.requests.map((request) => request.authorization())).toEqual([
      `Bearer ${accountAToken}`,
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(accountBToken)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("does not retry or surface the initial 401 when its refresh settles after a replacement login", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const rotatedAToken = "account-a-rotated-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    let resolveRefresh!: (response: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const fetchMock = vi.fn(() => refreshResponse)
    vi.stubGlobal("fetch", fetchMock)
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // A's refresh is already in flight. It settles only after B owns the
    // session, so neither A's 401 nor its refresh may reach the replacement.
    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    resolveRefresh(authSessionResponse(rotatedAToken))

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(uploads.requests).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe(accountBToken)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("retries once with the same login's rotated token and preserves conflict resolution", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const rotatedAToken = "account-a-rotated-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(authSessionResponse(rotatedAToken)))
    )
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })

    await vi.waitFor(() => expect(uploads.requests).toHaveLength(2))
    expect(uploads.requests[1]?.authorization()).toBe(`Bearer ${rotatedAToken}`)
    uploads.requests[1]?.respond({
      status: 409,
      body: {
        success: false,
        error_code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
        params: { existing_document_id: documentId },
      },
    })

    await expect(upload).resolves.toEqual({
      status: "duplicate",
      existing_document: existingDocument,
    })
    expect(apiRequest).toHaveBeenCalledWith(
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
      expect.objectContaining({ signal: undefined })
    )
  })

  it("clears the session when a same-login refresh is definitively rejected", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(authFailureResponse()))
    )
    installImmediateWebLock()

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })

    await expect(upload).resolves.toMatchObject({
      status: 401,
      errorCode: "AUTH_SESSION_EXPIRED",
    })
    expect(uploads.requests).toHaveLength(1)
    expect(getAccessToken()).toBeNull()
  })

  it("does not look up a conflict that arrives from a previous login after sign-in", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))

    // The duplicate conflict was produced for login A. Its response settles
    // only after the replacement login B owns the session.
    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    uploads.requests[0]?.respond({
      status: 409,
      body: {
        success: false,
        error_code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
        params: { existing_document_id: documentId },
      },
    })

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(apiRequest).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(accountBToken)
    expect(uploads.requests).toHaveLength(1)
  })

  it("does not present an upload accepted for a previous login after sign-in", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))

    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    uploads.requests[0]?.respond({
      status: 202,
      body: { success: true, data: acceptedDocument() },
    })

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(getAccessToken()).toBe(accountBToken)
  })

  it("does not look up a retry conflict that arrives from a previous login after sign-in", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const rotatedAToken = "account-a-rotated-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(authSessionResponse(rotatedAToken)))
    )
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(2))
    expect(uploads.requests[1]?.authorization()).toBe(`Bearer ${rotatedAToken}`)

    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    uploads.requests[1]?.respond({
      status: 409,
      body: {
        success: false,
        error_code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
        params: { existing_document_id: documentId },
      },
    })

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(apiRequest).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(accountBToken)
    expect(uploads.requests.map((request) => request.authorization())).toEqual([
      `Bearer ${accountAToken}`,
      `Bearer ${rotatedAToken}`,
    ])
  })

  it("does not replay or surface a late retry 401 after a replacement login", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const rotatedAToken = "account-a-rotated-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    const fetchMock = vi.fn(() =>
      Promise.resolve(authSessionResponse(rotatedAToken))
    )
    vi.stubGlobal("fetch", fetchMock)
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(2))
    expect(uploads.requests[1]?.authorization()).toBe(`Bearer ${rotatedAToken}`)

    // The retry was sent for A's rotated token. Its definitive 401 settles
    // only after B owns the session and must not be presented to B.
    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    uploads.requests[1]?.respond({
      status: 401,
      body: { success: false, error_code: "AUTH_SESSION_EXPIRED" },
    })

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(uploads.requests).toHaveLength(2)
    expect(uploads.requests.map((request) => request.authorization())).toEqual([
      `Bearer ${accountAToken}`,
      `Bearer ${rotatedAToken}`,
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe(accountBToken)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("does not surface a conflict lookup failure that settles after a replacement login", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    installImmediateWebLock()
    let rejectLookup!: (error: unknown) => void
    const lookup = new Promise<never>((_resolve, reject) => {
      rejectLookup = reject
    })
    apiRequest.mockReset().mockReturnValue(lookup)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 409,
      body: {
        success: false,
        error_code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
        params: { existing_document_id: documentId },
      },
    })
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
    expect(apiRequest).toHaveBeenCalledWith(
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
      expect.objectContaining({ signal: undefined })
    )

    // The conflict GET started for A and rejects only after B owns the
    // session. Its failure belongs to A, not the replacement login.
    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    rejectLookup(new Error("document lookup failed"))

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(uploads.requests).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(accountBToken)
  })

  it("keeps a conflict lookup failure when the same login still owns the session", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    const lookupError = new Error("document lookup failed")
    apiRequest.mockReset().mockRejectedValue(lookupError)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 409,
      body: {
        success: false,
        error_code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
        params: { existing_document_id: documentId },
      },
    })

    await expect(upload).resolves.toBe(lookupError)
    expect(uploads.requests).toHaveLength(1)
    expect(getAccessToken()).toBe(accountAToken)
  })

  it("resolves a conflict through the current login's document lookup", async () => {
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    installImmediateWebLock()
    apiRequest.mockReset().mockResolvedValue(existingDocument)

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
    })
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))
    uploads.requests[0]?.respond({
      status: 409,
      body: {
        success: false,
        error_code: "KNOWLEDGE_DOCUMENT_NAME_CONFLICT",
        params: { existing_document_id: documentId },
      },
    })

    await expect(upload).resolves.toEqual({
      status: "name_conflict",
      existing_document: existingDocument,
    })
    expect(apiRequest).toHaveBeenCalledWith(
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
      expect.objectContaining({ signal: undefined })
    )
  })
})

describe("knowledge-base upload build responses across login changes", () => {
  it("does not apply a previous login's delayed browser upload build response to the replacement login", async () => {
    const oldBuild = "a".repeat(64)
    const newBuild = "b".repeat(64)
    const accountAToken = "account-a-access-token".padEnd(48, "x")
    const accountBToken = "account-b-access-token".padEnd(48, "x")
    vi.stubEnv("VITE_LINKSENSE_BUILD_ID", oldBuild)
    setAccessToken(accountAToken, Date.now() + 60_000)
    const uploads = installDeferredUploads()
    const onProgress = vi.fn()

    const upload = uploadKnowledgeDocument({
      knowledgeBaseId,
      file: new File(["manual"], "manual.txt", { type: "text/plain" }),
      onProgress,
    }).then(
      (value) => value,
      (error: unknown) => error
    )
    await vi.waitFor(() => expect(uploads.requests).toHaveLength(1))

    // Account A's upload progress and Web build headers arrive only after the
    // replacement login B owns the session.
    beginLoginSession()
    setAccessToken(accountBToken, Date.now() + 60_000)
    uploads.requests[0]?.progress()
    uploads.requests[0]?.respond({
      status: 202,
      body: { success: true, data: acceptedDocument() },
      build: newBuild,
    })

    const result = await upload
    expect(result).toMatchObject({ name: "AbortError" })
    expect(onProgress).not.toHaveBeenCalled()
    expect(getPendingClientBuild()).toBeNull()
    expect(getAccessToken()).toBe(accountBToken)
  })

})

describe("knowledge-base original file API", () => {
  beforeEach(() => {
    apiRequest.mockReset()
    downloadApiFile.mockReset()
    downloadApiFile.mockResolvedValue(new Blob())
  })

  it("uses independent inline-preview and attachment-download endpoints", async () => {
    const previewController = new AbortController()
    const downloadController = new AbortController()

    await loadKnowledgeDocumentPreview(
      knowledgeBaseId,
      documentId,
      documentVersionId,
      previewController.signal
    )
    await downloadKnowledgeDocument(
      knowledgeBaseId,
      documentId,
      documentVersionId,
      downloadController.signal
    )

    expect(downloadApiFile).toHaveBeenNthCalledWith(
      1,
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/preview`,
      { document_version_id: documentVersionId },
      previewController.signal
    )
    expect(downloadApiFile).toHaveBeenNthCalledWith(
      2,
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/original`,
      { document_version_id: documentVersionId },
      downloadController.signal
    )
  })
})

describe("knowledge-base entry API", () => {
  beforeEach(() => {
    apiRequest.mockReset().mockResolvedValue({
      breadcrumbs: [],
      items: [],
      next_cursor: null,
    })
  })

  it("requests the recursive flat view explicitly", async () => {
    await listKnowledgeBaseEntries(knowledgeBaseId, { view: "flat" })

    expect(apiRequest).toHaveBeenCalledWith(
      `/knowledge-bases/${knowledgeBaseId}/entries`,
      expect.objectContaining({
        query: {
          parent_entry_id: undefined,
          view: "flat",
          cursor: undefined,
          limit: 100,
        },
      })
    )
  })
})

describe("knowledge-base document rebuild API", () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it("walks rebuild-all keyset pages while retaining only aggregate counts", async () => {
    apiRequest
      .mockResolvedValueOnce({
        items: [{ status: "accepted" }],
        next_cursor: documentVersionId,
      })
      .mockResolvedValueOnce({
        items: [{ status: "rejected" }],
        next_cursor: null,
      })

    await expect(rebuildKnowledgeDocuments(knowledgeBaseId)).resolves.toEqual({
      accepted: 1,
      rejected: 1,
    })
    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      `/knowledge-bases/${knowledgeBaseId}/documents/rebuild`,
      expect.objectContaining({ method: "POST", body: {} })
    )
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      `/knowledge-bases/${knowledgeBaseId}/documents/rebuild`,
      expect.objectContaining({
        method: "POST",
        body: { cursor: documentVersionId },
      })
    )
  })

  it("splits an explicit selection into bounded request batches", async () => {
    const documentIds = Array.from(
      { length: 205 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`
    )
    apiRequest
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, () => ({ status: "accepted" })),
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, () => ({ status: "accepted" })),
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 5 }, () => ({ status: "rejected" })),
        next_cursor: null,
      })

    await expect(
      rebuildKnowledgeDocuments(knowledgeBaseId, documentIds)
    ).resolves.toEqual({ accepted: 200, rejected: 5 })
    expect(apiRequest).toHaveBeenCalledTimes(3)
    for (const [index, expectedSize] of [100, 100, 5].entries()) {
      expect(apiRequest.mock.calls[index]?.[1]).toEqual(
        expect.objectContaining({
          method: "POST",
          body: {
            document_ids: documentIds.slice(
              index * 100,
              index * 100 + expectedSize
            ),
          },
        })
      )
    }
  })
})

function acceptedDocument() {
  return {
    id: documentId,
    knowledge_base_id: knowledgeBaseId,
    display_name: "manual.txt",
    canonical_extension: "txt" as const,
    mime_type: "text/plain",
    size_bytes: 6,
    status: "processing" as const,
    current_version_id: null,
    searchable: false,
    rebuild_required: false,
    processing: {
      operation: "upload" as const,
      processing_generation: documentVersionId,
      stage: "queued" as const,
      progress_percent: 15,
      revision: 1,
      stable_error_code: null,
      retry_at: null,
      retry_attempt: 0,
      cancellable: true,
    },
    candidate_failure: null,
    preview: {
      parsed: true as const,
      original_supported: true,
      renderer: null,
    },
    created_at: "2026-07-23T03:00:00.000Z",
    updated_at: "2026-07-23T03:00:00.000Z",
  }
}

type DeferredUploadOutcome = { status: number; body: unknown; build?: string }
type DeferredUpload = {
  respond(outcome: DeferredUploadOutcome): void
  progress(): void
  authorization(): string | null
}

function installDeferredUploads(): {
  requests: DeferredUpload[]
  setAutoResponder: (responder: (request: DeferredUpload) => void) => void
} {
  const requests: DeferredUpload[] = []
  let autoResponder: ((request: DeferredUpload) => void) | null = null

  class DeferredUploadRequest extends EventTarget implements DeferredUpload {
    responseType: XMLHttpRequestResponseType = ""
    status = 0
    response: unknown = null
    readonly upload = new EventTarget()
    private readonly requestHeaders = new Map<string, string>()
    private responseBuild: string | null = null

    open() {}
    setRequestHeader(name: string, value: string) {
      this.requestHeaders.set(name.toLowerCase(), value)
    }
    getResponseHeader(name: string) {
      return name.toLowerCase() === "x-linksense-build"
        ? this.responseBuild
        : null
    }
    send() {
      requests.push(this)
      autoResponder?.(this)
    }
    abort() {
      this.dispatchEvent(new Event("abort"))
    }
    progress() {
      this.upload.dispatchEvent(
        new ProgressEvent("progress", {
          lengthComputable: true,
          loaded: 5,
          total: 10,
        })
      )
    }
    authorization() {
      return this.requestHeaders.get("authorization") ?? null
    }
    respond(outcome: DeferredUploadOutcome) {
      this.status = outcome.status
      this.response = outcome.body
      this.responseBuild = outcome.build ?? null
      this.dispatchEvent(new Event("load"))
    }
  }

  vi.stubGlobal("XMLHttpRequest", DeferredUploadRequest)
  return {
    requests,
    setAutoResponder(responder) {
      autoResponder = responder
    },
  }
}

function authSessionResponse(accessToken: string) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        access_token: accessToken,
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_session_expires_at: "2099-03-01T00:00:00.000Z",
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "person@example.com",
          name: "Person",
          avatar_object_key: null,
          role: "admin",
          status: "active",
          preferred_locale: "zh-CN",
          running_message_action: "queue",
          last_login_at: "2026-08-31T08:00:00.000Z",
          last_login_method: "password",
          password_updated_at: "2026-08-01T08:00:00.000Z",
          created_at: "2026-08-01T08:00:00.000Z",
          updated_at: "2026-08-31T08:00:00.000Z",
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  )
}

function authFailureResponse() {
  return new Response(
    JSON.stringify({ success: false, error_code: "AUTH_SESSION_EXPIRED" }),
    { status: 401, headers: { "content-type": "application/json" } }
  )
}

function installImmediateWebLock() {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, callback: () => Promise<unknown>) => callback(),
    },
  })
}

function restoreWebLocks() {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  })
}
