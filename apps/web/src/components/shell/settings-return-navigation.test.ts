import { describe, expect, it } from "vitest"

import {
  conversationSettingsReturnState,
  resolveSettingsReturn,
} from "@/components/shell/settings-return-navigation"

describe("settings return navigation", () => {
  it("round-trips the currently open conversation through settings", () => {
    const state = conversationSettingsReturnState({
      pathname: "/conversations/c1",
      search: "?preview=office",
      hash: "#message-1",
    })

    expect(state).toEqual({
      settingsReturnTo: "/conversations/c1?preview=office#message-1",
    })
    expect(resolveSettingsReturn(state)).toBe(
      "/conversations/c1?preview=office#message-1"
    )
  })

  it("keeps the existing Plugin Center return target supported", () => {
    expect(
      resolveSettingsReturn({
        settingsReturnTo:
          "/capabilities?section=mcp&scope=personal&search=%E6%9C%AC%E5%9C%B0",
      })
    ).toBe("/capabilities?section=mcp&scope=personal&search=%E6%9C%AC%E5%9C%B0")
  })

  it("round-trips an interactive application task through settings", () => {
    const path = "/applications/application-1/run/conversation-1"
    const state = conversationSettingsReturnState({
      pathname: path,
      search: "",
      hash: "",
    })

    expect(state).toEqual({ settingsReturnTo: path })
    expect(resolveSettingsReturn(state)).toBe(path)
  })

  it("rejects external and unrelated return destinations", () => {
    expect(
      resolveSettingsReturn({
        settingsReturnTo: "https://example.com/conversations/c1",
      })
    ).toBeNull()
    expect(
      resolveSettingsReturn({ settingsReturnTo: "/settings/general" })
    ).toBeNull()
    expect(
      conversationSettingsReturnState({
        pathname: "/automations",
        search: "",
        hash: "",
      })
    ).toBeUndefined()
  })
})
