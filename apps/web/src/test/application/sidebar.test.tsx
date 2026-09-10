import { formatRelativeDate } from "@/i18n/date"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  conversation,
  conversations,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it.each([
    ["APPLICATION_NOT_FOUND", "应用不存在或你无权访问。"],
    ["APPLICATION_DISABLED", "应用已停用，暂时不能开始新任务。"],
    [
      "APPLICATION_DEPENDENCY_UNAVAILABLE",
      "应用依赖的模型、插件/Skill 或知识库当前不可用。",
    ],
  ] as const)(
    "marks only unavailable application tasks and shows their reason (%s)",
    async (reason, message) => {
      installApiMock({
        conversationListResponse: () =>
          json({
            success: true,
            data: {
              items: conversations.map((item, index) => ({
                ...item,
                application:
                  index === 2
                    ? null
                    : {
                        id: "50000000-0000-4000-8000-000000000001",
                        name: "应用",
                        available: index === 1,
                        unavailable_reason: index === 1 ? null : reason,
                      },
              })),
              next_cursor: null,
            },
          }),
      })
      renderApp()
      const sidebar = await screen.findByRole("complementary", {
        name: "LinkSense 导航",
      })
      const warning = await within(sidebar).findByRole("status", {
        name: "应用不可用，暂时无法发送消息",
      })
      expect(warning.closest("a")).toHaveTextContent(conversations[0]!.title)
      await userEvent.setup().hover(warning)
      const tooltip = await screen.findByRole("tooltip")
      expect(tooltip).toHaveTextContent(message)
      expect(tooltip).toHaveClass(
        "rounded-md",
        "border",
        "border-[var(--app-border)]",
        "bg-[var(--app-popover)]",
        "text-[var(--app-text)]",
        "font-medium"
      )
      expect(tooltip.children).toHaveLength(0)
      expect(
        within(sidebar).getAllByRole("status", {
          name: "应用不可用，暂时无法发送消息",
        })
      ).toHaveLength(1)
    }
  )

  it("does not expose rename actions or shortcuts for application-managed tasks", async () => {
    const applicationName = "AISG学校政策问答助手"
    const application = {
      id: "50000000-0000-4000-8000-000000000001",
      name: applicationName,
      icon: { type: "preset" as const, preset: "graduation-cap" as const },
    }
    const applicationConversation = {
      ...conversation,
      title: applicationName,
      application,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                title: applicationName,
                application,
              },
              conversations[1],
              conversations[2],
            ],
            next_cursor: null,
          },
        }),
      conversationGetResponse: async () =>
        json({ success: true, data: applicationConversation }),
    })
    const interaction = userEvent.setup()
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    const sidebarTitle = await within(sidebar).findByText(applicationName)
    const applicationLink = sidebarTitle.closest("a")
    expect(applicationLink).not.toBeNull()
    expect(applicationLink).not.toHaveAttribute("aria-keyshortcuts")

    await interaction.dblClick(sidebarTitle)
    fireEvent.keyDown(applicationLink as HTMLAnchorElement, { key: "F2" })
    expect(
      screen.queryByRole("dialog", { name: "重命名" })
    ).not.toBeInTheDocument()

    const banner = await screen.findByRole("banner")
    await interaction.click(
      within(banner).getByRole("button", { name: "操作" })
    )
    expect(
      screen.queryByRole("menuitem", { name: "重命名" })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("menuitem", { name: "置顶任务" })
    ).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "归档任务" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "删除任务" })).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.method === "PATCH" &&
          typeof request.body === "object" &&
          request.body !== null &&
          "title" in request.body
      )
    ).toBe(false)
  })

  it("shows the styled task preview on hover and a running indicator in compact task rows", async () => {
    const interaction = userEvent.setup()
    const longTitle =
      "请创建 artifacts/mcp-e2e-verification 中的完整任务并验证导入结果"
    const updatedAt = "2026-07-13T08:00:00.000Z"
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                title: longTitle,
                updated_at: updatedAt,
                execution_status: "running",
              },
              {
                ...conversations[1],
                execution_status: "completed",
              },
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = await within(sidebar).findByText(longTitle)
    const item = title.closest(".sidebar-conversation-item")
    const link = title.closest("a")

    expect(item).not.toBeNull()
    expect(link).not.toBeNull()
    expect(within(sidebar).getByRole("link", { name: longTitle })).toBe(link)
    expect(link).toHaveClass("sidebar-conversation-link")
    expect(link).toHaveClass("h-8")
    expect(link).not.toHaveClass("min-h-9", "py-2")
    expect(link).toHaveAttribute("aria-busy", "true")
    expect(title).toHaveClass("sidebar-conversation-title-fade", "font-medium")
    expect(title).not.toHaveClass("truncate")
    expect(title).not.toHaveClass("font-semibold")
    expect(title).not.toHaveAttribute("title")
    expect(link).not.toHaveAttribute("title")
    expect(item!.querySelector("time")).toBeNull()

    const runningStatus = within(item as HTMLElement).getByRole("status", {
      name: "执行中",
    })
    expect(runningStatus).toHaveClass(
      "sidebar-conversation-running",
      "group-hover:opacity-0",
      "group-has-[:focus-visible]:opacity-0"
    )
    expect(runningStatus).not.toHaveClass("transition-opacity")
    expect(runningStatus.querySelector("svg")).toHaveClass(
      "size-3.5",
      "animate-spin",
      "motion-reduce:animate-none"
    )

    const completedTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const completedItem = completedTitle.closest(".sidebar-conversation-item")
    expect(completedItem).not.toBeNull()
    expect(
      within(completedItem as HTMLElement).queryByRole("status")
    ).not.toBeInTheDocument()

    const pinButton = within(item as HTMLElement).getByRole("button", {
      name: /^置顶任务/u,
    })
    const archiveButton = within(item as HTMLElement).getByRole("button", {
      name: /^归档任务/u,
    })
    expect(
      within(item as HTMLElement).queryByRole("button", {
        name: /^删除任务/u,
      })
    ).not.toBeInTheDocument()
    for (const button of [pinButton, archiveButton]) {
      expect(button).toHaveClass(
        "w-5",
        "transition-none",
        "hover:bg-transparent",
        "hover:text-[var(--app-text)]",
        "dark:hover:bg-transparent"
      )
      expect(button).not.toHaveClass("hover:bg-[var(--app-sidebar-active)]")
    }
    const pinIcon = pinButton.querySelector("svg")
    const archiveIcon = archiveButton.querySelector("svg")
    expect(pinIcon).toHaveClass("size-4")
    expect(pinIcon).not.toHaveClass("size-3.5")
    expect(pinIcon).toHaveAttribute("data-icon", "sidebar-pin")
    expect(archiveIcon).toHaveClass("size-3.5")
    expect(pinIcon).toHaveAttribute("stroke-width", "2")
    expect(archiveIcon).toHaveAttribute("stroke-width", "2")
    const actions = archiveButton.parentElement
    expect(actions).toContainElement(pinButton)
    expect(actions).toContainElement(archiveButton)
    expect(actions).toHaveClass(
      "gap-1",
      "opacity-0",
      "pointer-events-none",
      "group-hover:opacity-100",
      "group-hover:pointer-events-auto",
      "group-has-[:focus-visible]:opacity-100",
      "group-has-[:focus-visible]:pointer-events-auto"
    )
    expect(actions).not.toHaveClass("transition-opacity")

    expect(screen.queryByRole("dialog", { name: longTitle })).toBeNull()
    await interaction.hover(link as HTMLElement)
    const preview = await screen.findByRole("dialog", { name: longTitle })
    expect(preview).toHaveClass("sidebar-conversation-preview", "rounded-xl")
    expect(within(preview).getByText(longTitle)).toBeVisible()
    expect(preview.querySelector("time")).toHaveAttribute("datetime", updatedAt)
    expect(preview.querySelector("time")).toHaveTextContent(
      formatRelativeDate(updatedAt, "zh-CN")
    )
    await interaction.unhover(link as HTMLElement)
    await waitFor(() => expect(preview).not.toBeInTheDocument())
  })

  it("keeps task navigation and focus working after hovering the task preview", async () => {
    const interaction = userEvent.setup()
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = await within(sidebar).findByText(conversations[1]!.title)
    const link = title.closest("a")
    expect(link).not.toBeNull()

    await interaction.hover(link as HTMLElement)
    expect(
      await screen.findByRole("dialog", { name: conversations[1]!.title })
    ).toBeVisible()

    await interaction.click(link as HTMLElement)
    expect(link).toHaveFocus()
    await interaction.unhover(link as HTMLElement)
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: conversations[1]!.title })
      ).toBeNull()
    })
    expect(link).toHaveAttribute("aria-current", "page")
    expect(link).toHaveFocus()
  })

  it("keeps task focus styling stable while another task is hovered", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const focusedTitle = await within(sidebar).findByText(
      conversations[0]!.title
    )
    const hoveredTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const focusedItem = focusedTitle.closest(".sidebar-conversation-item")
    const hoveredItem = hoveredTitle.closest(".sidebar-conversation-item")
    const focusedLink = focusedTitle.closest("a")

    expect(focusedItem).not.toBeNull()
    expect(hoveredItem).not.toBeNull()
    expect(focusedLink).not.toBeNull()

    const focusedArchiveButton = within(focusedItem as HTMLElement).getByRole(
      "button",
      { name: /^归档任务/u }
    )
    const focusedActions = focusedArchiveButton.parentElement
    const runningStatus = within(focusedItem as HTMLElement).getByRole(
      "status",
      { name: "执行中" }
    )

    focusedLink!.focus()
    expect(document.activeElement).toBe(focusedLink)
    expect(focusedActions).toHaveClass(
      "group-has-[:focus-visible]:pointer-events-auto",
      "group-has-[:focus-visible]:opacity-100"
    )
    expect(runningStatus).toHaveClass("group-has-[:focus-visible]:opacity-0")

    fireEvent.mouseEnter(hoveredItem as HTMLElement)

    expect(document.activeElement).toBe(focusedLink)
    expect(focusedActions).toHaveClass(
      "group-has-[:focus-visible]:pointer-events-auto",
      "group-has-[:focus-visible]:opacity-100"
    )
    expect(runningStatus).toHaveClass("group-has-[:focus-visible]:opacity-0")

    fireEvent.mouseLeave(hoveredItem as HTMLElement)

    expect(focusedActions).toHaveClass(
      "group-has-[:focus-visible]:pointer-events-auto",
      "group-has-[:focus-visible]:opacity-100"
    )
    expect(runningStatus).toHaveClass("group-has-[:focus-visible]:opacity-0")
  })

  it("renames a recent task from its double-click dialog", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = await within(sidebar).findByText(conversations[0]!.title)

    await interaction.dblClick(title)
    const dialog = await screen.findByRole("dialog", { name: "重命名" })
    const titleInput = within(dialog).getByRole("textbox", { name: "任务" })
    expect(titleInput).toHaveValue(conversations[0]!.title)
    expect(titleInput).toHaveClass("font-medium")
    expect(titleInput).toHaveClass("focus-visible:bg-input/65")
    expect(titleInput).not.toHaveClass(
      "focus-visible:border-input-focus-border"
    )

    await interaction.clear(titleInput)
    await interaction.type(titleInput, "活动安全复盘")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ title: "活动安全复盘" })
        )
      ).toBe(true)
    })
    expect(await within(sidebar).findByText("活动安全复盘")).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "重命名" })
    ).not.toBeInTheDocument()
  })

  it("uses the latest task title when opening the page rename dialog", async () => {
    const latestTitle = "最新的自动任务名称"
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const eventId = "20000000-0000-4000-8000-000000000002"
    const sseEventId = "c1:2"
    let releaseTitleEvent!: () => void
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseTitleEvent = resolve
    })
    const { requests } = installApiMock({
      conversationGetResponse: (callIndex) =>
        Promise.resolve(
          json({
            success: true,
            data: {
              ...conversation,
              title: callIndex === 1 ? conversations[0]!.title : latestTitle,
            },
          })
        ),
      eventStreamStart,
      eventStreamBody: `id: ${sseEventId}\nevent: conversation.title.updated\ndata: ${JSON.stringify(
        {
          id: eventId,
          conversation_id: conversationId,
          turn_id: null,
          sequence_no: 2,
          event_type: "conversation.title.updated",
          visibility: "user_visible",
          payload: {
            schema_version: 1,
            title: latestTitle,
          },
          sse_event_id: sseEventId,
          created_at: "2026-07-17T08:00:02.000Z",
        }
      )}\n\n`,
    })
    const interaction = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole("heading", { name: conversations[0]!.title })
    ).toBeVisible()
    const initialWorkspace = document.querySelector(".conversation-workspace")
    const initialScroller = document.querySelector(".conversation-scroll")
    const initialComposer = screen.getByRole("form", { name: "任务输入框" })
    const initialUserMessage = screen.getByRole("article", {
      name: "用户消息",
    })

    releaseTitleEvent()
    expect(
      await screen.findByRole(
        "heading",
        { name: latestTitle },
        { timeout: 10_000 }
      )
    ).toBeVisible()
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    expect(document.querySelector(".conversation-workspace")).toBe(
      initialWorkspace
    )
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposer
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      initialUserMessage
    )

    const topBar = screen.getByRole("banner")
    await interaction.click(
      within(topBar).getByRole("button", { name: "操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "重命名" })
    )

    const dialog = await screen.findByRole("dialog", { name: "重命名" })
    expect(within(dialog).getByRole("textbox", { name: "任务" })).toHaveValue(
      latestTitle
    )
  })

  it("archives recent tasks without exposing permanent deletion in row actions", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    const archiveTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const archiveItem = archiveTitle.closest(".sidebar-conversation-item")
    expect(archiveItem).not.toBeNull()
    await interaction.click(
      within(archiveItem as HTMLElement).getByRole("button", {
        name: /^归档任务/u,
      })
    )

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c2" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ archive_status: "archived" })
        )
      ).toBe(true)
      expect(
        within(sidebar).queryByText(conversations[1]!.title)
      ).not.toBeInTheDocument()
    })

    const remainingTitle = within(sidebar).getByText(conversations[2]!.title)
    const remainingItem = remainingTitle.closest(".sidebar-conversation-item")
    expect(remainingItem).not.toBeNull()
    expect(
      within(remainingItem as HTMLElement).getByRole("button", {
        name: /^置顶任务/u,
      })
    ).toBeInTheDocument()
    expect(
      within(remainingItem as HTMLElement).getByRole("button", {
        name: /^归档任务/u,
      })
    ).toBeInTheDocument()
    expect(
      within(remainingItem as HTMLElement).queryByRole("button", {
        name: /^删除任务/u,
      })
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c3" &&
          request.method === "DELETE"
      )
    ).toBe(false)
  })

  it("moves a pinned task into the pinned list and restores it when unpinned", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskTitle = conversations[1]!.title

    expect(
      within(sidebar).queryByRole("heading", { name: "置顶" })
    ).not.toBeInTheDocument()
    const taskItem = (await within(sidebar).findByText(taskTitle)).closest(
      ".sidebar-conversation-item"
    )
    expect(taskItem).not.toBeNull()
    const pinButton = within(taskItem as HTMLElement).getByRole("button", {
      name: `置顶任务“${taskTitle}”`,
    })
    expect(pinButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "sidebar-pin"
    )
    await interaction.click(pinButton)

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c2" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) === JSON.stringify({ pinned: true })
        )
      ).toBe(true)
      const pinnedHeading = within(sidebar).getByRole("heading", {
        name: "置顶",
      })
      expect(
        within(pinnedHeading.closest("section") as HTMLElement).getByText(
          taskTitle
        )
      ).toBeVisible()
    })

    const pinnedItem = within(sidebar)
      .getByText(taskTitle)
      .closest(".sidebar-conversation-item")
    expect(pinnedItem).not.toBeNull()
    const unpinButton = within(pinnedItem as HTMLElement).getByRole("button", {
      name: `取消置顶任务“${taskTitle}”`,
    })
    expect(unpinButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "sidebar-pin-filled"
    )
    expect(unpinButton.querySelector("svg")).toHaveClass("size-4")
    expect(unpinButton.querySelector("svg")).toHaveAttribute(
      "stroke-width",
      "0"
    )
    await interaction.click(unpinButton)

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c2" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) === JSON.stringify({ pinned: false })
        )
      ).toBe(true)
      expect(
        within(sidebar).queryByRole("heading", { name: "置顶" })
      ).not.toBeInTheDocument()
      const taskHeading = within(sidebar).getByRole("heading", { name: "任务" })
      expect(
        within(taskHeading.closest("section") as HTMLElement).getByText(
          taskTitle
        )
      ).toBeVisible()
    })
  })

  it("renders the persisted task order without a visible drag handle", async () => {
    const orderedTasks = [
      { ...conversations[0]!, sort_order: 2 },
      { ...conversations[1]!, sort_order: 0 },
      { ...conversations[2]!, sort_order: 1 },
    ]
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: { items: orderedTasks, next_cursor: null },
        }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const firstTitle = await within(sidebar).findByText(conversations[1]!.title)
    const secondTitle = within(sidebar).getByText(conversations[2]!.title)
    const thirdTitle = within(sidebar).getByText(conversations[0]!.title)
    const firstTask = firstTitle.closest(
      ".sidebar-conversation-item"
    ) as HTMLElement
    const secondTask = secondTitle.closest(
      ".sidebar-conversation-item"
    ) as HTMLElement
    const thirdTask = thirdTitle.closest(
      ".sidebar-conversation-item"
    ) as HTMLElement

    expect(
      firstTask.compareDocumentPosition(secondTask) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      secondTask.compareDocumentPosition(thirdTask) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const keyboardActivator = within(firstTask).getByRole("button", {
      name: `使用键盘调整任务“${conversations[1]!.title}”，当前第 1 位`,
    })
    expect(keyboardActivator).toBeEnabled()
    expect(keyboardActivator).toHaveClass("sr-only")
    expect(keyboardActivator.querySelector("svg")).toBeNull()
    expect(firstTask).toHaveClass("cursor-grab")

    const pinButton = within(firstTask).getByRole("button", {
      name: `置顶任务“${conversations[1]!.title}”`,
    })
    fireEvent.pointerDown(pinButton, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 })
    expect(firstTask).not.toHaveAttribute("data-dragging")
    fireEvent.pointerUp(document)
  })

  it("shows an automation binding dialog instead of an inline error when unpinning", async () => {
    const task = {
      ...conversations[1]!,
      pinned_at: "2026-07-30T08:00:00.000Z",
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: { items: [task], next_cursor: null },
        }),
      conversationPatchResponse: (_conversationId, body) => {
        if (body.pinned === false) {
          return json(
            {
              success: false,
              error_code: "AUTOMATION_TASK_IN_USE",
            },
            409
          )
        }
        throw new Error("Unexpected conversation patch")
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskItem = (await within(sidebar).findByText(task.title)).closest(
      ".sidebar-conversation-item"
    )
    expect(taskItem).not.toBeNull()

    await interaction.click(
      within(taskItem as HTMLElement).getByRole("button", {
        name: `取消置顶任务“${task.title}”`,
      })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "无法取消置顶",
    })
    expect(
      within(dialog).getByText("该任务仍关联自动化，请先删除或重新绑定自动化。")
    ).toBeVisible()
    expect(
      within(sidebar).queryByText(
        "该任务仍关联自动化，请先删除或重新绑定自动化。"
      )
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === `/api/v1/conversations/${task.id}` &&
          request.method === "PATCH" &&
          JSON.stringify(request.body) === JSON.stringify({ pinned: false })
      )
    ).toBe(true)

    await interaction.click(
      within(dialog).getByRole("button", { name: "知道了" })
    )
    expect(
      screen.queryByRole("dialog", { name: "无法取消置顶" })
    ).not.toBeInTheDocument()
    expect(within(sidebar).getByRole("heading", { name: "置顶" })).toBeVisible()
  })

  it("removes the task menu and loads every active conversation into the recent list", async () => {
    const lastConversation = {
      ...conversations[0],
      id: "c4",
      title: "第二页任务",
    }
    const { requests } = installApiMock({
      conversationListResponse: (query) =>
        query.get("cursor") === "next-page"
          ? json({
              success: true,
              data: { items: [lastConversation], next_cursor: null },
            })
          : json({
              success: true,
              data: { items: conversations, next_cursor: "next-page" },
            }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    expect(
      within(sidebar).queryByRole("link", { name: "任务" })
    ).not.toBeInTheDocument()
    expect(
      await within(sidebar).findByText(lastConversation.title)
    ).toBeVisible()

    await waitFor(() => {
      const listRequests = requests.filter(
        (request) => request.path === "/api/v1/conversations"
      )
      expect(listRequests).toHaveLength(2)
      expect(new URLSearchParams(listRequests[0]!.query).get("limit")).toBe(
        "100"
      )
      expect(new URLSearchParams(listRequests[0]!.query).get("archived")).toBe(
        "false"
      )
      expect(new URLSearchParams(listRequests[1]!.query).get("cursor")).toBe(
        "next-page"
      )
    })
  })

  it("places search, notification, and collapse controls beside the LinkSense logo", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    const brand = within(sidebar).getByRole("img", { name: "LinkSense" })
    const searchButton = within(sidebar).getByRole("button", {
      name: "搜索",
    })
    const collapseButton = within(sidebar).getByRole("button", {
      name: "折叠侧边栏",
    })
    const notificationButton = within(sidebar).getByRole("button", {
      name: "自动化通知",
    })

    expect(brand).toHaveClass("sidebar-brand-logo")
    expect(brand).toHaveAttribute(
      "src",
      expect.stringContaining("linksense-lockup-primary.svg")
    )
    expect(brand.parentElement).not.toHaveClass(
      "text-[length:var(--app-font-18)]"
    )
    expect(brand.parentElement).not.toHaveClass(
      "text-[length:var(--app-font-15)]"
    )
    expect(brand.parentElement).toContainElement(searchButton)
    expect(brand.parentElement).toContainElement(collapseButton)
    expect(brand.parentElement).toContainElement(notificationButton)
    expect(
      searchButton.compareDocumentPosition(notificationButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      notificationButton.compareDocumentPosition(collapseButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(searchButton).toHaveClass(
      "sidebar-nav-item",
      "size-7",
      "bg-transparent"
    )
    expect(searchButton).toHaveTextContent("")
    expect(searchButton.querySelector(".lucide-search")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    expect(collapseButton.querySelector(".lucide-panel-left")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    expect(collapseButton).toHaveClass("sidebar-collapse-control")
    expect(notificationButton.querySelector(".lucide-bell")).toHaveClass(
      "size-3.5"
    )
    expect(notificationButton.querySelector(".lucide-bell")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    expect(
      notificationButton.querySelector("[data-automation-unread-indicator]")
    ).not.toBeInTheDocument()

    await interaction.hover(searchButton)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    await interaction.unhover(searchButton)
    await interaction.hover(collapseButton)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    await interaction.click(searchButton)
    expect(await screen.findByRole("dialog", { name: "搜索" })).toBeVisible()
  })

  it("aligns the mobile navigation close control with the sidebar controls", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "打开导航" })
    )

    const sheet = await waitFor(() => {
      const content = document.querySelector('[data-slot="sheet-content"]')
      expect(content).toHaveClass("mobile-navigation-sheet")
      return content
    })
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Expected the mobile navigation sheet to render")
    }
    const closeButton = within(sheet).getByRole("button", { name: "关闭" })
    const searchButton = within(sheet).getByRole("button", { name: "搜索" })
    const notificationButton = within(sheet).getByRole("button", {
      name: "自动化通知",
    })

    expect(closeButton).toHaveClass("mobile-navigation-close")
    expect(closeButton).not.toHaveClass("bg-secondary")
    expect(searchButton.parentElement).toHaveClass("sidebar-header-actions")
    expect(notificationButton).toBeVisible()
  })

  it("does nothing when the notification bell has no unread item", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const notificationButton = within(sidebar).getByRole("button", {
      name: "自动化通知",
    })

    await interaction.click(notificationButton)

    expect(
      screen.queryByRole("heading", { name: "自动化" })
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/automations" && request.method === "GET"
      )
    ).toBe(false)
    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/automations/completion-notifications/read" &&
          request.method === "POST"
      )
    ).toBe(false)
  })

  it("opens the first unread notification's task and clears the bell indicator", async () => {
    const completedAt = "2026-07-31T01:02:03.000Z"
    const targetConversation = {
      ...conversations[1],
      id: "30000000-0000-4000-8000-000000000001",
      title: "自动化通知对应任务",
      has_unread_completion: true,
      has_automation: true,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        Promise.resolve(
          json({
            success: true,
            data: {
              items: [conversations[0], targetConversation],
              next_cursor: null,
            },
          })
        ),
      conversationDetailResponse: async (conversationId) =>
        json({
          success: true,
          data: {
            ...conversation,
            ...targetConversation,
            id: conversationId,
            messages: [
              {
                id: `${conversationId}-message-1`,
                role: "assistant",
                content: "自动化通知对应任务已加载。",
              },
            ],
            turns: [],
            running_turn: null,
          },
        }),
      conversationPatchResponse: async (_conversationId, body) =>
        json({
          success: true,
          data: {
            ...targetConversation,
            has_unread_completion: body.completion_read
              ? false
              : targetConversation.has_unread_completion,
          },
        }),
      automationCompletionNotification: {
        latest_unread: {
          conversation_id: targetConversation.id,
          completed_at: completedAt,
        },
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const notificationButton = await within(sidebar).findByRole("button", {
      name: "自动化通知，有已完成的未读任务",
    })
    const indicator = notificationButton.querySelector(
      "[data-automation-unread-indicator]"
    )

    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass("rounded-full", "bg-[var(--app-selection)]")

    await interaction.click(notificationButton)

    expect(await screen.findByText("自动化通知对应任务已加载。")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "自动化" })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/automations/completion-notifications/read" &&
            request.method === "POST" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ through: completedAt })
        )
      ).toBe(true)
      expect(
        requests.some(
          (request) =>
            request.path === `/api/v1/conversations/${targetConversation.id}` &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ completion_read: true })
        )
      ).toBe(true)
      expect(
        within(sidebar)
          .getByRole("button", { name: "自动化通知" })
          .querySelector("[data-automation-unread-indicator]")
      ).not.toBeInTheDocument()
    })
  })

  it("clears the bell indicator when the unread task is opened directly", async () => {
    const targetConversation = {
      ...conversations[0],
      execution_status: "completed",
      has_unread_completion: true,
      has_automation: true,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [targetConversation, conversations[1]],
            next_cursor: null,
          },
        }),
      automationCompletionNotification: {
        latest_unread: {
          conversation_id: targetConversation.id,
          completed_at: "2026-07-31T01:02:03.000Z",
        },
      },
    })

    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === `/api/v1/conversations/${targetConversation.id}` &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ completion_read: true })
        )
      ).toBe(true)
      expect(
        within(sidebar)
          .getByRole("button", { name: "自动化通知" })
          .querySelector("[data-automation-unread-indicator]")
      ).not.toBeInTheDocument()
    })
  })

  it("collapses the desktop sidebar and restores the mounted navigation", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    const { container } = renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    await interaction.click(
      within(sidebar).getByRole("button", { name: "折叠侧边栏" })
    )

    const shell = container.querySelector(".app-shell")
    expect(shell).toHaveAttribute("data-sidebar-collapsed", "true")
    expect(sidebar).toHaveAttribute("aria-hidden", "true")
    expect(sidebar).toHaveAttribute("inert")
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("separator", { name: "调整侧边栏宽度" })
    ).not.toBeInTheDocument()

    const expandButton = screen.getByRole("button", { name: "展开侧边栏" })
    expect(expandButton.closest(".app-main")).toHaveAttribute(
      "data-compact-top-bar",
      "true"
    )
    expect(expandButton).toHaveAttribute("aria-controls", "app-sidebar")
    expect(expandButton).toHaveClass("sidebar-collapse-control")
    expect(expandButton.querySelector(".lucide-panel-left")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    await interaction.hover(expandButton)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    await interaction.click(expandButton)

    const restoredSidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    expect(restoredSidebar).toBe(sidebar)
    expect(shell).not.toHaveAttribute("data-sidebar-collapsed")
    expect(sidebar).not.toHaveAttribute("aria-hidden")
    expect(sidebar).not.toHaveAttribute("inert")
    expect(
      screen.getByRole("separator", { name: "调整侧边栏宽度" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "展开侧边栏" })
    ).not.toBeInTheDocument()
  })

  it("keeps all navigation below new task in the sidebar scroll area", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskScroller = sidebar.querySelector(".sidebar-conversation-scroll")
    const newTaskLink = within(sidebar).getByRole("link", { name: "新任务" })
    const automationLink = within(sidebar).getByRole("link", {
      name: "自动化",
    })
    const capabilitiesLink = within(sidebar).getByRole("link", {
      name: "插件中心",
    })
    const knowledgeBasesLink = within(sidebar).getByRole("link", {
      name: "资料库",
    })
    expect(knowledgeBasesLink.querySelector("svg")).toHaveClass(
      "lucide-library-big"
    )

    expect(taskScroller).not.toBeNull()
    expect(taskScroller?.contains(newTaskLink)).toBe(false)
    expect(taskScroller?.contains(automationLink)).toBe(true)
    expect(taskScroller?.contains(capabilitiesLink)).toBe(true)
    expect(taskScroller?.contains(knowledgeBasesLink)).toBe(true)
    expect(taskScroller?.closest(".sidebar-conversation-region")).toHaveClass(
      "-mr-3"
    )
    expect(taskScroller).toHaveClass("pr-3.5")
    expect(taskScroller).not.toHaveClass("pr-0.5")
  })

  it("shows the shared sidebar top divider only while its content is scrolled", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskScroller = sidebar.querySelector(".sidebar-conversation-scroll")
    const taskRegion = taskScroller?.closest(".sidebar-conversation-region")

    expect(taskScroller).not.toBeNull()
    expect(taskRegion).not.toBeNull()
    expect(taskRegion).not.toHaveClass("mt-2")
    expect(taskRegion).not.toHaveClass("mt-5")
    expect(taskRegion).not.toHaveAttribute("data-scrolled")

    if (!(taskScroller instanceof HTMLElement)) {
      throw new Error("Expected the recent-task scroller to render")
    }
    taskScroller.scrollTop = 24
    fireEvent.scroll(taskScroller)
    expect(taskRegion).toHaveAttribute("data-scrolled", "true")

    taskScroller.scrollTop = 0
    fireEvent.scroll(taskScroller)
    expect(taskRegion).not.toHaveAttribute("data-scrolled")
  })

  it("uses the stronger navigation typography hierarchy across app and settings shells", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    expect(within(sidebar).getByRole("button", { name: "搜索" })).toHaveClass(
      "sidebar-nav-item",
      "size-7"
    )
    expect(
      within(sidebar).queryByRole("link", { name: "任务" })
    ).not.toBeInTheDocument()
    const newTaskLink = within(sidebar).getByRole("link", {
      name: "新任务",
    })
    const automationLink = within(sidebar).getByRole("link", {
      name: "自动化",
    })
    const pluginLink = within(sidebar).getByRole("link", {
      name: "插件中心",
    })
    const knowledgeBaseLink = within(sidebar).getByRole("link", {
      name: "资料库",
    })
    expect(automationLink).toHaveAttribute("href", "/automations")
    expect(pluginLink).toHaveAttribute("href", "/capabilities")
    expect(knowledgeBaseLink).toHaveAttribute("href", "/knowledge-bases")
    await interaction.click(
      within(sidebar).getByRole("button", { name: "反馈与帮助" })
    )
    expect(await screen.findByRole("menuitem", { name: "反馈" })).toBeVisible()
    const helpCenterLink = await screen.findByRole("menuitem", {
      name: "在新标签页打开帮助中心",
    })
    expect(helpCenterLink).toHaveAttribute(
      "href",
      "/help/user-guide/tasks/create-and-run/"
    )
    expect(helpCenterLink).toHaveAttribute("target", "_blank")
    expect(helpCenterLink).toHaveAttribute("rel", "noreferrer noopener")
    expect(
      newTaskLink.compareDocumentPosition(automationLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      automationLink.compareDocumentPosition(pluginLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      pluginLink.compareDocumentPosition(knowledgeBaseLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      within(sidebar).queryByRole("link", { name: "已归档任务" })
    ).not.toBeInTheDocument()
    expect(within(sidebar).getByRole("heading", { name: "任务" })).toHaveClass(
      "font-semibold",
      "text-[length:var(--app-ui-font-size)]"
    )
    expect(
      await within(sidebar).findByText(conversations[0]!.title)
    ).toHaveClass("font-medium", "text-[length:var(--app-ui-font-size)]")
    expect(sidebar.querySelector("time")).toBeNull()

    const accountTrigger = within(sidebar).getByRole("button", {
      name: "林晓",
    })
    expect(accountTrigger).toHaveClass("sidebar-user-button")
    expect(accountTrigger).toHaveClass("py-1.5")
    expect(accountTrigger.closest(".sidebar-account-bar")).toHaveClass("mt-1")
    expect(accountTrigger.querySelector("svg")).toBeNull()
    expect(accountTrigger.querySelector('[data-slot="avatar"]')).toHaveClass(
      "sidebar-account-avatar",
      "size-6"
    )
    expect(
      within(accountTrigger).getByText("林晓", {
        selector: "span.block.truncate",
      })
    ).toHaveClass("font-semibold", "text-[length:var(--app-ui-font-size)]")
    expect(within(accountTrigger).queryByText("管理员")).not.toBeInTheDocument()
    expect(
      within(accountTrigger).queryByText("lin@example.com")
    ).not.toBeInTheDocument()
    await interaction.click(accountTrigger)
    const settingsMenuItem = await screen.findByRole("menuitem", {
      name: "设置",
    })
    expect(screen.getByRole("menu")).toHaveClass(
      "w-[calc(var(--anchor-width)+2.25rem)]",
      "max-w-[calc(100vw-24px)]"
    )
    expect(settingsMenuItem).toHaveClass(
      "font-medium",
      "text-[length:var(--app-ui-font-size)]"
    )
    expect(
      screen.getByRole("menu").querySelector('[data-slot="avatar"]')
    ).toHaveClass("sidebar-account-avatar", "size-6")
    const menu = screen.getByRole("menu")
    const accountName = within(menu).getByText("林晓", {
      selector: "span.truncate",
    })
    expect(accountName).toHaveClass(
      "font-semibold",
      "text-[length:var(--app-ui-font-size)]"
    )
    const quotaRemaining = within(menu).getByText(
      "用量剩余：总 - · 周 - · 月 -"
    )
    expect(quotaRemaining).toHaveClass(
      "account-menu-quota",
      "text-[length:var(--app-font-11)]",
      "text-[var(--app-muted)]"
    )
    expect(accountName.parentElement).not.toContainElement(quotaRemaining)
    expect(
      quotaRemaining.compareDocumentPosition(settingsMenuItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await interaction.click(settingsMenuItem)
    const settingsSidebar = await screen.findByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("heading", { name: "个人" })
    ).toHaveClass("font-semibold")
    const generalLink = within(settingsSidebar).getByRole("link", {
      name: "常规",
    })
    const generalLabel = within(generalLink).getByText("常规")
    expect(generalLink).toHaveClass("font-medium")
    expect(generalLabel).not.toHaveClass("font-semibold")
    const settingsNavigationLinks = settingsSidebar.querySelectorAll(
      ".settings-navigation-link"
    )
    expect(settingsNavigationLinks).toHaveLength(20)
    settingsNavigationLinks.forEach((link) => {
      expect(link.querySelectorAll(":scope > span")).toHaveLength(1)
      expect(link.querySelector(":scope > span > span")).toBeNull()
    })
    expect(
      within(settingsSidebar).queryByText("界面语言")
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).queryByText("姓名和头像")
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).queryByText("管理用户账号、角色和状态")
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).queryByRole("link", { name: "插件" })
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).getByRole("link", { name: "已归档任务" })
    ).toHaveAttribute("href", "/archived")
    expect(
      within(settingsSidebar).getByRole("link", { name: "插件中心" })
    ).toHaveAttribute("href", "/admin/capabilities")
    expect(
      within(settingsSidebar).getByRole("link", { name: "知识库" })
    ).toHaveAttribute("href", "/admin/knowledge-bases")
    expect(
      within(settingsSidebar).queryByRole("link", { name: "知识库数据源" })
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).getByRole("link", { name: "模型设置" })
    ).toHaveAttribute("href", "/admin/models")
    expect(
      within(settingsSidebar).queryByRole("link", { name: "分享审批" })
    ).not.toBeInTheDocument()
  })
})
