import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"

import i18n from "@/i18n"
import { DesktopUpdateControl } from "./desktop-update-control"
import { desktopUpdateMessages } from "./messages"

const host = vi.hoisted(() => ({ desktop: true, check: vi.fn() }))
vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: { checkForUpdate: host.check },
}))
vi.mock("mygo-runtime", async (original) => ({
  ...(await original<typeof import("mygo-runtime")>()),
  isMyGo: () => host.desktop,
}))

beforeEach(async () => {
  host.desktop = true
  host.check.mockReset()
  await i18n.changeLanguage("zh-CN")
})
afterEach(cleanup)

describe("desktop update check", () => {
  it("does not expose desktop controls to the browser", () => {
    host.desktop = false
    render(<DesktopUpdateControl />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(host.check).not.toHaveBeenCalled()
  })

  it("announces the version and ignores duplicate activation while keeping keyboard focus", async () => {
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
    const button = screen.getByRole("button", { name: "检查更新" })
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard("{Enter}{Enter}")
    expect(host.check).toHaveBeenCalledOnce()
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveFocus()
    complete({ state: "available", version: "0.2.0" })
    expect(
      await screen.findByText("有新版本 0.2.0。请向管理员获取安装包。")
    ).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("0.2.0")
  })

  it.each([
    [{ state: "current" }, "客户端已是最新版。"],
    [{ state: "unavailable" }, "此安装包不支持检查更新。请联系管理员。"],
    [{ state: "available" }, "无法检查更新。请稍后重试。"],
    [{ state: "failed" }, "无法检查更新。请稍后重试。"],
  ])("displays a safe status for %j", async (result, message) => {
    host.check.mockResolvedValue(result)
    render(<DesktopUpdateControl />)
    await userEvent.click(screen.getByRole("button", { name: "检查更新" }))
    expect(await screen.findByText(message)).toBeVisible()
  })

  it.each(supportedLocales)(
    "keeps translated control and version placeholders for %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(<DesktopUpdateControl />)
      expect(
        screen.getByRole("button", {
          name: desktopUpdateMessages[locale].check,
        })
      ).toBeVisible()
      expect(i18n.getResource(locale, "translation", "desktopUpdate")).toEqual(
        desktopUpdateMessages[locale]
      )
      expect(i18n.t("desktopUpdate.available", { version: "0.2.0" })).toContain(
        "0.2.0"
      )
    }
  )

  it("uses the Chinese fallback in an unsupported language", async () => {
    await i18n.changeLanguage("xx")
    render(<DesktopUpdateControl />)
    expect(screen.getByRole("button", { name: "检查更新" })).toBeVisible()
  })
})
