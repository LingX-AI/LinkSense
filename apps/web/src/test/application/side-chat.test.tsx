import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { sideChatSelectionSchema } from "@linksense/shared"
import {
  conversation,
  installApiMock,
  json,
  renderApp,
  seedLocalDraft,
  setupApplicationTests,
} from "./fixture"

const parentId = "20000000-0000-4000-8000-000000000001"
const childId = "20000000-0000-4000-8000-000000000002"
const sourceId = "30000000-0000-4000-8000-000000000001"
const answerId = "30000000-0000-4000-8000-000000000002"
const referenceId = "40000000-0000-4000-8000-000000000001"
const currentTurnId = "50000000-0000-4000-8000-000000000001"
const draft = "继续问这段引用"
async function openExistingSideChat({
  phase,
  initialDraft = draft,
}: {
  phase: "starting" | "running"
  initialDraft?: string
}) {
  const childPath = `/api/v1/conversations/${childId}`
  const eventId = `${childId}:1`
  let completed = false
  let completeTurn!: () => void
  const completion = new Promise<void>((resolve) => {
    completeTurn = () => {
      completed = true
      resolve()
    }
  })
  const { fetchMock, requests } = installApiMock({
    userOverride: { running_message_action: "steer" },
    conversationDetailResponse: async (id) =>
      json({
        success: true,
        data:
          id === parentId
            ? { ...conversation, id, title: "主任务" }
            : {
                ...conversation,
                id,
                title: "旁聊",
                execution_status: completed ? "completed" : "running",
                running_turn:
                  !completed && phase === "running"
                    ? { id: currentTurnId, status: "running" }
                    : null,
                starting_turn:
                  !completed && phase === "starting"
                    ? {
                        turn_id: currentTurnId,
                        task_kind: "turn",
                        idempotency_key: "accepted-before-opening",
                        input_text: "之前发送的问题",
                        created_at: "2026-11-01T09:00:00.000Z",
                        message_display: null,
                        attachments: [],
                      }
                    : null,
                turns: completed
                  ? [{ id: currentTurnId, status: "completed" }]
                  : phase === "running"
                    ? [{ id: currentTurnId, status: "running" }]
                    : [],
                messages: completed
                  ? [
                      {
                        id: answerId,
                        role: "assistant",
                        turn_id: currentTurnId,
                        content: "上一轮已完成",
                      },
                    ]
                  : [],
              },
      }),
    backgroundEventStreams: {
      [childId]: {
        start: completion,
        body: `id: ${eventId}\nevent: turn/completed\ndata: ${JSON.stringify({
          id: "60000000-0000-4000-8000-000000000001",
          conversation_id: childId,
          turn_id: currentTurnId,
          sequence_no: 1,
          event_type: "turn/completed",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/completed",
            params: {
              threadId: "side-chat-thread",
              turn: { id: "side-chat-native-turn", status: "completed" },
            },
          },
          sse_event_id: eventId,
          created_at: "2026-11-01T09:00:01.000Z",
        })}\n\n`,
      },
    },
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path === `/api/v1/conversations/${parentId}/side-chat`) {
        return json({
          success: true,
          data: {
            conversation_id: childId,
            parent_conversation_id: parentId,
            reference: {
              id: referenceId,
              source_conversation_id: parentId,
              source_title: "主任务",
              source_message_id: sourceId,
              selection_text: "主任务里的引用段落。",
              include_recent_messages: true,
              recent_messages: [],
            },
          },
        })
      }
      const response = await fetchMock(input, init)
      if (path === `${childPath}/turns` && init?.method === "POST") {
        return json(
          {
            success: true,
            data: {
              accepted: true,
              status: "starting",
              turn_id: "50000000-0000-4000-8000-000000000002",
            },
          },
          202
        )
      }
      return response
    })
  )
  seedLocalDraft(childId, { input: initialDraft })
  const interaction = userEvent.setup()
  renderApp(`/conversations/${parentId}`)
  await interaction.click(
    await screen.findByRole("button", { name: "打开旁聊" })
  )
  const panel = within(
    await screen.findByRole("complementary", { name: "旁聊" })
  )
  const composer = await panel.findByRole("textbox", { name: "任务输入框" })
  await waitFor(() => expect(composer).toHaveValue(initialDraft))
  return {
    childPath,
    completeTurn,
    composer,
    interaction,
    panel,
    interrupts: () =>
      requests.filter(
        ({ method, path }) => method === "POST" && path.endsWith("/interrupt")
      ),
    submissions: () =>
      requests.filter(
        ({ method, path }) =>
          method === "POST" &&
          path.startsWith(`${childPath}/`) &&
          /\/(turns|pending-requests|steer)$/u.test(path)
      ),
  }
}

