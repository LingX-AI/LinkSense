import { beforeEach, describe, expect, it, vi } from "vitest"

const teamsMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getContext: vi.fn(),
  getAuthToken: vi.fn(),
}))

vi.mock("@microsoft/teams-js", () => ({
  app: {
    initialize: teamsMocks.initialize,
    getContext: teamsMocks.getContext,
  },
  authentication: {
    getAuthToken: teamsMocks.getAuthToken,
  },
}))

import {
  detectTeamsHost,
  getTeamsSsoToken,
} from "@/adapters/teams/teams-adapter"

describe("Teams host adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    teamsMocks.initialize.mockResolvedValue(undefined)
    teamsMocks.getContext.mockResolvedValue({
      app: { locale: "en-US" },
      user: { loginHint: "user@example.com" },
    })
    teamsMocks.getAuthToken.mockResolvedValue("teams-token")
  })

  it("returns the Teams locale and login hint after SDK initialization", async () => {
    await expect(detectTeamsHost()).resolves.toEqual({
      kind: "teams",
      locale: "en-US",
      loginHint: "user@example.com",
    })
    expect(teamsMocks.initialize).toHaveBeenCalledOnce()
  })

  it("reports SDK initialization failure when the page is embedded", async () => {
    teamsMocks.initialize.mockRejectedValue(new Error("invalid manifest"))

    await expect(detectTeamsHost({ assumeEmbedded: true })).resolves.toEqual({
      kind: "teams_error",
    })
  })

  it("treats the same SDK failure as a normal browser outside an iframe", async () => {
    teamsMocks.initialize.mockRejectedValue(new Error("not in Teams"))

    await expect(detectTeamsHost({ assumeEmbedded: false })).resolves.toEqual({
      kind: "web",
    })
  })

  it("gets the SSO token only through the Teams SDK", async () => {
    await expect(getTeamsSsoToken()).resolves.toBe("teams-token")
    expect(teamsMocks.getAuthToken).toHaveBeenCalledOnce()
  })
})
