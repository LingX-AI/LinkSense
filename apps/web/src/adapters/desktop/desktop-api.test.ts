import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const native = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("mygo-runtime", () => ({ isMyGo: () => true }))
vi.mock("@mygo-plugins/fetch", () => ({ fetch: native.request }))
vi.mock("./mygo", () => ({
  Desktop: {
    info: async () => ({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    }),
  },
}))

import { initializeDesktopHost } from "./desktop-adapter"
import { apiRequest, buildApiUrl } from "@/api/client"
import { getStoredAccessSession, setAccessToken } from "@/api/session"
import { uploadKnowledgeDocument } from "@/features/knowledge-bases/knowledge-base-api"
import { buildHtmlPreviewShellSource } from "@/components/media/html-preview/html-preview-shell"

describe("desktop API integration", () => {
  beforeEach(async () => {
    await initializeDesktopHost()
    native.request.mockReset()
    localStorage.clear()
    setAccessToken(null)
  })

  afterEach(() => {
    setAccessToken(null)
  })

  it("uses the selected server and keeps access credentials out of Web storage", () => {
    expect(buildApiUrl("/me")).toBe("https://example.com/api/v1/me")
    setAccessToken("desktop-access-token", Date.now() + 60_000)
    expect(getStoredAccessSession()?.accessToken).toBe("desktop-access-token")
    expect(localStorage.getItem("linksense.auth.access-session")).toBeNull()
  })

  it("loads signed HTML preview resources from the server and keeps the bundled shell local", () => {
    expect(buildHtmlPreviewShellSource("preview", 0, "/html-preview/session/index.html"))
      .toBe("https://example.com/html-preview/session/index.html?previewId=preview&attempt=0")
    expect(buildHtmlPreviewShellSource("preview", 0))
      .toBe("/assistant-html-preview-shell.html?previewId=preview&attempt=0")
  })

  it("accepts a compatible desktop API even when the embedded Web build differs", async () => {
    native.request.mockResolvedValue(
      Response.json(
        { success: true, data: "ready" },
        {
          headers: {
            "x-linksense-desktop-protocol": "1",
            "x-linksense-build": "b".repeat(64),
          },
        }
      )
    )
    await expect(
      apiRequest("/system/bootstrap", { schema: z.string() })
    ).resolves.toBe("ready")
    const headers: Headers = native.request.mock.calls[0][1].headers
    expect(headers.get("x-linksense-desktop-protocol")).toBe("1")
    expect(headers.get("x-linksense-client-build")).toBe("0".repeat(64))
  })

  it.each([undefined, "2"])(
    "rejects an API without a compatible desktop handshake (%s)",
    async (protocol) => {
      native.request.mockResolvedValue(
        Response.json(
          { success: true, data: "ready" },
          {
            headers: protocol
              ? { "x-linksense-desktop-protocol": protocol }
              : {},
          }
        )
      )
      await expect(
        apiRequest("/system/bootstrap", { schema: z.string() })
      ).rejects.toMatchObject({ errorCode: "DESKTOP_UPDATE_REQUIRED" })
      expect(native.request).toHaveBeenCalledOnce()
    }
  )

  it.each(["conversation", "knowledge", "citation"])(
    "stops a %s stream after an incompatible server handshake",
    async (kind) => {
      native.request.mockResolvedValue(new Response("", {
        status: 409,
        headers: { "x-linksense-desktop-protocol": "2" },
      }))
      const stop = kind === "conversation"
        ? (await import("@/api/sse")).connectConversationEvents("test", { onEvent: vi.fn() })
        : kind === "knowledge"
          ? (await import("@/features/knowledge-bases/knowledge-base-events")).connectKnowledgeBaseEvents("test", { onEvent: vi.fn() })
          : (await import("@/features/knowledge-bases/knowledge-citation-events")).connectKnowledgeCitationEvents("test", {
              onSourceChanged: vi.fn(), shouldReconnect: () => true,
            })
      try {
        await vi.waitFor(() => expect(native.request).toHaveBeenCalledOnce())
        const signal: AbortSignal = native.request.mock.calls[0][1].signal
        await vi.waitFor(() => expect(signal.aborted).toBe(true))
        expect(native.request).toHaveBeenCalledOnce()
      } finally {
        stop()
      }
    }
  )

  it("cancels an in-progress knowledge upload through the native transport", async () => {
    native.request.mockImplementation(
      (_input: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true }
          )
        })
    )
    const controller = new AbortController()
    const upload = uploadKnowledgeDocument({
      knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
      file: new File(["document"], "manual.txt", { type: "text/plain" }),
      signal: controller.signal,
    })
    const aborted = expect(upload).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(native.request).toHaveBeenCalledOnce())
    controller.abort()
    await aborted
    expect(native.request).toHaveBeenCalledOnce()
  })
})