describe("parallel side chat", () => {
  setupApplicationTests()

  it("still queues a structured quote in a running cloud side chat", async () => {
    const { childPath, interaction, panel, submissions } =
      await openExistingSideChat({ phase: "running" })
    await interaction.click(panel.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(submissions()).toEqual([
        expect.objectContaining({
          path: `${childPath}/pending-requests`,
          body: expect.objectContaining({
            message_display: {
              kind: "conversation_reference",
              reference_id: referenceId,
              request: draft,
            },
          }),
        }),
      ])
    )
  })

  it("keeps the running main task visible, preserves both drafts and returns a selection without sending it", async () => {
    seedLocalDraft(parentId, { input: "主任务原有草稿" })
    const { requests } = installApiMock({
      conversationDetailResponse: async (id) =>
        json({
          success: true,
          data:
            id === parentId
              ? {
                  ...conversation,
                  id,
                  title: "主任务",
                  messages: [
                    {
                      id: sourceId,
                      role: "assistant",
                      content: "主任务里的引用段落。",
                    },
                  ],
                }
              : {
                  ...conversation,
                  id,
                  title: "旁聊",
                  execution_status: "completed",
                  running_turn: null,
                  turns: [{ id: "turn-side", status: "completed" }],
                  messages: [
                    {
                      id: answerId,
                      role: "assistant",
                      content: "旁聊结论，可带回。",
                    },
                  ],
                },
        }),
    })
    const originalFetch = window.fetch
    const starts: unknown[] = []
    let selected: unknown
    let sideChat: unknown = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === `/api/v1/conversations/${parentId}/side-chat`) {
          if (init?.method === "POST") {
            selected = JSON.parse(String(init.body))
            const selection = sideChatSelectionSchema.parse(selected)
            sideChat = {
              conversation_id: childId,
              parent_conversation_id: parentId,
              reference: {
                ...selection,
                id: referenceId,
                source_conversation_id: parentId,
                source_title: "主任务",
                recent_messages: [],
              },
            }
          }
          return json({ success: true, data: sideChat })
        }
        if (
          url.pathname === `/api/v1/conversations/${childId}/turns` &&
          init?.method === "POST"
        ) {
          starts.push(JSON.parse(String(init.body)))
          return json(
            {
              success: true,
              data: {
                accepted: true,
                status: "starting",
                turn_id: referenceId,
              },
            },
            202
          )
        }
        return originalFetch(input, init)
      })
    )
    const interaction = userEvent.setup()
    renderApp(`/conversations/${parentId}`)
    const mainComposer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    const banner = await screen.findByRole("banner")
    await waitFor(() => expect(mainComposer).toHaveValue("主任务原有草稿"))
    const quote = await screen.findByText("主任务里的引用段落。")
    act(() => {
      const range = document.createRange()
      range.selectNodeContents(quote)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await interaction.click(
      await screen.findByRole("button", { name: "旁边问这段" })
    )
    let panel = await screen.findByRole("complementary", { name: "旁聊" })
    expect(await within(panel).findByText("旁聊结论，可带回。")).toBeVisible()
    expect(
      within(panel).queryByRole("heading", { level: 1 })
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole("button", { name: "分支到新聊天" })
    ).not.toBeInTheDocument()
    expect(selected).toEqual({
      source_message_id: sourceId,
      selection_text: "主任务里的引用段落。",
      include_recent_messages: true,
    })
    expect(mainComposer).toHaveValue("主任务原有草稿")
    const sideComposer = within(panel).getByRole("textbox", {
      name: "任务输入框",
    })
    await interaction.type(sideComposer, "旁聊未发送的草稿")
    await interaction.click(
      within(banner).getByRole("button", {
        name: "打开会话侧栏",
      })
    )
    expect(
      await screen.findByRole("region", { name: "会话侧栏" })
    ).toBeVisible()
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "旁聊" })
      ).not.toBeInTheDocument()
    )
    await interaction.click(screen.getByRole("button", { name: "打开旁聊" }))
    panel = await screen.findByRole("complementary", { name: "旁聊" })
    await waitFor(() =>
      expect(
        within(panel).getByRole("textbox", { name: "任务输入框" })
      ).toHaveValue("旁聊未发送的草稿")
    )
    await interaction.click(
      within(panel).getByRole("button", { name: "带回主任务输入框" })
    )
    expect(mainComposer).toHaveValue(
      "主任务原有草稿\n\n来自旁聊的引用\n> 旁聊结论，可带回。\n\n"
    )
    expect(starts).toEqual([])
    expect(
      requests.filter(
        (item) =>
          item.method === "POST" &&
          /\/(turns|pending-requests)$/u.test(item.path)
      )
    ).toEqual([])
    await interaction.click(
      within(panel).getByRole("button", { name: "收起旁聊" })
    )
    await interaction.click(screen.getByRole("button", { name: "打开旁聊" }))
    const reopened = await screen.findByRole("complementary", { name: "旁聊" })
    const restoredComposer = await within(reopened).findByRole("textbox", {
      name: "任务输入框",
    })
    await waitFor(() =>
      expect(restoredComposer).toHaveValue("旁聊未发送的草稿")
    )
    await interaction.click(restoredComposer)
    await interaction.keyboard("{Enter}")
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toMatchObject({
      message_display: {
        kind: "conversation_reference",
        reference_id: referenceId,
        request: "旁聊未发送的草稿",
      },
    })
    expect(mainComposer).toHaveValue(
      "主任务原有草稿\n\n来自旁聊的引用\n> 旁聊结论，可带回。\n\n"
    )
  })
})
