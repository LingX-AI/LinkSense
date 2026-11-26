import type { ReactElement } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"

import {
  desktopExecutionDefaultTargetKey,
  desktopStartGuideKey,
} from "./desktop-execution-default-target"
import { MacDesktopStartGuide } from "./mac-desktop-start-guide"
import type { DesktopExecutionDeviceAvailability } from "./desktop-execution-target"
import { desktopExecutionMessages } from "./messages"

const host = vi.hoisted(() => ({
  platform: "darwin" as "darwin" | "web" | "windows",
  serverUrl: "https://desktop.example.test" as string | null,
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => host.platform === "darwin",
  getDesktopServerUrl: () => host.serverUrl,
}))

const messages = desktopExecutionMessages["en-US"]
const preferencesKey = desktopExecutionDefaultTargetKey("user-a")!
const defaults = {
  userId: "user-a",
  localComputerEnabled: true,
  cloudTargetEnabled: true,
  deviceAvailability: {
    kind: "unavailable" as const,
    reason: "unpaired" as const,
  },
}

function guideElement(
  overrides: Partial<Parameters<typeof MacDesktopStartGuide>[0]> = {}
): ReactElement {
  return (
    <MemoryRouter>
      <MacDesktopStartGuide {...defaults} {...overrides} />
    </MemoryRouter>
  )
}

function renderGuide(
  overrides: Partial<Parameters<typeof MacDesktopStartGuide>[0]> = {}
) {
  return render(guideElement(overrides))
}

function getRegion() {
  return screen.getByRole("region", { name: messages.startGuideTitle })
}

function getLink(name: string) {
  return within(getRegion()).getByRole("link", { name })
}

function queryLink(name: string) {
  return within(getRegion()).queryByRole("link", { name })
}

function expectGuideAbsent() {
  expect(screen.queryByText(messages.startGuideTitle)).not.toBeInTheDocument()
}

