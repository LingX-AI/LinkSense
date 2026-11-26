import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"

import i18n from "@/i18n"
import type { DesktopUpdateResult } from "@/adapters/desktop/desktop-adapter"
import { DesktopUpdateControl } from "./desktop-update-control"
import { desktopUpdateMessages } from "./messages"

const host = vi.hoisted(() => ({
  desktop: true,
  mac: true,
  check: vi.fn(),
  getState: vi.fn(),
  install: vi.fn(),
  setChannel: vi.fn(),
  restart: vi.fn(),
  openInstaller: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-adapter", async (original) => ({
  ...(await original<typeof import("@/adapters/desktop/desktop-adapter")>()),
  isDesktopHost: () => host.desktop,
  isMacDesktopHost: () => host.mac,
  checkDesktopUpdate: host.check,
  getDesktopUpdateState: host.getState,
  installDesktopUpdate: host.install,
  setDesktopUpdateChannel: host.setChannel,
  restartDesktopAfterUpdate: host.restart,
  openDesktopUpdateInstaller: host.openInstaller,
  subscribeDesktopUpdateChanged: (listener: (value: unknown) => void) =>
    host.subscribe(listener),
}))

let emitUpdate: (result: DesktopUpdateResult) => void = () => undefined

const available = (
  overrides: Partial<DesktopUpdateResult> = {}
): DesktopUpdateResult => ({
  state: "available",
  version: "0.2.0",
  installAvailable: true,
  downloadAvailable: false,
  revision: 7,
  ...overrides,
})

beforeEach(async () => {
  host.desktop = true
  host.mac = true
  host.check.mockReset()
  host.getState.mockReset().mockResolvedValue({ state: "idle" })
  host.install.mockReset()
  host.setChannel.mockReset()
  host.restart.mockReset()
  host.openInstaller.mockReset()
  emitUpdate = () => undefined
  host.subscribe
    .mockReset()
    .mockImplementation((listener: (result: DesktopUpdateResult) => void) => {
      emitUpdate = listener
      return () => undefined
    })
  await i18n.changeLanguage("zh-CN")
})
afterEach(cleanup)

const zh = desktopUpdateMessages["zh-CN"]

function releaseNotesBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-slot="desktop-update-release-notes"]'
  )
}

describe("desktop update roles", () => {
  it("does not expose desktop controls to the browser", () => {
    host.desktop = false
    render(<DesktopUpdateControl />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(host.getState).not.toHaveBeenCalled()
    expect(host.subscribe).not.toHaveBeenCalled()
  })

  it("keeps Windows on the original check-only control", async () => {
    host.mac = false
    let complete: (result: object) => void = () => {
      throw new Error("check did not start")
    }
    host.check.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    render(<DesktopUpdateControl />)
    const user = userEvent.setup()
    const button = screen.getByRole("button", { name: zh.check })
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard("{Enter}{Enter}")
    expect(host.check).toHaveBeenCalledOnce()
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveFocus()
    complete({ state: "available", version: "0.2.0", notes: "Ignored notes" })
    expect(
      await screen.findByText("有新版本 0.2.0。请向管理员获取安装包。")
    ).toBeVisible()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.releaseNotes })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Ignored notes")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
    expect(host.getState).not.toHaveBeenCalled()
  })

  it.each([
    [{ state: "current" }, zh.current],
    [{ state: "unavailable" }, zh.unavailable],
    [{ state: "failed" }, zh.failed],
  ])("keeps check-only status %j", async (result, message) => {
    host.mac = false
    host.check.mockResolvedValue(result)
    render(<DesktopUpdateControl />)
    await userEvent.click(screen.getByRole("button", { name: zh.check }))
    expect(await screen.findByText(message)).toBeVisible()
  })
})

describe("desktop update footer layout", () => {
  it.each([true, false])(
    "keeps a trailing action and a full-width status line on mac=%s",
    async (mac) => {
      host.mac = mac
      const { unmount } = render(
        <DesktopUpdateControl
          trailingAction={<button type="button">Retry</button>}
        />
      )
      expect(
        await screen.findByRole("button", { name: "Retry" })
      ).toBeVisible()
      expect(screen.getByRole("status")).toHaveClass("w-full")
      unmount()
    }
  )
})

