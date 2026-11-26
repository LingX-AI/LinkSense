import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"

import { desktopExecutionDefaultTargetKey } from "./desktop-execution-default-target"
import { DesktopExecutionDefaultTargetSettings } from "./desktop-execution-default-target-settings"
import { desktopExecutionDefaultTargetAnchorId } from "./desktop-execution-target"

const serverUrl = "https://desktop.example.test"
const host = vi.hoisted(() => ({
  platform: "darwin",
  serverUrl: null as string | null,
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => host.platform === "darwin",
  getDesktopServerUrl: () => host.serverUrl,
}))

const preferenceKey =
  'linksense.desktopExecution.defaultTarget:["https://desktop.example.test","user-1"]'

function getTrigger() {
  return screen.getByRole("combobox", { name: "Default run location" })
}

describe("macOS default run location", () => {
  beforeEach(async () => {
    host.platform = "darwin"
    host.serverUrl = serverUrl
    window.localStorage.clear()
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it.each(["web", "windows"])(
    "does not enable the preference on %s",
    (platform) => {
      host.platform = platform
      expect(desktopExecutionDefaultTargetKey("user-1")).toBeNull()
    }
  )

  it("requires a signed-in user and a Mac server URL", () => {
    expect(desktopExecutionDefaultTargetKey(undefined)).toBeNull()
    expect(desktopExecutionDefaultTargetKey("user-1")).toBe(preferenceKey)
    host.serverUrl = null
    expect(desktopExecutionDefaultTargetKey("user-1")).toBeNull()
  })

  it("exposes the distinct settings hash target for the first-run guide", () => {
    render(
      <DesktopExecutionDefaultTargetSettings
        preferenceKey={preferenceKey}
        anchorId={desktopExecutionDefaultTargetAnchorId}
      />
    )
    expect(getTrigger()).toHaveAttribute("id", "desktop-default-target")
  })

  it("saves This Mac with the keyboard and restores it on remount without network calls", async () => {
    const request = vi.fn()
    vi.stubGlobal("fetch", request)
    const interaction = userEvent.setup()
    const view = render(
      <DesktopExecutionDefaultTargetSettings preferenceKey={preferenceKey} />
    )
    const trigger = getTrigger()
    expect(trigger).toHaveTextContent("Cloud computer")
    expect(trigger).toHaveAccessibleDescription(
      "Applies to new tasks you create from this Mac. You can still change the run location before creating a task."
    )

    await interaction.tab()
    expect(trigger).toHaveFocus()
    await interaction.keyboard("{Enter}")
    await screen.findByRole("option", { name: "This Mac" })
    await interaction.keyboard("{End}{Enter}")
    await waitFor(() => expect(trigger).toHaveTextContent("This Mac"))
    expect(window.localStorage.getItem(preferenceKey)).toBe("local")
    expect(request).not.toHaveBeenCalled()

    view.unmount()
    render(
      <DesktopExecutionDefaultTargetSettings preferenceKey={preferenceKey} />
    )
    expect(getTrigger()).toHaveTextContent("This Mac")
  })

  it.each(["invalid", "unavailable"] as const)(
    "shows Cloud when the saved preference is %s",
    (storage) => {
      if (storage === "invalid") {
        window.localStorage.setItem(preferenceKey, "unknown-target")
      } else {
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
          throw new DOMException("Storage blocked", "SecurityError")
        })
      }
      render(
        <DesktopExecutionDefaultTargetSettings preferenceKey={preferenceKey} />
      )
      expect(getTrigger()).toHaveTextContent("Cloud computer")
    }
  )

  it("retains the saved value when a write fails and clears the accessible error after retry", async () => {
    window.localStorage.setItem(preferenceKey, "local")
    const interaction = userEvent.setup()
    render(
      <DesktopExecutionDefaultTargetSettings preferenceKey={preferenceKey} />
    )
    const trigger = getTrigger()
    const store = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementationOnce(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError")
      })
    async function chooseCloud() {
      await interaction.click(trigger)
      await interaction.click(
        await screen.findByRole("option", { name: "Cloud computer" })
      )
    }

    await chooseCloud()
    const alert = await screen.findByRole("alert")
    const saveError = "Couldn’t save the default run location. Try again."
    expect(alert).toHaveTextContent(saveError)
    expect(trigger).toHaveAccessibleDescription(
      expect.stringContaining(saveError)
    )
    expect(trigger).toHaveTextContent("This Mac")
    expect(window.localStorage.getItem(preferenceKey)).toBe("local")

    await chooseCloud()
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    )
    expect(trigger).toHaveTextContent("Cloud computer")
    expect(window.localStorage.getItem(preferenceKey)).toBe("cloud")
    expect(store).toHaveBeenCalledTimes(2)
  })
})
