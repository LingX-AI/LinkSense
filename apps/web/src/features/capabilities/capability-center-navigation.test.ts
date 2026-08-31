import { describe, expect, it } from "vitest"

import {
  capabilityCenterLocationFromSearch,
  capabilityCenterSettingsState,
  resolveCapabilityCenterSettingsReturn,
} from "@/features/capabilities/capability-center-navigation"

describe("capability center navigation", () => {
  it("round-trips the active MCP catalog context through settings", () => {
    const state = capabilityCenterSettingsState({
      section: "mcp",
      scope: "personal",
      search: "本地分析",
    })

    expect(state).toEqual({
      settingsReturnTo:
        "/capabilities?section=mcp&scope=personal&search=%E6%9C%AC%E5%9C%B0%E5%88%86%E6%9E%90",
    })
    expect(resolveCapabilityCenterSettingsReturn(state)).toBe(
      state.settingsReturnTo
    )
    expect(
      capabilityCenterLocationFromSearch(
        new URL(state.settingsReturnTo, "https://linksense.local").search
      )
    ).toEqual({ section: "mcp", scope: "personal", search: "本地分析" })
  })

  it("rejects external or unrelated settings return destinations", () => {
    expect(
      resolveCapabilityCenterSettingsReturn({
        settingsReturnTo: "https://example.com/capabilities",
      })
    ).toBeNull()
    expect(
      resolveCapabilityCenterSettingsReturn({
        settingsReturnTo: "/conversations/new",
      })
    ).toBeNull()
    expect(resolveCapabilityCenterSettingsReturn(null)).toBeNull()
  })

  it("normalizes unsupported catalog scopes by section", () => {
    expect(
      capabilityCenterLocationFromSearch(
        "?section=skill&scope=clawhub&search=browser"
      )
    ).toEqual({ section: "skill", scope: "clawhub", search: "browser" })
    expect(
      capabilityCenterLocationFromSearch("?section=plugin&scope=clawhub")
    ).toEqual({ section: "plugin", scope: "personal", search: "" })
    expect(
      capabilityCenterLocationFromSearch("?section=mcp&scope=public")
    ).toEqual({ section: "mcp", scope: "personal", search: "" })
  })
})
