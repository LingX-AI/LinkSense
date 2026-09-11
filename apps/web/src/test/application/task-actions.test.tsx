import {
  act,
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
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
import { conversationInterruptTimeoutMs } from "@/features/conversations/conversation-interrupt"

describe("LinkSense application", () => {
  setupApplicationTests()
  it.each([
    ["TURN_START_CLOSED", false, false],
    ["TURN_START_CLOSED", false, true],
    ["RUNNER_UNAVAILABLE", true, false],
  ])(
    "allows manual resubmission after %s (reuse identity: %s, reload: %s)",
    async (errorCode, reuseIdentity, reload) => {
      let attempts = 0
      const { requests } = installApiMock({
        conversationOverride: {
          execution_status: "completed",
          running_turn: null,
          turns: [{ id: "turn-1", status: "completed" }],
          pending_requests: [],
        },
        turnStartResponse: async () => {
          attempts += 1
          if (attempts > 1)
            return json(
              {
                success: true,
                data: {
                  turn_id: "00000000-0000-4000-8000-000000000002",
                  accepted: true,
                  status: "starting",
                },
              },
              202
            )
          return json(
            { success: false, error_code: errorCode },
            errorCode === "TURN_START_CLOSED" ? 409 : 503
          )
        },
      })
      const interaction = userEvent.setup()
      const view = renderApp()
      let composer = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(composer, "请继续处理")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      const submissions = () =>
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      await waitFor(() => expect(submissions()).toHaveLength(1))
      await waitFor(() => expect(composer).toHaveValue("请继续处理"))
      expect(submissions()).toHaveLength(1)
      if (errorCode === "TURN_START_CLOSED") {
        expect(
          await screen.findByText("上次提交已结束，本次未执行。请重新提交")
        ).toBeVisible()
      }
      if (reload) {
        view.unmount()
        renderApp()
        composer = await screen.findByRole("textbox", { name: "任务输入框" })
        await waitFor(() => expect(composer).toHaveValue("请继续处理"))
        expect(submissions()).toHaveLength(1)
      }
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(submissions()).toHaveLength(2))
      const ids = submissions().map(
        (request) =>
          (request.body as { idempotency_key: string }).idempotency_key
      )
      expect(ids[0] === ids[1]).toBe(reuseIdentity)
    }
  )

  it("renders the protected Codex-style shell and conversation controls", async () => {
    installApiMock()
    renderApp()

    expect(
      await screen.findByRole("log", undefined, { timeout: 3_000 })
    ).toBeInTheDocument()
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 导航" })
    ).toBeInTheDocument()
    expect(screen.getByRole("banner")).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "任务输入框" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "语音输入" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument()
  })

  it("refreshes a stale running conversation after the interrupt target is already terminal", async () => {
    const interaction = userEvent.setup()
    const { requests } = installApiMock({
      interruptResponse: () =>
        json(
          {
            success: true,
            data: { code: "TURN_INTERRUPT_NOT_ACTIVE" },
          },
          202
        ),
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data:
            callIndex === 1
              ? conversation
              : {
                  ...conversation,
                  execution_status: "completed",
                  running_turn: null,
                  turns: [{ id: "turn-1", status: "completed" }],
                },
        }),
    })
    renderApp()

    await interaction.click(await screen.findByRole("button", { name: "停止" }))

    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(2)
    })
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("reconciles a stopped turn when the completion event is missing and the first refresh is stale", async () => {
    const { requests } = installApiMock({
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data:
            callIndex < 3
              ? conversation
              : {
                  ...conversation,
                  execution_status: "interrupted",
                  running_turn: null,
                  turns: [{ id: "turn-1", status: "interrupted" }],
                },
        }),
    })
    renderApp()
    fireEvent.click(await screen.findByRole("button", { name: "停止" }))
    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: "正在中断…" })).toBeNull()
        expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
      },
      { timeout: 5_000 }
    )
    expect(
      requests.filter((request) => request.path.endsWith("/interrupt"))
    ).toHaveLength(1)
  })

  it("allows stopping again after confirmation times out without pretending the turn has ended", async () => {
    const { requests } = installApiMock()
    renderApp()
    const stop = await screen.findByRole("button", { name: "停止" })
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(stop)
    })
    expect(screen.getByRole("button", { name: "正在中断…" })).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(conversationInterruptTimeoutMs)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled()
    expect(screen.getByText("暂时无法中断当前执行，请稍后重试")).toBeVisible()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "停止" }))
    })
    expect(
      requests.filter((request) => request.path.endsWith("/interrupt"))
    ).toHaveLength(2)
  })

  it("keeps interrupted streamed output after terminal refresh and page remount", async () => {
    const partialText = "这段已经输出的内容需要保留。"
    const partialMessageId = "60000000-0000-4000-8000-000000000041"
    const nativeItemId = "native-interrupted-message"
    const localTurnId = "30000000-0000-4000-8000-000000000041"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const event = (
      sequence: number,
      eventType: string,
      payload: Record<string, unknown>
    ) => {
      const eventId = `c1:${sequence}`
      return `id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify({
        id: `61000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: localTurnId,
        sequence_no: sequence,
        event_type: eventType,
        visibility: "user_visible",
        payload,
        sse_event_id: eventId,
        created_at: `2026-08-29T08:00:${String(sequence).padStart(2, "0")}.000Z`,
      })}\n\n`
    }
    const nativePayload = (
      method: string,
      params: Record<string, unknown>
    ) => ({
      schema_version: 2,
      source: "codex_app_server",
      method,
      params,
    })
    const interruptedDetail = {
      ...conversation,
      execution_status: "interrupted",
      running_turn: null,
      turns: [{ id: localTurnId, status: "interrupted" }],
      last_event_id: "c1:44",
      messages: [
        ...conversation.messages,
        {
          id: partialMessageId,
          role: "assistant",
          turn_id: localTurnId,
          content: partialText,
          created_at: "2026-08-29T08:00:41.000Z",
        },
      ],
    }
    const eventStreamBody = [
      event(
        41,
        "item/agentMessage/delta",
        nativePayload("item/agentMessage/delta", {
          threadId: "native-thread-1",
          turnId: "native-turn-1",
          itemId: nativeItemId,
          delta: partialText,
        })
      ),
      event(42, "conversation.message.completed", {
        schema_version: 1,
        message_id: partialMessageId,
        role: "assistant",
        item_id: nativeItemId,
      }),
      event(
        43,
        "turn/completed",
        nativePayload("turn/completed", {
          threadId: "native-thread-1",
          turn: { id: "native-turn-1", status: "interrupted" },
        })
      ),
    ].join("")
    const { requests } = installApiMock({
      eventStreamBody,
      eventStreamStart,
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data:
            callIndex === 1
              ? {
                  ...conversation,
                  turns: [{ id: localTurnId, status: "running" }],
                  running_turn: { id: localTurnId, status: "running" },
                }
              : interruptedDetail,
        }),
    })

    const firstMount = renderApp()

    await screen.findByRole("log", undefined, { timeout: 10_000 })
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    await waitFor(
      () => {
        const messages = screen.getAllByText(partialText)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toBeVisible()
      },
      { timeout: 10_000 }
    )
    await waitFor(
      () => {
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1" &&
              request.method === "GET"
          ).length
        ).toBeGreaterThanOrEqual(2)
        expect(screen.getAllByText(partialText)).toHaveLength(1)
      },
      { timeout: 10_000 }
    )

    firstMount.unmount()
    renderApp()

    await waitFor(
      () => {
        const messages = screen.getAllByText(partialText)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toBeVisible()
      },
      { timeout: 10_000 }
    )
  }, 30_000)

  it("uploads all pasted files one at a time", async () => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:pasted-image")
        static revokeObjectURL = vi.fn()
      }
    )
    let resolveFirstUpload: ((response: Response) => void) | undefined
    const firstUpload = new Promise<Response>((resolve) => {
      resolveFirstUpload = resolve
    })
    const uploadedNames: string[] = []
    const documentFile = new File(["document"], "requirements.pdf", {
      type: "application/pdf",
    })
    const imageFile = new File(["image"], "reference.png", {
      type: "image/png",
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      attachmentUploadResponse: (formData, callIndex) => {
        const file = formData.get("file")
        uploadedNames.push(file instanceof File ? file.name : "")
        if (callIndex === 1) return firstUpload
        return json({
          success: true,
          data: {
            id: `attachment-${callIndex}`,
            name: file instanceof File ? file.name : "attachment",
            kind: "attachment",
            size: file instanceof File ? file.size : 0,
          },
        })
      },
    })
    renderApp()

    const input = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 10_000 }
    )
    await waitFor(
      () => expect(screen.getByLabelText("添加附件")).toBeEnabled(),
      { timeout: 10_000 }
    )
    const pasteEvent = createEvent.paste(input)
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [documentFile, imageFile],
        items: [
          {
            kind: "file",
            type: documentFile.type,
            getAsFile: () => documentFile,
          },
        ],
      },
    })

    fireEvent(input, pasteEvent)

    await waitFor(() => expect(uploadedNames).toEqual([documentFile.name]), {
      timeout: 10_000,
    })
    const imageUpload = screen.getByRole("status", {
      name: `正在上传附件 ${imageFile.name}`,
    })
    expect(imageUpload.closest(".image-preview-thumbnail")).not.toBeNull()
    expect(imageUpload.querySelector("img")).toHaveAttribute(
      "src",
      "blob:pasted-image"
    )
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/attachments" &&
          request.method === "POST"
      )
    ).toHaveLength(1)

    resolveFirstUpload?.(
      json({
        success: true,
        data: {
          id: "attachment-1",
          name: documentFile.name,
          kind: "attachment",
          size: documentFile.size,
        },
      })
    )

    await waitFor(
      () => expect(uploadedNames).toEqual([documentFile.name, imageFile.name]),
      { timeout: 10_000 }
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/attachments" &&
            request.method === "POST"
        )
      ).toHaveLength(2)
    )
  }, 20_000)

  it("skips meaningless temporary files from folder attachment uploads", async () => {
    const interaction = userEvent.setup()
    const uploadedNames: string[] = []
    const usefulFile = new File(["model"], "model.weights", {
      type: "application/octet-stream",
    })
    const macMetadata = new File(["metadata"], ".DS_Store", {
      type: "application/octet-stream",
    })
    const resourceFork = new File(["fork"], "._model.weights", {
      type: "application/octet-stream",
    })
    Object.defineProperty(usefulFile, "webkitRelativePath", {
      configurable: true,
      value: "project/model.weights",
    })
    Object.defineProperty(macMetadata, "webkitRelativePath", {
      configurable: true,
      value: "project/.DS_Store",
    })
    Object.defineProperty(resourceFork, "webkitRelativePath", {
      configurable: true,
      value: "project/__MACOSX/._model.weights",
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      attachmentUploadResponse: (formData) => {
        const file = formData.get("file")
        uploadedNames.push(file instanceof File ? file.name : "")
        return json({
          success: true,
          data: {
            id: `attachment-${uploadedNames.length}`,
            name: file instanceof File ? file.name : "attachment",
            kind: "attachment",
            size: file instanceof File ? file.size : 0,
          },
        })
      },
    })
    renderApp()

    const folderInput = await screen.findByLabelText("添加文件夹", undefined, {
      timeout: 10_000,
    })
    await waitFor(() => expect(folderInput).toBeEnabled(), { timeout: 10_000 })
    await interaction.upload(folderInput, [
      usefulFile,
      macMetadata,
      resourceFork,
    ])

    await waitFor(() => expect(uploadedNames).toEqual(["model.weights"]))
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/attachments" &&
          request.method === "POST"
      )
    ).toHaveLength(1)
  })

  it("shows an error when every selected attachment is a temporary file", async () => {
    const interaction = userEvent.setup()
    const macMetadata = new File(["metadata"], ".DS_Store", {
      type: "application/octet-stream",
    })
    Object.defineProperty(macMetadata, "webkitRelativePath", {
      configurable: true,
      value: "project/.DS_Store",
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
    })
    renderApp()

    const folderInput = await screen.findByLabelText("添加文件夹", undefined, {
      timeout: 10_000,
    })
    await waitFor(() => expect(folderInput).toBeEnabled(), { timeout: 10_000 })
    await interaction.upload(folderInput, macMetadata)

    expect(
      await screen.findByText("已跳过临时文件，请选择其他有意义的文件")
    ).toBeInTheDocument()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/attachments" &&
          request.method === "POST"
      )
    ).toHaveLength(0)
  })

  it("shows the compact message rail at rest and reveals cached task messages on hover", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        messages: [
          { id: "m1", role: "user", content: "请评估活动风险" },
          {
            id: "m2",
            role: "assistant",
            content: "正在整理风险与建议。",
          },
          { id: "m3", role: "user", content: "再检查天气影响" },
          {
            id: "m4",
            role: "assistant",
            content: "已补充恶劣天气预案。",
          },
        ],
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
        execution_status: "completed",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const messageNavigation = await screen.findByRole("navigation", {
      name: "任务消息导航",
    })
    expect(within(messageNavigation).getAllByRole("button")).toHaveLength(2)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByTestId("conversation-line-m1")).toHaveClass(
      "[--line-effect:0]"
    )

    const detailRequestCount = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1" && request.method === "GET"
    ).length
    await interaction.hover(
      within(messageNavigation).getByRole("button", {
        name: "请评估活动风险",
      })
    )

    const preview = screen.getByRole("dialog", {
      name: "请评估活动风险",
    })
    expect(within(preview).getByText("请评估活动风险")).toBeVisible()
    expect(within(preview).getByText("正在整理风险与建议。")).toBeVisible()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1" &&
          request.method === "GET"
      )
    ).toHaveLength(detailRequestCount)

    await interaction.unhover(
      within(messageNavigation).getByRole("button", {
        name: "请评估活动风险",
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    const targetMessage = screen.getAllByRole("article", {
      name: "用户消息",
    })[1]
    await interaction.click(
      within(messageNavigation).getByRole("button", {
        name: "再检查天气影响",
      })
    )
    expect(targetMessage).toHaveAttribute("id", "conversation-message-m3")
  })

  it("closes the confirmation dialog after deleting the current task", async () => {
    let conversationListRequestCount = 0
    let resolveConversationListRefresh!: (response: Response) => void
    const conversationListRefresh = new Promise<Response>((resolve) => {
      resolveConversationListRefresh = resolve
    })
    const { requests } = installApiMock({
      conversationListResponse: () => {
        conversationListRequestCount += 1
        return conversationListRequestCount === 1
          ? json({
              success: true,
              data: { items: conversations, next_cursor: null },
            })
          : conversationListRefresh
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    expect(await screen.findByRole("log")).toBeInTheDocument()
    await interaction.click(screen.getByRole("button", { name: "操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "删除任务" })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "永久删除任务？",
    })
    const deleteButton = within(dialog).getByRole("button", { name: "删除" })
    expect(deleteButton).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    await interaction.click(deleteButton)

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "永久删除任务？" })
      ).not.toBeInTheDocument()
    )
    expect(
      await screen.findByRole("heading", { name: "未命名任务" })
    ).toBeVisible()
    resolveConversationListRefresh(
      json({
        success: true,
        data: { items: conversations.slice(1), next_cursor: null },
      })
    )
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: "/api/v1/conversations/c1",
        method: "DELETE",
      })
    )
  })

  it("groups current task actions and leaves the task after archiving it", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole("banner")
    const title = within(banner).getByRole("heading", {
      name: conversations[0]!.title,
    })
    const titleActions = title.parentElement
    expect(titleActions).not.toBeNull()
    expect(titleActions).toHaveClass("conversation-title-actions", "gap-1")
    expect(
      titleActions?.querySelector(".conversation-title-application-icon")
    ).toBeNull()
    expect(within(banner).getAllByRole("button")).toHaveLength(3)
    expect(within(banner).getByRole("button", { name: "分享" })).toBeVisible()
    expect(
      within(banner).getByRole("button", { name: "关闭任务概览" })
    ).toBeVisible()

    const actionsButton = within(titleActions as HTMLElement).getByRole(
      "button",
      { name: "操作" }
    )
    expect(actionsButton.querySelector("svg")).toHaveClass(
      "text-[var(--app-muted)]",
      "opacity-70"
    )
    await interaction.click(actionsButton)

    const renameItem = await screen.findByRole("menuitem", {
      name: "重命名",
    })
    expect(renameItem).toBeVisible()
    const archiveItem = screen.getByRole("menuitem", { name: "归档任务" })
    const deleteItem = screen.getByRole("menuitem", { name: "删除任务" })
    expect(archiveItem).toBeVisible()
    expect(deleteItem).toBeVisible()
    for (const item of [renameItem, archiveItem]) {
      expect(item.querySelector("svg")).toHaveClass(
        "size-3.5",
        "text-[var(--app-muted)]",
        "opacity-70"
      )
    }
    expect(deleteItem.querySelector("svg")).toHaveClass(
      "size-3.5",
      "opacity-70"
    )

    await interaction.click(archiveItem)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { archive_status: "archived" },
        })
      )
    )
    expect(
      await screen.findByRole("heading", { name: "未命名任务" })
    ).toBeVisible()
  })

  it("pins and unpins the current task from the title actions menu", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole("banner")
    const actionsButton = within(banner).getByRole("button", { name: "操作" })

    await interaction.click(actionsButton)
    const pinItem = await screen.findByRole("menuitem", {
      name: "置顶任务",
    })
    expect(pinItem.querySelector('[data-icon="conversation-pin"]')).toHaveClass(
      "size-3.5",
      "text-[var(--app-muted)]",
      "opacity-70"
    )
    await interaction.click(pinItem)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { pinned: true },
        })
      )
    )

    await interaction.click(actionsButton)
    const unpinItem = await screen.findByRole("menuitem", {
      name: "取消置顶",
    })
    expect(
      unpinItem.querySelector('[data-icon="conversation-pin-filled"]')
    ).toHaveClass("size-3.5", "text-[var(--app-muted)]", "opacity-70")
    await interaction.click(unpinItem)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { pinned: false },
        })
      )
    )
  })

  it("uses a larger restore icon for an archived current task", async () => {
    installApiMock({
      conversationOverride: {
        archived: true,
        archive_status: "archived",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole("banner")
    await interaction.click(
      within(banner).getByRole("button", { name: "操作" })
    )

    const unarchiveItem = await screen.findByRole("menuitem", {
      name: "取消归档",
    })
    expect(
      unarchiveItem.querySelector('[data-icon="conversation-unarchive"]')
    ).toHaveClass("size-4", "text-[var(--app-muted)]", "opacity-70")
  })
})
