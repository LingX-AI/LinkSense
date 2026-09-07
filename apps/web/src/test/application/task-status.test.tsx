import { conversationReconnectingWarningDelayMs } from "@/features/conversations/use-conversation-events"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
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
  it("reconciles a completed turn from detail when the event stream disconnects without polling the task list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let releaseCompletedDetail: (() => void) | undefined
    let listRequestCount = 0
    const completedDetailReady = new Promise<void>((resolve) => {
      releaseCompletedDetail = resolve
    })
    const { requests } = installApiMock({
      eventStreamUnavailable: true,
      conversationListResponse: () => {
        listRequestCount += 1
        return json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? {
                    ...item,
                    execution_status:
                      listRequestCount === 1 ? "running" : "completed",
                  }
                : item
            ),
            next_cursor: null,
          },
        })
      },
      conversationGetResponse: async (callIndex) => {
        if (callIndex === 1) {
          return json({ success: true, data: conversation })
        }

        await completedDetailReady
        return json({
          success: true,
          data: {
            ...conversation,
            execution_status: "completed",
            running_turn: null,
            turns: [{ id: "turn-1", status: "completed" }],
            messages: [
              ...conversation.messages,
              {
                id: "m3",
                role: "assistant",
                content: "任务已经完成。",
                turn_id: "turn-1",
              },
            ],
          },
        })
      },
    })
    renderApp()

    expect(
      await screen.findByRole("button", { name: "停止" }, { timeout: 3_000 })
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(conversationReconnectingWarningDelayMs)
    })
    expect(screen.getByText("连接正在恢复")).toBeVisible()

    releaseCompletedDetail?.()

    expect(
      await screen.findByText("任务已经完成。", undefined, { timeout: 3_000 })
    ).toBeVisible()
    expect(screen.getByText("用时", { exact: true })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "停止" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("连接正在恢复")).not.toBeInTheDocument()
    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    const sidebarTaskTitle = within(sidebar).getByText(conversations[0]!.title)
    const sidebarTask = sidebarTaskTitle.closest(".sidebar-conversation-item")
    expect(sidebarTask).not.toBeNull()
    await waitFor(() => {
      expect(sidebarTaskTitle.closest("a")).not.toHaveAttribute("aria-busy")
      expect(
        within(sidebarTask as HTMLElement).queryByRole("status", {
          name: "执行中",
        })
      ).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(2)
    })
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
  }, 10_000)

  it("updates the sidebar directly when the initial detail already contains a terminal turn", async () => {
    let releaseCompletedDetail: ((response: Response) => void) | undefined
    let listRequestCount = 0
    const completedDetail = new Promise<Response>((resolve) => {
      releaseCompletedDetail = resolve
    })
    const { requests } = installApiMock({
      eventStreamUnavailable: true,
      conversationListResponse: () => {
        listRequestCount += 1
        return json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? {
                    ...item,
                    execution_status:
                      listRequestCount === 1 ? "running" : "completed",
                  }
                : item
            ),
            next_cursor: null,
          },
        })
      },
      conversationGetResponse: async () => completedDetail,
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const sidebarTaskTitle = await within(sidebar).findByText(
      conversations[0]!.title
    )
    expect(sidebarTaskTitle.closest("a")).toHaveAttribute("aria-busy", "true")

    releaseCompletedDetail?.(
      json({
        success: true,
        data: {
          ...conversation,
          execution_status: "completed",
          running_turn: null,
          turns: [{ id: "turn-1", status: "completed" }],
          last_event_id: "c1:completed",
          messages: [
            ...conversation.messages,
            {
              id: "m3",
              role: "assistant",
              content: "任务已经完成。",
            },
          ],
        },
      })
    )

    expect(await screen.findByText("任务已经完成。")).toBeVisible()
    await waitFor(() => {
      expect(sidebarTaskTitle.closest("a")).not.toHaveAttribute("aria-busy")
      expect(
        within(sidebar).queryByRole("status", { name: "执行中" })
      ).not.toBeInTheDocument()
    })
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
  })

  it("does not poll conversation detail while its event stream remains connected", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { requests } = installApiMock()
    renderApp()

    expect(
      await screen.findByRole("button", { name: "停止" })
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500)
    })

    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1" &&
          request.method === "GET"
      )
    ).toHaveLength(1)
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
  })

  it("does not poll the task list while a background task remains running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c2"
                ? {
                    ...item,
                    execution_status: "running",
                  }
                : item
            ),
            next_cursor: null,
          },
        }),
      conversationDetailResponse: async (conversationId) =>
        json({
          success: true,
          data: {
            ...conversation,
            ...conversations.find((item) => item.id === conversationId),
            execution_status: "running",
            turns: [{ id: "turn-c2-running", status: "running" }],
            running_turn: { id: "turn-c2-running", status: "running" },
            last_event_id: "c2:running",
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const backgroundTaskTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const backgroundTaskLink = backgroundTaskTitle.closest("a")
    expect(backgroundTaskLink).toHaveAttribute("aria-busy", "true")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500)
    })

    expect(backgroundTaskLink).toHaveAttribute("aria-busy", "true")
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
  })

  it("keeps recent conversations as title-only rows without textual execution status", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    for (const item of conversations) {
      expect(await within(sidebar).findByText(item.title)).toBeVisible()
    }
    expect(sidebar.querySelector("time")).toBeNull()
    for (const status of ["执行中", "已完成", "待执行", "已中断"]) {
      expect(
        within(sidebar).queryByText(status, { exact: true })
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByRole("banner")).queryByText(status, { exact: true })
      ).not.toBeInTheDocument()
    }
  })

  it("shows an unread completion dot until the user opens the completed task", async () => {
    const interaction = userEvent.setup()
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              conversations[0],
              { ...conversations[1], has_unread_completion: true },
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const unreadDot = await within(sidebar).findByRole("status", {
      name: "任务已完成，尚未查看",
    })
    const completedTaskLink = within(sidebar)
      .getByText(conversations[1].title)
      .closest("a")
    expect(completedTaskLink).not.toBeNull()
    expect(unreadDot).toBeVisible()

    await interaction.click(completedTaskLink as HTMLAnchorElement)

    expect(
      within(sidebar).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2",
          method: "PATCH",
          body: { completion_read: true },
        })
      )
    })
  })

  it("prioritizes the running indicator over a stale unread completion marker", async () => {
    const runningUnreadConversation = {
      ...conversations[1],
      execution_status: "running" as const,
      last_turn_status: "completed" as const,
      has_unread_completion: true,
    }
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [conversations[0], runningUnreadConversation],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const runningTitle = await within(sidebar).findByText(
      runningUnreadConversation.title
    )
    const runningItem = runningTitle.closest(".sidebar-conversation-item")
    const runningLink = runningTitle.closest("a")
    expect(runningItem).not.toBeNull()
    expect(runningLink).toHaveAttribute("aria-busy", "true")
    expect(
      within(runningItem as HTMLElement).getByRole("status", {
        name: "执行中",
      })
    ).toBeVisible()
    expect(
      within(runningItem as HTMLElement).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).not.toBeInTheDocument()
    expect(
      within(runningItem as HTMLElement).queryByRole("status", {
        name: "任务执行失败，尚未查看",
      })
    ).not.toBeInTheDocument()
  })

  it("shows an unread failure icon until the user opens the failed task", async () => {
    const interaction = userEvent.setup()
    const failedConversation = {
      ...conversations[1],
      execution_status: "failed" as const,
      last_turn_status: "failed" as const,
      has_unread_completion: true,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [conversations[0], failedConversation],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const unreadFailure = await within(sidebar).findByRole("status", {
      name: "任务执行失败，尚未查看",
    })
    const failedTaskLink = within(sidebar)
      .getByText(failedConversation.title)
      .closest("a")
    expect(failedTaskLink).not.toBeNull()
    expect(unreadFailure).toBeVisible()
    expect(unreadFailure).toHaveClass("text-destructive")
    expect(unreadFailure.querySelector("svg")).not.toBeNull()

    await interaction.click(failedTaskLink as HTMLAnchorElement)

    expect(
      within(sidebar).queryByRole("status", {
        name: "任务执行失败，尚未查看",
      })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2",
          method: "PATCH",
          body: { completion_read: true },
        })
      )
    })
  })

  it("does not show an unread result indicator for the task that is already open", async () => {
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                execution_status: "failed",
                last_turn_status: "failed",
                has_unread_completion: true,
              },
              conversations[1],
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    expect(
      within(sidebar).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).not.toBeInTheDocument()
    expect(
      within(sidebar).queryByRole("status", {
        name: "任务执行失败，尚未查看",
      })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { completion_read: true },
        })
      )
    })
  })

  it("shows an application icon before each application-managed task title", async () => {
    const applicationName = "AISG学校政策问答助手"
    const fallbackApplicationName = "默认图标应用"
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                title: applicationName,
                application: {
                  id: "50000000-0000-4000-8000-000000000001",
                  name: applicationName,
                  icon: { type: "preset", preset: "graduation-cap" },
                },
              },
              {
                ...conversations[1],
                title: fallbackApplicationName,
                application: {
                  id: "50000000-0000-4000-8000-000000000002",
                  name: fallbackApplicationName,
                },
              },
              conversations[2],
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const applicationTitle = await within(sidebar).findByText(applicationName)
    const applicationLink = applicationTitle.closest("a")
    const fallbackTitle = within(sidebar).getByText(fallbackApplicationName)
    const fallbackLink = fallbackTitle.closest("a")
    const regularTitle = within(sidebar).getByText(conversations[2]!.title)
    const regularLink = regularTitle.closest("a")

    expect(applicationLink).not.toBeNull()
    expect(fallbackLink).not.toBeNull()
    expect(regularLink).not.toBeNull()
    const applicationIcon = applicationLink!.querySelector(
      ".sidebar-conversation-application-icon"
    )
    const fallbackIcon = fallbackLink!.querySelector(
      ".sidebar-conversation-application-icon"
    )
    const presetIcon = applicationIcon?.querySelector("svg")

    expect(applicationIcon).not.toBeNull()
    expect(applicationIcon).toHaveClass(
      "bg-transparent",
      "after:border-border/60",
      "[&_svg]:size-5"
    )
    expect(applicationIcon).not.toHaveClass("bg-muted")
    expect(
      applicationIcon?.querySelector('[data-slot="avatar-fallback"]')
    ).toHaveClass("bg-transparent", "text-muted-foreground")
    expect(presetIcon).not.toBeNull()
    expect(presetIcon?.querySelectorAll("[fill]").length).toBeGreaterThan(0)
    expect(
      applicationIcon!.compareDocumentPosition(applicationTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(fallbackIcon?.querySelector("svg")).not.toBeNull()
    expect(
      regularLink!.querySelector(".sidebar-conversation-application-icon")
    ).toBeNull()
  })
})
