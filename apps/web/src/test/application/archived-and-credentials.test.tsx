import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  chooseSelectOption,
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
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      archived: true,
      archive_status: "archived",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      clearArchivedDeletedCount: 1,
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

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/archived",
          method: "DELETE",
        })
      )
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "清除全部已归档任务？",
        })
      ).not.toBeInTheDocument()
    )
    expect(await screen.findByText("没有已归档任务")).toBeVisible()
    expect(await screen.findByText("已清除 1 个已归档任务。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "搜索" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "清除全部" })
    ).not.toBeInTheDocument()
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
      await screen.findByRole("heading", { name: "插件凭据生效来源" })
    ).toBeVisible()
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
    await interaction.type(screen.getByLabelText("提供方类型"), "service_api")
    await interaction.clear(screen.getByLabelText("环境变量名"))
    await interaction.type(screen.getByLabelText("环境变量名"), "API_KEY")
    await interaction.type(screen.getByLabelText("环境变量值"), "secret-one")
    await interaction.click(
      screen.getByRole("button", { name: "添加环境变量" })
    )
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
        name: "移除此环境变量",
      })
    ).toHaveLength(2)
    const keyInputs = screen.getAllByLabelText("环境变量名")
    const valueInputs = screen.getAllByLabelText("环境变量值")
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

  it("shows the redacted effective credential source for each plugin key", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/credentials")

    await screen.findByRole("heading", { name: "插件凭据生效来源" })
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(
      screen
        .getByRole("combobox", { name: "插件" })
        .closest('[data-slot="field"]')
    ).toHaveClass("credential-effective-plugin-field")
    await chooseSelectOption(interaction, "插件", "业务数据")
    expect(await screen.findByText("SERVICE_API_KEY")).toBeVisible()
    expect(
      screen
        .getAllByText("个人凭据")
        .some((element) => element.dataset.slot === "badge")
    ).toBe(true)
    expect(
      screen.queryByText(/secret-one|credential-1/)
    ).not.toBeInTheDocument()
  })
})