describe("desktop update affordances", () => {
  it("installs in place on a writable build without any manual installer URL", async () => {
    host.getState.mockResolvedValue(
      available({ channel: "stable", betaAvailable: false })
    )
    render(<DesktopUpdateControl />)
    expect(
      await screen.findByText(
        zh.updateAvailable.replace("{{version}}", "0.2.0")
      )
    ).toBeVisible()
    expect(screen.getByRole("button", { name: zh.check })).toBeVisible()
    expect(screen.getByRole("button", { name: zh.install })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.openInstaller })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: zh.channel })
    ).toHaveTextContent(zh.channelStable)
    expect(screen.getByText(zh.channelBetaUnavailable)).toBeVisible()
    expect(host.install).not.toHaveBeenCalled()
  })

  it("offers only the configured installer page on a read-only build", async () => {
    host.getState.mockResolvedValue(
      available({ installAvailable: false, downloadAvailable: true })
    )
    host.openInstaller
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("installer unavailable"))
    render(<DesktopUpdateControl />)
    const open = await screen.findByRole("button", { name: zh.openInstaller })
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
    await userEvent.click(open)
    expect(host.openInstaller).toHaveBeenCalledWith()
    await userEvent.click(open)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      zh.installerFailed
    )
    expect(host.install).not.toHaveBeenCalled()
  })

  it("shows no action and keeps the old copy for a check-only available result", async () => {
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.2.0",
    })
    render(<DesktopUpdateControl />)
    expect(
      await screen.findByText(zh.available.replace("{{version}}", "0.2.0"))
    ).toBeVisible()
    expect(
      screen.queryByText(zh.updateAvailable.replace("{{version}}", "0.2.0"))
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.openInstaller })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: zh.check })).toBeVisible()
  })

  it("offers the configured installer for a check-only available result", async () => {
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.2.0",
      downloadAvailable: true,
    })
    render(<DesktopUpdateControl />)
    expect(
      await screen.findByText(zh.available.replace("{{version}}", "0.2.0"))
    ).toBeVisible()
    expect(screen.getByRole("button", { name: zh.openInstaller })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
  })

  it("does not invent an installer action when no URL is configured", async () => {
    host.getState.mockResolvedValue(
      available({ installAvailable: false, downloadAvailable: undefined })
    )
    render(<DesktopUpdateControl />)
    expect(await screen.findByRole("button", { name: zh.check })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.openInstaller })
    ).not.toBeInTheDocument()
  })

  it("offers the configured installer for an unavailable update state", async () => {
    host.getState.mockResolvedValue({
      state: "unavailable",
      downloadAvailable: true,
    })
    render(<DesktopUpdateControl />)
    expect(await screen.findByText(zh.unavailable)).toBeVisible()
    expect(screen.getByRole("button", { name: zh.openInstaller })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
  })

  it("keeps failed and unavailable states check-only when no installer is configured", async () => {
    host.getState.mockResolvedValue({ state: "unavailable" })
    const view = render(<DesktopUpdateControl />)
    expect(await screen.findByText(zh.unavailable)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.install })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.openInstaller })
    ).not.toBeInTheDocument()
    view.unmount()

    host.getState.mockResolvedValue({ state: "failed" })
    render(<DesktopUpdateControl />)
    expect(await screen.findByText(zh.failed)).toBeVisible()
    expect(screen.getByRole("button", { name: zh.check })).toBeVisible()
  })

  it("guides the user when native work is busy and never retries on its own", async () => {
    const busy: DesktopUpdateResult = {
      state: "busy",
      version: "0.2.0",
      installAvailable: true,
      revision: 7,
      notes: "Local task notes",
    }
    host.getState.mockResolvedValue(busy)
    host.install.mockResolvedValue({ ...busy, revision: 8 })
    render(<DesktopUpdateControl />)
    expect(await screen.findByText(zh.busy)).toBeVisible()
    expect(screen.getByRole("button", { name: zh.releaseNotes })).toBeVisible()
    expect(host.install).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: zh.install }))
    expect(host.install).toHaveBeenCalledWith(7)
    expect(await screen.findByText(zh.busy)).toBeVisible()
    expect(screen.getByRole("button", { name: zh.releaseNotes })).toBeVisible()
  })

  it("does not start another check while native is already checking", async () => {
    host.getState.mockResolvedValue({
      state: "checking",
      installAvailable: true,
      revision: 7,
    })
    render(<DesktopUpdateControl />)
    const button = await screen.findByRole("button", { name: zh.check })
    expect(button).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(button)
    expect(host.check).not.toHaveBeenCalled()
  })
})

