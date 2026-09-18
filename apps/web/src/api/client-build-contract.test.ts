import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const oldBuild = "a".repeat(64)
const newBuild = "b".repeat(64)
let client: typeof import("./client")

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv("VITE_LINKSENSE_BUILD_ID", oldBuild)
  client = await import("./client")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("requests from a page opened before deployment", () => {
  it.each(["stream", "download"])(
    "checks the %s response build before using its contents",
    async (kind) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("new build response", {
          headers: { "x-linksense-build": newBuild },
        })
      )
      vi.stubGlobal("fetch", fetchMock)
      const result =
        kind === "stream"
          ? client.apiStreamRequest("/events", { method: "POST", body: {} })
          : client.downloadApiFile("/files/file")
      await expect(result).rejects.toMatchObject({
        errorCode: "CLIENT_UPDATE_REQUIRED",
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(
        fetchMock.mock.calls[0]?.[1].headers.get("x-linksense-client-build")
      ).toBe(oldBuild)
    }
  )

  it.each(["conversation", "knowledge", "citation"])(
    "stops a %s event connector when the server build changes",
    async (kind) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response("", {
          status: 409,
          headers: { "x-linksense-build": newBuild },
        })
      )
      vi.stubGlobal("fetch", fetchMock)
      const onEvent = vi.fn()
      const stop =
        kind === "conversation"
          ? (await import("./sse")).connectConversationEvents("test", {
              onEvent,
            })
          : kind === "knowledge"
            ? (
                await import("@/features/knowledge-bases/knowledge-base-events")
              ).connectKnowledgeBaseEvents("test", { onEvent })
            : (
                await import("@/features/knowledge-bases/knowledge-citation-events")
              ).connectKnowledgeCitationEvents("test", {
                onSourceChanged: onEvent,
                shouldReconnect: () => true,
              })
      try {
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
        await Promise.resolve()
        await vi.waitFor(() =>
          expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true)
        )
        expect(
          (await import("@/app/client-build")).getPendingClientBuild()
        ).toBe(newBuild)
        expect(onEvent).not.toHaveBeenCalled()
      } finally {
        stop()
      }
    }
  )

  it.each(["general", "knowledge"])(
    "checks the %s upload build before schema parsing and never replays it",
    async (kind) => {
      const sent = vi.fn()
      const requestHeaders = new Map<string, string>()
      class Upload extends EventTarget {
        upload = new EventTarget()
        responseType = ""
        response = { success: true, data: { new_shape: true } }
        status = 200
        withCredentials = false
        open() {}
        setRequestHeader(name: string, value: string) {
          requestHeaders.set(name.toLowerCase(), value)
        }
        getResponseHeader(name: string) {
          return name.toLowerCase() === "x-linksense-build" ? newBuild : null
        }
        send() {
          sent()
          this.dispatchEvent(new Event("load"))
        }
        abort() {
          this.dispatchEvent(new Event("abort"))
        }
      }
      vi.stubGlobal("XMLHttpRequest", Upload)
      const result =
        kind === "general"
          ? client.apiUploadRequest("/capabilities", {
              body: new FormData(),
              schema: z.strictObject({ name: z.string() }),
            })
          : (
              await import("@/features/knowledge-bases/knowledge-base-api")
            ).uploadKnowledgeDocument({
              knowledgeBaseId: "test",
              file: new File(["content"], "document.txt"),
            })
      await expect(result).rejects.toMatchObject({
        errorCode: "CLIENT_UPDATE_REQUIRED",
      })
      expect(sent).toHaveBeenCalledTimes(1)
      expect(requestHeaders.get("x-linksense-client-build")).toBe(oldBuild)
    }
  )
  it("identifies the new server before applying the old response schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: true,
          data: { name: "Application", added_after_deployment: true },
        },
        { headers: { "x-linksense-build": newBuild } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      client.apiRequest("/applications", {
        schema: z.strictObject({ name: z.string() }),
      })
    ).rejects.toMatchObject({ errorCode: "CLIENT_UPDATE_REQUIRED" })
    expect(
      fetchMock.mock.calls[0]?.[1].headers.get("x-linksense-client-build")
    ).toBe(oldBuild)
    expect(fetchMock.mock.calls[0]?.[1].cache).toBe("no-store")
  })

  it("keeps same-build contract errors visible instead of treating them as updates", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { success: true, data: { name: 123 } },
            { headers: { "x-linksense-build": oldBuild } }
          )
        )
    )
    await expect(
      client.apiRequest("/applications", {
        schema: z.strictObject({ name: z.string() }),
      })
    ).rejects.toMatchObject({ errorCode: "API_RESPONSE_INVALID" })
  })

  it("does not replay writes or send later writes after detecting an update", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { success: false, error_code: "CLIENT_UPDATE_REQUIRED" },
          { status: 409, headers: { "x-linksense-build": newBuild } }
        )
      )
    vi.stubGlobal("fetch", fetchMock)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        client.apiRequest("/applications", {
          method: "POST",
          body: { name: "Draft" },
          schema: z.unknown(),
        })
      ).rejects.toMatchObject({ errorCode: "CLIENT_UPDATE_REQUIRED" })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("classifies an HTML maintenance response separately from invalid business data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Maintenance</html>", {
          status: 503,
          headers: { "content-type": "text/html" },
        })
      )
    )
    await expect(
      client.apiRequest("/applications", { schema: z.unknown() })
    ).rejects.toMatchObject({ errorCode: "SERVICE_TEMPORARILY_UNAVAILABLE" })
  })
})
