import i18n from "@/i18n"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  chooseSelectOption,
  installApiMock,
  renderApp,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("finishes a slow language save after the settings selector closes", async () => {
    let finish!: () => void
    const languagePatchStart = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { requests } = installApiMock({ languagePatchStart })
    renderApp("/settings/general")
    await screen.findByRole("heading", { name: /^常规$/u })
    await chooseSelectOption(userEvent.setup(), "界面语言", "English")
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "English" })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByRole("combobox", { name: "界面语言" })).toBeDisabled()
    await act(async () => {
      finish()
      await languagePatchStart
    })
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"))
    expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: "/api/v1/me",
        method: "PATCH",
        body: { preferred_locale: "en-US" },
      })
    )
  })
  it("reflects language changes from another entry point and can switch back", async () => {
    const { requests } = installApiMock()
    renderApp("/settings/general")
    await screen.findByRole("heading", { name: /^常规$/u })
    await act(async () => {
      await i18n.changeLanguage("en-US")
    })
    expect(
      screen.getByRole("combobox", { name: "Interface language" })
    ).toHaveTextContent("English")
    await chooseSelectOption(
      userEvent.setup(),
      "Interface language",
      "简体中文"
    )
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"))
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: "/api/v1/me",
        method: "PATCH",
        body: { preferred_locale: "zh-CN" },
      })
    )
  })
  it("returns from settings to the currently open task", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/conversations/c1")

    expect(
      await screen.findByRole("heading", { name: "活动风险评估" })
    ).toBeVisible()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      within(sidebar).getByRole("button", { name: "林晓" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "设置" })
    )

    const settingsSidebar = await screen.findByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", "/conversations/c1")

    await interaction.click(
      within(settingsSidebar).getByRole("link", { name: "个人资料" })
    )
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", "/conversations/c1")

    await interaction.click(
      screen.getByRole("link", { name: "返回 LinkSense" })
    )
    expect(
      await screen.findByRole("heading", { name: "活动风险评估" })
    ).toBeVisible()
  })

  it("opens a compact account menu without a language selection shortcut", async () => {
    installApiMock({
      userOverride: {
        weekly_credit_limit: "0.001",
        credit_quota: {
          weekly: {
            limit_credits: "0.001",
            used_credits: "0.00025",
            remaining_credits: "0.00075",
            remaining_percentage: 75,
            reset_at: "2026-08-09T16:00:00.000Z",
          },
        },
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    const trigger = await screen.findByRole(
      "button",
      { name: "林晓" },
      { timeout: 3_000 }
    )
    await interaction.click(trigger)

    const menu = await screen.findByRole("menu")
    expect(
      within(menu).queryByRole("menuitem", { name: "界面语言" })
    ).not.toBeInTheDocument()
    expect(within(menu).queryByRole("menuitemradio")).not.toBeInTheDocument()
    expect(menu).toHaveClass("w-(--anchor-width)")
    expect(menu).not.toHaveClass("w-[260px]")
    expect(within(menu).getAllByText("林晓").length).toBeGreaterThan(0)
    expect(within(menu).getByText("额度")).toBeVisible()
    expect(within(menu).getByText("0")).toBeVisible()
    expect(within(menu).queryByText("lin@example.com")).not.toBeInTheDocument()
    expect(within(menu).queryByText("管理员")).not.toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "设置" })).toBeVisible()
    expect(
      within(menu).queryByRole("menuitem", { name: "个人设置" })
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole("menuitem", { name: "个人凭据" })
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole("menuitem", { name: "管理中心" })
    ).not.toBeInTheDocument()
    const signOutItem = within(menu).getByRole("menuitem", {
      name: "退出登录",
    })
    expect(signOutItem).toBeVisible()
    expect(signOutItem).toHaveAttribute("data-variant", "default")
    expect(
      screen.queryByRole("link", { name: "个人凭据" })
    ).not.toBeInTheDocument()
    expect(within(menu).queryByText("English")).not.toBeInTheDocument()
    expect(within(menu).queryByText(/宠物|主题/)).not.toBeInTheDocument()

    await interaction.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("requires confirmation before signing out", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const trigger = await screen.findByRole("button", { name: "林晓" })

    await interaction.click(trigger)
    await interaction.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "退出登录",
      })
    )

    let dialog = await screen.findByRole("dialog", { name: "退出登录？" })
    expect(dialog).toHaveTextContent(
      "退出后，你需要重新登录才能继续使用 LinkSense。"
    )
    expect(
      requests.some((request) => request.path === "/api/v1/auth/logout")
    ).toBe(false)

    await interaction.click(
      within(dialog).getByRole("button", { name: "取消" })
    )
    expect(
      screen.queryByRole("dialog", { name: "退出登录？" })
    ).not.toBeInTheDocument()
    expect(
      requests.some((request) => request.path === "/api/v1/auth/logout")
    ).toBe(false)

    await interaction.click(trigger)
    await interaction.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "退出登录",
      })
    )
    dialog = await screen.findByRole("dialog", { name: "退出登录？" })
    expect(
      within(dialog).getByRole("button", { name: "退出登录" })
    ).toHaveClass("bg-destructive", "text-destructive-foreground")
    await interaction.click(
      within(dialog).getByRole("button", { name: "退出登录" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/auth/logout" && request.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      await screen.findByRole("heading", { name: "登录 LinkSense" })
    ).toBeVisible()
  })

  it("uses the independent settings shell and saves language automatically from General", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(await screen.findByRole("heading", { name: "常规" })).toBeVisible()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /个人资料/ })).toHaveAttribute(
      "href",
      "/settings/profile"
    )
    const mobileNavigation = screen.getByRole("button", { name: /设置导航/ })
    await interaction.click(mobileNavigation)
    const mobileDrawer = await screen.findByRole("dialog", {
      name: "LinkSense 设置导航",
    })
    expect(mobileDrawer).toHaveAttribute("data-side", "left")
    expect(
      within(mobileDrawer).getByRole("textbox", { name: "搜索设置" })
    ).toBeVisible()
    expect(mobileNavigation).toHaveAttribute("aria-expanded", "true")
    await interaction.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(mobileNavigation).toHaveAttribute("aria-expanded", "false")

    const runningAction = screen.getByRole("combobox", {
      name: "执行中发送新消息",
    })
    expect(runningAction).toHaveTextContent("排队为下一条请求")
    await chooseSelectOption(interaction, "执行中发送新消息", "引导当前执行")
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/me" &&
            request.method === "PATCH" &&
            (request.body as { running_message_action?: string })
              ?.running_message_action === "steer"
        )
      ).toBeDefined()
    )
    expect(runningAction).toHaveTextContent("引导当前执行")

    const languageSelector = screen.getByRole("combobox", { name: "界面语言" })
    expect(languageSelector).toHaveClass("rounded-md")
    expect(languageSelector).not.toHaveClass("rounded-lg", "rounded-full")
    expect(screen.queryByText("语言", { exact: true })).not.toBeInTheDocument()
    expect(languageSelector).toHaveAccessibleDescription("应用UI语言")
    expect(
      languageSelector.closest('[data-slot="settings-section-header"]')
    ).toContainElement(screen.getByRole("heading", { name: "界面语言" }))
    await interaction.click(languageSelector)
    for (const language of [
      "简体中文",
      "English",
      "Español",
      "Português (Brasil)",
      "Français",
      "日本語",
    ]) {
      expect(
        await screen.findByRole("option", { name: language })
      ).toBeVisible()
    }
    await interaction.click(screen.getByRole("option", { name: "English" }))
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"))
    expect(
      screen.getByRole("combobox", { name: "Interface language" })
    ).toHaveAccessibleDescription("App UI language")
    expect(screen.getByRole("heading", { name: /^General$/u })).toBeVisible()
    expect(
      screen.getByRole("combobox", { name: "New messages during a run" })
    ).toHaveTextContent("Guide the current run")
    expect(
      screen.getByRole("complementary", {
        name: "LinkSense settings navigation",
      })
    ).toBeVisible()
    expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/me" &&
            request.method === "PATCH" &&
            (request.body as { preferred_locale?: string })
              ?.preferred_locale === "en-US"
        )
      ).toBeDefined()
    )
    expect(
      screen.queryByText("Language preference saved.")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Save" })
    ).not.toBeInTheDocument()
  })

  it("shows the profile hero, personal usage, activity, and name editor", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/profile")

    expect(
      await screen.findByRole("heading", { level: 1, name: "个人资料" })
    ).toBeVisible()
    expect(
      screen.getByRole("heading", { level: 2, name: "林晓" })
    ).toBeVisible()
    expect(
      screen.getByText("林", { selector: "[data-slot=avatar-fallback]" })
    ).toHaveClass("profile-hero-avatar-fallback", "text-xl", "font-semibold")
    expect(screen.getByText("lin@example.com")).toBeVisible()
    expect(await screen.findByText("累计 Token 数")).toBeVisible()
    expect(screen.getByText("12.3K")).toBeVisible()
    expect(screen.getByText("聊天总数")).toBeVisible()
    expect(screen.getByText("技能使用次数")).toBeVisible()
    expect(screen.getByText("当前连续天数")).toBeVisible()
    expect(screen.getByText("2 天")).toBeVisible()
    expect(
      screen.getByRole("group", {
        name: "最近 365 天的 Token 活动热力图",
      })
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "最常用的模型" })).toBeVisible()
    expect(screen.getByText("Model A")).toBeVisible()
    expect(screen.getByRole("heading", { name: "最常用的技能" })).toBeVisible()
    expect(screen.getByText("dashi-ppt")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "身份资料" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "上传新头像" })).toBeEnabled()
    const editNameButton = screen.getByRole("button", { name: "编辑名称" })
    expect(editNameButton).toHaveClass("size-8")
    await interaction.click(editNameButton)
    expect(screen.getByRole("dialog", { name: "编辑名称" })).toBeInTheDocument()
    const nameInput = screen.getByRole("textbox", { name: "名称" })
    const nameLabel = document.querySelector('label[for="profile-name"]')
    expect(nameLabel?.lastElementChild).toHaveTextContent("*")
    expect(nameLabel?.lastElementChild).toHaveClass("text-destructive")
    await interaction.clear(nameInput)
    await interaction.type(nameInput, "林晓新")
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/me" &&
            request.method === "PATCH" &&
            (request.body as { name?: string })?.name === "林晓新"
        )
      ).toBeDefined()
    )
    expect(
      requests.some((request) => request.path === "/api/v1/me/usage")
    ).toBe(true)
  })

  it("rolls back an immediate language change when automatic saving fails", async () => {
    installApiMock({ languagePatchFails: true })
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(
      await screen.findByRole("heading", { name: /^常规$/u })
    ).toBeVisible()
    await chooseSelectOption(interaction, "界面语言", "English")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法连接服务，请检查网络后重试。"
    )
    expect(screen.getByRole("heading", { name: /^常规$/u })).toBeVisible()
    expect(document.documentElement.lang).toBe("zh-CN")
    expect(window.localStorage.getItem("linksense.language")).toBe("zh-CN")
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
  })

  it("toggles the security password fields independently", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/security")

    expect(await screen.findByRole("heading", { name: "安全" })).toBeVisible()
    expect(
      screen.getByText("8~16 个字符，且包含大写、小写、数字和标点或符号。")
    ).toBeVisible()
    expect(screen.queryByText(/Unicode/u)).not.toBeInTheDocument()
    const passwordHeading = screen.getByRole("heading", { name: "修改密码" })
    const passwordSection = passwordHeading.closest(
      '[data-slot="settings-card"]'
    )
    expect(passwordHeading.closest('[data-slot="card"]')).toBeNull()
    expect(passwordSection?.parentElement).toHaveClass("gap-8")
    expect(
      screen
        .getByRole("heading", { name: "已关联的第三方账号" })
        .closest('[data-slot="card"]')
    ).toBeNull()
    const currentPassword = screen.getByLabelText(/^当前密码\s*\*?$/u)
    const newPassword = screen.getByLabelText(/^新密码\s*\*?$/u)
    const confirmation = screen.getByLabelText(/^确认新密码\s*\*?$/u)
    for (const input of [currentPassword, newPassword, confirmation]) {
      const label = document.querySelector(`label[for="${input.id}"]`)
      expect(label?.lastElementChild).toHaveTextContent("*")
      expect(label?.lastElementChild).toHaveClass("text-destructive")
      expect(label?.lastElementChild).toHaveAttribute("aria-hidden", "true")
      expect(input).toBeRequired()
    }
    await interaction.type(currentPassword, "CurrentPass1!")
    await interaction.type(newPassword, "NextPass2!")
    await interaction.type(confirmation, "NextPass2!")

    expect(currentPassword).toHaveAttribute("type", "password")
    expect(newPassword).toHaveAttribute("type", "password")
    expect(confirmation).toHaveAttribute("type", "password")

    await interaction.click(
      screen.getByRole("button", { name: "显示当前密码" })
    )
    expect(currentPassword).toHaveAttribute("type", "text")
    expect(currentPassword).toHaveValue("CurrentPass1!")
    expect(newPassword).toHaveAttribute("type", "password")
    expect(confirmation).toHaveAttribute("type", "password")

    await interaction.click(screen.getByRole("button", { name: "显示新密码" }))
    await interaction.click(
      screen.getByRole("button", { name: "显示确认新密码" })
    )
    expect(newPassword).toHaveAttribute("type", "text")
    expect(newPassword).toHaveValue("NextPass2!")
    expect(confirmation).toHaveAttribute("type", "text")
    expect(confirmation).toHaveValue("NextPass2!")

    await interaction.click(
      screen.getByRole("button", { name: "隐藏当前密码" })
    )
    expect(currentPassword).toHaveAttribute("type", "password")
    expect(newPassword).toHaveAttribute("type", "text")
    expect(confirmation).toHaveAttribute("type", "text")
  })

  it("changes and persists the theme and UI font size from Appearance settings", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    const { container } = renderApp("/settings/appearance")

    expect(await screen.findByRole("heading", { name: "外观" })).toBeVisible()
    expect(screen.getByRole("link", { name: /外观/ })).toHaveAttribute(
      "href",
      "/settings/appearance"
    )
    expect(
      screen.getByText("设置 LinkSense 的界面主题与基准字号。")
    ).toBeVisible()
    expect(screen.getByText("主题", { selector: "legend" })).toBeVisible()

    const uiFontSize = screen.getByRole("spinbutton", { name: "UI 字号" })
    expect(uiFontSize).toHaveValue(14)
    expect(uiFontSize).toHaveAttribute("min", "12")
    expect(uiFontSize).toHaveAttribute("max", "18")
    expect(uiFontSize).toHaveAttribute("step", "1")
    expect(uiFontSize).toHaveAttribute("data-slot", "input")
    expect(uiFontSize).toHaveClass("h-9", "w-18", "text-center")
    expect(uiFontSize).not.toHaveClass("h-10")

    await interaction.clear(uiFontSize)
    await interaction.type(uiFontSize, "12")
    expect(document.documentElement.dataset.uiFontSize).toBe("12")
    expect(
      document.documentElement.style.getPropertyValue("--app-ui-font-size")
    ).toBe("12px")
    expect(window.localStorage.getItem("linksense.uiFontSize")).toBe("12")

    await interaction.clear(uiFontSize)
    await interaction.type(uiFontSize, "19")
    await interaction.tab()
    expect(uiFontSize).toHaveValue(18)
    expect(document.documentElement.dataset.uiFontSize).toBe("18")
    expect(window.localStorage.getItem("linksense.uiFontSize")).toBe("18")

    const systemTheme = screen.getByRole("radio", { name: "系统" })
    const lightTheme = screen.getByRole("radio", { name: "浅色" })
    const darkTheme = screen.getByRole("radio", { name: "深色" })
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    expect(systemTheme).toBeChecked()
    expect(systemTheme.closest('[role="radiogroup"]')).toHaveClass(
      "grid",
      "grid-cols-3",
      "gap-3"
    )
    expect(systemTheme.closest('[data-slot="card"]')).toBeNull()
    expect(uiFontSize.closest('[data-slot="card-content"]')).toHaveClass(
      "px-4",
      "sm:px-5"
    )
    for (const option of [systemTheme, lightTheme, darkTheme]) {
      expect(option.closest('[data-slot="radio-group-option"]')).toHaveClass(
        "border-0",
        "w-full",
        "p-0"
      )
    }
    expect(
      container.querySelectorAll(
        '.appearance-theme-preview[aria-hidden="true"]'
      )
    ).toHaveLength(3)

    await interaction.click(darkTheme)
    expect(darkTheme).toBeChecked()
    expect(container.querySelector('[data-preview-theme="dark"]')).toHaveClass(
      "border-foreground",
      "rounded-card"
    )
    expect(
      container.querySelector('[data-preview-theme="system"]')
    ).not.toHaveClass("border-foreground")
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.dataset.themePreference).toBe("dark")
    expect(window.localStorage.getItem("linksense.theme")).toBe("dark")

    await interaction.click(lightTheme)
    expect(lightTheme).toBeChecked()
    expect(document.documentElement).not.toHaveClass("dark")
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(window.localStorage.getItem("linksense.theme")).toBe("light")
    expect(
      requests.some(
        (request) => request.path === "/api/v1/me" && request.method === "PATCH"
      )
    ).toBe(false)

    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/强调色|自定义字体|透明|对比度|动态效果/u)
    ).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage("en-US")
    })
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible()
    expect(screen.getByText("Theme", { selector: "legend" })).toBeVisible()
    expect(
      screen.getByRole("spinbutton", { name: "UI font size" })
    ).toHaveValue(18)
    expect(screen.getByRole("radio", { name: "System" })).toBeVisible()
    expect(screen.getByRole("radio", { name: "Light" })).toBeVisible()
    expect(screen.getByRole("radio", { name: "Dark" })).toBeVisible()
  })
})