beforeEach(async () => {
  host.platform = "darwin"
  host.serverUrl = "https://desktop.example.test"
  window.localStorage.clear()
  await i18n.changeLanguage("en-US")
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("macOS first-run guide", () => {
  it("lists the pair, browser, and default destinations for an unpaired Mac", () => {
    renderGuide()

    const pair = getLink(messages.startGuidePairTitle)
    const browser = getLink(messages.startGuideBrowserTitle)
    const runLocation = getLink(messages.startGuideDefaultTargetTitle)
    expect(within(getRegion()).getAllByRole("link")).toEqual([
      pair,
      browser,
      runLocation,
    ])
    expect(pair).toHaveAttribute(
      "href",
      "/settings/general#desktop-devices-heading"
    )
    expect(browser).toHaveAttribute(
      "href",
      "/settings/general#browser-extension"
    )
    expect(runLocation).toHaveAttribute(
      "href",
      "/settings/general#desktop-default-target"
    )
    expect(pair).toHaveAccessibleDescription(messages.startGuidePairDescription)
    expect(browser).toHaveAccessibleDescription(
      messages.startGuideBrowserDescription
    )
    expect(runLocation).toHaveAccessibleDescription(
      messages.defaultTargetDescription
    )
  })

  it.each<[string, DesktopExecutionDeviceAvailability]>([
    ["ready", { kind: "ready", deviceId: "device-1" }],
    ["connecting", { kind: "unavailable", reason: "connecting" }],
    ["offline", { kind: "unavailable", reason: "offline" }],
    ["not_ready", { kind: "unavailable", reason: "not_ready" }],
  ])(
    "omits only the pairing step once this Mac is %s",
    (_state, deviceAvailability) => {
      renderGuide({ deviceAvailability })

      expect(queryLink(messages.startGuidePairTitle)).not.toBeInTheDocument()
      expect(getLink(messages.startGuideBrowserTitle)).toBeVisible()
      expect(getLink(messages.startGuideDefaultTargetTitle)).toBeVisible()
    }
  )

  it.each<[string, DesktopExecutionDeviceAvailability]>([
    ["checking", { kind: "checking" }],
    ["unavailable", { kind: "unavailable", reason: "status_unavailable" }],
  ])(
    "does not offer pairing while the device status is %s",
    (_state, deviceAvailability) => {
      renderGuide({ deviceAvailability })

      expect(queryLink(messages.startGuidePairTitle)).not.toBeInTheDocument()
      expect(getLink(messages.startGuideBrowserTitle)).toBeVisible()
      expect(getLink(messages.startGuideDefaultTargetTitle)).toBeVisible()
    }
  )

  it.each(["cloud", "local"] as const)(
    "stays hidden when a valid %s default was already saved",
    (target) => {
      window.localStorage.setItem(preferencesKey, target)
      renderGuide()

      expectGuideAbsent()
    }
  )

  it("stays visible when the saved default is a malformed legacy value", () => {
    window.localStorage.setItem(preferencesKey, "legacy-target")
    renderGuide()

    expect(getRegion()).toBeVisible()
    expect(getLink(messages.startGuideDefaultTargetTitle)).toBeVisible()
  })

  it("dismisses with one Skip control and scopes the dismissal to owner and server", async () => {
    const interaction = userEvent.setup()
    const view = renderGuide()

    expect(within(getRegion()).getAllByRole("button")).toHaveLength(1)
    await interaction.click(
      screen.getByRole("button", { name: messages.startGuideSkip })
    )
    expectGuideAbsent()
    expect(window.localStorage.getItem(desktopStartGuideKey("user-a")!)).toBe(
      "dismissed"
    )

    // Another owner never inherits the previous owner's dismissal, including
    // after the device state changes.
    view.rerender(
      guideElement({
        userId: "user-b",
        deviceAvailability: { kind: "ready", deviceId: "device-1" },
      })
    )
    expect(getRegion()).toBeVisible()
    expect(
      window.localStorage.getItem(desktopStartGuideKey("user-b")!)
    ).toBeNull()

    view.rerender(guideElement())
    expectGuideAbsent()

    host.serverUrl = "https://other-desktop.example.test"
    view.rerender(guideElement())
    expect(getRegion()).toBeVisible()
  })

  it("keeps the dismissal for this mount when storage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    renderGuide()

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: messages.startGuideSkip }))
    expectGuideAbsent()
  })

  it("still renders when reading the dismissal throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    renderGuide()

    expect(getRegion()).toBeVisible()
  })

  it("shows only the browser step when local is disabled and cloud is enabled", () => {
    renderGuide({ localComputerEnabled: false })

    expect(queryLink(messages.startGuidePairTitle)).not.toBeInTheDocument()
    expect(getLink(messages.startGuideBrowserTitle)).toBeVisible()
    expect(
      queryLink(messages.startGuideDefaultTargetTitle)
    ).not.toBeInTheDocument()
  })

  it("keeps the default step when local is enabled but cloud is disabled", () => {
    renderGuide({ cloudTargetEnabled: false })

    expect(getLink(messages.startGuidePairTitle)).toBeVisible()
    expect(getLink(messages.startGuideBrowserTitle)).toBeVisible()
    expect(getLink(messages.startGuideDefaultTargetTitle)).toBeVisible()
  })

  it("hides itself when no run location is offered", () => {
    renderGuide({ localComputerEnabled: false, cloudTargetEnabled: false })

    expectGuideAbsent()
  })

  it("stays hidden without an active owner, during model setup, and outside the Mac host", () => {
    renderGuide({ userId: undefined })
    expectGuideAbsent()

    cleanup()
    renderGuide({ modelSetupActive: true })
    expectGuideAbsent()

    cleanup()
    host.platform = "web"
    renderGuide()
    expectGuideAbsent()

    cleanup()
    host.platform = "windows"
    renderGuide()
    expectGuideAbsent()
  })
})
