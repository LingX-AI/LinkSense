import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClientUpdateNotice } from "./client-update-notice"
import { useClientUpdate } from "@/app/use-client-update"
import { reloadClientPage } from "@/app/client-update-navigation"
import i18n from "@/i18n"
import { zhCN } from "@/i18n/zh-CN"
import { enUS } from "@/i18n/en-US"

vi.mock("@/app/use-client-update", () => ({ useClientUpdate: vi.fn() }))
vi.mock("@/app/client-update-navigation", () => ({ reloadClientPage: vi.fn() }))

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.mocked(useClientUpdate).mockReturnValue("a".repeat(64))
  vi.mocked(reloadClientPage).mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe("system update notice", () => {
  it.each(["zh-CN", "en-US"])(
    "keeps the maintenance layout with a refresh illustration and concise device help in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(<ClientUpdateNotice />)
      const dialog = screen.getByRole("dialog", {
        name: i18n.t("clientUpdate.title"),
      })
      expect(dialog).toHaveAccessibleDescription(
        i18n.t("clientUpdate.description")
      )
      expect(dialog).toHaveClass(
        "overflow-hidden",
        "grid-rows-[minmax(0,1fr)_auto]"
      )
      expect(dialog.querySelector(".bg-maintenance-hero-base")).toHaveAttribute(
        "aria-hidden",
        "true"
      )
      const hero = dialog.querySelector(".bg-maintenance-hero-base")
      const iconLayers = hero?.querySelectorAll(".lucide-refresh-cw")
      expect(iconLayers).toHaveLength(2)
      expect(iconLayers?.[0]).toHaveClass(
        "absolute",
        "translate-x-1.5",
        "translate-y-2"
      )
      expect(iconLayers?.[1]).toHaveAttribute("stroke-width", "2")
      expect(hero?.querySelector(".lucide-wrench")).not.toBeInTheDocument()
      const help = screen.getByRole("note")
      expect(help).toHaveTextContent(
        locale === "zh-CN" ? "强制刷新方法" : "How to hard refresh"
      )
      expect(help.querySelectorAll("p")).toHaveLength(0)
      expect(help.querySelectorAll("dt")).toHaveLength(3)
      expect(help.querySelectorAll("dd")).toHaveLength(3)
      expect(help.querySelector("dl")).toHaveClass("gap-y-2")
      expect(help).not.toHaveTextContent(/Chrome|Edge|Firefox|Safari/)
      expect(help).toHaveTextContent("Ctrl + Shift + R")
      expect(help).toHaveTextContent("⌘ + Shift + R")
      expect(help).toHaveTextContent("⌘ + ⌥ + R")
      if (locale === "zh-CN") {
        expect(dialog).toHaveAccessibleDescription(
          "系统有更新，请刷新页面后继续"
        )
      }
      expect(
        screen.getByRole("button", { name: i18n.t("clientUpdate.update") })
      ).toBeEnabled()
      expect(
        screen
          .getByRole("button", { name: i18n.t("clientUpdate.update") })
          .querySelector("svg")
      ).toBeNull()
      expect(
        screen.getByText(i18n.t("clientUpdate.windowsHelp"))
      ).toBeInTheDocument()
      expect(
        screen.getByText(i18n.t("clientUpdate.macHelp"))
      ).toBeInTheDocument()
      expect(
        screen.getByText(i18n.t("clientUpdate.mobileHelp"))
      ).toBeInTheDocument()
      expect(reloadClientPage).not.toHaveBeenCalled()
    }
  )

  it("preserves an open draft when the user defers updating and shows the next deployment again", async () => {
    const tree = (
      <>
        <input aria-label="Draft" defaultValue="Unsent work" />
        <ClientUpdateNotice />
      </>
    )
    const view = render(tree)
    fireEvent.click(screen.getByRole("button", { name: "稍后更新" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "Unsent work"
    )
    fireEvent.click(screen.getByRole("button", { name: "系统已更新" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "稍后更新" }))
    vi.mocked(useClientUpdate).mockReturnValue("b".repeat(64))
    view.rerender(
      <>
        <input aria-label="Draft" defaultValue="Unsent work" />
        <ClientUpdateNotice />
      </>
    )
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(reloadClientPage).not.toHaveBeenCalled()
  })

  it("prevents duplicate update actions and retains a failed update for retry", async () => {
    let fail!: (reason: Error) => void
    vi.mocked(reloadClientPage).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    render(<ClientUpdateNotice />)
    const button = screen.getByRole("button", { name: "更新页面" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.getByRole("button", { name: "正在检查更新…" })).toBeDisabled()
    expect(reloadClientPage).toHaveBeenCalledTimes(1)
    await act(async () => fail(new Error("offline")))
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("clientUpdate.notReady")
    )
    fireEvent.click(screen.getByRole("button", { name: "更新页面" }))
    await waitFor(() => expect(reloadClientPage).toHaveBeenCalledTimes(2))
  })

  it("renders no update UI when the page is current", () => {
    vi.mocked(useClientUpdate).mockReturnValue(null)
    render(<ClientUpdateNotice />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("keeps both translation sets complete and falls back to Chinese", () => {
    expect(Object.keys(enUS.clientUpdate)).toEqual(
      Object.keys(zhCN.clientUpdate)
    )
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    for (const [key, value] of Object.entries(zhCN.clientUpdate)) {
      expect(fallback.t(`clientUpdate.${key}`, { lng: "en-US" })).toBe(value)
    }
  })
})
