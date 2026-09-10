import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  setupApplicationTests,
  conversation,
  installApiMock,
  json,
  renderApp,
  seedLocalDraft,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("downloads an artifact in the current page and ignores a repeated click while pending", async () => {
    const createObjectURL = vi.fn(() => "blob:artifact-download")
    const revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const open = vi.fn()
    vi.stubGlobal("open", open)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    let resolveDownload: ((response: Response) => void) | undefined
    const downloadResponse = new Promise<Response>((resolve) => {
      resolveDownload = resolve
    })
    const { requests } = installApiMock({
      downloadResponse,
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "报告已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "report.pdf",
                kind: "artifact",
                downloadable: true,
              },
            ],
          },
        ],
      },
    })
    renderApp()
    const assistantReplies = await screen.findAllByRole("article", {
      name: "助手回复",
    })
    const download = within(assistantReplies.at(-1)!).getByRole("button", {
      name: "下载 report.pdf",
    })
    fireEvent.click(download)
    fireEvent.click(download)

    expect(open).not.toHaveBeenCalled()
    expect(
      requests.filter(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/artifact-1/download" &&
          request.method === "GET"
      )
    ).toHaveLength(1)
    resolveDownload?.(
      new Response("pdf-content", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    )
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(createObjectURL).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe("blob:artifact-download")
    expect(anchor.download).toBe("report.pdf")
    expect(anchor.target).toBe("")
    expect(anchor.isConnected).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe("http://localhost/")
    await waitFor(() => expect(download).toBeEnabled())
  })

  it("shows the reusable top notification when an artifact download fails", async () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    installApiMock({
      downloadResponse: Promise.resolve(
        json(
          {
            success: false,
            error_code: "ARTIFACT_NOT_FOUND",
            message_key: "errors.artifactNotFound",
          },
          404
        )
      ),
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "报告已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "report.pdf",
                kind: "artifact",
                downloadable: true,
              },
            ],
          },
        ],
      },
    })
    renderApp()

    const assistantReplies = await screen.findAllByRole("article", {
      name: "助手回复",
    })
    fireEvent.click(
      within(assistantReplies.at(-1)!).getByRole("button", {
        name: "下载 report.pdf",
      })
    )

    const notification = await screen.findByText("未找到该产物。")
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest(".conversation-top-overlay-stack")).toBeNull()
    expect(click).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe("http://localhost/")
  })

  it("downloads an image artifact from the shared preview through the artifact download route", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:image-artifact-download"),
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const { requests } = installApiMock({
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "图片已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "小狗和可乐.png",
                mime_type: "image/png",
                size_bytes: 235_520,
                kind: "artifact",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const preview = await screen.findByRole(
      "button",
      { name: "预览图片 小狗和可乐.png" },
      { timeout: 3_000 }
    )
    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/artifact-1/preview" &&
          request.method === "POST"
      )
    ).toBe(true)
    const assistantReplies = await screen.findAllByRole("article", {
      name: "助手回复",
    })
    expect(
      within(assistantReplies.at(-1)!).getByText("小狗和可乐.png")
    ).toBeVisible()
    expect(
      within(assistantReplies.at(-1)!).getByRole("button", {
        name: "下载 小狗和可乐.png",
      })
    ).toBeVisible()

    await interaction.click(preview)
    expect(
      await screen.findByRole(
        "img",
        { name: "小狗和可乐.png" },
        { timeout: 3_000 }
      )
    ).toHaveAttribute("src", "https://files.example.test/artifact-preview.png")

    const previewPane = await screen.findByRole("region", {
      name: "预览文档 小狗和可乐.png",
    })
    await interaction.click(
      within(previewPane).getByRole("button", {
        name: "下载文档 小狗和可乐.png",
      })
    )

    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(
      requests.filter(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/artifact-1/download" &&
          request.method === "GET"
      )
    ).toHaveLength(1)
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/files/artifact-1/media"
      )
    ).toBe(false)
  })

  it("opens a sent XLSX attachment with the shared file preview", async () => {
    const spreadsheet = {
      id: "attachment-sheet-1",
      filename: "EdTech出差费用明细表.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size_bytes: 54_321,
      kind: "attachment",
      status: "bound",
      turn_id: "turn-1",
      downloadable: false,
    }
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [{ id: "turn-1", status: "completed" }],
        messages: conversation.messages.map((message) =>
          message.role === "user"
            ? { ...message, attachments: [spreadsheet] }
            : message
        ),
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览文档 EdTech出差费用明细表.xlsx",
      })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/attachments/attachment-sheet-1/content" &&
            request.method === "GET"
        )
      ).toBe(true)
    )
    expect(
      requests.some(
        (request) =>
          request.path ===
          "/api/v1/conversations/c1/files/attachment-sheet-1/content"
      )
    ).toBe(false)
  })

  it("shows a PPTX selection question immediately without waiting for turn admission", async () => {
    seedLocalDraft("c1", { input: "主输入框原有草稿" })
    let resolveTurnStart: ((response: Response) => void) | undefined
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [{ id: "turn-1", status: "completed" }],
        draft_input: "主输入框原有草稿",
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            content: "演示文稿已生成。",
            artifacts: [
              {
                id: "70000000-0000-4000-8000-000000000001",
                filename: "ai-introduction.pptx",
                mime_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes: 268_000,
                kind: "artifact",
                turn_id: "turn-1",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
      turnStartResponse: async () =>
        new Promise((resolve) => {
          resolveTurnStart = resolve
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览演示文稿 ai-introduction.pptx",
      })
    )

    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/70000000-0000-4000-8000-000000000001/content" &&
          request.method === "GET"
      )
    ).toBe(true)

    await interaction.click(
      await screen.findByRole("button", { name: "进入文件标注模式" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "问 LinkSense" })
    )

    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "任务输入框",
    })
    expect(composer).toHaveValue("主输入框原有草稿")

    const selectionPromptForm = await screen.findByRole("form", {
      name: "针对所选元素询问 LinkSense",
    })
    const selectionPrompt = within(selectionPromptForm).getByRole("textbox", {
      name: "针对所选元素询问 LinkSense",
    })
    await interaction.type(selectionPrompt, "改为英文")
    expect(composer).toHaveValue("主输入框原有草稿")
    await interaction.click(
      within(selectionPromptForm).getByRole("button", { name: "添加标注" })
    )

    expect(selectionPromptForm).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    )
    await interaction.click(
      within(
        await screen.findByRole("dialog", { name: "待发送标注列表" })
      ).getByRole("button", { name: "发送" })
    )
    const optimisticQuestion = (
      await screen.findAllByRole("article", { name: "用户消息" })
    ).at(-1)
    expect(optimisticQuestion).toBeDefined()
    const optimisticAnnotation = within(
      optimisticQuestion as HTMLElement
    ).getByRole("region", {
      name: "演示文稿注释：ai-introduction.pptx",
    })
    expect(
      within(optimisticAnnotation).getByRole("button", {
        name: "1 条注释",
      })
    ).toBeVisible()
    expect(
      within(optimisticQuestion as HTMLElement).queryByText("改为英文")
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/turns"
        )
      ).toBe(true)
    })
    const turnRequest = requests.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/api/v1/conversations/c1/turns"
    )
    const body = turnRequest?.body as {
      input_text?: string
      priority_capability_ids?: string[]
      message_display?: Record<string, unknown>
    }
    expect(body.input_text).toBeUndefined()
    expect(body.priority_capability_ids).toEqual([])
    expect(body).not.toHaveProperty("draft_policy")
    expect(body.message_display).toEqual({
      kind: "presentation_annotation",
      file_id: "70000000-0000-4000-8000-000000000001",
      annotations: [
        {
          request: "改为英文",
          slide_number: 3,
          elements: [
            {
              element_id: "title-1",
              type: "text",
              text: "人工智能连接数据、算法与人类目标",
              bounds: { x: 120, y: 80, width: 520, height: 90 },
            },
          ],
        },
      ],
    })
    expect(composer).toHaveValue("主输入框原有草稿")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toBe(false)

    resolveTurnStart?.(
      json(
        {
          success: true,
          data: {
            turn_id: "00000000-0000-4000-8000-000000000001",
            accepted: true,
            status: "starting",
          },
        },
        202
      )
    )
  })

  it("queues a PPTX selection question while the current task is running", async () => {
    seedLocalDraft("c1", { input: "主输入框原有草稿" })
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "running",
        running_turn: { id: "turn-1", status: "running" },
        turns: [{ id: "turn-1", status: "running" }],
        draft_input: "主输入框原有草稿",
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            content: "演示文稿已生成。",
            artifacts: [
              {
                id: "70000000-0000-4000-8000-000000000001",
                filename: "ai-introduction.pptx",
                mime_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes: 268_000,
                kind: "artifact",
                turn_id: "turn-1",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
      pendingRequestResponse: (body) => {
        const request = body as { idempotency_key?: string }
        return json(
          {
            success: true,
            data: {
              id: "pending-office-1",
              queue_no: 1,
              status: "waiting_previous_turn",
              input_text: "改为英文",
              idempotency_key: request.idempotency_key,
            },
          },
          201
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览演示文稿 ai-introduction.pptx",
      })
    )

    await interaction.click(
      await screen.findByRole("button", { name: "进入文件标注模式" })
    )
    const askButton = await screen.findByRole("button", {
      name: "问 LinkSense",
    })
    expect(askButton).toBeEnabled()
    await interaction.click(askButton)

    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "任务输入框",
    })
    expect(composer).toHaveValue("主输入框原有草稿")

    const selectionPromptForm = await screen.findByRole("form", {
      name: "针对所选元素询问 LinkSense",
    })
    const selectionPrompt = within(selectionPromptForm).getByRole("textbox", {
      name: "针对所选元素询问 LinkSense",
    })
    await interaction.type(selectionPrompt, "改为英文")
    await interaction.click(
      within(selectionPromptForm).getByRole("button", { name: "添加标注" })
    )

    expect(selectionPromptForm).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    )
    await interaction.click(
      within(
        await screen.findByRole("dialog", { name: "待发送标注列表" })
      ).getByRole("button", { name: "发送" })
    )
    expect(await screen.findByText("1 条注释")).toBeVisible()
    expect(screen.queryByText("改为英文")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/pending-requests"
        )
      ).toBe(true)
    })
    const pendingRequest = requests.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/api/v1/conversations/c1/pending-requests"
    )
    const body = pendingRequest?.body as {
      input_text?: string
      priority_capability_ids?: string[]
      message_display?: Record<string, unknown>
    }
    expect(body.input_text).toBeUndefined()
    expect(body.priority_capability_ids).toEqual([])
    expect(body).not.toHaveProperty("draft_policy")
    expect(body.message_display).toEqual({
      kind: "presentation_annotation",
      file_id: "70000000-0000-4000-8000-000000000001",
      annotations: [
        {
          request: "改为英文",
          slide_number: 3,
          elements: [
            {
              element_id: "title-1",
              type: "text",
              text: "人工智能连接数据、算法与人类目标",
              bounds: { x: 120, y: 80, width: 520, height: 90 },
            },
          ],
        },
      ],
    })
    expect(
      requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/conversations/c1/turns"
      )
    ).toBe(false)
    expect(composer).toHaveValue("主输入框原有草稿")
  })

  it("downloads a loaded Office preview in the current page", async () => {
    const createObjectURL = vi.fn(() => "blob:office-preview")
    const revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const open = vi.fn()
    vi.stubGlobal("open", open)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    installApiMock({
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "演示文稿已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "ai-introduction.pptx",
                mime_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes: 268_000,
                kind: "artifact",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览演示文稿 ai-introduction.pptx",
      })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "下载预览文档" })
    )

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe("blob:office-preview")
    expect(anchor.download).toBe("ai-introduction.pptx")
    expect(anchor.target).toBe("")
    expect(anchor.isConnected).toBe(false)
  })
})