describe("desktop update candidate click", () => {
  it("installs the revision the click was rendered for", async () => {
    host.getState.mockResolvedValue(available())
    host.install.mockResolvedValue({
      state: "downloading",
      downloaded: 5,
      total: 100,
      revision: 8,
    })
    render(<DesktopUpdateControl />)
    await userEvent.click(
      await screen.findByRole("button", { name: zh.install })
    )
    expect(host.install).toHaveBeenCalledWith(7)
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "5"
    )
  })

  it("does not silently install a newer candidate than the rendered one", async () => {
    host.getState.mockResolvedValue(available())
    render(<DesktopUpdateControl />)
    const button = await screen.findByRole("button", { name: zh.install })
    // A native snapshot replaces the displayed candidate between render and
    // click handling. The old click must not install the new candidate.
    button.addEventListener(
      "click",
      () => {
        emitUpdate(available({ version: "0.2.1", revision: 8 }))
      },
      { capture: true, once: true }
    )
    await userEvent.click(button)
    expect(host.install).not.toHaveBeenCalled()
    await screen.findByText(zh.updateAvailable.replace("{{version}}", "0.2.1"))
    await userEvent.click(screen.getByRole("button", { name: zh.install }))
    expect(host.install).toHaveBeenCalledWith(8)
  })

  it("keeps a repeated install activation to one native request", async () => {
    host.getState.mockResolvedValue(available())
    let resolveInstall: (result: DesktopUpdateResult) => void = () => undefined
    host.install.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve
      })
    )
    render(<DesktopUpdateControl />)
    const install = await screen.findByRole("button", { name: zh.install })
    await userEvent.click(install)
    await userEvent.click(install)
    expect(host.install).toHaveBeenCalledOnce()
    expect(install).toHaveAttribute("aria-disabled", "true")
    resolveInstall({
      state: "downloading",
      downloaded: 5,
      total: 100,
      revision: 8,
    })
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "5"
    )
  })
})

describe("desktop update progress", () => {
  it("uses only real counts and resets on a delta fallback", async () => {
    host.getState.mockResolvedValue({
      state: "downloading",
      downloaded: 30,
      total: 100,
      revision: 7,
    })
    render(<DesktopUpdateControl />)
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "30"
    )

    emitUpdate({
      state: "downloading",
      downloaded: 10,
      total: 100,
      revision: 8,
    })
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "10"
      )
    )

    // A late snapshot from an older revision must not move the progress.
    emitUpdate({
      state: "downloading",
      downloaded: 95,
      total: 100,
      revision: 7,
    })
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "10"
    )

    emitUpdate({ state: "downloading", revision: 9 })
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    )
    expect(screen.getByText(zh.preparing)).toBeVisible()
  })

  it("never estimates a percentage from missing or inconsistent counts", async () => {
    host.getState.mockResolvedValue({
      state: "downloading",
      downloaded: 120,
      total: 100,
      revision: 7,
    })
    render(<DesktopUpdateControl />)
    expect(await screen.findByText(zh.preparing)).toBeVisible()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("ignores a duplicate revision instead of replacing the display", async () => {
    host.getState.mockResolvedValue(available())
    render(<DesktopUpdateControl />)
    expect(
      await screen.findByText(
        zh.updateAvailable.replace("{{version}}", "0.2.0")
      )
    ).toBeVisible()
    emitUpdate({
      state: "downloading",
      downloaded: 10,
      total: 100,
      revision: 7,
    })
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    )
    expect(
      screen.getByText(zh.updateAvailable.replace("{{version}}", "0.2.0"))
    ).toBeVisible()
  })
})

