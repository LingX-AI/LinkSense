import { afterEach, describe, expect, it, vi } from "vitest"

import { connectKnowledgeBaseEvents } from "@/features/knowledge-bases/knowledge-base-events"

describe("knowledge base event connector", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not reconnect after an authoritative stream termination", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const onConnectionChange = vi.fn()
    const shouldReconnect = vi.fn(() => Promise.resolve(false))

    const disconnect = connectKnowledgeBaseEvents(
      "00000000-0000-4000-8000-000000000001",
      {
        onEvent: vi.fn(),
        onConnectionChange,
        shouldReconnect,
      }
    )

    await vi.waitFor(() => expect(shouldReconnect).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onConnectionChange).toHaveBeenCalledWith("connected")
    expect(onConnectionChange).not.toHaveBeenCalledWith("reconnecting")
    disconnect()
  })
})
