import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  installApiMock,
  renderApp,
  setupApplicationTests,
} from "@/test/application/fixture"

describe("account support actions", () => {
  setupApplicationTests()

  it.each(["user", "admin"] as const)(
    "places settings directly below help and feedback for a %s account",
    async (role) => {
      installApiMock({ userOverride: { role } })
      const interaction = userEvent.setup()
      renderApp()

      const sidebar = await screen.findByRole("complementary", {
        name: "LinkSense 导航",
      })
      const account = within(sidebar).getByRole("button", { name: "林晓" })
      expect(account.parentElement?.querySelectorAll("button")).toHaveLength(1)
      expect(
        within(sidebar).queryByRole("button", { name: "反馈与帮助" })
      ).not.toBeInTheDocument()

      await interaction.click(account)
      const menu = await screen.findByRole("menu")
      const settings = within(menu).getByRole("menuitem", { name: "设置" })
      const help = within(menu).getByRole("menuitem", {
        name: "在新标签页打开帮助中心",
      })
      const feedback = within(menu).getByRole("menuitem", { name: "反馈" })
      const signOut = within(menu).getByRole("menuitem", { name: "退出登录" })
      const items = within(menu).getAllByRole("menuitem")

      expect(help).toHaveTextContent("使用帮助")
      expect(items.indexOf(feedback)).toBe(items.indexOf(help) + 1)
      expect(items.indexOf(settings)).toBe(items.indexOf(feedback) + 1)
      expect(items.indexOf(signOut)).toBe(items.indexOf(settings) + 1)
      expect(help).toHaveAttribute(
        "href",
        "/help/user-guide/tasks/create-and-run/"
      )
      expect(help).toHaveAttribute("target", "_blank")
      expect(help).toHaveAttribute("rel", "noreferrer noopener")
    }
  )

  it("keeps the feedback dialog open after the account menu closes and resets a cancelled draft", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const account = within(sidebar).getByRole("button", { name: "林晓" })
    await interaction.click(account)
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )

    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    await interaction.type(
      within(dialog).getByRole("textbox", { name: "反馈内容" }),
      "未提交的反馈"
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "取消" })
    )
    expect(
      screen.queryByRole("dialog", { name: "提交反馈" })
    ).not.toBeInTheDocument()

    await interaction.click(account)
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )
    const reopenedDialog = await screen.findByRole("dialog", {
      name: "提交反馈",
    })
    expect(
      within(reopenedDialog).getByRole("textbox", { name: "反馈内容" })
    ).toHaveValue("")
  })

  it("opens feedback from the account menu in the mobile navigation drawer", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "打开导航" })
    )
    const navigation = await screen.findByRole("dialog", { name: "LinkSense" })
    const account = within(navigation).getByRole("button", { name: "林晓" })
    expect(account.parentElement?.querySelectorAll("button")).toHaveLength(1)
    await interaction.click(account)
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )

    expect(
      await screen.findByRole("dialog", { name: "提交反馈" })
    ).toBeVisible()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
})
