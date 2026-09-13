import i18n from "@/i18n"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { setupApplicationTests, installApiMock, renderApp } from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("shows two fixed roles without role customization controls", async () => {
    installApiMock()
    renderApp("/admin/roles")

    expect(
      await screen.findByRole(
        "heading",
        { name: "角色与权限" },
        { timeout: 8_000 }
      )
    ).toBeVisible()
    expect(
      screen
        .getByRole("heading", { name: "角色与权限" })
        .closest(".management-page")
        ?.closest(".settings-content")
    ).toHaveClass("settings-content")
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "用户与用户组" })).toHaveAttribute(
      "href",
      "/admin/users"
    )
    expect(screen.getByRole("link", { name: "用量统计" })).toHaveAttribute(
      "href",
      "/admin/usage"
    )
    expect(
      screen.queryByText(/仅有 user 与 admin 两种固定角色/)
    ).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "权限矩阵" })).toBeVisible()
    const permissionTable = screen.getByRole("table", { name: "权限矩阵" })
    const expectedPermissions = [
      "管理自己的任务",
      "管理个人资料、外观与安全设置",
      "创建、导入和管理个人插件/Skill",
      "浏览、安装、更新插件并提交上架审核",
      "管理个人凭据",
      "管理自有知识库，并使用获授权知识库",
      "管理用户与用户组",
      "审核并治理插件中心条目",
      "治理全局知识库元数据与生命周期（不自动获得正文权限）",
      "配置知识库数据源与同步",
      "配置生成、图片理解、嵌入与重排模型及 Token 单价",
      "管理产品设置与登录认证",
      "查看系统健康并执行知识库维护",
      "查看跨用户脱敏审计与任务元数据（不含正文）",
      "查看全局、用户组和用户的模型用量与费用",
    ]
    for (const permission of expectedPermissions) {
      expect(within(permissionTable).getByText(permission)).toBeVisible()
    }
    const personalKnowledgeRow = within(permissionTable)
      .getByText("管理自有知识库，并使用获授权知识库")
      .closest("tr")
    const knowledgeGovernanceRow = within(permissionTable)
      .getByText("治理全局知识库元数据与生命周期（不自动获得正文权限）")
      .closest("tr")
    if (!personalKnowledgeRow || !knowledgeGovernanceRow) {
      throw new Error("Expected knowledge permission rows")
    }
    expect(within(personalKnowledgeRow).getAllByRole("cell")).toHaveLength(3)
    expect(within(personalKnowledgeRow).getAllByText("是")).toHaveLength(2)
    expect(within(knowledgeGovernanceRow).getByText("否")).toBeVisible()
    expect(within(knowledgeGovernanceRow).getByText("是")).toBeVisible()
    expect(
      screen.getByText(
        /管理员身份本身不授予其他用户的任务正文或知识库正文访问权/
      )
    ).toBeVisible()
    expect(await screen.findByText("14 个账号")).toBeVisible()
    expect(screen.getByText("3 个账号")).toBeVisible()
    expect(
      screen.queryByRole("button", {
        name: /新增角色|创建角色|编辑角色|删除角色/,
      })
    ).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage("en-US")
    })
    expect(
      screen.getByText(
        "Manage owned knowledge bases and use shared knowledge bases"
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        "View model usage and cost globally, by group, and by user"
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        /does not grant access to other users' task or knowledge base content/
      )
    ).toBeVisible()
  }, 10_000)

  it("switches between users and user groups with the combined page tabs", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    expect(
      await screen.findByRole(
        "heading",
        { name: "用户与用户组" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    const tablist = screen.getByRole("tablist", {
      name: "用户与用户组管理",
    })
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["用户", "用户组"])
    expect(screen.getByRole("tab", { name: "用户" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute(
      "aria-selected",
      "false"
    )
    expect(tablist).toHaveClass(
      "max-w-full",
      "justify-start",
      "overflow-x-auto"
    )

    await interaction.click(screen.getByRole("tab", { name: "用户组" }))

    expect(await screen.findByText("暂无用户组")).toBeVisible()
    expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("button", { name: "创建用户组" })).toBeVisible()
  })

  it("deletes a user group after an empty 204 response", async () => {
    const { requests } = installApiMock({
      userGroupsOverride: [
        {
          id: "group-1",
          name: "测试",
          description: undefined,
          member_count: 1,
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/groups")

    const groupHeading = await screen.findByRole(
      "heading",
      { name: "测试" },
      { timeout: 3_000 }
    )
    const groupRow = groupHeading.closest("article")
    expect(groupRow).not.toBeNull()
    await interaction.click(
      within(groupRow as HTMLElement).getByRole("button", { name: "操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "删除" })
    )
    await interaction.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "删除" })
    )

    expect(await screen.findByText("暂无用户组")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "测试" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("无法连接服务，请检查网络后重试。")
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/user-groups/group-1" &&
          request.method === "DELETE"
      )
    ).toBe(true)
  })

  it("shows a user group's member count and opens its member list", async () => {
    const { requests } = installApiMock({
      userGroupsOverride: [
        {
          id: "group-1",
          name: "IT 部门",
          description: undefined,
          member_count: 1,
          member_ids: ["user-1"],
        },
      ],
      managedUsersOverride: [
        {
          id: "user-1",
          name: "林晓",
          email: "lin@example.com",
          user_group_ids: ["group-1"],
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/groups")

    const memberCount = await screen.findByRole(
      "button",
      { name: "查看用户组 IT 部门 的 1 名成员" },
      { timeout: 5_000 }
    )
    expect(memberCount).toHaveTextContent("成员数: 1")

    await interaction.click(memberCount)

    const dialog = await screen.findByRole("dialog", {
      name: "IT 部门的成员",
    })
    expect(within(dialog).getByText("共 1 名成员")).toBeVisible()
    expect(within(dialog).getAllByText("林晓")).toHaveLength(2)
    expect(within(dialog).getByText("lin@example.com")).toBeVisible()
    const memberList = within(dialog).getByRole("list", {
      name: "用户组成员列表",
    })
    expect(memberList).toHaveClass("divide-border/50")
    expect(memberList.parentElement).toHaveClass("border-border/50")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/users" &&
          new URLSearchParams(request.query).get("user_group_id") === "group-1"
      )
    ).toBe(true)
  })

  it("searches and selects user group members by name or email", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/groups")

    await interaction.click(
      await screen.findByRole("button", { name: "创建用户组" })
    )
    const dialog = await screen.findByRole("dialog", { name: "创建用户组" })
    const memberTrigger = within(dialog).getByRole("button", {
      name: "选择成员",
    })

    await interaction.click(memberTrigger)
    const searchInput = await screen.findByPlaceholderText("搜索成员姓名或邮箱")
    const memberPicker = searchInput.closest('[data-slot="popover-content"]')
    if (!(memberPicker instanceof HTMLElement)) {
      throw new Error("Expected the member picker popover to be rendered.")
    }

    await interaction.type(searchInput, "林晓")
    expect(within(memberPicker).getByText("lin@example.com")).toBeVisible()

    await interaction.clear(searchInput)
    await interaction.type(searchInput, "lin@example.com")
    await interaction.click(within(memberPicker).getByText("林晓"))
    expect(memberTrigger).toHaveTextContent("林晓")

    await interaction.click(within(memberPicker).getByText("林晓"))
    expect(memberTrigger).toHaveTextContent("选择成员")
  })

  it("uses the settings shell for administrator user management without password controls", async () => {
    const createObjectURL = vi.fn(() => "blob:user-import-template")
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/users")
    expect(
      await screen.findByRole(
        "heading",
        { name: "用户与用户组" },
        { timeout: 5_000 }
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(await screen.findByText("lin@example.com")).toBeVisible()
    expect(screen.getByRole("table")).toHaveClass("user-management-table")
    expect(screen.getByRole("tab", { name: "用户" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute(
      "aria-selected",
      "false"
    )
    const userRow = screen.getByRole("row", { name: /lin@example\.com/u })
    const userCells = within(userRow).getAllByRole("cell")
    expect(userRow.querySelector('[data-slot="avatar-fallback"]')).toHaveClass(
      "text-xs",
      "font-semibold"
    )
    expect(userCells[6]).toHaveTextContent("-")
    expect(
      within(userRow).getByRole("switch", { name: "禁用用户 林晓" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("button", { name: /设置密码|重置密码/ })
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("button", { name: "导入 Excel" }))
    const importDialog = screen.getByRole("dialog", { name: "导入 Excel" })
    const importActions = importDialog.querySelector(
      '[data-slot="excel-import-actions"]'
    )
    expect(importActions).toHaveClass(
      "flex",
      "flex-col",
      "sm:flex-row",
      "sm:items-center"
    )
    expect(
      within(importDialog).getByRole("button", { name: "选择 Excel 文件" })
    ).toHaveClass("w-full", "min-w-0", "justify-start", "sm:flex-1")
    const downloadTemplate = within(importDialog).getByRole("button", {
      name: "下载 Excel 模板",
    })
    expect(downloadTemplate).toBeVisible()
    await interaction.click(downloadTemplate)
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      "LinkSense-用户导入模板.xlsx"
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/users/import-template.xlsx" &&
          request.method === "GET"
      )
    ).toBe(true)

    await interaction.upload(
      within(importDialog).getByLabelText("选择 Excel 文件"),
      new File([new Uint8Array([80, 75, 3, 4])], "users.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    )
    await interaction.click(
      within(importDialog).getByRole("button", { name: "开始导入" })
    )

    const notification = await screen.findByText("导入结果")
    const notificationToast = notification.closest("[data-sonner-toast]")
    expect(notificationToast).not.toBeNull()
    expect(notification.closest('[role="dialog"]')).toBeNull()
    expect(notificationToast).toHaveTextContent("成功 2 条，跳过 0 条")
  })

  it("uses an edit icon and toggles another user's account status", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "managed-user-1",
          name: "张宁",
          email: "zhang@example.com",
          role: "user",
          status: "active",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    const userRow = await screen.findByRole("row", {
      name: /zhang@example\.com/u,
    })
    const editAction = within(userRow).getByRole("button", { name: "编辑" })
    expect(editAction.querySelector("svg")).not.toBeNull()
    expect(editAction).toHaveClass("size-6", "text-muted-foreground")
    expect(within(userRow).queryByText("编辑")).not.toBeInTheDocument()

    const statusSwitch = within(userRow).getByRole("switch", {
      name: "禁用用户 张宁",
    })
    expect(statusSwitch).toBeEnabled()
    expect(statusSwitch).toBeChecked()
    await interaction.click(statusSwitch)

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/managed-user-1" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({ status: "disabled" })
    )
    const enableSwitch = await within(userRow).findByRole("switch", {
      name: "启用用户 张宁",
    })
    expect(enableSwitch).not.toBeChecked()
    expect(await screen.findByText("已禁用用户 张宁")).toBeVisible()

    await interaction.click(enableSwitch)
    await waitFor(() =>
      expect(
        requests
          .filter(
            (request) =>
              request.path === "/api/v1/admin/users/managed-user-1" &&
              request.method === "PATCH"
          )
          .at(-1)?.body
      ).toEqual({ status: "active" })
    )
    expect(
      await within(userRow).findByRole("switch", { name: "禁用用户 张宁" })
    ).toBeChecked()
    expect(await screen.findByText("已启用用户 张宁")).toBeVisible()
  })

  it("keeps the last enabled administrator status switch disabled", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "last-admin",
          name: "最后管理员",
          email: "last-admin@example.com",
          role: "admin",
          status: "active",
        },
      ],
      roleSummaryOverride: [
        {
          role: "user",
          active_count: 0,
          disabled_count: 0,
          total_count: 0,
        },
        {
          role: "admin",
          active_count: 1,
          disabled_count: 0,
          total_count: 1,
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    const statusSwitch = await screen.findByRole("switch", {
      name: "禁用用户 最后管理员",
    })
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users/role-summary" &&
            request.method === "GET"
        )
      ).toBe(true)
    )
    expect(statusSwitch).toHaveAttribute("aria-disabled", "true")

    await interaction.hover(statusSwitch.parentElement as HTMLElement)
    expect(
      await screen.findByText("系统必须至少保留一个启用状态的管理员。")
    ).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/users/last-admin" &&
          request.method === "PATCH"
      )
    ).toBe(false)
  })

  it("opens model settings from its standalone administrator route", async () => {
    const { requests } = installApiMock()
    renderApp("/admin/models")

    expect(
      await screen.findByRole(
        "heading",
        { name: "模型设置" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    expect(
      await screen.findByRole(
        "heading",
        { name: "模型渠道列表" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "模型服务" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("tab", { name: "模型设置" })
    ).not.toBeInTheDocument()

    const settingsSidebar = screen.getByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("link", { name: "模型设置" })
    ).toHaveAttribute("aria-current", "page")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/model-provider-settings" &&
          request.method === "GET"
      )
    ).toBe(true)
    expect(
      requests.some((request) =>
        [
          "/api/v1/admin/product-settings",
          "/api/v1/admin/authentication-settings",
        ].includes(request.path)
      )
    ).toBe(false)
  })

  it("orders administrator navigation with system update last", async () => {
    installApiMock()
    renderApp("/admin/users")

    await screen.findByRole("heading", { name: "用户与用户组" })
    const administrationNavigation = await screen.findByRole("navigation", {
      name: "管理",
    })
    const links = within(administrationNavigation).getAllByRole("link")
    const usageLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/usage"
    )
    const usersAndGroupsLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/users"
    )
    const quotaLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/quotas"
    )
    const systemUpdateLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/system-update"
    )

    expect(usageLinkIndex).toBeGreaterThanOrEqual(0)
    expect(usersAndGroupsLinkIndex).toBeGreaterThanOrEqual(0)
    expect(systemUpdateLinkIndex).toBeGreaterThan(usageLinkIndex)
    expect(
      links.filter((link) => link.textContent === "用户与用户组")
    ).toHaveLength(1)
    expect(
      links.some((link) => link.getAttribute("href") === "/admin/groups")
    ).toBe(false)
    expect(quotaLinkIndex).toBeGreaterThanOrEqual(0)
    expect(usageLinkIndex).toBe(quotaLinkIndex + 1)
    expect(links.at(-1)).toHaveAttribute("href", "/admin/system-update")
  })

  it("disables the user group combobox when no groups are available", async () => {
    installApiMock({ userGroupsOverride: [] })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    await interaction.click(screen.getByRole("button", { name: "编辑" }))

    const dialog = await screen.findByRole("dialog", { name: "编辑用户" })
    const groupSelector = within(dialog).getByRole("combobox", {
      name: "所属用户组",
    })
    expect(groupSelector).toBeDisabled()
    expect(groupSelector).toHaveAttribute("placeholder", "暂无数据")
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("shows two user group names and reveals the complete list from the overflow badge", async () => {
    installApiMock({
      userOverride: {
        user_group_ids: [
          "group-research",
          "group-product",
          "group-marketing",
          "group-finance",
          "group-operations",
        ],
        user_groups: [
          { id: "group-research", name: "研发组" },
          { id: "group-product", name: "产品组" },
          { id: "group-marketing", name: "市场组" },
          { id: "group-finance", name: "财务组" },
          { id: "group-operations", name: "运营组" },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    const groupCell = within(userRow).getAllByRole("cell")[6]
    expect(groupCell).toHaveTextContent("研发组")
    expect(groupCell).toHaveTextContent("产品组")
    expect(groupCell).toHaveTextContent("+3")
    expect(within(groupCell).queryByText("市场组")).not.toBeInTheDocument()

    const overflowBadge = within(groupCell).getByLabelText("另有 3 个用户组")
    await interaction.hover(overflowBadge)

    const tooltip = await screen.findByRole("tooltip")
    expect(
      within(tooltip).getByRole("list", { name: "所属用户组" })
    ).toHaveTextContent("研发组产品组市场组财务组运营组")
  })

  it("filters and updates user groups with the dropdown multi-select", async () => {
    const { requests } = installApiMock({
      userOverride: { user_group_ids: ["group-it"] },
      userGroupsOverride: [
        {
          id: "group-it",
          name: "IT",
          description: "信息技术",
          member_count: 1,
        },
        {
          id: "group-marketing",
          name: "市场部",
          description: "品牌与市场",
          member_count: 2,
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    await interaction.click(screen.getByRole("button", { name: "编辑" }))

    const dialog = await screen.findByRole("dialog", { name: "编辑用户" })
    const groupSelector = within(dialog).getByRole("combobox", {
      name: "所属用户组",
    })
    expect(
      within(dialog).getByRole("button", { name: "移除用户组 IT" })
    ).toBeVisible()

    await interaction.click(groupSelector)
    await interaction.type(groupSelector, "市场")
    await interaction.click(
      await screen.findByRole("option", { name: /市场部/u })
    )
    expect(
      within(dialog).getByRole("button", { name: "移除用户组 市场部" })
    ).toBeVisible()

    await interaction.click(
      within(dialog).getByRole("button", { name: "移除用户组 IT" })
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/user-1" &&
            request.method === "PATCH"
        )?.body
      ).toMatchObject({ user_group_ids: ["group-marketing"] })
    )
  })

  it("edits per-user credit quotas in credits", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          total_credit_limit: "7",
          weekly_credit_limit: "2.5",
          monthly_credit_limit: "0.5",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    expect(userRow).toHaveTextContent("2.5")
    expect(userRow).toHaveTextContent("0.5")
    expect(within(userRow).getByText("7")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "编辑" }))
    const dialog = await screen.findByRole("dialog", { name: "编辑用户" })
    const quotaSection = within(dialog).getByRole("region", {
      name: "个人额度",
    })
    expect(quotaSection.tagName).toBe("SECTION")
    expect(
      within(quotaSection).getByRole("heading", {
        level: 3,
        name: "个人额度",
      })
    ).toHaveClass("form-label")
    const totalQuotaInput = within(dialog).getByLabelText("总额度")
    const weeklyQuotaInput = within(dialog).getByLabelText("周额度")
    const monthlyQuotaInput = within(dialog).getByLabelText("月额度")
    expect(totalQuotaInput).toHaveValue("7")
    expect(weeklyQuotaInput).toHaveValue("2.5")
    expect(monthlyQuotaInput).toHaveValue("0.5")

    await interaction.clear(totalQuotaInput)
    await interaction.type(totalQuotaInput, "8.5")
    await interaction.clear(weeklyQuotaInput)
    await interaction.type(weeklyQuotaInput, "0.75")
    await interaction.clear(monthlyQuotaInput)
    await interaction.type(monthlyQuotaInput, "1.25")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/user-1" &&
            request.method === "PATCH"
        )?.body
      ).toMatchObject({
        total_credit_limit: "8.5",
        weekly_credit_limit: "0.75",
        monthly_credit_limit: "1.25",
      })
    )
  })

  it("shows a short hyphen for missing per-user credit quotas", async () => {
    installApiMock({
      managedUsersOverride: [
        {
          total_credit_limit: null,
          weekly_credit_limit: null,
          monthly_credit_limit: null,
        },
      ],
    })
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    const cells = within(userRow).getAllByRole("cell")
    expect(cells[7]).toHaveTextContent("-")
    expect(cells[8]).toHaveTextContent("-")
    expect(cells[9]).toHaveTextContent("-")
  })

  it("shows and filters users by registration source", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "self-registered-user",
          name: "自主注册用户",
          email: "self-registered@example.com",
          registration_source: "self_registration",
        },
        {
          id: "invited-user",
          name: "受邀用户",
          email: "invited@example.com",
          registration_source: "organization_invitation",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    expect(await screen.findByText("self-registered@example.com")).toBeVisible()
    expect(screen.getByText("invited@example.com")).toBeVisible()
    expect(screen.getByText("自主注册")).toBeVisible()
    expect(screen.getByText("组织邀请")).toBeVisible()

    await interaction.click(screen.getByLabelText("用户来源"))
    await interaction.click(
      await screen.findByRole("option", { name: "自主注册" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users" &&
            new URLSearchParams(request.query).get("registration_source") ===
              "self_registration"
        )
      ).toBe(true)
    )
    expect(await screen.findByText("self-registered@example.com")).toBeVisible()
    expect(screen.queryByText("invited@example.com")).toBeNull()

    await interaction.click(screen.getByLabelText("用户来源"))
    await interaction.click(
      await screen.findByRole("option", { name: "组织邀请" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users" &&
            new URLSearchParams(request.query).get("registration_source") ===
              "organization_invitation"
        )
      ).toBe(true)
    )
    expect(await screen.findByText("invited@example.com")).toBeVisible()
    expect(screen.queryByText("self-registered@example.com")).toBeNull()
  })

  it("batch-updates total quota without changing unchecked periodic quotas", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    await interaction.click(screen.getByLabelText("选择用户 林晓"))
    await interaction.click(
      screen.getByRole("button", { name: "批量设置额度（1）" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "批量设置用户额度",
    })
    await interaction.click(within(dialog).getByText("更新总额度"))
    await interaction.click(within(dialog).getByText("更新周额度"))
    await interaction.click(within(dialog).getByText("更新月额度"))
    const totalQuotaInput = within(dialog).getByLabelText("总额度")
    await interaction.type(totalQuotaInput, "1.5")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/credit-limits" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({
        user_ids: ["user-1"],
        total_credit_limit: "1.5",
      })
    )
  })

  it("shows usage remaining percentages and filters users with no weekly remaining usage", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "weekly-exhausted-user",
          name: "周用完",
          email: "weekly-exhausted@example.com",
          weekly_credit_limit: "10",
          monthly_credit_limit: "40",
          credit_quota: {
            total: null,
            weekly: {
              limit_credits: "10",
              used_credits: "10",
              remaining_credits: "0",
              remaining_percentage: 0,
              reset_at: "2026-08-10T00:00:00.000Z",
            },
            monthly: {
              limit_credits: "40",
              used_credits: "30",
              remaining_credits: "10",
              remaining_percentage: 25,
              reset_at: "2026-09-01T00:00:00.000Z",
            },
          },
        },
        {
          id: "weekly-remaining-user",
          name: "还有用量",
          email: "weekly-remaining@example.com",
          weekly_credit_limit: "10",
          monthly_credit_limit: "40",
          credit_quota: {
            total: null,
            weekly: {
              limit_credits: "10",
              used_credits: "5",
              remaining_credits: "5",
              remaining_percentage: 50,
              reset_at: "2026-08-10T00:00:00.000Z",
            },
            monthly: {
              limit_credits: "40",
              used_credits: "40",
              remaining_credits: "0",
              remaining_percentage: 0,
              reset_at: "2026-09-01T00:00:00.000Z",
            },
          },
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    const exhaustedRow = await screen.findByRole("row", {
      name: /weekly-exhausted@example\.com/u,
    })
    expect(exhaustedRow).toHaveTextContent("10")
    expect(exhaustedRow).toHaveTextContent("剩余额度 0（0%）")
    expect(exhaustedRow).toHaveTextContent("40")
    expect(exhaustedRow).toHaveTextContent("剩余额度 10（25%）")
    expect(
      await screen.findByText("weekly-remaining@example.com")
    ).toBeVisible()

    await interaction.click(screen.getByLabelText("额度剩余"))
    await interaction.click(
      await screen.findByRole("option", { name: "周额度剩余为 0" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users" &&
            new URLSearchParams(request.query).get(
              "credit_quota_remaining_zero"
            ) === "weekly"
        )
      ).toBe(true)
    )
    expect(
      await screen.findByText("weekly-exhausted@example.com")
    ).toBeVisible()
    expect(screen.queryByText("weekly-remaining@example.com")).toBeNull()
  })

  it("keeps user identity and actions visible without compressing the last-login column", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          total_credit_limit: "7",
          weekly_credit_limit: "2.5",
          monthly_credit_limit: "0.5",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const table = screen.getByRole("table")
    const headerCells = within(table).getAllByRole("columnheader")
    expect(headerCells[0]).toHaveClass("user-management-selection-column")
    expect(headerCells[1]).toHaveClass("user-management-name-column")
    expect(headerCells.at(-2)).toHaveClass("user-management-last-login-column")
    expect(headerCells.at(-1)).toHaveClass("user-management-actions-column")

    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    const userCells = within(userRow).getAllByRole("cell")
    expect(userCells[0]).toHaveClass("user-management-selection-column")
    expect(userCells[1]).toHaveClass("user-management-name-column")
    expect(userCells.at(-2)).toHaveClass("user-management-last-login-column")
    expect(userCells[1]?.querySelector(".table-primary")).toHaveClass(
      "truncate"
    )
    expect(userCells[1]?.querySelector(".table-secondary")).toHaveClass(
      "truncate"
    )
    const actionCell = userCells.at(-1)
    expect(actionCell).toBeDefined()
    const actionCellElement = actionCell as HTMLElement
    expect(actionCellElement).toHaveClass("user-management-actions-column")

    await interaction.click(
      within(actionCellElement).getByRole("button", {
        name: "调整 林晓 的额度",
      })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "调整个人额度",
    })
    const totalQuotaInput = within(dialog).getByLabelText("总额度")
    const weeklyQuotaInput = within(dialog).getByLabelText("周额度")
    const monthlyQuotaInput = within(dialog).getByLabelText("月额度")
    expect(totalQuotaInput).toHaveValue("7")
    expect(weeklyQuotaInput).toHaveValue("2.5")
    expect(monthlyQuotaInput).toHaveValue("0.5")

    await interaction.clear(totalQuotaInput)
    await interaction.type(totalQuotaInput, "8")
    await interaction.clear(weeklyQuotaInput)
    await interaction.type(weeklyQuotaInput, "0.6")
    await interaction.clear(monthlyQuotaInput)
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/user-1" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({
        total_credit_limit: "8",
        weekly_credit_limit: "0.6",
        monthly_credit_limit: null,
      })
    )
  })

  it("hides administrator settings from regular users while keeping the settings entry", async () => {
    installApiMock({ userOverride: { role: "user" } })
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(await screen.findByRole("heading", { name: "常规" })).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "管理" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "用户" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "用量统计" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "已归档任务" })).toHaveAttribute(
      "href",
      "/archived"
    )
    expect(
      screen.queryByRole("link", { name: "插件中心" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", "/conversations/new")
    expect(screen.getByRole("link", { name: "LinkSense" })).toHaveAttribute(
      "href",
      "/conversations/new"
    )

    await interaction.click(
      screen.getByRole("link", { name: "返回 LinkSense" })
    )
    const accountTrigger = await screen.findByRole("button", {
      name: "林晓",
    })
    expect(screen.getByRole("link", { name: "插件中心" })).toHaveAttribute(
      "href",
      "/capabilities"
    )
    expect(
      screen.queryByRole("link", { name: "已归档任务" })
    ).not.toBeInTheDocument()
    await interaction.click(accountTrigger)
    expect(await screen.findByRole("menuitem", { name: "设置" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "个人设置" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "个人凭据" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "管理中心" })
    ).not.toBeInTheDocument()
  })

  it("applies the configured product name across settings, the app shell, and browser metadata", async () => {
    installApiMock({
      systemName: "MOSS 工作台",
      userOverride: { role: "user" },
    })
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(await screen.findByRole("heading", { name: "常规" })).toBeVisible()
    expect(
      screen.getByRole("complementary", { name: "MOSS 工作台 设置导航" })
    ).toBeVisible()
    const backLink = screen.getByRole("link", { name: "返回 MOSS 工作台" })
    expect(backLink).toHaveAttribute("href", "/conversations/new")
    expect(document.title).toBe("MOSS 工作台")
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      "content",
      "MOSS 工作台"
    )

    await interaction.click(backLink)

    expect(
      await screen.findByRole("complementary", { name: "MOSS 工作台 导航" })
    ).toBeVisible()
    expect(
      await screen.findByPlaceholderText("描述你希望 MOSS 工作台 完成的任务…")
    ).toBeVisible()
  })

  it("redirects regular users away from administrator routes without loading admin data", async () => {
    const { requests } = installApiMock({ userOverride: { role: "user" } })
    renderApp("/admin/users")

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
    expect(
      requests.some((request) => request.path.startsWith("/api/v1/admin/"))
    ).toBe(false)
  })
})
