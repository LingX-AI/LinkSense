import { afterEach, expect, it, vi } from "vitest"
import { browserExtensionRequest } from "./bridge"
afterEach(() => vi.useRealTimers())
it("ignores spoofed messages from other origins and accepts only the matching request", async () => {
  vi.useFakeTimers()
  const send = vi.spyOn(window, "postMessage")
  const response = browserExtensionRequest("detect")
  const outgoing = send.mock.calls[0]?.[0] as { id: string }
  const data = {
    source: "linksense-extension",
    id: outgoing.id,
    result: { detected: true },
  }
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      origin: "https://untrusted.test",
      data,
    })
  )
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      origin: location.origin,
      data: { ...data, id: "wrong" },
    })
  )
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      origin: location.origin,
      data,
    })
  )
  await expect(response).resolves.toEqual({ detected: true })
  send.mockRestore()
})
