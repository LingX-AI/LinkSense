import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  conversations,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("shows archived conversations in settings and keeps archived-only search", async () => {
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      title: "整理项目会议纪要",
      archived: true,
      archive_status: "archived",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      conversationListResponse: (query) =>
        json({
          success: true,
          data: {
            items: query.get("archived") === "true" ? [archivedTask] : [],
            next_cursor: null,
            total_count: query.get("archived") === "true" ? 1 : 0,
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    expect(
      await screen.findByRole("complementary", {
        name: "LinkSense 设置导航",
      })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "已归档任务" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("heading", { name: "已归档任务" })).toBeVisible()
    expect(await screen.findByText("1 个任务")).toBeVisible()
    const searchButton = screen.getByRole("button", { name: "搜索" })
    expect(searchButton).toHaveClass("hover:bg-hover")
    expect(searchButton).not.toHaveClass("bg-secondary")
    expect(searchButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )
    const clearButton = screen.getByRole("button", { name: "清除全部" })
    expect(clearButton).toBeEnabled()
    expect(clearButton).toHaveClass("bg-destructive/10", "text-destructive")
    expect(clearButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )

    await interaction.click(searchButton)
    await interaction.type(
      screen.getByPlaceholderText("搜索标题、消息、附件、产物、插件或 Skill…"),
      "会议"
    )

    await waitFor(() =>
      expect(
        requests.some((request) => {
          if (request.path !== "/api/v1/conversations") return false
          const query = new URLSearchParams(request.query)
          return (
            query.get("archived") === "true" && query.get("search") === "会议"
          )
        })
      ).toBe(true)
    )
  })

  it("shows a muted delete icon and a direct unarchive text button for archived tasks", async () => {
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      title: "整理项目会议纪要",
      archived: true,
      archive_status: "archived",
      updated_at: "2026-07-22T14:41:00",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      conversationListResponse: (query) =>
        json({
          success: true,
          data: {
            items: query.get("archived") === "true" ? [archivedTask] : [],
            next_cursor: null,
            total_count: query.get("archived") === "true" ? 1 : 0,
          },
        }),
      conversationPatchResponse: (conversationId, body) =>
        json({
          success: true,
          data: {
            ...archivedTask,
            id: conversationId,
            archived: body.archive_status === "archived",
            archive_status: body.archive_status ?? "active",
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    const deleteButton = await screen.findByRole("button", {
      name: "删除任务“整理项目会议纪要”",
    })
    const unarchiveButton = screen.getByRole("button", {
      name: "取消归档任务“整理项目会议纪要”",
    })
    expect(
      screen.queryByRole("button", { name: "操作" })
    ).not.toBeInTheDocument()
    const archivedRow = deleteButton.closest("article")
    expect(archivedRow).toHaveClass("archived-conversation-row")
    expect(screen.getByText("1 个任务")).toBeVisible()
    expect(
      within(archivedRow as HTMLElement).getByText("2026年7月22日，14:41")
    ).toHaveAttribute("datetime", "2026-07-22T14:41:00")
    expect(deleteButton).toHaveClass("hover:bg-hover")
    expect(deleteButton).not.toHaveClass(
      "bg-destructive/10",
      "text-destructive"
    )
    expect(deleteButton.querySelector("svg")).toHaveClass(
      "text-muted-foreground"
    )
    expect(deleteButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )
    expect(unarchiveButton).toHaveClass("bg-secondary")
    expect(unarchiveButton).toHaveTextContent("取消归档")
    expect(unarchiveButton.querySelector("svg")).not.toBeInTheDocument()

    await interaction.click(deleteButton)
    const deleteDialog = await screen.findByRole("dialog", {
      name: "永久删除任务？",
    })
    await interaction.click(
      within(deleteDialog).getByRole("button", { name: "取消" })
    )

    await interaction.click(unarchiveButton)
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/archived-task-1",
          method: "PATCH",
          body: { archive_status: "active" },
        })
      )
    )
  })

  it("confirms and clears all archived tasks without targeting active tasks", async () => {
    let archivedListRequestCount = 0
    let finishClearArchived!: () => void
    const clearArchivedStart = new Promise<void>((resolve) => {
      finishClearArchived = resolve
    })
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      archived: true,
      archive_status: "archived",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      clearArchivedResponse: async () => {
        await clearArchivedStart
        return json({ success: true, data: { deleted_count: 1 } })
      },
      conversationListResponse: (query) => {
        if (query.get("archived") !== "true") {
          return json({
            success: true,
            data: { items: conversations, next_cursor: null },
          })
        }
        archivedListRequestCount += 1
        return json({
          success: true,
          data: {
            items: archivedListRequestCount === 1 ? [archivedTask] : [],
            next_cursor: null,
            total_count: archivedListRequestCount === 1 ? 1 : 0,
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    const clearButton = await screen.findByRole("button", {
      name: "清除全部",
    })
    await waitFor(() => expect(clearButton).toBeEnabled())
    await interaction.click(clearButton)

    const dialog = await screen.findByRole("dialog", {
      name: "清除全部已归档任务？",
    })
    expect(within(dialog).getByText(/未归档任务不受影响/u)).toBeVisible()
    const confirmButton = within(dialog).getByRole("button", {
      name: "清除全部",
    })
    expect(confirmButton).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    await interaction.click(confirmButton)

    expect(
      screen.queryByRole("dialog", {
        name: "清除全部已归档任务？",
      })
    ).not.toBeInTheDocument()
    const clearingLabel = await screen.findByText("正在清除已归档任务…")
    const clearingToast = clearingLabel.closest("[data-sonner-toast]")
    expect(clearingToast).toHaveAttribute("data-type", "loading")
    expect(clearingToast?.closest("[data-sonner-toaster]")).toHaveAttribute(
      "data-y-position",
      "top"
    )
    expect(clearingToast?.closest("[data-sonner-toaster]")).toHaveAttribute(
      "data-x-position",
      "center"
    )
    expect(clearButton).toBeDisabled()
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/archived",
          method: "DELETE",
        })
      )
    )
    finishClearArchived()
    expect(await screen.findByText("没有已归档任务")).toBeVisible()
    expect(screen.queryByText("正在清除已归档任务…")).not.toBeInTheDocument()
    const successLabel = await screen.findByText("已清除 1 个已归档任务")
    expect(successLabel).toBeVisible()
    expect(successLabel.closest("[data-sonner-toast]")).toBe(clearingToast)
    expect(clearingToast).toHaveAttribute("data-type", "success")
    expect(
      screen.queryByRole("button", { name: "搜索" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "清除全部" })
    ).not.toBeInTheDocument()
  })

  it("keeps the clear confirmation closed and restores the archived list when clearing fails", async () => {
    let finishClearArchived!: () => void
    const clearArchivedStart = new Promise<void>((resolve) => {
      finishClearArchived = resolve
    })
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      archived: true,
      archive_status: "archived",
    }
    installApiMock({
      userOverride: { role: "user" },
      conversationListResponse: (query) =>
        json({
          success: true,
          data: {
            items: query.get("archived") === "true" ? [archivedTask] : [],
            next_cursor: null,
            total_count: query.get("archived") === "true" ? 1 : 0,
          },
        }),
      clearArchivedResponse: async () => {
        await clearArchivedStart
        return json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
      },
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    await interaction.click(
      await screen.findByRole("button", { name: "清除全部" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "清除全部已归档任务？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "清除全部" })
    )

    expect(dialog).not.toBeInTheDocument()
    const clearingLabel = await screen.findByText("正在清除已归档任务…")
    expect(clearingLabel).toBeVisible()
    const clearingToast = clearingLabel.closest("[data-sonner-toast]")
    expect(clearingToast).toHaveAttribute("data-type", "loading")
    finishClearArchived()

    await waitFor(() =>
      expect(screen.queryByText("正在清除已归档任务…")).not.toBeInTheDocument()
    )
    expect(clearingToast).toHaveAttribute("data-type", "error")
    expect(clearingToast).toBeVisible()
    expect(
      screen.queryByRole("dialog", {
        name: "清除全部已归档任务？",
      })
    ).not.toBeInTheDocument()
    expect(screen.getByText("1 个任务")).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "清除全部" })).toBeEnabled()
    )
  })

  it("creates a personal credential with multiple environment variables", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/credentials")

    expect(
      await screen.findByRole("heading", { name: "插件凭据" })
    ).toBeInTheDocument()
    const settingsSidebar = screen.getByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("link", { name: "插件凭据" })
    ).toHaveAttribute("aria-current", "page")
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "插件凭据生效来源" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    await interaction.click(
      await screen.findByRole("button", { name: "新增凭据" })
    )
    await interaction.type(screen.getByLabelText("名称"), "业务系统")
    await interaction.type(screen.getByLabelText("服务标识"), "service_api")
    await interaction.clear(screen.getByLabelText("配置项名称"))
    await interaction.type(screen.getByLabelText("配置项名称"), "API_KEY")
    await interaction.type(screen.getByLabelText("授权信息"), "secret-one")
    await interaction.click(screen.getByRole("button", { name: "添加配置项" }))
    const credentialDialog = screen.getByRole("dialog", { name: "新增凭据" })
    expect(credentialDialog).toHaveClass(
      "max-h-[90vh]",
      "overflow-y-auto",
      "sm:max-w-2xl"
    )
    expect(
      credentialDialog.querySelectorAll('[data-slot="credential-secret-row"]')
    ).toHaveLength(2)
    expect(
      within(credentialDialog).getAllByRole("button", {
        name: "移除此配置项",
      })
    ).toHaveLength(2)
    const keyInputs = screen.getAllByLabelText("配置项名称")
    const valueInputs = screen.getAllByLabelText("授权信息")
    expect(valueInputs[0]).toHaveAttribute("autocomplete", "new-password")
    await interaction.clear(keyInputs[1]!)
    await interaction.type(keyInputs[1]!, "API_SECRET")
    await interaction.type(valueInputs[1]!, "secret-two")
    await interaction.click(screen.getByRole("button", { name: "确认新增" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/credentials" && request.method === "POST"
        )?.body
      ).toEqual({
        name: "业务系统",
        provider_type: "service_api",
        secret_payload: { API_KEY: "secret-one", API_SECRET: "secret-two" },
      })
    )
  })

  it("removes the public credential administration route", async () => {
    installApiMock()
    renderApp("/admin/credentials")

    expect(await screen.findByText("页面不存在")).toBeVisible()
    expect(
      screen.queryByRole("link", { name: "公共凭据" })
    ).not.toBeInTheDocument()
  })

  it("explains credentials and does not show a separate technical source inspector", async () => {
    installApiMock()
    renderApp("/credentials")
    expect(
      await screen.findByRole("heading", { name: "插件凭据" })
    ).toBeVisible()
    expect(
      screen.getByText(/插件凭据是插件访问外部服务时使用的密钥等授权信息/)
    ).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "插件" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/secret-one|credential-1/)
    ).not.toBeInTheDocument()
  })
})
