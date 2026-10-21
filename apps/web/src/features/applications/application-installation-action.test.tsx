import {
  applicationDistributionSummarySchema,
  type ApplicationDistributionSummary,
} from "@linksense/shared"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { ApplicationInstallationAction } from "./application-installation-action"

afterEach(cleanup)

const id = "11000000-0000-4000-8000-000000000001"
const distribution = applicationDistributionSummarySchema.parse({
  application_id: id,
  published_version_id: id,
  published_version_number: "2.0.0",
  usage_modes: ["install", "service"],
  installation: null,
  installed_application_id: null,
})
const currentInstallation = {
  installed_version_id: id,
  installed_version_number: "2.0.0",
  available_version_id: id,
  available_version_number: "2.0.0",
  update_available: false,
}

function show(overrides: Partial<ApplicationDistributionSummary> = {}) {
  const onInstall = vi.fn()
  render(
    <ApplicationInstallationAction
      distribution={{ ...distribution, ...overrides }}
      onInstall={onInstall}
    />
  )
  return onInstall
}

describe("application installation action", () => {
  it.each(["install", "service"] as const)(
    "opens %s directly when it is the only offered mode",
    async (mode) => {
      await i18n.changeLanguage("zh-CN")
      const onInstall = show({ usage_modes: [mode] })
      const button = screen.getByRole("button", { name: "安装应用" })
      expect(button).not.toHaveAttribute("aria-haspopup", "menu")
      await userEvent.click(button)
      expect(onInstall).toHaveBeenCalledExactlyOnceWith(mode)
    }
  )

  it.each(["install", "service"] as const)(
    "opens only the selected %s mode from the shared installation menu",
    async (mode) => {
      await i18n.changeLanguage("zh-CN")
      const onInstall = show()
      await userEvent.click(screen.getByRole("button", { name: "安装应用" }))
      await userEvent.click(
        await screen.findByRole("menuitem", {
          name: i18n.t(`applications.distribution.modes.${mode}`),
        })
      )
      expect(onInstall).toHaveBeenCalledExactlyOnceWith(mode)
    }
  )

  it("prevents reinstalling a current copy while allowing service installation", async () => {
    await i18n.changeLanguage("zh-CN")
    const onInstall = show({
      installed_application_id: id,
      copy_installation: currentInstallation,
    })
    await userEvent.click(screen.getByRole("button", { name: "安装应用" }))
    const copy = await screen.findByRole("menuitem", {
      name: /^应用安装包/,
    })
    expect(within(copy).getByText("已安装")).toBeVisible()
    expect(copy).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(copy)
    expect(onInstall).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("menuitem", { name: "应用服务" }))
    expect(onInstall).toHaveBeenCalledExactlyOnceWith("service")
  })

  it("offers the remaining copy directly when the service is already current", async () => {
    await i18n.changeLanguage("zh-CN")
    const onInstall = show({ service_installation: currentInstallation })
    const button = screen.getByRole("button", { name: "安装应用" })
    expect(button).not.toHaveAttribute("aria-haspopup", "menu")
    await userEvent.click(button)
    expect(onInstall).toHaveBeenCalledExactlyOnceWith("install")
  })

  it("disables the installed label when both modes are already current", async () => {
    await i18n.changeLanguage("zh-CN")
    const onInstall = show({
      installed_application_id: id,
      copy_installation: currentInstallation,
      service_installation: currentInstallation,
    })
    const button = screen.getByRole("button", { name: "已安装" })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onInstall).not.toHaveBeenCalled()
  })

  it.each(["install", "service"] as const)(
    "keeps the %s update attached to its mode without duplicate update buttons",
    async (mode) => {
      await i18n.changeLanguage("zh-CN")
      const update = {
        ...currentInstallation,
        installed_version_number: "1.0.0",
        update_available: true,
      }
      const onInstall = show({
        ...(mode === "install"
          ? { installed_application_id: id, copy_installation: update }
          : { service_installation: update }),
      })
      const buttons = screen.getAllByRole("button", { name: "发现新版" })
      expect(buttons).toHaveLength(1)
      await userEvent.click(buttons[0])
      const item = await screen.findByRole("menuitem", {
        name: (name) =>
          name.includes(i18n.t(`applications.distribution.modes.${mode}`)),
      })
      expect(within(item).getByText("发现新版")).toBeVisible()
      await userEvent.click(item)
      expect(onInstall).toHaveBeenCalledExactlyOnceWith(mode)
    }
  )

  it("allows choosing the installation mode with the keyboard", async () => {
    await i18n.changeLanguage("zh-CN")
    const onInstall = show()
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole("button", { name: "安装应用" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    const copy = await screen.findByRole("menuitem", { name: "应用安装包" })
    await waitFor(() => expect(copy).toHaveFocus())
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onInstall).toHaveBeenCalledExactlyOnceWith("service")
  })

  it("hides the installation action for an already current service-only application", () => {
    show({
      usage_modes: ["service"],
      service_installation: currentInstallation,
    })
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("hides the installation action when no usage mode is offered", () => {
    show({ usage_modes: [] })
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
