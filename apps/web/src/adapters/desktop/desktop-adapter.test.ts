import { afterEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  isDesktop: false,
  info: vi.fn(),
  request: vi.fn(),
  openExternal: vi.fn(),
}))
vi.mock("mygo-runtime", () => ({ isMyGo: () => native.isDesktop }))
vi.mock("@mygo-plugins/fetch", () => ({ fetch: native.request }))
vi.mock("./mygo", () => ({
  Desktop: { info: native.info, openExternal: native.openExternal },
}))

import {
  getDesktopPlatform,
  getDesktopServerUrl,
  hostFetch,
  initializeDesktopHost,
  openDesktopExternal,
} from "./desktop-adapter"

describe("desktop host boundary", () => {
  afterEach(() => {
    native.isDesktop = false
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset.desktopPlatform
  })

  it("keeps the existing browser transport and does not call native services", async () => {
    const browserFetch = vi.fn().mockResolvedValue(new Response("{}"))
    vi.stubGlobal("fetch", browserFetch)
    await initializeDesktopHost()
    expect(getDesktopServerUrl()).toBeNull()
    expect(getDesktopPlatform()).toBeNull()
    await hostFetch("/api/v1/me")
    expect(browserFetch).toHaveBeenCalledWith("/api/v1/me", undefined)
    expect(native.info).not.toHaveBeenCalled()
    expect(native.request).not.toHaveBeenCalled()
  })

  it("validates the bridge and uses the configured server and native transport", async () => {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: "https://example.com",
      platform: "darwin",
      version: "0.1.0",
    })
    await initializeDesktopHost()
    expect(getDesktopServerUrl()).toBe("https://example.com")
    expect(getDesktopPlatform()).toBe("darwin")
    expect(document.documentElement.dataset.desktopPlatform).toBe("darwin")
    const controller = new AbortController()
    native.request.mockResolvedValue(new Response("{}"))
    await hostFetch("https://example.com/api/v1/me", {
      signal: controller.signal,
    })
    expect(native.request).toHaveBeenCalledWith(
      "https://example.com/api/v1/me",
      { signal: controller.signal }
    )
    await openDesktopExternal("https://example.com")
    expect(native.openExternal).toHaveBeenCalledWith("https://example.com")
  })

  it("rejects an unsupported bridge rather than making an API request", async () => {
    native.isDesktop = true
    native.info.mockResolvedValue({
      bridgeVersion: 2,
      serverUrl: "https://example.com",
      platform: "windows",
      version: "0.2.0",
    })
    await expect(initializeDesktopHost()).rejects.toThrow()
    expect(native.request).not.toHaveBeenCalled()
  })
})