describe("desktop update release notes", () => {
  const notes =
    'Fixes <b>literal</b> and <img src="https://updates.example.test/b.png"> https://updates.example.test/notes\nSecond line'

  it("renders verified candidate notes as literal wrapped text and resets for a new candidate", async () => {
    host.getState.mockResolvedValue(available({ notes }))
    render(<DesktopUpdateControl />)
    const trigger = await screen.findByRole("button", {
      name: zh.releaseNotes,
    })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const text = releaseNotesBlock()
    expect(text).not.toBeNull()
    expect(text).toHaveClass("whitespace-pre-wrap", "break-words")
    expect(text?.textContent).toBe(notes)
    expect(text?.querySelector("b, a, img")).toBeNull()

    const nextNotes = "New candidate notes"
    emitUpdate(available({ version: "0.2.1", revision: 8, notes: nextNotes }))
    await screen.findByText(zh.updateAvailable.replace("{{version}}", "0.2.1"))
    expect(releaseNotesBlock()).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: zh.releaseNotes }))
    expect(releaseNotesBlock()?.textContent).toBe(nextNotes)
  })

  it("resets the disclosure when the channel changes", async () => {
    host.getState.mockResolvedValue(available({ notes: "Stable notes" }))
    render(<DesktopUpdateControl />)
    await userEvent.click(
      await screen.findByRole("button", { name: zh.releaseNotes })
    )
    expect(releaseNotesBlock()?.textContent).toBe("Stable notes")

    emitUpdate(available({ channel: "beta", revision: 8, notes: "Beta notes" }))
    await waitFor(() => expect(releaseNotesBlock()).toBeNull())
    expect(
      screen.getByRole("combobox", { name: zh.channel })
    ).toHaveTextContent(zh.channelBeta)
    await userEvent.click(screen.getByRole("button", { name: zh.releaseNotes }))
    expect(releaseNotesBlock()?.textContent).toBe("Beta notes")
  })
})

describe("desktop update event ordering and reload", () => {
  it("ignores a late snapshot that resolves after a newer native event", async () => {
    let resolveState: (result: DesktopUpdateResult) => void = () => undefined
    host.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve
      })
    )
    render(<DesktopUpdateControl />)
    emitUpdate(available({ version: "0.2.1", revision: 8 }))
    expect(
      await screen.findByText(
        zh.updateAvailable.replace("{{version}}", "0.2.1")
      )
    ).toBeVisible()
    resolveState({
      state: "downloading",
      downloaded: 40,
      total: 100,
      revision: 7,
    })
    await waitFor(() =>
      expect(
        screen.getByText(zh.updateAvailable.replace("{{version}}", "0.2.1"))
      ).toBeVisible()
    )
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("does not let a failed background read replace good native data", async () => {
    let rejectState: (error: Error) => void = () => undefined
    host.getState.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectState = reject
      })
    )
    render(<DesktopUpdateControl />)
    emitUpdate({ state: "available", version: "0.2.0" })
    expect(
      await screen.findByText(zh.available.replace("{{version}}", "0.2.0"))
    ).toBeVisible()
    rejectState(new Error("offline"))
    await waitFor(() =>
      expect(
        screen.getByText(zh.available.replace("{{version}}", "0.2.0"))
      ).toBeVisible()
    )
    expect(screen.queryByText(zh.failed)).not.toBeInTheDocument()
  })

  it("re-reads the native snapshot when settings reopen", async () => {
    host.getState.mockResolvedValue({
      state: "downloading",
      downloaded: 20,
      total: 100,
      revision: 7,
    })
    const first = render(<DesktopUpdateControl />)
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20"
    )
    expect(host.getState).toHaveBeenCalledOnce()
    first.unmount()

    host.getState.mockResolvedValue({
      state: "staged",
      version: "0.2.0",
      revision: 8,
    })
    render(<DesktopUpdateControl />)
    expect(
      await screen.findByRole("button", { name: zh.restart })
    ).toBeVisible()
    expect(host.getState).toHaveBeenCalledTimes(2)
    expect(host.restart).not.toHaveBeenCalled()
  })

  it("shares one initial native read across public entries", async () => {
    host.getState.mockResolvedValue(available())
    render(
      <>
        <DesktopUpdateControl />
        <div data-testid="second">
          <DesktopUpdateControl />
        </div>
      </>
    )
    expect(
      await screen.findAllByText(
        zh.updateAvailable.replace("{{version}}", "0.2.0")
      )
    ).toHaveLength(2)
    expect(host.getState).toHaveBeenCalledOnce()
    expect(host.subscribe).toHaveBeenCalledOnce()
    emitUpdate({ state: "staged", version: "0.2.0", revision: 8 })
    expect(
      await screen.findAllByRole("button", { name: zh.restart })
    ).toHaveLength(2)
  })
})

