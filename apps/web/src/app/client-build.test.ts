import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"

const oldBuild = "a".repeat(64)
const newBuild = "b".repeat(64)
let build: typeof import("./client-build")
const disposers: Array<() => void> = []

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv("VITE_LINKSENSE_BUILD_ID", oldBuild)
  build = await import("./client-build")
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.history.replaceState(null, "", "/")
})

describe("page build state", () => {
  it("only notifies about validated different builds and keeps the update required across mixed responses", () => {
    const notify = vi.fn()
    disposers.push(build.subscribeToClientBuild(notify))
    for (const value of [null, "latest", oldBuild])
      expect(build.observeServerBuild(value)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(build.observeServerBuild(newBuild)).toBe(true)
    expect(build.observeServerBuild(newBuild)).toBe(true)
    build.observeServerBuild(oldBuild)
    expect(build.getPendingClientBuild()).toBe(newBuild)
    expect(notify).toHaveBeenCalledTimes(1)
    build.observeServerBuild("c".repeat(64))
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it("does not flag development hot reload or missing build identities", () => {
    vi.stubEnv("VITE_LINKSENSE_BUILD_ID", undefined)
    expect(build.observeServerBuild(newBuild)).toBe(false)
    expect(build.getPendingClientBuild()).toBeNull()
  })

  it.each(["vite:preloadError", "focus", "online"])(
    "checks the published manifest on %s without automatically reloading",
    async (eventName) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(Response.json({ build_id: newBuild }))
      vi.stubGlobal("fetch", fetchMock)
      disposers.push(build.installClientBuildListeners())
      window.dispatchEvent(new Event(eventName))
      await waitFor(() => expect(build.getPendingClientBuild()).toBe(newBuild))
      expect(fetchMock).toHaveBeenCalledWith("/build-info.json", {
        cache: "no-store",
        signal: expect.any(AbortSignal),
      })
    }
  )

  it("checks a page restored from back/forward cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ build_id: newBuild }))
    )
    disposers.push(build.installClientBuildListeners())
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true })
    )
    await waitFor(() => expect(build.getPendingClientBuild()).toBe(newBuild))
  })

  it("does not misclassify offline, HTML maintenance, invalid metadata or same-build import failures", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("maintenance", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ build_id: "invalid" }))
      .mockResolvedValueOnce(Response.json({ build_id: oldBuild }))
    vi.stubGlobal("fetch", fetchMock)
    for (let attempt = 0; attempt < 4; attempt += 1)
      await build.checkForPublishedWebUpdate()
    expect(build.getPendingClientBuild()).toBeNull()
  })

  it("preserves the current route, query and fragment and removes the reload marker only after the matching build loads", () => {
    const result = new URL(
      build.clientUpdateUrl(
        "https://example.test/applications?scope=owned#draft",
        newBuild
      )
    )
    expect(result.pathname).toBe("/applications")
    expect(result.searchParams.get("scope")).toBe("owned")
    expect(result.hash).toBe("#draft")
    window.history.replaceState(
      { draft: true },
      "",
      result.pathname + result.search + result.hash
    )
    build.clearClientUpdateUrl()
    expect(window.location.search).toContain("__linksense_build")
    vi.stubEnv("VITE_LINKSENSE_BUILD_ID", newBuild)
    build.clearClientUpdateUrl()
    expect(window.location.search).toBe("?scope=owned")
    expect(window.location.hash).toBe("#draft")
    expect(window.history.state).toEqual({ draft: true })
  })
})

describe("explicit page update", () => {
  it("only reloads after the served Web and API agree, preserving the route", async () => {
    const { reloadClientPage } = await import("./client-update-navigation")
    const navigate = vi.fn()
    window.history.replaceState(null, "", "/applications?scope=owned#draft")
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ build_id: newBuild }))
        .mockResolvedValueOnce(
          Response.json({}, { headers: { "x-linksense-build": newBuild } })
        )
    )
    await reloadClientPage(navigate)
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining(
        "/applications?scope=owned&__linksense_build=" + newBuild + "#draft"
      )
    )
  })

  it.each([oldBuild, null])(
    "does not reload when the API is not ready for the published Web (%s)",
    async (apiBuild) => {
      const { reloadClientPage } = await import("./client-update-navigation")
      const navigate = vi.fn()
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(Response.json({ build_id: newBuild }))
          .mockResolvedValueOnce(
            Response.json(
              {},
              { headers: apiBuild ? { "x-linksense-build": apiBuild } : {} }
            )
          )
      )
      await expect(reloadClientPage(navigate)).rejects.toThrow(
        "UPDATE_NOT_READY"
      )
      expect(navigate).not.toHaveBeenCalled()
    }
  )
})
