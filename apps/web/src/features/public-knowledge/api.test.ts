import { afterEach, describe, expect, it, vi } from "vitest"
import { setAccessToken } from "@/api/session"
import { PublicKnowledgeClient } from "./api"

const publicId = "public-knowledge-application-1234",
  conversationId = "00000000-0000-4000-8000-000000000001"
afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})
describe("anonymous public knowledge client", () => {
  it("uses only the visitor capability and never sends the signed-in session or cookies", async () => {
    setAccessToken("signed-in-owner-credential")
    const fetcher = vi.fn(async () =>
      Response.json({ success: true, data: { items: [], next_cursor: null } })
    )
    vi.stubGlobal("fetch", fetcher)
    await new PublicKnowledgeClient(
      publicId,
      "anonymous-visitor-credential"
    ).list()
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(`/public-knowledge/${publicId}/conversations`),
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        headers: { authorization: "Bearer anonymous-visitor-credential" },
      })
    )
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
      "signed-in-owner-credential"
    )
  })
  it("does not automatically replay a failed model turn", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { success: false, error_code: "RUNNER_UNAVAILABLE" },
        { status: 503 }
      )
    )
    vi.stubGlobal("fetch", fetcher)
    await expect(
      new PublicKnowledgeClient(publicId, "visitor").ask(
        conversationId,
        "Question",
        conversationId
      )
    ).rejects.toMatchObject({ status: 503, errorCode: "RUNNER_UNAVAILABLE" })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it("requests a new anonymous capability without forwarding an old visitor token", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          token: "a".repeat(64),
          visitor_id: conversationId,
          expires_at: "2026-12-01T00:00:00Z",
        },
      })
    )
    vi.stubGlobal("fetch", fetcher)
    await new PublicKnowledgeClient(publicId).start("https://website.example")
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: "https://website.example" }),
      })
    )
  })
})