describe("desktop update restart and channel", () => {
  it("asks for an explicit restart after staging and reports failure", async () => {
    host.getState.mockResolvedValue({
      state: "staged",
      version: "0.2.0",
      revision: 7,
    })
    host.restart.mockRejectedValue(new Error("restart unavailable"))
    render(<DesktopUpdateControl />)
    const restart = await screen.findByRole("button", { name: zh.restart })
    expect(host.restart).not.toHaveBeenCalled()
    expect(host.install).not.toHaveBeenCalled()
    await userEvent.click(restart)
    expect(host.restart).toHaveBeenCalledOnce()
    expect(await screen.findByRole("alert")).toHaveTextContent(zh.restartFailed)
    expect(host.install).not.toHaveBeenCalled()
  })

  it("disables the beta channel when native omits betaAvailable", async () => {
    // Go's betaAvailable uses omitempty, so an unavailable beta feed is
    // serialized as an absent field rather than false.
    host.getState.mockResolvedValue(available({ channel: "stable" }))
    render(<DesktopUpdateControl />)
    const select = await screen.findByRole("combobox", { name: zh.channel })
    expect(screen.getByText(zh.channelBetaUnavailable)).toBeVisible()
    const user = userEvent.setup()
    await user.click(select)
    const beta = await screen.findByRole("option", { name: zh.channelBeta })
    expect(beta).toHaveAttribute("aria-disabled", "true")
    await user.click(beta)
    expect(host.setChannel).not.toHaveBeenCalled()
    expect(select).toHaveTextContent(zh.channelStable)
  })

  it("persists a channel switch in native state and disables the select while pending", async () => {
    host.getState.mockResolvedValue(
      available({ channel: "stable", betaAvailable: true })
    )
    let resolveChannel: (result: DesktopUpdateResult) => void = () => undefined
    host.setChannel.mockReturnValue(
      new Promise((resolve) => {
        resolveChannel = resolve
      })
    )
    render(<DesktopUpdateControl />)
    const select = await screen.findByRole("combobox", { name: zh.channel })
    const user = userEvent.setup()
    await user.click(select)
    await user.click(
      await screen.findByRole("option", { name: zh.channelBeta })
    )
    expect(host.setChannel).toHaveBeenCalledWith("beta")
    expect(select).toBeDisabled()
    resolveChannel(
      available({ channel: "beta", betaAvailable: true, revision: 8 })
    )
    await waitFor(() => expect(select).toHaveTextContent(zh.channelBeta))
    expect(select).toBeEnabled()
  })

  it("keeps the previous channel and explains a failed switch", async () => {
    host.getState.mockResolvedValue(
      available({ channel: "stable", betaAvailable: true })
    )
    host.setChannel.mockRejectedValue(new Error("channel unavailable"))
    render(<DesktopUpdateControl />)
    const select = await screen.findByRole("combobox", { name: zh.channel })
    const user = userEvent.setup()
    await user.click(select)
    await user.click(
      await screen.findByRole("option", { name: zh.channelBeta })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(zh.channelFailed)
    expect(select).toHaveTextContent(zh.channelStable)
  })
})

describe("desktop update translations", () => {
  it.each(supportedLocales)(
    "keeps translated controls, placeholders, and status text for %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      host.getState.mockResolvedValue(
        available({
          channel: "stable",
          betaAvailable: false,
          installAvailable: false,
          downloadAvailable: true,
          notes: "Localized notes",
        })
      )
      render(<DesktopUpdateControl />)
      expect(
        screen.getByRole("button", {
          name: desktopUpdateMessages[locale].check,
        })
      ).toBeVisible()
      expect(
        await screen.findByRole("button", {
          name: desktopUpdateMessages[locale].openInstaller,
        })
      ).toBeVisible()
      expect(
        screen.getByRole("combobox", {
          name: desktopUpdateMessages[locale].channel,
        })
      ).toBeVisible()
      expect(
        screen.getByRole("button", {
          name: desktopUpdateMessages[locale].releaseNotes,
        })
      ).toBeVisible()
      expect(i18n.getResource(locale, "translation", "desktopUpdate")).toEqual(
        desktopUpdateMessages[locale]
      )
      expect(
        i18n.t("desktopUpdate.updateAvailable", { version: "0.2.0" })
      ).toContain("0.2.0")
    }
  )

  it("keeps every locale's key set and interpolation placeholders aligned", () => {
    const keys = Object.keys(desktopUpdateMessages["zh-CN"]).sort()
    for (const locale of supportedLocales) {
      const messages = desktopUpdateMessages[locale]
      expect(Object.keys(messages).sort()).toEqual(keys)
      for (const key of ["available", "updateAvailable"] as const) {
        expect(messages[key]).toContain("{{version}}")
      }
    }
  })

  it("uses the Chinese fallback in an unsupported language", async () => {
    await i18n.changeLanguage("xx")
    render(<DesktopUpdateControl />)
    expect(screen.getByRole("button", { name: zh.check })).toBeVisible()
  })
})
