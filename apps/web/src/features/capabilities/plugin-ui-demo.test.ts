import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  capabilitySummarySchema,
  marketplaceCatalogItemSchema,
} from "@/api/contracts"
import {
  apiRequest,
  apiUploadRequest,
  isPluginUiDemoEnabled,
  pluginUiDemoQueryKey,
  pluginUiDemoResponse,
} from "./plugin-ui-demo"

afterEach(() => {
  window.history.replaceState(null, "", "/")
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function openDemo() {
  window.history.replaceState(
    null,
    "",
    "/capabilities?section=plugin&scope=personal&pluginDemo=1"
  )
}

describe("local plugin UI samples", () => {
  it("requires a local development page and an explicit plugin demo parameter", () => {
    expect(isPluginUiDemoEnabled()).toBe(false)
    openDemo()
    expect(isPluginUiDemoEnabled()).toBe(true)
    expect(pluginUiDemoQueryKey()).toEqual(["plugin-ui-demo"])
    window.history.replaceState(
      null,
      "",
      "/capabilities?section=skill&pluginDemo=1"
    )
    expect(isPluginUiDemoEnabled()).toBe(false)
    openDemo()
    vi.stubEnv("DEV", false)
    expect(isPluginUiDemoEnabled()).toBe(false)
  })

  it("returns contract-valid samples, a disabled plugin, and searchable public records without network access", async () => {
    openDemo()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const page = await apiRequest("/capabilities", {
      schema: z.object({ items: z.array(capabilitySummarySchema) }),
    })
    expect(page.items).toHaveLength(6)
    expect(page.items.some((item) => item.personally_disabled)).toBe(true)
    const catalog = await apiRequest("/marketplace", {
      query: { search: "weekly" },
      schema: z.object({ items: z.array(marketplaceCatalogItemSchema) }),
    })
    expect(catalog.items).toHaveLength(1)
    expect(catalog.items[0].release.name).toContain("Weekly")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("blocks mutations, uploads, and unsupported reads before reaching live APIs", async () => {
    openDemo()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      await expect(
        apiRequest("/capabilities/real-record", { method, schema: z.unknown() })
      ).rejects.toMatchObject({ errorCode: "PLUGIN_UI_DEMO_READ_ONLY" })
    }
    await expect(
      apiUploadRequest("/capabilities", {
        body: new FormData(),
        method: "POST",
        schema: z.unknown(),
      })
    ).rejects.toMatchObject({ errorCode: "PLUGIN_UI_DEMO_READ_ONLY" })
    expect(() => pluginUiDemoResponse("/unsupported")).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
