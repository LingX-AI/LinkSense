import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AutomationCompletionNotification } from "@/api/contracts"
import {
  setupApplicationTests,
  conversation,
  conversations,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

function installAutomationNotificationMock() {
  const targets = [
    {
      ...conversations[1],
      id: "30000000-0000-4000-8000-000000000001",
      title: "自动化任务 A",
      has_automation: true,
      execution_status: "completed",
    },
    {
      ...conversations[1],
      id: "30000000-0000-4000-8000-000000000002",
      title: "自动化任务 B",
      has_automation: true,
      execution_status: "completed",
    },
  ]
  const completedAtById = new Map<string, string>()
  const unreadIds = new Set<string>()
  let rejectReads = false
  const notification: AutomationCompletionNotification = {
    latest_unread: null,
  }
  const updateNotification = () => {
    const latest = [...completedAtById]
      .filter(([id]) => unreadIds.has(id))
      .sort((left, right) => right[1].localeCompare(left[1]))[0]
    notification.latest_unread = latest
      ? { conversation_id: latest[0], completed_at: latest[1] }
      : null
  }
  const summaries = () =>
    targets.map((target) => ({
      ...target,
      updated_at: completedAtById.get(target.id) ?? target.updated_at,
      has_unread_completion: unreadIds.has(target.id),
    }))
  const fixture = installApiMock({
    conversationListResponse: () =>
      json({
        success: true,
        data: { items: [conversations[0], ...summaries()], next_cursor: null },
      }),
    conversationDetailResponse: async (conversationId) => {
      const target = summaries().find((item) => item.id === conversationId)
      return json({
        success: true,
        data: {
          ...conversation,
          ...target,
          id: conversationId,
          execution_status: "completed",
          messages: target
            ? [
                {
                  id: `${conversationId}-result`,
                  role: "assistant",
                  content: `${target.title}的结果`,
                },
              ]
            : conversation.messages,
          turns: [],
          running_turn: null,
        },
      })
    },
    conversationPatchResponse: (conversationId, body) => {
      if (body.completion_read && rejectReads) {
        return json({ success: false, error_code: "FORBIDDEN" }, 403)
      }
      if (body.completion_read) {
        unreadIds.delete(conversationId)
        updateNotification()
      }
      return json({
        success: true,
        data: summaries().find((item) => item.id === conversationId),
      })
    },
    automationCompletionNotification: notification,
  })
  return {
    ...fixture,
    targets,
    setRejectReads: (value: boolean) => {
      rejectReads = value
    },
    complete: (conversationId: string, completedAt: string) => {
      completedAtById.set(conversationId, completedAt)
      unreadIds.add(conversationId)
      updateNotification()
    },
  }
}

describe("automation completion notifications", () => {
  setupApplicationTests()
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
  })

  it("keeps the bell unread after opening the latest task and opens the next unread task", async () => {
    const { complete, requests, targets } = installAutomationNotificationMock()
    const older = targets[0]!
    const latest = targets[1]!
    complete(older.id, "2026-10-06T01:00:00.000Z")
    complete(latest.id, "2026-10-06T02:00:00.000Z")
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      await within(sidebar).findByRole("button", {
        name: "自动化通知，有已完成的未读任务",
      })
    )
    expect(await screen.findByText(`${latest.title}的结果`)).toBeVisible()
    await waitFor(() => {
      expect(
        within(sidebar).getByRole("button", {
          name: "自动化通知，有已完成的未读任务",
        })
      ).toBeVisible()
      expect(
        within(sidebar).getAllByRole("status", {
          name: "任务已完成，尚未查看",
        })
      ).toHaveLength(1)
    })
    await interaction.click(
      within(sidebar).getByRole("button", {
        name: "自动化通知，有已完成的未读任务",
      })
    )
    expect(await screen.findByText(`${older.title}的结果`)).toBeVisible()
    await waitFor(() => {
      expect(
        within(sidebar).getByRole("button", { name: "自动化通知" })
      ).toBeVisible()
      expect(
        within(sidebar).queryByRole("status", {
          name: "任务已完成，尚未查看",
        })
      ).not.toBeInTheDocument()
    })
    expect(
      requests
        .filter(
          (request) =>
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ completion_read: true })
        )
        .map((request) => request.path)
    ).toEqual([
      `/api/v1/conversations/${latest.id}`,
      `/api/v1/conversations/${older.id}`,
    ])
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/automations/completion-notifications/read"
      )
    ).toBe(false)
  })

  it("updates the task unread marker and bell after an automation completes without a page refresh", async () => {
    const { complete, requests, targets } = installAutomationNotificationMock()
    const target = targets[0]!
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await within(sidebar).findByRole("link", { name: new RegExp(target.title) })
    expect(
      within(sidebar).getByRole("button", { name: "自动化通知" })
    ).toBeVisible()
    complete(target.id, "2026-10-06T03:00:00.000Z")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(
      requests.filter(
        (request) =>
          request.method === "GET" &&
          request.path === "/api/v1/automations/completion-notifications"
      ).length
    ).toBeGreaterThanOrEqual(2)
    await waitFor(() => {
      expect(
        within(sidebar).getByRole("button", {
          name: "自动化通知，有已完成的未读任务",
        })
      ).toBeVisible()
      expect(
        within(sidebar).getByRole("status", {
          name: "任务已完成，尚未查看",
        })
      ).toBeVisible()
    })
  })

  it("shows a new completion in a task whose previous completion was already read", async () => {
    const { complete, requests, targets } = installAutomationNotificationMock()
    const target = targets[0]!
    complete(target.id, "2026-10-06T01:00:00.000Z")
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      await within(sidebar).findByRole("button", {
        name: "自动化通知，有已完成的未读任务",
      })
    )
    expect(await screen.findByText(`${target.title}的结果`)).toBeVisible()
    await within(sidebar).findByRole("button", { name: "自动化通知" })
    await interaction.click(
      within(sidebar).getByRole("link", { name: "新任务" })
    )

    complete(target.id, "2026-10-06T04:00:00.000Z")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await interaction.click(
      await within(sidebar).findByRole("button", {
        name: "自动化通知，有已完成的未读任务",
      })
    )
    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === `/api/v1/conversations/${target.id}` &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ completion_read: true })
        )
      ).toHaveLength(2)
      expect(
        within(sidebar).getByRole("button", { name: "自动化通知" })
      ).toBeVisible()
    })
  })

  it("preserves an unread notification after a denied read and retries only when the user clicks again", async () => {
    const { complete, requests, targets, setRejectReads } =
      installAutomationNotificationMock()
    const target = targets[0]!
    complete(target.id, "2026-10-06T01:00:00.000Z")
    setRejectReads(true)
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const readRequests = () =>
      requests.filter(
        (request) =>
          request.path === `/api/v1/conversations/${target.id}` &&
          request.method === "PATCH" &&
          JSON.stringify(request.body) ===
            JSON.stringify({ completion_read: true })
      )
    await interaction.click(
      await within(sidebar).findByRole("button", {
        name: "自动化通知，有已完成的未读任务",
      })
    )
    expect(
      await within(sidebar).findByText("你没有权限执行此操作。")
    ).toBeVisible()
    expect(readRequests()).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(readRequests()).toHaveLength(1)
    setRejectReads(false)
    await interaction.click(
      within(sidebar).getByRole("button", {
        name: "自动化通知，有已完成的未读任务",
      })
    )
    await waitFor(() => {
      expect(readRequests()).toHaveLength(2)
      expect(
        within(sidebar).getByRole("button", { name: "自动化通知" })
      ).toBeVisible()
    })
    expect(
      within(sidebar).queryByText("你没有权限执行此操作。")
    ).not.toBeInTheDocument()
  })
})
