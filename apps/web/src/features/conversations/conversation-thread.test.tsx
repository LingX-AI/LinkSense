import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import type {
  CapabilitySummary,
  Conversation,
  NativeCodexItem,
} from "@/api/contracts"
import { downloadApiFile } from "@/api/client"
import {
  AssistantMarkdown,
  ConversationThread,
} from "@/features/conversations/conversation-thread"
import {
  assistantHtmlPreviewReadyMessageType,
  assistantHtmlPreviewResizeMessageType,
  assistantHtmlPreviewShellInitializeMessageType,
  assistantHtmlPreviewShellReadyMessageType,
  assistantHtmlPreviewWheelMessageType,
} from "@/features/conversations/assistant-html-preview-document"
import i18n from "@/i18n"
import { AssistantKnowledgeImage } from "@/features/conversations/assistant-knowledge-image"

const knowledgeBaseApiMocks = vi.hoisted(() => ({
  getKnowledgeCitationPreview: vi.fn(),
}))

const agentKeyA = `agent_${"a".repeat(24)}`
const agentKeyB = `agent_${"b".repeat(24)}`
const agentKeyC = `agent_${"c".repeat(24)}`

vi.mock("@/api/client", () => ({
  downloadApiFile: vi.fn().mockResolvedValue(new Blob()),
}))

vi.mock(
  "@/features/knowledge-bases/knowledge-base-api",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/knowledge-bases/knowledge-base-api")
      >()
    return {
      ...actual,
      getKnowledgeCitationPreview:
        knowledgeBaseApiMocks.getKnowledgeCitationPreview,
    }
  }
)

const originalExecCommand = document.execCommand
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)
const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor)
  else Reflect.deleteProperty(URL, name)
}

function mockExecCommand(result: boolean) {
  const execCommand = vi.fn(() => result)
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: execCommand,
  })
  return execCommand
}

const completedConversation: Conversation = {
  id: "conversation-1",
  title: "回归测试",
  archived: false,
  category_id: null,
  collaboration_mode: "default",
  user_input_requests: [],
  plan_reviews: [],
  updated_at: "2026-07-11T08:00:03.250Z",
  has_unread_completion: false,
  has_automation: false,
  messages: [
    {
      id: "message-user-1",
      role: "user",
      turn_id: "turn-1",
      sequence_no: 1,
      content: "请给出处理结果",
      created_at: "2026-07-11T15:47:00",
    },
    {
      id: "message-assistant-1",
      role: "assistant",
      turn_id: "turn-1",
      sequence_no: 2,
      content:
        "**处理完成**\n\n- 已检查 `pnpm dev`\n- [查看文档](https://example.com/docs)",
      created_at: "2026-07-11T15:54:00",
    },
  ],
  turns: [
    {
      id: "turn-1",
      status: "completed",
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: "2026-07-11T08:00:03.250Z",
    },
  ],
  running_turn: null,
  activities: [],
}

describe("conversation turn responses", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(downloadApiFile).mockClear().mockResolvedValue(new Blob())
    knowledgeBaseApiMocks.getKnowledgeCitationPreview.mockReset()
    createObjectURL.mockReset().mockReturnValue("blob:sent-image")
    revokeObjectURL.mockReset()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  afterEach(() => {
    cleanup()
    window.getSelection()?.removeAllRanges()
    if (originalExecCommand) {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        writable: true,
        value: originalExecCommand,
      })
    } else {
      Reflect.deleteProperty(document, "execCommand")
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl)
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl)
  })

  it("branches from the final terminal assistant message", async () => {
    const interaction = userEvent.setup()
    const onForkMessage = vi.fn(async () => undefined)
    render(
      <MemoryRouter>
        <ConversationThread
          conversation={completedConversation}
          onDownload={vi.fn()}
          onForkMessage={onForkMessage}
        />
      </MemoryRouter>
    )

    await interaction.click(
      screen.getByRole("button", { name: "分支到新聊天" })
    )

    expect(onForkMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-assistant-1" })
    )
  })

  it("renders a source-task link at the copied-context boundary", () => {
    const { container } = render(
      <MemoryRouter>
        <ConversationThread
          conversation={{
            ...completedConversation,
            fork_source: {
              available: true,
              conversation_id: "source-conversation-1",
              message_id: "source-message-1",
              title: "源任务",
              boundary_sequence_no: 2,
            },
            messages: [
              ...(completedConversation.messages ?? []),
              {
                id: "message-user-2",
                role: "user",
                turn_id: "turn-2",
                sequence_no: 3,
                content: "分支中的新问题",
                created_at: "2026-07-11T16:00:00",
              },
            ],
            turns: [
              ...(completedConversation.turns ?? []),
              {
                id: "turn-2",
                status: "completed",
                started_at: "2026-07-11T08:00:04.000Z",
                completed_at: "2026-07-11T08:00:05.000Z",
              },
            ],
          }}
          onDownload={vi.fn()}
        />
      </MemoryRouter>
    )

    const sourceLink = screen.getByRole("link", {
      name: "打开源任务：源任务",
    })
    const copiedAnswer = screen.getByText("处理完成")
    const nextQuestion = screen.getByText("分支中的新问题")

    expect(sourceLink).toHaveAttribute(
      "href",
      "/conversations/source-conversation-1"
    )
    expect(sourceLink).toHaveTextContent("从聊天中继续")
    expect(sourceLink).toHaveClass(
      "before:bg-foreground/10",
      "after:bg-foreground/10",
      "hover:before:bg-foreground/20",
      "hover:after:bg-foreground/20"
    )
    expect(
      copiedAnswer.compareDocumentPosition(sourceLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      sourceLink.compareDocumentPosition(nextQuestion) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      container.querySelectorAll("[data-slot='fork-source-marker']")
    ).toHaveLength(1)
  })

  it("renders a non-clickable marker when the source task is unavailable", () => {
    render(
      <MemoryRouter>
        <ConversationThread
          conversation={{
            ...completedConversation,
            fork_source: {
              available: false,
              boundary_sequence_no: 2,
            },
          }}
          onDownload={vi.fn()}
        />
      </MemoryRouter>
    )

    const unavailableMarker = screen.getByRole("note", {
      name: "源任务不可用",
    })
    expect(unavailableMarker).toHaveTextContent("源任务不可用")
    expect(unavailableMarker).toHaveClass(
      "before:bg-foreground/10",
      "after:bg-foreground/10"
    )
    expect(
      screen.queryByRole("link", { name: /打开源任务/u })
    ).not.toBeInTheDocument()
  })

  it("renders the localized welcome state for a new task", async () => {
    const interaction = userEvent.setup()
    const onStarterQuestionSelect = vi.fn()
    const { container } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          id: "new",
          messages: [],
          turns: [],
          running_turn: null,
          activities: [],
        }}
        onDownload={vi.fn()}
        showNewTaskWelcome
        onStarterQuestionSelect={onStarterQuestionSelect}
      />
    )

    expect(
      screen.getByRole("heading", {
        name: "我们一起在 LinkSense 中做些什么？",
      })
    ).toBeVisible()
    expect(screen.queryByText("还没有任务。可以直接从输入框开始。")).toBeNull()
    expect(container.querySelector(".conversation-welcome-icon")).not.toBeNull()
    const starterQuestions = screen.getByRole("group", {
      name: "常见任务建议",
    })
    expect(within(starterQuestions).getAllByRole("button")).toHaveLength(4)
    const starterQuestionIcons = Array.from(
      starterQuestions.querySelectorAll<HTMLElement>(
        ".conversation-starter-question-icon"
      )
    )
    expect(starterQuestionIcons).toHaveLength(4)
    expect(starterQuestionIcons.map((icon) => icon.dataset.tone)).toEqual([
      "file",
      "knowledge",
      "data",
      "deliverable",
    ])
    expect(
      starterQuestionIcons.every(
        (icon) => icon.getAttribute("aria-hidden") === "true"
      )
    ).toBe(true)
    expect(
      within(starterQuestions).getByRole("button", {
        name: /分析一份文件/u,
      })
    ).toBeVisible()
    expect(
      within(starterQuestions).getByRole("button", {
        name: /查询内部知识/u,
      })
    ).toBeVisible()
    expect(
      within(starterQuestions).getByRole("button", {
        name: /分析表格数据/u,
      })
    ).toBeVisible()
    expect(
      within(starterQuestions).getByRole("button", {
        name: /制作工作成果/u,
      })
    ).toBeVisible()

    await interaction.click(
      within(starterQuestions).getByRole("button", {
        name: /分析一份文件/u,
      })
    )

    expect(onStarterQuestionSelect).toHaveBeenCalledWith(
      "请分析我上传的文件，提炼核心结论、关键风险和待办事项，并按重要程度整理。"
    )

    await i18n.changeLanguage("en-US")

    expect(
      await screen.findByRole("heading", {
        name: "What should we do together in LinkSense?",
      })
    ).toBeVisible()
    expect(
      await screen.findByRole("group", { name: "Common task suggestions" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Analyze a file/u })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Create a work deliverable/u })
    ).toBeVisible()
  })

  it("hides a submitted form with collapsed activity and preserves its result when reopened", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          user_input_requests: [
            {
              id: "30000000-0000-4000-8000-000000000007",
              conversation_id: completedConversation.id,
              turn_id: "turn-1",
              item_id: "linksense-form-18",
              kind: "form",
              server_name: "linksense_core",
              message: "请确认发布信息。",
              requested_schema: {
                type: "object",
                properties: {
                  title: { type: "string", title: "标题" },
                },
                required: ["title"],
              },
              ui_hints: {},
              response_semantics: { kind: "input" },
              response_content: { title: "季度复盘" },
              status: "answered",
              auto_resolve_at: "2026-07-11T08:10:00.000Z",
              resolved_at: "2026-07-11T08:02:00.000Z",
              resolved_action: "accept",
              created_at: "2026-07-11T08:01:00.000Z",
              updated_at: "2026-07-11T08:02:00.000Z",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    const finalReply = screen.getByRole("article", { name: "助手回复" })
    expect(screen.queryByTestId("conversation-user-input-request")).toBeNull()
    expect(within(finalReply).getByText("处理完成")).toBeVisible()

    for (let cycle = 0; cycle < 2; cycle++) {
      await interaction.click(
        within(summary).getByRole("button", { name: "展开中间过程" })
      )
      const card = within(summary).getByTestId(
        "conversation-user-input-request"
      )
      expect(card).toBeVisible()
      expect(card).toHaveAttribute("data-request-status", "submitted")
      expect(within(card).getByText("已提交")).toBeVisible()
      expect(within(card).getByRole("textbox", { name: /标题/ })).toHaveValue(
        "季度复盘"
      )
      expect(within(card).getByRole("textbox", { name: /标题/ })).toBeDisabled()
      expect(
        screen.getAllByTestId("conversation-user-input-request")
      ).toHaveLength(1)

      await interaction.click(
        within(summary).getByRole("button", { name: "收起中间过程" })
      )
      expect(screen.queryByTestId("conversation-user-input-request")).toBeNull()
      expect(within(finalReply).getByText("处理完成")).toBeVisible()
    }
  })

  it("keeps streamed assistant markdown stable while work is still running", () => {
    const { container } = render(
      <AssistantMarkdown
        streaming
        content={
          "# 已开始处理\n\n这是流式回复正文。\n\n- 第一项\n- 第二项\n\n> 正在整理结果"
        }
      />
    )

    expect(
      screen.getByRole("heading", { name: "已开始处理" }).closest(".shimmer")
    ).toBeNull()
    expect(
      screen.getByText("这是流式回复正文。").closest(".shimmer")
    ).toBeNull()
    expect(screen.getByText("第一项").closest(".shimmer")).toBeNull()
    expect(screen.getByText("正在整理结果").closest(".shimmer")).toBeNull()
    expect(container.querySelector(".assistant-markdown.shimmer")).toBeNull()
    expect(container.querySelector(".assistant-markdown .shimmer")).toBeNull()
  })

  it("requests site icons as soon as streamed assistant links are rendered", async () => {
    vi.mocked(downloadApiFile).mockResolvedValue(
      new Blob(["favicon"], { type: "image/png" })
    )

    render(
      <AssistantMarkdown
        streaming
        content={
          "打开 [Microsoft Security Info](https://mysignins.microsoft.com/security-info) 修改密码。"
        }
      />
    )

    expect(
      screen.getByRole("link", { name: "Microsoft Security Info" })
    ).toBeVisible()
    await waitFor(() => {
      expect(downloadApiFile).toHaveBeenCalledWith("/site-icons", {
        origin: "https://mysignins.microsoft.com",
      })
    })
  })

  it.each([
    ["empty", "[下载文件]()"],
    ["workspace-relative", "[下载文件](artifacts/result.zip)"],
    ["loopback", "[下载文件](http://127.0.0.1:5210/result.zip)"],
  ])(
    "renders %s assistant download destinations as plain text",
    (_, content) => {
      render(<AssistantMarkdown content={content} />)

      expect(screen.getByText("下载文件")).toBeVisible()
      expect(screen.queryByRole("link", { name: "下载文件" })).toBeNull()
    }
  )

  it.each([false, true])(
    "renders inline and block TeX formulas with KaTeX when streaming=%s",
    (streaming) => {
      const { container } = render(
        <AssistantMarkdown
          streaming={streaming}
          content={[
            "行内公式：\\(v = s / t\\)。",
            "",
            "\\[",
            "\\mathrm{tokens}/s \\approx \\frac{\\text{有效显存带宽}}{\\text{模型权重大小}+\\text{每步读取的 KV Cache}}",
            "\\]",
          ].join("\n")}
        />
      )

      expect(container.querySelectorAll(".katex")).toHaveLength(2)
      expect(container.querySelector(".katex-display")).not.toBeNull()
      expect(
        container.querySelector(".katex-display .katex-html")
      ).not.toBeNull()
      expect(screen.getByText("行内公式：", { exact: false })).toBeVisible()
    }
  )

  it.each([false, true])(
    "repairs spaced strong-emphasis closers without rewriting code examples when streaming=%s",
    (streaming) => {
      render(
        <AssistantMarkdown
          streaming={streaming}
          content={[
            "# TEC_306 技术使用政策",
            "",
            "**版本： **2.0",
            "",
            "- **创建人： **Jon Hansen",
            "",
            "`**行内示例： **value`",
            "",
            "```md",
            "**代码块： **value",
            "```",
          ].join("\n")}
        />
      )

      const versionLabel = screen.getByText("版本：", { selector: "strong" })
      const creatorLabel = screen.getByText("创建人：", { selector: "strong" })
      expect(versionLabel.closest("p")).toHaveTextContent("版本： 2.0")
      expect(creatorLabel.closest("li")).toHaveTextContent(
        "创建人： Jon Hansen"
      )
      expect(screen.getByText("**行内示例： **value")).toBeVisible()
      expect(screen.getByText("**代码块： **value")).toBeVisible()
    }
  )

  it.each([false, true])(
    "renders assistant emphasis whose opening markers contain leading whitespace when streaming=%s",
    (streaming) => {
      const { container } = render(
        <AssistantMarkdown
          streaming={streaming}
          content={[
            "- 9月1日：公司宣布** Neo He 提前转正**，表扬其项目表现。",
            "- 8月31日：任命** Jegan Chen、Rhoda Chen、Liz Xukur**分别兼任产品线负责人。",
            "- 8月28日：通知** 9月1日 16:00–18:00**举行 OKR 回顾会议。",
            "- 8月27日：欢迎新同事** Mayme Diao**加入 Infocare。",
            "- 8月16日：Rhoda 获奖励** 300元京东购物卡**。",
            "- 8月10日：Kate Chen 获** 200元沃尔玛购物卡**奖励。",
          ].join("\n")}
        />
      )

      expect(
        [...container.querySelectorAll("strong")].map(
          (element) => element.textContent
        )
      ).toEqual([
        "Neo He 提前转正",
        "Jegan Chen、Rhoda Chen、Liz Xukur",
        "9月1日 16:00–18:00",
        "Mayme Diao",
        "300元京东购物卡",
        "200元沃尔玛购物卡",
      ])
      expect(
        container.querySelector(".assistant-markdown")
      ).not.toHaveTextContent("**")
    }
  )

  it.each([false, true])(
    "renders assistant emphasis containing Unicode horizontal whitespace when streaming=%s",
    (streaming) => {
      const { container } = render(
        <AssistantMarkdown
          streaming={streaming}
          content={
            "这是当前会话选中的知识库，共包含**\u00a010 个文档**，内容比较杂。"
          }
        />
      )

      expect(
        screen.getByText("10 个文档", { selector: "strong" })
      ).toBeVisible()
      expect(
        container.querySelector(".assistant-markdown")
      ).not.toHaveTextContent("**")
    }
  )

  it.each([false, true])(
    "renders strong emphasis next to Chinese text when streaming=%s",
    (streaming) => {
      const emphasized = "安装、迁移、新增或变更（IMAC）"
      const { container } = render(
        <AssistantMarkdown
          streaming={streaming}
          content={`本政策为教职工申请**${emphasized}**技术设备提供指引。`}
        />
      )

      expect(screen.getByText(emphasized, { selector: "strong" })).toBeVisible()
      expect(
        container.querySelector(".assistant-markdown")
      ).not.toHaveTextContent(`**${emphasized}**`)
    }
  )

  it("renders a completed html-preview fence as an interactive message card", async () => {
    const html = [
      "<!doctype html>",
      '<html><head><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head>',
      '<body><button class="rounded-xl bg-blue-600 px-4 py-2 text-white" onclick="this.textContent = \'Done\'">Continue</button></body></html>',
    ].join("\n")
    render(
      <AssistantMarkdown content={`\`\`\`html-preview\n${html}\n\`\`\``} />
    )

    const previewCard = screen.getByRole("region", {
      name: "交互式 HTML 预览",
    })
    const previewSurface = previewCard.querySelector(
      "[data-assistant-html-preview-surface='true']"
    )
    expect(previewCard).toBeVisible()
    expect(previewCard).toHaveClass("w-full", "max-w-full", "bg-transparent")
    expect(previewSurface).toHaveClass("border-muted-foreground/15")
    expect(previewCard).not.toHaveClass("resize-y", "sm:resize")
    expect(previewCard).not.toHaveClass("shadow-xs")
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.queryByText("HTML")).toBeNull()
    expect(screen.queryByRole("tab", { name: "代码" })).toBeNull()
    const frame = screen.getByTitle(
      "AI 生成的交互式 HTML 页面"
    ) as HTMLIFrameElement
    expect(frame).toHaveAttribute(
      "sandbox",
      expect.stringContaining("allow-scripts")
    )
    expect(frame).not.toHaveAttribute(
      "sandbox",
      expect.stringContaining("allow-same-origin")
    )
    expect(frame).not.toHaveAttribute("referrerpolicy")
    expect(frame).toHaveAttribute("scrolling", "no")
    expect(frame).toHaveClass("w-full")
    expect(frame).toHaveAttribute(
      "src",
      expect.stringContaining("/assistant-html-preview-shell.html")
    )
    expect(frame.srcdoc).toBe("")
    expect(
      screen.getByRole("status", { name: "正在加载交互式预览…" })
    ).toBeVisible()
    const loadingSurface = previewCard.querySelector(
      ".assistant-html-preview-loading-surface"
    )
    expect(loadingSurface).toBeVisible()
    expect(loadingSurface).toHaveClass(
      "absolute",
      "inset-0",
      "h-full",
      "w-full"
    )
    expect(loadingSurface).not.toHaveClass("relative")
    expect(screen.queryByText("正在生成中，可能需要一些时间")).toBeNull()
    expect(previewCard.querySelector('[data-slot="skeleton"]')).toBeNull()

    const previewId = frame.dataset.assistantHtmlPreviewId
    expect(previewId).toBeTruthy()
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage")
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewShellReadyMessageType,
            previewId,
          },
        })
      )
    })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: assistantHtmlPreviewShellInitializeMessageType,
        previewId,
        html: expect.stringContaining("rounded-xl bg-blue-600 px-4 py-2"),
      }),
      "*"
    )
    expect(postMessage.mock.calls[0]?.[0].html).not.toContain(
      "cdn.jsdelivr.net"
    )

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewResizeMessageType,
            previewId,
            height: 1_280,
          },
        })
      )
    })
    await waitFor(() => expect(frame).toHaveAttribute("height", "1280"))

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewReadyMessageType,
            previewId,
          },
        })
      )
    })
    await waitFor(() => expect(frame).not.toHaveClass("invisible"))
    expect(
      screen.queryByRole("status", { name: "正在加载交互式预览…" })
    ).toBeNull()
    expect(
      previewCard.querySelector(".assistant-html-preview-loading-surface")
    ).toBeNull()
    expect(previewSurface).not.toHaveClass(
      "border",
      "border-muted-foreground/15"
    )
    expect(screen.queryByText("正在生成中，可能需要一些时间")).toBeNull()
  })

  it("forwards preview wheel movement to the conversation at an iframe boundary", () => {
    const html = "<!doctype html><html><body>Preview</body></html>"
    const { container } = render(
      <div className="conversation-scroll">
        <AssistantMarkdown content={`\`\`\`html-preview\n${html}\n\`\`\``} />
      </div>
    )
    const scroller = container.querySelector<HTMLElement>(
      ".conversation-scroll"
    )!
    const frame = screen.getByTitle(
      "AI 生成的交互式 HTML 页面"
    ) as HTMLIFrameElement
    scroller.scrollTop = 600

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: assistantHtmlPreviewWheelMessageType,
            previewId: frame.dataset.assistantHtmlPreviewId,
            deltaX: 0,
            deltaY: -160,
          },
        })
      )
    })

    expect(scroller.scrollTop).toBe(440)
  })

  it("expands the assistant message container for an html-preview card", () => {
    const conversation: Conversation = {
      ...completedConversation,
      messages: (completedConversation.messages ?? []).map((message) =>
        message.role === "assistant"
          ? {
              ...message,
              content:
                "```html-preview\n<!doctype html><html><body>Preview</body></html>\n```",
            }
          : message
      ),
    }

    render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    const previewCard = screen.getByRole("region", {
      name: "交互式 HTML 预览",
    })
    expect(previewCard.closest(".message-content")).toHaveClass("w-full")
  })

  it("keeps ordinary HTML as code instead of executing it", () => {
    const { container } = render(
      <AssistantMarkdown
        streaming
        content={'```html\n<button onclick="alert(1)">Continue</button>\n```'}
      />
    )

    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText(/Continue/, { selector: "code" })).toBeVisible()
    expect(screen.getByRole("button", { name: "复制代码" })).toBeVisible()
  })

  it("renders standalone HTML source as a previewable code block", async () => {
    const interaction = userEvent.setup()
    const html = [
      '<form id="class-picker">',
      '  <label for="class-select">选择班级</label>',
      '  <select id="class-select">',
      '    <option value="11469269">Block B</option>',
      "  </select>",
      "</form>",
    ].join("\n")
    const { container } = render(<AssistantMarkdown content={html} />)

    expect(container.querySelector("iframe")).toBeNull()
    expect(
      screen.getByText(/class-picker/u, { selector: "code" })
    ).toBeVisible()
    expect(container.querySelectorAll("pre")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "复制代码" })).toBeVisible()
    expect(
      screen.getAllByRole("button", { name: "预览 HTML 代码" })
    ).toHaveLength(1)

    await interaction.click(
      screen.getByRole("button", { name: "预览 HTML 代码" })
    )

    expect(
      screen.getByRole("region", { name: "交互式 HTML 预览" })
    ).toBeVisible()
    expect(container.querySelector("iframe")).not.toBeNull()
  })

  it("renders raw HTML blocks that follow assistant text", () => {
    const html = [
      '<div id="notice">',
      "  <p>冲突：已有 2 个同标题任务</p>",
      "</div>",
      "",
      '<form id="class-picker">',
      '  <button id="opt1" type="button">选择一</button>',
      '  <button id="opt2" type="button">选择二</button>',
      "</form>",
    ].join("\n")
    const { container } = render(
      <AssistantMarkdown content={`原样返回：\n\n${html}`} />
    )

    expect(screen.getByText("原样返回：")).toBeVisible()
    expect(container.querySelectorAll("pre")).toHaveLength(1)
    expect(
      screen.getByText(/class-picker/u, { selector: "code" })
    ).toBeVisible()
    expect(screen.getByText(/opt2/u, { selector: "code" })).toBeVisible()
    expect(
      screen.getAllByRole("button", { name: "预览 HTML 代码" })
    ).toHaveLength(1)
  })

  it("toggles completed HTML code blocks between code and preview", async () => {
    const interaction = userEvent.setup()
    const html = [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "<body><button>Continue</button></body>",
      "</html>",
    ].join("\n")
    const { container } = render(
      <AssistantMarkdown content={`\`\`\`html\n${html}\n\`\`\``} />
    )

    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText(/Continue/u, { selector: "code" })).toBeVisible()

    const previewButton = screen.getByRole("button", {
      name: "预览 HTML 代码",
    })
    expect(previewButton).toHaveClass("markdown-preview-button")
    expect(screen.getByRole("button", { name: "复制代码" })).toBeVisible()

    await interaction.click(previewButton)

    expect(
      screen.getByRole("region", { name: "交互式 HTML 预览" })
    ).toBeVisible()
    expect(container.querySelector("iframe")).not.toBeNull()
    expect(screen.queryByText(/Continue/u, { selector: "code" })).toBeNull()

    const codeButton = screen.getByRole("button", {
      name: "查看 HTML 代码",
    })
    expect(codeButton).toHaveClass("markdown-html-code-toggle-button")

    await interaction.click(codeButton)

    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText(/Continue/u, { selector: "code" })).toBeVisible()
    expect(screen.getByRole("button", { name: "复制代码" })).toBeVisible()
  })

  it("hides a streaming html-preview and mounts it once after completion", () => {
    const partialContent =
      '```html-preview\n<button onclick="alert(1)">Continue</button>'
    const completeContent = `${partialContent}\n\`\`\``
    const { container, rerender } = render(
      <AssistantMarkdown streaming content={partialContent} />
    )

    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.queryByText(/Continue/, { selector: "code" })).toBeNull()
    expect(
      screen.getByRole("status", {
        name: "正在生成交互组件…",
      })
    ).toBeVisible()
    expect(screen.queryByText("正在生产交互组件......")).toBeNull()
    expect(screen.queryByText("HTML")).toBeNull()
    expect(
      container.querySelector(".assistant-html-preview-loading-surface")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-canvas")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-glow")
    ).toBeVisible()
    expect(screen.queryByText("正在生成中，可能需要一些时间")).toBeNull()
    expect(
      container.querySelector(".assistant-html-preview-loading-meta")
    ).toBeNull()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()

    rerender(<AssistantMarkdown streaming content={completeContent} />)

    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.queryByText(/Continue/, { selector: "code" })).toBeNull()
    expect(
      screen.getByRole("status", {
        name: "正在生成交互组件…",
      })
    ).toBeVisible()

    rerender(<AssistantMarkdown content={completeContent} />)

    expect(container.querySelectorAll("iframe")).toHaveLength(1)
    expect(
      screen.queryByRole("status", {
        name: "正在生成交互组件…",
      })
    ).toBeNull()
  })

  it("renders every structured knowledge citation at its UTF-16 anchor", async () => {
    const interaction = userEvent.setup()
    const content = "😀第一句。第二句。"
    const summary = {
      knowledge_base_name: "售后知识库",
      document_name: "售后政策.pdf",
      title_path: ["售后政策"],
      page_numbers: [2],
    }
    knowledgeBaseApiMocks.getKnowledgeCitationPreview.mockResolvedValue({
      status: "available",
      citation_id: "10000000-0000-4000-8000-000000000012",
      citation_no: 2,
      summary: { ...summary, document_name: "补充政策.pdf" },
      parent_excerpt:
        "# 设备遗失赔偿规则\n\n第二次设备遗失需要承担 **50%** 的更换费用，第三次及以后需要承担全部费用。",
      original: { supported: false, renderer: null },
    })
    const conversation: Conversation = {
      ...completedConversation,
      messages: [
        completedConversation.messages![0]!,
        {
          ...completedConversation.messages![1]!,
          content,
          knowledge_citations: [
            {
              citation_id: "10000000-0000-4000-8000-000000000011",
              citation_no: 1,
              summary,
              anchors: [
                { occurrence_no: 1, after_offset_utf16: 6 },
                { occurrence_no: 3, after_offset_utf16: 10 },
              ],
            },
            {
              citation_id: "10000000-0000-4000-8000-000000000012",
              citation_no: 2,
              summary: { ...summary, document_name: "补充政策.pdf" },
              anchors: [{ occurrence_no: 2, after_offset_utf16: 10 }],
            },
          ],
        },
      ],
    }

    render(
      <MemoryRouter>
        <ConversationThread conversation={conversation} onDownload={vi.fn()} />
      </MemoryRouter>
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    expect(assistant.querySelector(".assistant-markdown p")).toHaveTextContent(
      "😀第一句。1第二句。12"
    )
    expect(
      screen.getAllByRole("link", { name: "打开知识库引用 1" })
    ).toHaveLength(2)
    const secondCitation = screen.getByRole("link", {
      name: "打开知识库引用 2",
    })
    expect(secondCitation).toHaveClass("knowledge-citation-link")
    expect(secondCitation).toHaveAttribute(
      "href",
      "/knowledge-citations/10000000-0000-4000-8000-000000000012"
    )
    expect(secondCitation.getAttribute("href")).not.toContain(
      "document_version_id"
    )
    expect(secondCitation.getAttribute("href")).not.toContain("parent_id")
    expect(secondCitation.getAttribute("href")).not.toContain("citation_start")

    await interaction.hover(secondCitation)
    const citationHeading = await screen.findByRole("heading", {
      name: "设备遗失赔偿规则",
    })
    expect(citationHeading).toBeVisible()
    expect(screen.queryByText("# 设备遗失赔偿规则")).not.toBeInTheDocument()
    const citationExcerpt = screen.getByText("第二次设备遗失需要承担", {
      exact: false,
    })
    expect(citationExcerpt).toBeVisible()
    const hoverCard = citationExcerpt.closest(".knowledge-citation-hover-card")
    if (!(hoverCard instanceof HTMLElement)) {
      throw new Error("Missing knowledge citation hover card")
    }
    expect(hoverCard).toHaveClass("knowledge-citation-hover-card")
    const hoverCardAction = within(hoverCard).getByRole("link", {
      name: "打开知识库引用 2",
    })
    expect(hoverCardAction).toHaveClass("knowledge-citation-hover-card-action")
    expect(hoverCardAction).toHaveAttribute(
      "href",
      "/knowledge-citations/10000000-0000-4000-8000-000000000012"
    )
    const hoverCardArrow = hoverCardAction.querySelector(
      ".knowledge-citation-hover-card-arrow"
    )
    expect(hoverCardArrow).toBeInstanceOf(SVGElement)
    expect(hoverCardArrow).toHaveAttribute("aria-hidden", "true")
    expect(within(hoverCard).getByText("补充政策.pdf")).toBeVisible()
    expect(within(hoverCard).getByText("引用 [2] · 售后知识库")).toBeVisible()
    expect(
      within(hoverCard).getByText("来源位置：售后政策 · 第 2 页")
    ).toBeVisible()
    expect(
      knowledgeBaseApiMocks.getKnowledgeCitationPreview
    ).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000012",
      expect.any(AbortSignal)
    )
  })

  it("keeps a knowledge citation attached when its anchor lands after paragraph whitespace", () => {
    const firstParagraph =
      "你需要立即做这几件事：马上报告你的主管和 IT 部门；填写学校的失窃/遗失表；如果是在校外被偷，还要报警并提交正式警方报告。"
    const secondParagraph =
      "另外，如果不是“被偷”而是“遗失”，政策写的是按 100% 更换成本收费。"
    const content = `${firstParagraph}\n\n${secondParagraph}`
    const summary = {
      knowledge_base_name: "政策知识库",
      document_name: "设备政策.pdf",
      title_path: ["设备政策"],
      page_numbers: [4],
    }

    render(
      <MemoryRouter>
        <ConversationThread
          conversation={{
            ...completedConversation,
            messages: [
              completedConversation.messages![0]!,
              {
                ...completedConversation.messages![1]!,
                content,
                knowledge_citations: [
                  {
                    citation_id: "10000000-0000-4000-8000-000000000014",
                    citation_no: 4,
                    summary,
                    anchors: [
                      {
                        occurrence_no: 4,
                        after_offset_utf16:
                          firstParagraph.length + "\n\n".length,
                      },
                    ],
                  },
                ],
              },
            ],
          }}
          onDownload={vi.fn()}
        />
      </MemoryRouter>
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    const paragraphs = Array.from(
      assistant.querySelectorAll(".assistant-markdown p")
    )
    expect(paragraphs[0]).toHaveTextContent(`${firstParagraph}4`)
    expect(paragraphs[1]).toHaveTextContent(secondParagraph)
    expect(
      paragraphs.some((paragraph) => paragraph.textContent?.trim() === "4")
    ).toBe(false)
    expect(
      within(assistant).getByRole("link", { name: "打开知识库引用 4" })
    ).toBeVisible()
  })

  it("loads knowledge images only through citation-authorized asset routes", async () => {
    const firstCitationId = "10000000-0000-4000-8000-000000000011"
    const secondCitationId = "10000000-0000-4000-8000-000000000012"
    const assetId = "50000000-0000-4000-8000-000000000003"
    const download = vi.mocked(downloadApiFile)
    download
      .mockRejectedValueOnce(new Error("not_authorized_by_first_citation"))
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))

    render(
      <MemoryRouter>
        <AssistantMarkdown
          content={`候选人信息\n\n![王颖证件照](kb-asset://${assetId})`}
          citations={[
            {
              citation_id: firstCitationId,
              citation_no: 1,
              summary: {
                knowledge_base_name: "人员简历",
                document_name: "王颖简历.pdf",
                title_path: ["个人资料"],
                page_numbers: [1],
              },
              anchors: [{ occurrence_no: 1, after_offset_utf16: 5 }],
            },
            {
              citation_id: secondCitationId,
              citation_no: 2,
              summary: {
                knowledge_base_name: "人员简历",
                document_name: "王颖简历.pdf",
                title_path: ["照片"],
                page_numbers: [1],
              },
              anchors: [{ occurrence_no: 2, after_offset_utf16: 5 }],
            },
          ]}
        />
      </MemoryRouter>
    )

    const placeholder = screen.getByRole("status", {
      name: "正在加载图片 王颖证件照",
    })
    expect(placeholder).toHaveClass(
      "assistant-inline-image-placeholder",
      "assistant-inline-image-thumbnail-placeholder"
    )
    expect(placeholder).toHaveTextContent("")
    expect(placeholder.querySelector(".animate-spin")).toBeInTheDocument()

    expect(
      await screen.findByRole("img", { name: "王颖证件照" })
    ).toHaveAttribute("src", "blob:sent-image")
    expect(download).toHaveBeenNthCalledWith(
      1,
      `/knowledge-citations/${firstCitationId}/assets/${assetId}`,
      undefined,
      expect.any(AbortSignal)
    )
    expect(download).toHaveBeenNthCalledWith(
      2,
      `/knowledge-citations/${secondCitationId}/assets/${assetId}`,
      undefined,
      expect.any(AbortSignal)
    )
  })

  it.each([false, true])(
    "uses only the conversation snapshot even with citations (missing=%s)",
    async (missing) => {
      const download = vi.mocked(downloadApiFile)
      if (missing) download.mockRejectedValue(new Error("snapshot missing"))
      else
        download.mockResolvedValue(new Blob(["image"], { type: "image/png" }))
      render(
        <AssistantKnowledgeImage
          assetReferenceId="asset"
          citationIds={["citation"]}
          conversationId="conversation"
          turnId="turn"
          alt="会话图片"
        />
      )
      if (missing) {
        expect(await screen.findByText("无法预览图片 会话图片")).toBeVisible()
      } else {
        expect(
          await screen.findByRole("img", { name: "会话图片" })
        ).toHaveAttribute("src", "blob:sent-image")
      }
      expect(download).toHaveBeenCalledTimes(1)
      expect(download).toHaveBeenCalledWith(
        "/conversations/conversation/turns/turn/knowledge-assets/asset",
        undefined,
        expect.any(AbortSignal)
      )
    }
  )

  it("loads a knowledge image through turn authorization while streaming and hands off without hiding it", async () => {
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const turnId = "20000000-0000-4000-8000-000000000002"
    const citationId = "10000000-0000-4000-8000-000000000013"
    const assetId = "50000000-0000-4000-8000-000000000004"
    const content = `修改密码\n\n![查看账户](kb-asset://${assetId})`
    const download = vi.mocked(downloadApiFile)
    download.mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))
    const renderMarkdown = (
      streaming: boolean,
      citations?: NonNullable<
        Conversation["messages"]
      >[number]["knowledge_citations"]
    ) => (
      <MemoryRouter>
        <AssistantMarkdown
          content={content}
          streaming={streaming}
          citations={citations}
          knowledgeAssetScope={{ conversationId, turnId }}
        />
      </MemoryRouter>
    )
    const { rerender } = render(renderMarkdown(true))

    expect(
      screen.getByRole("status", { name: "正在加载图片 查看账户" })
    ).toBeVisible()
    expect(screen.queryByText("无法预览图片 查看账户")).toBeNull()
    expect(
      await screen.findByRole("img", { name: "查看账户" })
    ).toHaveAttribute("src", "blob:sent-image")
    expect(download).toHaveBeenCalledWith(
      `/conversations/${conversationId}/turns/${turnId}/knowledge-assets/${assetId}`,
      undefined,
      expect.any(AbortSignal)
    )

    rerender(renderMarkdown(false))
    expect(screen.getByRole("img", { name: "查看账户" })).toHaveAttribute(
      "src",
      "blob:sent-image"
    )
    expect(screen.queryByText("无法预览图片 查看账户")).toBeNull()

    rerender(
      renderMarkdown(false, [
        {
          citation_id: citationId,
          citation_no: 1,
          summary: {
            knowledge_base_name: "IT 指南",
            document_name: "修改密码.pdf",
            title_path: ["修改密码"],
            page_numbers: [3],
          },
          anchors: [{ occurrence_no: 1, after_offset_utf16: 4 }],
        },
      ])
    )

    expect(
      await screen.findByRole("img", { name: "查看账户" })
    ).toHaveAttribute("src", "blob:sent-image")
    expect(screen.queryByText("无法预览图片 查看账户")).toBeNull()
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenLastCalledWith(
      `/conversations/${conversationId}/turns/${turnId}/knowledge-assets/${assetId}`,
      undefined,
      expect.any(AbortSignal)
    )
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it("keeps the final answer card and knowledge image mounted when the persistent message id arrives", async () => {
    const itemId = "agent-final-stable-card"
    const assetId = "50000000-0000-4000-8000-000000000015"
    const citationId = "10000000-0000-4000-8000-000000000015"
    const content = `操作步骤\n\n![账号页面](kb-asset://${assetId})`
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const streamedMessage = {
      id: `streaming-${itemId}`,
      role: "assistant" as const,
      turn_id: runningTurn.id,
      item_id: itemId,
      phase: "final_answer" as const,
      content,
      created_at: "2026-07-11T08:00:02.000Z",
      streaming: true,
    }
    vi.mocked(downloadApiFile).mockResolvedValueOnce(
      new Blob(["image"], { type: "image/png" })
    )

    const { rerender } = render(
      <MemoryRouter>
        <ConversationThread
          conversation={{
            ...completedConversation,
            messages: [completedConversation.messages![0]!, streamedMessage],
            turns: [runningTurn],
            running_turn: runningTurn,
          }}
          onDownload={vi.fn()}
        />
      </MemoryRouter>
    )

    const initialArticle = screen.getByRole("article", { name: "助手回复" })
    const initialContent = initialArticle.querySelector(".message-content")
    const initialImage = await screen.findByRole("img", { name: "账号页面" })
    const initialSource = initialImage.getAttribute("src")

    rerender(
      <MemoryRouter>
        <ConversationThread
          conversation={{
            ...completedConversation,
            messages: [
              completedConversation.messages![0]!,
              {
                ...streamedMessage,
                id: "message-final-stable-card",
                streaming: false,
                knowledge_citations: [
                  {
                    citation_id: citationId,
                    citation_no: 1,
                    summary: {
                      knowledge_base_name: "IT 指南",
                      document_name: "账号指南.pdf",
                      title_path: ["操作步骤"],
                      page_numbers: [1],
                    },
                    anchors: [{ occurrence_no: 1, after_offset_utf16: 4 }],
                  },
                ],
              },
            ],
            turns: [
              {
                ...runningTurn,
                status: "completed",
                completed_at: "2026-07-11T08:00:03.000Z",
              },
            ],
            running_turn: null,
          }}
          onDownload={vi.fn()}
        />
      </MemoryRouter>
    )

    const completedArticle = screen.getByRole("article", { name: "助手回复" })
    const completedImage = screen.getByRole("img", { name: "账号页面" })
    expect(completedArticle).toBe(initialArticle)
    expect(completedArticle.querySelector(".message-content")).toBe(
      initialContent
    )
    expect(completedImage).toBe(initialImage)
    expect(completedImage).toHaveAttribute("src", initialSource)
    expect(
      screen.queryByRole("status", { name: "正在加载图片 账号页面" })
    ).toBeNull()
    expect(downloadApiFile).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it("keeps a commentary card mounted when its persistent message id arrives", () => {
    const itemId = "agent-commentary-stable-card"
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const streamedMessage = {
      id: `streaming-${itemId}`,
      role: "assistant" as const,
      turn_id: runningTurn.id,
      item_id: itemId,
      phase: "commentary" as const,
      content: "正在读取知识库",
      created_at: "2026-07-11T08:00:02.000Z",
      streaming: true,
    }
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!, streamedMessage],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        onDownload={vi.fn()}
      />
    )
    const initialCard = screen
      .getByText("正在读取知识库")
      .closest(".process-commentary")

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              ...streamedMessage,
              id: "message-commentary-stable-card",
              streaming: false,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      screen.getByText("正在读取知识库").closest(".process-commentary")
    ).toBe(initialCard)
  })

  it("recovers a legacy redacted knowledge asset URL during streaming", async () => {
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const turnId = "20000000-0000-4000-8000-000000000002"
    const assetId = "50000000-0000-4000-8000-000000000014"
    const download = vi.mocked(downloadApiFile)
    download.mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))

    render(
      <MemoryRouter>
        <AssistantMarkdown
          content={`![历史流图片](kb-asset:$ABSOLUTE${assetId})`}
          streaming
          knowledgeAssetScope={{ conversationId, turnId }}
        />
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("img", { name: "历史流图片" })
    ).toHaveAttribute("src", "blob:sent-image")
    expect(download).toHaveBeenCalledWith(
      `/conversations/${conversationId}/turns/${turnId}/knowledge-assets/${assetId}`,
      undefined,
      expect.any(AbortSignal)
    )
  })

  it("recovers image authorization from the native item during message handoff", async () => {
    const itemId = "agent-final-with-knowledge-image"
    const assetId = "50000000-0000-4000-8000-000000000005"
    const content = `完整文档\n\n![完整文档图片](kb-asset://${assetId})`
    const download = vi.mocked(downloadApiFile)
    download.mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-final-handoff",
              role: "assistant",
              turn_id: null,
              item_id: itemId,
              phase: "final_answer",
              content,
              created_at: "2026-07-11T08:00:03.000Z",
              streaming: false,
            },
          ],
          events: [
            nativeItemLifecycleEvent({
              id: "event-final-handoff",
              sequence: 3,
              item: {
                id: itemId,
                type: "agentMessage",
                phase: "final_answer",
                text: content,
              },
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      await screen.findByRole("img", { name: "完整文档图片" })
    ).toHaveAttribute("src", "blob:sent-image")
    expect(download).toHaveBeenCalledWith(
      `/conversations/${completedConversation.id}/turns/turn-1/knowledge-assets/${assetId}`,
      undefined,
      expect.any(AbortSignal)
    )
  })

  it("does not render an unfinished trailing image token during streaming", () => {
    const content = "回答正文\n\n![步骤四](kb-asset://50000000-0000"
    const renderMarkdown = (streaming: boolean) => (
      <MemoryRouter>
        <AssistantMarkdown content={content} streaming={streaming} />
      </MemoryRouter>
    )
    const { rerender } = render(renderMarkdown(true))

    expect(screen.getByText("回答正文")).toBeVisible()
    expect(document.body).not.toHaveTextContent("![步骤四]")

    rerender(renderMarkdown(false))
    expect(document.body).toHaveTextContent("![步骤四]")
  })

  it("hides internal knowledge source markers from rendering and copying", async () => {
    const interaction = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue()
    const conversation: Conversation = {
      ...completedConversation,
      messages: [
        completedConversation.messages![0]!,
        {
          ...completedConversation.messages![1]!,
          content:
            "安全结论[[kb-source:opaque-source-reference]]。后续[[kb-sour",
        },
      ],
    }

    render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    expect(assistant).toHaveTextContent("安全结论。后续")
    expect(assistant.textContent).not.toContain("[[kb-")
    expect(assistant.textContent).not.toContain("opaque-source-reference")

    await interaction.click(
      within(assistant).getByRole("button", { name: "复制消息" })
    )
    expect(writeText).toHaveBeenLastCalledWith("安全结论。后续")
  })

  it("renders a user turn knowledge snapshot by name without exposing ids", () => {
    const knowledgeBaseId = "10000000-0000-4000-8000-000000000001"
    const conversation: Conversation = {
      ...completedConversation,
      messages: [
        {
          ...completedConversation.messages![0]!,
          selected_knowledge_base_ids: [knowledgeBaseId],
        },
        completedConversation.messages![1]!,
      ],
    }

    const { container } = render(
      <ConversationThread
        conversation={conversation}
        knowledgeBases={[
          {
            id: knowledgeBaseId,
            name: "售后知识库",
            description: null,
            source_type: "local",
            source_sync: null,
            lifecycle_status: "active",
            availability_status: "enabled",
            owner: { id: "owner-1", name: "管理员" },
            is_owner: true,
            access_sources: [{ type: "owner" }],
            document_count: 1,
            ready_document_count: 1,
            storage_used_bytes: 100,
            storage_reserved_bytes: 0,
            storage_quota_bytes: 1_000,
            permissions: {
              view_content: true,
              update: true,
              manage_documents: true,
              manage_grants: true,
              create_grants: true,
              revoke_grants: true,
              archive: true,
              restore: false,
              delete: false,
              remove_direct_share: false,
            },
            archived_at: null,
            disabled_reason: null,
            created_at: "2026-07-22T00:00:00.000Z",
            updated_at: "2026-07-22T00:00:00.000Z",
          },
        ]}
        onDownload={vi.fn()}
      />
    )

    expect(
      screen.getByLabelText("本轮已选择的知识库、插件和 Skill")
    ).toHaveTextContent("售后知识库")
    expect(container).not.toHaveTextContent(knowledgeBaseId)
  })

  it("distinguishes an application-managed knowledge base from an unavailable ordinary knowledge base", async () => {
    const knowledgeBaseId = "10000000-0000-4000-8000-000000000002"
    const conversation: Conversation = {
      ...completedConversation,
      messages: [
        {
          ...completedConversation.messages![0]!,
          selected_knowledge_base_ids: [knowledgeBaseId],
        },
        completedConversation.messages![1]!,
      ],
    }
    const { rerender } = render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    expect(
      screen.getByLabelText("本轮已选择的知识库、插件和 Skill")
    ).toHaveTextContent("知识库已不可用")

    rerender(
      <ConversationThread
        conversation={{
          ...conversation,
          application: {
            id: "20000000-0000-4000-8000-000000000001",
            name: "政策问答助手",
            kind: "standard",
            package_id: null,
          },
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      screen.getByLabelText("本轮已选择的知识库、插件和 Skill")
    ).toHaveTextContent("应用托管知识库")
    expect(screen.queryByText("知识库已不可用")).toBeNull()

    await i18n.changeLanguage("en-US")
    expect(
      await screen.findByText("Application-managed knowledge base")
    ).toBeVisible()
  })

  it("hides the empty state while the first new-task message is starting", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          id: "new-task-being-created",
          messages: [],
          turns: [],
          running_turn: null,
          activities: [],
        }}
        onDownload={vi.fn()}
        showNewTaskWelcome
        suppressEmptyState
      />
    )

    expect(screen.queryByText("还没有任务。可以直接从输入框开始。")).toBeNull()
    expect(
      screen.queryByRole("heading", {
        name: "我们一起在 LinkSense 中做些什么？",
      })
    ).toBeNull()
  })

  it("renders custom empty-state content without warning decoration", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          id: "custom-empty-state",
          messages: [],
          turns: [],
          running_turn: null,
          activities: [],
        }}
        onDownload={vi.fn()}
        suppressEmptyState
        emptyStateContent={<div>嵌入应用欢迎页</div>}
      />
    )

    expect(screen.getByText("嵌入应用欢迎页")).toBeVisible()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(document.querySelector(".lucide-circle-alert")).toBeNull()
  })

  it("renders an elapsed-time header above a completed markdown response", () => {
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
      />
    )

    const log = screen.getByRole("log")
    const summary = within(log).getByTestId("turn-summary-turn-1")
    const userMessage = within(log).getByRole("article", {
      name: "用户消息",
    })
    const assistant = within(log).getByRole("article", { name: "助手回复" })

    expect(userMessage).toHaveAttribute(
      "id",
      "conversation-message-message-user-1"
    )
    expect(userMessage.querySelector(".message-content")).toHaveClass(
      "user-message"
    )
    expect(within(log).queryByText("LinkSense", { exact: true })).toBeNull()
    const elapsedStatus = within(summary).getByText("用时", { exact: true })
    expect(elapsedStatus).toBeVisible()
    expect(elapsedStatus.parentElement).not.toHaveClass("shimmer")
    expect(within(summary).queryByText("已完成", { exact: true })).toBeNull()
    const duration = within(summary).getByText("3s", { exact: true })
    expect(duration).toHaveClass("turn-duration")
    expect(duration).not.toHaveAttribute("aria-label")
    const summaryContent = elapsedStatus.parentElement
    const summaryHeading = summaryContent?.parentElement
    expect(summaryHeading).toHaveClass("turn-summary-heading")
    expect(summaryHeading).toHaveAttribute("data-slot", "marker")
    expect(summaryHeading).toHaveAttribute("data-variant", "border")
    expect(summaryContent).toHaveClass("turn-summary-marker-content")
    expect(duration.parentElement).toBe(summaryContent)
    expect(summaryHeading?.querySelector("svg")).toBeNull()
    expect(
      summary.compareDocumentPosition(assistant) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(within(assistant).getByText("处理完成").tagName).toBe("STRONG")
    expect(within(assistant).getByText("pnpm dev").tagName).toBe("CODE")
    expect(within(assistant).getAllByRole("listitem")).toHaveLength(2)
    const documentationLink = within(assistant).getByRole("link", {
      name: "查看文档",
    })
    expect(documentationLink).toHaveAttribute(
      "rel",
      expect.stringContaining("noopener")
    )
    expect(
      documentationLink.querySelector('[data-slot="site-link-icon"]')
    ).not.toBeNull()

    expect(within(summary).queryByRole("button")).toBeNull()
    expect(screen.queryByText("工具调用已完成")).toBeNull()
    expect(screen.queryByText("正在分析需求")).toBeNull()
    expect(within(summary).queryByText("pptx")).toBeNull()
    expect(within(summary).queryByText("已为本轮装配插件/Skill")).toBeNull()
    expect(screen.queryByText("conversation.activities.analyzing")).toBeNull()
  })

  it("highlights user message URLs without consuming following Chinese prose", () => {
    const content =
      "https://www.infocare.org.cn/整理这家公司的产品线为word文档给我"

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user" ? { ...message, content } : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const renderedUrl = userMessage.querySelector<HTMLElement>(
      "[data-user-message-url]"
    )

    expect(renderedUrl).toHaveAttribute(
      "data-user-message-url",
      "https://www.infocare.org.cn/"
    )
    expect(renderedUrl).toHaveTextContent("https://www.infocare.org.cn/")
    expect(renderedUrl).not.toHaveTextContent(
      "整理这家公司的产品线为word文档给我"
    )
    expect(
      renderedUrl?.querySelector(".user-message-url-icon")
    ).toBeInTheDocument()
    expect(userMessage).toHaveTextContent(content)
  })

  it("separates multiline external source links from surrounding Markdown content", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  content:
                    "官方来源：  \n[官方文档](https://developers.example/docs)  \n[开源仓库](https://github.com/example/repository)",
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    const sourceLinkStack = assistant.querySelector(
      ".assistant-markdown-source-link-stack"
    )

    expect(sourceLinkStack).toHaveTextContent("官方来源：")
    expect(
      within(sourceLinkStack as HTMLElement).getAllByRole("link")
    ).toHaveLength(2)
  })

  it("keeps parenthetical external source links in regular paragraph flow", () => {
    const { container } = render(
      <AssistantMarkdown
        content={[
          "美联社和 VOA 中文均报道，特朗普已要求五角大楼缩减年度美韩联合军演规模，韩国防务部门则称演习仍按计划进行。（",
          "[apnews.com](https://apnews.com)",
          ") (",
          "[voachinese.com](https://www.voachinese.com)",
          ")",
        ].join("  \n")}
      />
    )

    const paragraph = container.querySelector(".assistant-markdown p")
    expect(paragraph).toHaveTextContent("特朗普")
    expect(paragraph).not.toHaveClass("assistant-markdown-source-link-stack")
    expect(screen.getByRole("link", { name: "apnews.com" })).toBeVisible()
    expect(screen.getByRole("link", { name: "voachinese.com" })).toBeVisible()
  })

  it("keeps prose after a bare assistant URL outside the rendered link", () => {
    const content =
      '已截好广州博萃德学校官网首页（https://www.benendenguangzhou.cn/），并生成了可下载文件，请在下方附件卡片中查看"广州博萃德学校官网首页截图"。'

    const { container } = render(<AssistantMarkdown content={content} />)

    const paragraph = container.querySelector(".assistant-markdown p")
    const link = screen.getByRole("link", {
      name: "https://www.benendenguangzhou.cn/",
    })

    expect(paragraph).toHaveTextContent(content)
    expect(link).toHaveAttribute("href", "https://www.benendenguangzhou.cn/")
    expect(screen.queryByRole("link", { name: /并生成/u })).toBeNull()
  })

  it("splits accidental prose from overextended assistant link labels", () => {
    const content =
      '已截好广州博萃德学校官网首页（[https://www.benendenguangzhou.cn/), 并生成了可下载文件，请在下方附件卡片中查看"广州博萃德学校官网首页截图"](https://www.benendenguangzhou.cn/)。'

    const { container } = render(<AssistantMarkdown content={content} />)

    const paragraph = container.querySelector(".assistant-markdown p")
    const link = screen.getByRole("link", {
      name: "https://www.benendenguangzhou.cn/",
    })

    expect(paragraph).toHaveTextContent(
      '已截好广州博萃德学校官网首页（https://www.benendenguangzhou.cn/), 并生成了可下载文件，请在下方附件卡片中查看"广州博萃德学校官网首页截图"。'
    )
    expect(link).toHaveAttribute("href", "https://www.benendenguangzhou.cn/")
    expect(screen.queryByRole("link", { name: /并生成/u })).toBeNull()
  })

  it("renders regular Markdown images at the tool-preview size and opens the shared preview", async () => {
    const interaction = userEvent.setup()
    const onPreviewImage = vi.fn()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  content:
                    "请确认视觉方向：\n\n![PPT 风格选项](https://images.example.test/style-options.png)",
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
        onPreviewImage={onPreviewImage}
      />
    )

    const previewButton = screen.getByRole("button", {
      name: "预览图片 PPT 风格选项",
    })
    expect(previewButton).toHaveClass("conversation-image-thumbnail-trigger")
    expect(
      within(previewButton).getByRole("img", { name: "PPT 风格选项" })
    ).toHaveClass("conversation-image-thumbnail-image")

    await interaction.click(previewButton)

    expect(onPreviewImage).toHaveBeenCalledWith({
      id: "assistant-markdown-image:https://images.example.test/style-options.png",
      name: "PPT 风格选项",
      src: "https://images.example.test/style-options.png",
      alt: "PPT 风格选项",
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("replaces a failed Markdown image with a localized error thumbnail", async () => {
    const imageName = "昆明滇池国际会展中心"
    render(
      <AssistantMarkdown
        content={`![${imageName}](https://images.example.test/missing.png)`}
      />
    )

    fireEvent.error(screen.getByRole("img", { name: imageName }))

    const errorThumbnail = await screen.findByRole("img", {
      name: `无法预览图片 ${imageName}`,
    })
    expect(errorThumbnail).toHaveClass("conversation-image-thumbnail-error")
    expect(errorThumbnail).toHaveTextContent("图片暂不可用")
    expect(
      screen.queryByRole("button", { name: `预览图片 ${imageName}` })
    ).toBeNull()

    await i18n.changeLanguage("en-US")

    expect(await screen.findByText("Image unavailable")).toBeVisible()
    expect(errorThumbnail).toHaveAccessibleName(
      `Unable to preview image ${imageName}`
    )
  })

  it("shows a completed turn without displayable output as a failure", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          activities: [],
          events: [],
          artifacts: [],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("执行失败", { exact: true })).toBeVisible()
    expect(
      within(summary).queryByText("用时", { exact: true })
    ).not.toBeInTheDocument()

    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(
      within(summary).getByText(
        "本轮执行已结束，但没有产出可展示的内容，请重新执行。"
      )
    ).toBeVisible()
  })

  it("waits for terminal detail reconciliation before reporting missing output", () => {
    const emptyCompletedConversation = {
      ...completedConversation,
      messages: [completedConversation.messages![0]!],
      activities: [],
      events: [],
      artifacts: [],
    }
    const { rerender } = render(
      <ConversationThread
        conversation={emptyCompletedConversation}
        reconcilingCompletedTurnId="turn-1"
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(
      within(summary).queryByText("执行失败", { exact: true })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("本轮执行已结束，但没有产出可展示的内容，请重新执行。")
    ).toBeNull()

    rerender(
      <ConversationThread
        conversation={emptyCompletedConversation}
        onDownload={vi.fn()}
      />
    )
    expect(within(summary).getByText("执行失败", { exact: true })).toBeVisible()
  })

  it("shows elapsed time for a completed context compaction without an empty-output failure", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [],
          turns: [
            {
              ...completedConversation.turns![0]!,
              task_kind: "compact",
            },
          ],
          events: [
            nativeItemLifecycleEvent({
              id: "context-compaction-completed",
              sequence: 1,
              item: {
                id: "context-compaction-1",
                type: "contextCompaction",
              },
            }),
          ],
          artifacts: [],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("用时", { exact: true })).toBeVisible()
    expect(
      within(summary).queryByText("执行失败", { exact: true })
    ).not.toBeInTheDocument()

    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(within(summary).getByText("上下文已压缩")).toBeVisible()
    expect(
      within(summary).queryByText(
        "本轮执行已结束，但没有产出可展示的内容，请重新执行。"
      )
    ).not.toBeInTheDocument()
  })

  it("renders the current plugin logo for a selected user capability", () => {
    const knowledgeBaseId = "70000000-0000-4000-8000-000000000010"
    const pdfCapability: CapabilitySummary = {
      id: "60000000-0000-4000-8000-000000000001",
      name: "pdf",
      slug: "pdf",
      type: "plugin",
      status: "active",
      description: null,
      source_type: "local",
      marketplace_listing_id: null,
      marketplace_release_id: null,
      builtin_key: null,
      is_builtin: false,
      can_select: true,
      can_delete: true,
      personally_disabled: false,
      preference_status: "enabled",
      is_owner: true,
      can_manage: true,
      can_govern: false,
      has_logo: true,
      logo_url: "https://example.com/capabilities/pdf-logo.png",
      manifest: {},
      risk_summary: {
        contains_mcp_server: false,
        contains_scripts: false,
        contains_external_connections: false,
        requires_environment_variables: false,
        requires_credentials: false,
        contains_dependency_download_commands: false,
        declared_environment_keys: [],
        mcp_environment_references: [],
        dependency_commands: [],
      },
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          available_capabilities: [pdfCapability],
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  selected_capabilities: [
                    {
                      id: "60000000-0000-4000-8000-000000000001",
                      name: "pdf",
                      type: "plugin" as const,
                    },
                  ],
                  selected_knowledge_base_ids: [knowledgeBaseId],
                }
              : message
          ),
        }}
        applicationKnowledgeBases={[
          { id: knowledgeBaseId, name: "财务知识库" },
        ]}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const capabilities = within(userMessage).getByLabelText(
      "本轮已选择的知识库、插件和 Skill"
    )

    expect(within(capabilities).getByText("pdf")).toBeVisible()
    expect(
      capabilities.querySelector("img.user-message-capability-icon")
    ).toHaveAttribute("src", pdfCapability.logo_url)
    expect(within(capabilities).getByText("财务知识库")).toBeVisible()
    expect(within(capabilities).queryByRole("button")).toBeNull()
  })

  it("uses the localized product name for a selected built-in Skill", () => {
    const builtInId = "builtin:capability:linksense-browser"
    const knowledgeBaseId = "70000000-0000-4000-8000-000000000011"
    const builtInCapability: CapabilitySummary = {
      id: builtInId,
      name: "linksense-browser",
      slug: "linksense-browser",
      type: "skill",
      status: "active",
      description: null,
      source_type: "builtin",
      marketplace_listing_id: null,
      marketplace_release_id: null,
      builtin_key: "linksense-browser",
      is_builtin: true,
      can_select: false,
      can_delete: false,
      personally_disabled: false,
      preference_status: "enabled",
      is_owner: false,
      can_manage: false,
      can_govern: false,
      has_logo: false,
      logo_url: null,
      manifest: null,
      risk_summary: null,
      created_at: null,
      updated_at: null,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          available_capabilities: [builtInCapability],
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  selected_capabilities: [
                    {
                      id: builtInId,
                      name: "linksense-browser",
                      type: "skill" as const,
                    },
                  ],
                  selected_knowledge_base_ids: [knowledgeBaseId],
                }
              : message
          ),
        }}
        applicationKnowledgeBases={[
          { id: knowledgeBaseId, name: "AISG Policy" },
        ]}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const skillLabel = within(userMessage).getByText("LinkSense 浏览器")
    const knowledgeBaseLabel = within(userMessage).getByText("AISG Policy")
    expect(skillLabel).toBeVisible()
    expect(skillLabel).toHaveClass("user-message-capability-label")
    expect(knowledgeBaseLabel).toHaveClass("user-message-capability-label")
    expect(skillLabel.closest(".user-message-capability")).toHaveClass(
      "user-message-resource-chip"
    )
    expect(knowledgeBaseLabel.closest(".user-message-capability")).toHaveClass(
      "user-message-resource-chip"
    )
    expect(within(userMessage).queryByText("linksense-browser")).toBeNull()
  })

  it("shows only two selected resources and reveals the remaining list on hover", async () => {
    const interaction = userEvent.setup()
    const knowledgeBases = [
      {
        id: "70000000-0000-4000-8000-000000000001",
        name: "招生政策",
      },
      {
        id: "70000000-0000-4000-8000-000000000002",
        name: "财务制度",
      },
      {
        id: "70000000-0000-4000-8000-000000000003",
        name: "校园指南",
      },
    ]
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  selected_capabilities: [
                    {
                      id: "60000000-0000-4000-8000-000000000011",
                      name: "网页检索",
                      type: "plugin" as const,
                    },
                    {
                      id: "60000000-0000-4000-8000-000000000012",
                      name: "文档整理",
                      type: "skill" as const,
                    },
                  ],
                  selected_knowledge_base_ids: knowledgeBases.map(
                    (knowledgeBase) => knowledgeBase.id
                  ),
                }
              : message
          ),
        }}
        applicationKnowledgeBases={knowledgeBases}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const selections = within(userMessage).getByLabelText(
      "本轮已选择的知识库、插件和 Skill"
    )
    expect(within(selections).getByText("网页检索")).toBeVisible()
    expect(within(selections).getByText("文档整理")).toBeVisible()
    expect(within(selections).queryByText("招生政策")).toBeNull()

    const overflow = within(selections).getByRole("button", {
      name: "另外 3 个已选择项",
    })
    expect(overflow).toHaveTextContent("+3")

    await interaction.hover(overflow)
    const overflowList = await screen.findByRole("list", {
      name: "其他已选择项",
    })
    expect(within(overflowList).getByText("招生政策")).toBeVisible()
    expect(within(overflowList).getByText("财务制度")).toBeVisible()
    expect(within(overflowList).getByText("校园指南")).toBeVisible()

    await i18n.changeLanguage("en-US")
    expect(
      await screen.findByRole("button", { name: "3 more selected items" })
    ).toBeVisible()
    expect(
      await screen.findByRole("list", { name: "Additional selected items" })
    ).toBeVisible()
  })

  it("copies rendered code and tables from controls in their top-right corners", async () => {
    const interaction = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue()

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  content:
                    "```ts\nconst answer = 42\nconsole.log(answer)\n```\n\n| 名称 | 状态 |\n| --- | --- |\n| LinkSense | 完成 |",
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    const codeButton = within(assistant).getByRole("button", {
      name: "复制代码",
    })
    const tableButton = within(assistant).getByRole("button", {
      name: "复制表格",
    })

    expect(codeButton).toHaveClass("markdown-copy-button")
    expect(codeButton.parentElement).toHaveClass("markdown-copy-block-code")
    expect(codeButton.parentElement?.querySelector("pre")).not.toBeNull()
    expect(tableButton).toHaveClass("markdown-copy-button")
    expect(tableButton.closest(".markdown-copy-block-table")).not.toBeNull()
    expect(
      tableButton.closest(".markdown-table-toolbar")?.parentElement
    ).toHaveClass("markdown-table-scroll-shell")
    expect(
      tableButton.closest(".markdown-copy-block-table")?.querySelector("table")
    ).not.toBeNull()

    await interaction.click(codeButton)
    expect(writeText).toHaveBeenLastCalledWith(
      "const answer = 42\nconsole.log(answer)"
    )
    expect(
      within(assistant).getByRole("button", { name: "代码已复制" })
    ).toHaveAttribute("data-copy-state", "copied")

    await interaction.click(tableButton)
    expect(writeText).toHaveBeenLastCalledWith("名称\t状态\nLinkSense\t完成")
    expect(
      within(assistant).getByRole("button", { name: "表格已复制" })
    ).toHaveAttribute("data-copy-state", "copied")
  })

  it("keeps an overflowing Markdown table scrollable in a narrow container", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  content:
                    "| 模型 | 参数 | 定位 |\n| --- | --- | --- |\n| Whisper large-v3 | 1.55B | 基线 |\n| Qwen3-ASR | 0.6B | 中文主力 |",
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    expect(
      within(assistant).getByRole("columnheader", { name: "模型" })
    ).toBeVisible()
    const tableScroller = within(assistant).getByLabelText("可横向滚动的表格")
    const tableSurface = tableScroller.closest(".markdown-copy-block-table")
    expect(tableScroller).toHaveAttribute("data-slot", "table-container")
    Object.defineProperties(tableScroller, {
      clientWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 760 },
    })
    fireEvent.scroll(tableScroller)
    await waitFor(() =>
      expect(tableSurface).toHaveAttribute("data-table-overflow", "true")
    )
    expect(tableSurface).not.toHaveAttribute("data-table-card")
    expect(tableScroller).toHaveAttribute("tabindex", "0")
    expect(tableSurface).toHaveAttribute("data-table-scroll-start", "true")
    expect(tableSurface).toHaveAttribute("data-table-scroll-end", "false")

    tableScroller.scrollLeft = 440
    fireEvent.scroll(tableScroller)
    await waitFor(() =>
      expect(tableSurface).toHaveAttribute("data-table-scroll-end", "true")
    )

    await interaction.click(
      within(assistant).getByRole("button", { name: "放大查看表格" })
    )

    const dialog = await screen.findByRole("dialog", { name: "完整表格" })
    expect(dialog).toHaveClass("sm:max-w-6xl")
    expect(
      within(dialog).getByText("可横向和纵向滚动查看全部内容。")
    ).toBeVisible()
    const expandedTableScroller = within(dialog).getByLabelText("完整表格内容")
    expect(expandedTableScroller).toHaveAttribute(
      "data-slot",
      "table-container"
    )
    expect(expandedTableScroller).not.toHaveClass("border", "rounded-xl")
    expect(within(dialog).getByRole("table")).toBeVisible()
  })

  it("toggles assistant HTML code previews inline in the thread", async () => {
    const interaction = userEvent.setup()
    const onPreviewHtmlCode = vi.fn()
    const html = "<!doctype html>\n<html><body>Preview me</body></html>"

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  content: `\`\`\`html\n${html}\n\`\`\``,
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
        onPreviewHtmlCode={onPreviewHtmlCode}
      />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    await interaction.click(
      within(assistant).getByRole("button", { name: "预览 HTML 代码" })
    )

    expect(onPreviewHtmlCode).not.toHaveBeenCalled()
    expect(
      within(assistant).getByRole("region", { name: "交互式 HTML 预览" })
    ).toBeVisible()

    await interaction.click(
      within(assistant).getByRole("button", { name: "查看 HTML 代码" })
    )

    expect(
      within(assistant).queryByRole("region", { name: "交互式 HTML 预览" })
    ).toBeNull()
    expect(
      within(assistant).getByText(/Preview me/u, { selector: "code" })
    ).toBeVisible()
  })

  it("expands the assistant message container for inline HTML code previews", async () => {
    const interaction = userEvent.setup()
    const html = [
      '<div id="needs-input">',
      "  <p>发现重复 Task，需要教师决定</p>",
      "</div>",
      '<form id="decision-form">',
      '  <button type="button">继续创建</button>',
      "</form>",
    ].join("\n")

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  content: html,
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    await interaction.click(
      within(assistant).getByRole("button", { name: "预览 HTML 代码" })
    )

    const previewCard = within(assistant).getByRole("region", {
      name: "交互式 HTML 预览",
    })
    expect(previewCard.closest(".message-content")).toHaveClass("w-full")
  })

  it("removes trailing blank lines from the displayed user message", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? { ...message, content: "第一行\n第二行\n\n\n   " }
              : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    expect(userMessage.querySelector("p")?.textContent).toBe("第一行\n第二行")
  })

  it("renders presentation selections as annotation cards without exposing model context", async () => {
    const interaction = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue()
    const onPreviewPresentation = vi.fn()
    const presentationFile = {
      id: "70000000-0000-4000-8000-000000000001",
      name: "AI 入门.pptx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      kind: "artifact" as const,
      turn_id: "turn-1",
      download_available: true,
      size: 0,
    }
    const internalPrompt =
      "用户要求：改为英文\n\n元素定位：shape-7\n\n选中内容：生成式 AI"

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          artifacts: [presentationFile],
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  content: internalPrompt,
                  display: {
                    kind: "presentation_annotation" as const,
                    file_id: presentationFile.id,
                    file_name: presentationFile.name,
                    annotations: [
                      {
                        request: "改为英文",
                        slide_number: 1,
                        selection_count: 1,
                      },
                      {
                        request: "加粗副标题",
                        slide_number: 2,
                        selection_count: 1,
                      },
                    ],
                    annotation_count: 2,
                  },
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
        onPreviewPresentation={onPreviewPresentation}
        onRegenerateMessage={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const annotation = within(userMessage).getByRole("region", {
      name: "演示文稿注释：AI 入门.pptx",
    })
    const annotationTrigger = within(annotation).getByRole("button", {
      name: "2 条注释",
    })
    expect(annotationTrigger).toBeVisible()
    expect(screen.queryByText("改为英文")).not.toBeInTheDocument()
    expect(screen.queryByText(/元素定位|选中内容|shape-7/u)).toBeNull()
    expect(userMessage.innerHTML).not.toMatch(/元素定位|选中内容|shape-7/u)
    expect(
      within(userMessage).queryByRole("button", { name: "编辑消息" })
    ).toBeNull()

    await interaction.hover(annotationTrigger)
    const annotationRequest = await screen.findByText("改为英文")
    expect(annotationRequest).toBeVisible()
    expect(screen.getByText("加粗副标题")).toBeVisible()
    expect(screen.getByText("第 1 张幻灯片 · 1 个元素")).toBeVisible()
    expect(screen.getByText("第 2 张幻灯片 · 1 个元素")).toBeVisible()
    const annotationHoverCard = annotationRequest.closest(
      '[data-slot="hover-card-content"]'
    )
    if (!(annotationHoverCard instanceof HTMLElement)) {
      throw new Error("Missing annotation hover card")
    }
    expect(annotationHoverCard).toHaveClass(
      "rounded-xl",
      "border-[var(--app-border)]",
      "shadow-md"
    )
    expect(annotationHoverCard).not.toHaveClass(
      "shadow-lg",
      "border-border",
      "shadow-[var(--app-hover-card-shadow)]"
    )
    const previewButton = within(annotationHoverCard).getByRole("button", {
      name: "预览演示文稿 AI 入门.pptx",
    })
    expect(
      previewButton.querySelector('[data-file-icon-kind="powerpoint"]')
    ).not.toBeNull()

    await interaction.click(previewButton)
    expect(onPreviewPresentation).toHaveBeenCalledWith(presentationFile)

    await interaction.click(
      within(userMessage).getByRole("button", { name: "复制消息" })
    )
    expect(writeText).toHaveBeenCalledWith("1. 改为英文\n2. 加粗副标题")
  })

  it("renders a Word selection with the shared annotation card and reopens its document", async () => {
    const interaction = userEvent.setup()
    const onPreviewOfficeDocument = vi.fn()
    const wordFile = {
      id: "70000000-0000-4000-8000-000000000002",
      name: "项目建议书.docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      kind: "artifact" as const,
      turn_id: "turn-1",
      download_available: true,
      size: 0,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          artifacts: [wordFile],
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  content: "internal Word locator context",
                  display: {
                    kind: "word_annotation" as const,
                    file_id: wordFile.id,
                    file_name: wordFile.name,
                    annotations: [
                      {
                        request: "把标题改成蓝色",
                        selection_type: "text" as const,
                        paragraph_number: 2,
                        page_number: 1,
                        selection_count: 1 as const,
                      },
                    ],
                    annotation_count: 1 as const,
                  },
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
      />
    )

    const annotation = screen.getByRole("region", {
      name: "文档注释：项目建议书.docx",
    })
    const annotationTrigger = within(annotation).getByRole("button", {
      name: "1 条注释",
    })
    expect(screen.queryByText("把标题改成蓝色")).not.toBeInTheDocument()
    expect(
      screen.queryByText("internal Word locator context")
    ).not.toBeInTheDocument()

    await interaction.hover(annotationTrigger)
    const annotationRequest = await screen.findByText("把标题改成蓝色")
    expect(annotationRequest).toBeVisible()
    const annotationHoverCard = annotationRequest.closest(
      '[data-slot="hover-card-content"]'
    )
    if (!(annotationHoverCard instanceof HTMLElement)) {
      throw new Error("Missing annotation hover card")
    }
    const previewButton = within(annotationHoverCard).getByRole("button", {
      name: "预览文档 项目建议书.docx",
    })
    expect(
      previewButton.querySelector('[data-file-icon-kind="word"]')
    ).not.toBeNull()

    await interaction.click(previewButton)
    expect(onPreviewOfficeDocument).toHaveBeenCalledWith(wordFile)
  })

  it("renders an HTML selection with the shared annotation card and reopens its document", async () => {
    const interaction = userEvent.setup()
    const onPreviewOfficeDocument = vi.fn()
    const htmlFile = {
      id: "70000000-0000-4000-8000-000000000003",
      name: "landing.html",
      mime_type: "text/html",
      kind: "artifact" as const,
      turn_id: "turn-1",
      download_available: true,
      size: 0,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          artifacts: [htmlFile],
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  content: "internal HTML selector context",
                  display: {
                    kind: "html_annotation" as const,
                    file_id: htmlFile.id,
                    file_name: htmlFile.name,
                    annotations: [
                      {
                        request: "把标题改为英文",
                        selection_count: 1,
                      },
                    ],
                    annotation_count: 1 as const,
                  },
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
      />
    )

    const annotation = screen.getByRole("region", {
      name: "HTML 注释：landing.html",
    })
    const annotationTrigger = within(annotation).getByRole("button", {
      name: "1 条注释",
    })
    expect(screen.queryByText("把标题改为英文")).not.toBeInTheDocument()
    expect(screen.queryByText("internal HTML selector context")).toBeNull()

    await interaction.hover(annotationTrigger)
    const annotationRequest = await screen.findByText("把标题改为英文")
    const annotationHoverCard = annotationRequest.closest(
      '[data-slot="hover-card-content"]'
    )
    if (!(annotationHoverCard instanceof HTMLElement)) {
      throw new Error("Missing annotation hover card")
    }
    const previewButton = within(annotationHoverCard).getByRole("button", {
      name: "预览 HTML 文档 landing.html",
    })
    expect(
      previewButton.querySelector('[data-file-icon-kind="code"]')
    ).not.toBeNull()

    await interaction.click(previewButton)
    expect(onPreviewOfficeDocument).toHaveBeenCalledWith(htmlFile)
  })

  it("renders sent images and files above the user text card and opens image preview", async () => {
    const imageAttachment = {
      id: "attachment-image-1",
      name: "界面参考.png",
      mime_type: "image/png",
      size: 12_345,
      kind: "attachment" as const,
      status: "bound",
      turn_id: "turn-1",
      download_available: false,
    }
    const fileAttachment = {
      id: "attachment-file-1",
      name: "EdTech出差费用明细表.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 54_321,
      kind: "attachment" as const,
      status: "bound",
      turn_id: "turn-1",
      download_available: false,
    }
    const loadAttachmentPreview = vi.fn(
      async () => new Blob(["image"], { type: "image/png" })
    )
    const onPreviewOfficeDocument = vi.fn()
    const onPreviewImage = vi.fn()

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  attachments: [imageAttachment, fileAttachment],
                }
              : message
          ),
        }}
        loadAttachmentPreview={loadAttachmentPreview}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
        onPreviewImage={onPreviewImage}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const attachmentGroup = userMessage.querySelector<HTMLElement>(
      ".user-message-attachments"
    )
    const textCard = userMessage.querySelector<HTMLElement>(".user-message")
    const filePill = userMessage.querySelector<HTMLElement>(
      ".user-message-file-attachment"
    )

    expect(attachmentGroup).not.toBeNull()
    expect(textCard).not.toBeNull()
    expect(filePill).toHaveTextContent("EdTech出差费用明细表.xlsx")
    expect(filePill).toHaveClass(
      "user-message-resource-chip",
      "user-message-file-attachment-previewable"
    )
    expect(textCard).not.toContainElement(filePill)
    expect(
      attachmentGroup!.compareDocumentPosition(textCard!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(filePill).not.toHaveTextContent("54.3")
    expect(filePill).not.toHaveTextContent("2026")
    expect(
      within(userMessage).queryByRole("button", {
        name: /查看全部 \d+ 个附件/u,
      })
    ).not.toBeInTheDocument()

    const filePreviewButton = within(userMessage).getByRole("button", {
      name: "预览文档 EdTech出差费用明细表.xlsx",
    })
    expect(
      filePreviewButton.querySelector('[data-file-icon-kind="excel"]')
    ).not.toBeNull()
    await userEvent.click(filePreviewButton)
    expect(onPreviewOfficeDocument).toHaveBeenCalledWith(fileAttachment)

    const previewButton = await screen.findByRole("button", {
      name: "预览图片 界面参考.png",
    })
    expect(loadAttachmentPreview).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: "移除附件 界面参考.png" })
    ).not.toBeInTheDocument()

    await userEvent.click(previewButton)
    expect(onPreviewImage).toHaveBeenCalledWith({
      id: imageAttachment.id,
      name: imageAttachment.name,
      src: "blob:sent-image",
      alt: imageAttachment.name,
      downloadable: true,
    })
    expect(onPreviewOfficeDocument).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("collapses sent user-message attachments after the first two and reveals the complete list on hover", async () => {
    const interaction = userEvent.setup()
    const attachments = [
      "候选人一.pdf",
      "候选人二.pdf",
      "候选人三.pdf",
      "候选人四.pdf",
    ].map((name, index) => ({
      id: `sent-attachment-${index + 1}`,
      name,
      mime_type: "application/pdf",
      size: 8_192 + index,
      kind: "attachment" as const,
      status: "bound",
      turn_id: "turn-1",
      download_available: false,
    }))

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user" ? { ...message, attachments } : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    expect(within(userMessage).getByText("候选人一.pdf")).toBeVisible()
    expect(within(userMessage).getByText("候选人二.pdf")).toBeVisible()
    expect(screen.queryByText("候选人三.pdf")).not.toBeInTheDocument()
    expect(screen.queryByText("候选人四.pdf")).not.toBeInTheDocument()

    const overflowTrigger = within(userMessage).getByRole("button", {
      name: "查看全部 4 个附件",
    })
    expect(overflowTrigger).toHaveTextContent("+2")

    await interaction.hover(overflowTrigger)
    const completeList = await screen.findByLabelText("全部附件（4）")
    for (const attachment of attachments) {
      expect(within(completeList).getByText(attachment.name)).toBeVisible()
    }
  })

  it("does not render an empty user text card for an attachment-only message", async () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: (completedConversation.messages ?? []).map((message) =>
            message.role === "user"
              ? {
                  ...message,
                  content: "   \n",
                  attachments: [
                    {
                      id: "attachment-file-1",
                      name: "需求说明.docx",
                      mime_type:
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                      size: 8_192,
                      kind: "attachment" as const,
                      status: "bound",
                      turn_id: "turn-1",
                      download_available: false,
                    },
                  ],
                }
              : message
          ),
        }}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    expect(
      userMessage.querySelector<HTMLElement>(".user-message-file-attachment")
    ).toHaveTextContent("需求说明.docx")
    expect(userMessage.querySelector(".user-message")).toBeNull()
  })

  it("keeps a live processing header while filtering streamed reasoning content", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:05.000Z"))

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            {
              id: "message-user-1",
              role: "user",
              turn_id: "turn-1",
              content: "请给出处理结果",
            },
            {
              id: "streaming-assistant",
              role: "assistant",
              turn_id: "turn-1",
              content: "正在生成回复",
              created_at: "2026-07-11T08:00:03.000Z",
              streaming: true,
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              started_at: "2026-07-11T08:00:00.000Z",
              completed_at: null,
            },
          ],
          running_turn: {
            id: "turn-1",
            status: "running",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: null,
          },
        }}
        liveReasoningSummaries={{
          current: {
            itemId: "reasoning-1",
            turnId: "turn-1",
            summaryIndex: 0,
            text: "**Evaluating** test timing\n\n- reliability",
            createdAt: "2026-07-11T08:00:04.000Z",
            sequence: 6,
          },
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    const processingStatus = within(summary).getByText("正在处理", {
      exact: true,
    })
    const duration = within(summary).getByText("2s", { exact: true })
    expect(processingStatus).toBeVisible()
    expect(processingStatus.parentElement).not.toHaveClass("shimmer")
    expect(processingStatus.parentElement).toBe(duration.parentElement)
    expect(within(summary).queryByText("正在思考", { exact: true })).toBeNull()
    expect(duration.parentElement).toHaveClass("turn-summary-marker-content")
    expect(summary.querySelector(".turn-summary-chevron")).toBeNull()
    expect(within(summary).queryByText("执行中", { exact: true })).toBeNull()
    expect(duration).toBeVisible()
    const liveCommentary = within(summary)
      .getByText("正在生成回复")
      .closest(".process-commentary")
    expect(liveCommentary).toBeVisible()
    expect(liveCommentary).toHaveAttribute("data-final-answer-visible", "false")
    expect(liveCommentary).toHaveAttribute("data-running", "true")
    expect(liveCommentary).toHaveAttribute("aria-busy", "true")
    expect(liveCommentary).not.toHaveClass("shimmer")
    expect(
      liveCommentary?.querySelector(".assistant-markdown.shimmer")
    ).toBeNull()
    expect(
      liveCommentary?.querySelector(".assistant-markdown .shimmer")
    ).toBeNull()
    expect(screen.queryByRole("article", { name: "助手回复" })).toBeNull()
    expect(
      within(summary).queryByText("Evaluating", { exact: true })
    ).toBeNull()
    expect(within(summary).queryByText("思考内容")).toBeNull()
    expect(summary.querySelector(".reasoning-activity-row")).toBeNull()
  })

  it("marks only the initiating user message of a Goal turn", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            {
              id: "message-user-goal-start",
              role: "user",
              turn_id: "turn-goal",
              content: "制作产品发布演示文稿",
            },
            {
              id: "message-user-goal-follow-up",
              role: "user",
              turn_id: "turn-goal",
              content: "补充品牌色要求",
            },
            {
              id: "message-user-normal",
              role: "user",
              turn_id: "turn-normal",
              content: "解释这段代码",
            },
          ],
          turns: [
            {
              id: "turn-goal",
              status: "completed",
              task_kind: "goal",
              started_at: "2026-08-06T08:00:00.000Z",
              completed_at: "2026-08-06T08:00:10.000Z",
            },
            {
              id: "turn-normal",
              status: "completed",
              task_kind: "turn",
              started_at: "2026-08-06T08:01:00.000Z",
              completed_at: "2026-08-06T08:01:10.000Z",
            },
          ],
          running_turn: null,
        }}
        onDownload={vi.fn()}
      />
    )

    const goalMessage = screen
      .getByText("制作产品发布演示文稿")
      .closest("article")
    const followUpMessage = screen
      .getByText("补充品牌色要求")
      .closest("article")
    const normalMessage = screen.getByText("解释这段代码").closest("article")

    expect(goalMessage).not.toBeNull()
    expect(
      within(goalMessage as HTMLElement).getByText("目标", {
        selector: ".user-message-goal-indicator-label",
      })
    ).toBeVisible()
    const goalIcon = goalMessage?.querySelector(
      ".user-message-goal-indicator-icon"
    )
    expect(goalIcon).toBeVisible()
    expect(goalIcon).toHaveClass("lucide-goal")
    expect(
      followUpMessage?.querySelector(".user-message-goal-indicator")
    ).toBeNull()
    expect(
      normalMessage?.querySelector(".user-message-goal-indicator")
    ).toBeNull()
  })

  it("uses the same native Goal clock for the live processing duration", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T08:00:24.000Z"))

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          goal: {
            thread_id: "codex-thread-goal",
            objective: "帮我制作一个介绍 AI 发展的 PPT",
            status: "active",
            token_budget: null,
            tokens_used: 12_000,
            time_used_seconds: 24,
            created_at: "2026-08-06T08:00:00.000Z",
            updated_at: "2026-08-06T08:00:24.000Z",
          },
          messages: [
            {
              id: "message-user-goal",
              role: "user",
              turn_id: "turn-goal",
              content: "帮我制作一个介绍 AI 发展的 PPT",
            },
            {
              id: "streaming-goal-assistant",
              role: "assistant",
              turn_id: "turn-goal",
              content: "正在制作演示文稿",
              created_at: "2026-08-06T08:00:16.000Z",
              streaming: true,
            },
          ],
          turns: [
            {
              id: "turn-goal",
              status: "running",
              task_kind: "goal",
              started_at: "2026-08-06T08:00:00.000Z",
              completed_at: null,
            },
          ],
          running_turn: {
            id: "turn-goal",
            status: "running",
            task_kind: "goal",
            started_at: "2026-08-06T08:00:00.000Z",
            completed_at: null,
          },
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-goal")
    expect(within(summary).getByText("24s", { exact: true })).toBeVisible()

    act(() => vi.advanceTimersByTime(2_000))

    expect(within(summary).getByText("26s", { exact: true })).toBeVisible()
  })

  it("keeps timing a running turn while another task is open", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:00.000Z"))

    const runningTurn = {
      id: "turn-switch-timer",
      status: "running" as const,
      started_at: "2026-07-11T07:59:30.000Z",
      completed_at: null,
    }
    const conversation = {
      ...completedConversation,
      messages: [
        {
          id: "message-user-switch-timer",
          role: "user" as const,
          turn_id: runningTurn.id,
          content: "继续处理任务",
        },
        {
          id: "message-assistant-switch-timer",
          role: "assistant" as const,
          turn_id: runningTurn.id,
          phase: "commentary" as const,
          content: "正在持续处理",
          streaming: true,
        },
      ],
      turns: [runningTurn],
      running_turn: runningTurn,
    }

    const firstView = render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    act(() => vi.advanceTimersByTime(0))
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.getByText("2s", { exact: true })).toBeVisible()

    firstView.unmount()
    act(() => vi.advanceTimersByTime(5_000))

    render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    expect(screen.getByText("7s", { exact: true })).toBeVisible()
  })

  it("keeps the completed processing duration after switching away and back", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:00.000Z"))

    const turnId = "turn-completed-switch-timer"
    const runningTurn = {
      id: turnId,
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const userMessage = {
      id: "message-user-completed-switch-timer",
      role: "user" as const,
      turn_id: turnId,
      content: "继续处理任务",
    }
    const liveAssistantMessage = {
      id: "message-assistant-completed-switch-timer",
      role: "assistant" as const,
      turn_id: turnId,
      phase: "commentary" as const,
      content: "正在持续处理",
      streaming: true,
    }
    const runningConversation = {
      ...completedConversation,
      messages: [userMessage, liveAssistantMessage],
      turns: [runningTurn],
      running_turn: runningTurn,
    }

    const firstView = render(
      <ConversationThread
        conversation={runningConversation}
        onDownload={vi.fn()}
      />
    )

    act(() => vi.advanceTimersByTime(0))
    act(() => vi.advanceTimersByTime(7_000))
    expect(screen.getByText("7s", { exact: true })).toBeVisible()

    const completedTurn = {
      ...runningTurn,
      status: "completed" as const,
      completed_at: "2026-07-11T08:00:07.000Z",
    }
    const completedConversationAfterReload = {
      ...runningConversation,
      messages: [
        userMessage,
        {
          ...liveAssistantMessage,
          created_at: "2026-07-11T08:00:05.000Z",
          streaming: false,
        },
      ],
      turns: [completedTurn],
      running_turn: null,
    }

    firstView.unmount()
    render(
      <ConversationThread
        conversation={completedConversationAfterReload}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByText("7s", { exact: true })).toBeVisible()
  })

  it("keeps running tool activity expanded until the turn finishes", async () => {
    const interaction = userEvent.setup()
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const completedTurn = {
      id: "turn-1",
      status: "completed" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: "2026-07-11T08:00:05.000Z",
    }
    const userMessage = completedConversation.messages!.find(
      (message) => message.role === "user"
    )!
    const commentaryMessage = {
      id: "message-commentary",
      role: "assistant" as const,
      turn_id: "turn-1",
      phase: "commentary" as const,
      content: "正在整理执行结果",
      created_at: "2026-07-11T08:00:02.000Z",
      streaming: true,
    }
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [userMessage, commentaryMessage],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "command-running",
              itemId: "command-running",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
              command: "pnpm test",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    let summary = screen.getByTestId("turn-summary-turn-1")
    expect(
      within(summary).queryByRole("button", { name: "展开中间过程" })
    ).toBeNull()
    expect(
      within(summary).queryByRole("button", { name: "收起中间过程" })
    ).toBeNull()
    expect(within(summary).getByText("正在整理执行结果")).toBeVisible()
    expect(within(summary).getByText("正在运行一个命令")).toBeVisible()

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            commentaryMessage,
            {
              id: "message-final",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              content: "最终内容已开始输出",
              created_at: "2026-07-11T08:00:03.000Z",
              event_sequence_no: 4,
              streaming: true,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "command-running",
              itemId: "command-running",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
              command: "pnpm test",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    summary = screen.getByTestId("turn-summary-turn-1")
    expect(
      within(summary).queryByRole("button", { name: "展开中间过程" })
    ).toBeNull()
    expect(
      within(summary).queryByRole("button", { name: "收起中间过程" })
    ).toBeNull()
    expect(within(summary).getByText("正在整理执行结果")).toBeVisible()
    expect(within(summary).getByText("正在运行一个命令")).toBeVisible()
    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "最终内容已开始输出"
      )
    ).toBeVisible()

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            commentaryMessage,
            {
              id: "message-final",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              content: "最终内容已开始输出",
              created_at: "2026-07-11T08:00:03.000Z",
              event_sequence_no: 4,
              streaming: false,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "command-running",
              itemId: "command-running",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
              command: "pnpm test",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    summary = screen.getByTestId("turn-summary-turn-1")
    expect(
      within(summary).getByRole("button", { name: "收起中间过程" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(within(summary).getByText("正在整理执行结果")).toBeVisible()
    expect(within(summary).getByText("正在运行一个命令")).toBeVisible()
    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "最终内容已开始输出"
      )
    ).toBeVisible()

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            commentaryMessage,
            {
              id: "message-final",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              content: "最终内容已开始输出",
              created_at: "2026-07-11T08:00:03.000Z",
              event_sequence_no: 4,
              streaming: false,
            },
          ],
          turns: [completedTurn],
          running_turn: null,
          events: [
            nativeLifecycleEvent({
              id: "command-completed",
              itemId: "command-running",
              sequence: 3,
              method: "item/completed",
              status: "completed",
              command: "pnpm test",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    summary = screen.getByTestId("turn-summary-turn-1")
    const trigger = within(summary).getByRole("button", {
      name: "展开中间过程",
    })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(within(summary).queryByText("正在整理执行结果")).toBeNull()
    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "最终内容已开始输出"
      )
    ).toBeVisible()

    await interaction.click(trigger)

    expect(within(summary).getByText("正在整理执行结果")).toBeVisible()
    expect(
      within(summary).getByRole("button", { name: "收起中间过程" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("keeps legacy tool progress visible for historical and compatibility events", async () => {
    const interaction = userEvent.setup()
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
    }
    const { unmount } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          turns: [runningTurn],
          running_turn: runningTurn,
          activities: [
            {
              id: "legacy-tool-running",
              turn_id: "turn-1",
              item_id: "legacy-tool-1",
              type: "tool_started",
              status: "running",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByText("正在调用工具")).toBeVisible()

    unmount()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          activities: [
            {
              id: "legacy-tool-completed",
              turn_id: "turn-1",
              item_id: "legacy-tool-1",
              type: "tool_completed",
              status: "completed",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    await interaction.click(
      screen.getByRole("button", { name: "展开中间过程" })
    )
    expect(screen.getByText("工具调用已完成")).toBeVisible()
  })

  it("shows thinking without a timer until the first assistant output arrives", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:00.500Z"))

    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const userMessage = completedConversation.messages!.find(
      (message) => message.role === "user"
    )!
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [userMessage],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        onDownload={vi.fn()}
      />
    )

    let summary = screen.getByTestId("turn-summary-turn-1")
    const thinkingStatus = within(summary).getByText("正在思考", {
      exact: true,
    })
    expect(thinkingStatus).toBeVisible()
    expect(thinkingStatus.closest('[data-slot="marker"]')).toHaveAttribute(
      "data-variant",
      "border"
    )
    expect(thinkingStatus.closest('[data-slot="marker"]')).toHaveClass(
      "border-b"
    )
    expect(thinkingStatus.closest(".turn-summary-heading")).toHaveAttribute(
      "data-initial-thinking",
      "true"
    )
    expect(within(summary).queryByText("正在处理", { exact: true })).toBeNull()
    expect(summary.querySelector(".turn-duration")).toBeNull()

    act(() => vi.advanceTimersByTime(52_000))

    expect(within(summary).getByText("正在思考", { exact: true })).toBeVisible()
    expect(summary.querySelector(".turn-duration")).toBeNull()

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            {
              id: "streaming-assistant",
              role: "assistant",
              turn_id: "turn-1",
              phase: "commentary",
              content: "开始检查文件",
              created_at: "2026-07-11T08:00:52.500Z",
              streaming: true,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        onDownload={vi.fn()}
      />
    )

    summary = screen.getByTestId("turn-summary-turn-1")
    const processingStatus = within(summary).getByText("正在处理", {
      exact: true,
    })
    expect(processingStatus).toBeVisible()
    expect(processingStatus.closest('[data-slot="marker"]')).toHaveAttribute(
      "data-variant",
      "border"
    )
    expect(processingStatus.closest('[data-slot="marker"]')).toHaveClass(
      "border-b"
    )
    expect(
      processingStatus.closest(".turn-summary-heading")
    ).not.toHaveAttribute("data-initial-thinking")
    expect(within(summary).queryByText("正在思考", { exact: true })).toBeNull()
    expect(summary.querySelector(".turn-duration")).toBeNull()

    act(() => vi.advanceTimersByTime(1_000))

    expect(within(summary).getByText("1s", { exact: true })).toBeVisible()
  })

  it("does not keep a stopped previous turn thinking after editing and resending", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:08.000Z"))

    const stoppedPreviousTurn = {
      id: "turn-stopped",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
      interrupt_requested_at: "2026-07-11T08:00:05.000Z",
      interrupted_at: null,
    }
    const activeTurn = {
      id: "turn-active",
      status: "running" as const,
      started_at: "2026-07-11T08:00:06.000Z",
      completed_at: null,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            {
              id: "message-user-stopped",
              role: "user",
              turn_id: "turn-stopped",
              content: "不对，是尽量真实的中国人的名字。",
              created_at: "2026-07-11T08:00:00.000Z",
            },
            {
              id: "message-assistant-stopped",
              role: "assistant",
              turn_id: "turn-stopped",
              phase: "commentary",
              content:
                "我会改为常见、自然的中国式姓名组合，并确保这些是随机生成的示例姓名。",
              created_at: "2026-07-11T08:00:03.000Z",
            },
            {
              id: "message-user-active",
              role: "user",
              turn_id: "turn-active",
              content: "对，是尽量真实的中国人的名字。",
              created_at: "2026-07-11T08:00:06.000Z",
            },
          ],
          turns: [stoppedPreviousTurn, activeTurn],
          running_turn: activeTurn,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getAllByText("正在思考", { exact: true })).toHaveLength(1)

    const stoppedSummary = screen.getByTestId("turn-summary-turn-stopped")
    expect(
      within(stoppedSummary).queryByText("正在思考", { exact: true })
    ).toBeNull()
    expect(
      within(stoppedSummary).getByText("已中断", { exact: true })
    ).toBeVisible()
    expect(stoppedSummary.querySelector(".turn-thinking-activity")).toBeNull()

    const activeSummary = screen.getByTestId("turn-summary-turn-active")
    expect(
      within(activeSummary).getByText("正在思考", { exact: true })
    ).toBeVisible()
  })

  it("treats a native tool call as the first processed output", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:04.000Z"))
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "event-tool-started",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("正在处理", { exact: true })).toBeVisible()
    expect(within(summary).queryByText("正在思考", { exact: true })).toBeNull()
    expect(within(summary).getByText("1s", { exact: true })).toBeVisible()
    expect(within(summary).getByText("正在运行一个命令")).toBeVisible()
  })

  it("keeps the image generation loading surface last until the MCP call completes", () => {
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const imageCallStarted = {
      id: "image-generation-call",
      type: "mcpToolCall" as const,
      server: "linksense_core",
      tool: "generate_image",
      status: "inProgress" as const,
    } satisfies NativeCodexItem
    const imageCallCompleted = {
      ...imageCallStarted,
      status: "completed" as const,
      durationMs: 86_500,
    } satisfies NativeCodexItem
    const messages = [
      completedConversation.messages![0]!,
      {
        id: "image-generation-commentary",
        role: "assistant" as const,
        turn_id: "turn-1",
        phase: "commentary" as const,
        event_sequence_no: 4,
        content: "图像正在生成中，我会保留关键构图。",
        created_at: "2026-07-11T08:00:04.000Z",
        streaming: true,
      },
    ]
    const startedEvent = nativeItemLifecycleEvent({
      id: "image-generation-started",
      sequence: 3,
      item: imageCallStarted,
      method: "item/started",
    })
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages,
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [startedEvent],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    const loading = within(summary).getByRole("status", {
      name: "正在生成图片…",
    })
    expect(loading).toBeVisible()
    expect(loading).toHaveClass(
      "assistant-html-preview-loading-surface",
      "turn-image-generation-loading",
      "aspect-square",
      "min-h-0",
      "max-w-[20rem]"
    )
    expect(loading).not.toHaveClass("min-h-80")
    expect(
      loading.querySelector(".assistant-html-preview-loading-canvas")
    ).toBeVisible()
    expect(
      loading.querySelector(".assistant-html-preview-loading-glow")
    ).toBeVisible()
    expect(summary.lastElementChild).toBe(loading)

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages,
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            startedEvent,
            nativeItemLifecycleEvent({
              id: "image-generation-completed",
              sequence: 5,
              item: imageCallCompleted,
              method: "item/completed",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      within(summary).queryByRole("status", { name: "正在生成图片…" })
    ).toBeNull()
    expect(summary.querySelector(".turn-image-generation-loading")).toBeNull()
  })

  it("shows thinking without a tool disclosure while a plan is running", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:23.000Z"))
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "event-tool-started",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
            }),
            nativeLifecycleEvent({
              id: "event-tool-completed",
              sequence: 5,
              method: "item/completed",
              status: "completed",
            }),
            nativePlanEvent({
              id: "event-plan-running",
              sequence: 6,
              steps: [
                { step: "确认演示文稿结构", status: "inProgress" },
                { step: "生成演示文稿", status: "pending" },
              ],
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("正在处理", { exact: true })).toBeVisible()
    expect(within(summary).getByText("20s", { exact: true })).toBeVisible()
    expect(within(summary).queryByText("运行了一个命令")).toBeNull()
    const thinking = within(summary).getByText("正在思考", { exact: true })
    expect(thinking).toBeVisible()
    expect(thinking.closest(".native-activity-summary")).toHaveClass("shimmer")
    expect(thinking.closest('[data-slot="marker-content"]')).not.toBeNull()
    const thinkingRow = thinking.closest('[data-slot="marker"]')
    expect(thinkingRow).toHaveAttribute("role", "status")
    expect(thinkingRow).toHaveAttribute("aria-busy", "true")
    expect(summary.querySelectorAll(".native-activity-item")).toHaveLength(1)
    expect(
      within(summary).queryByRole("button", {
        name: i18n.t("conversation.nativeActivityDetails.expand", {
          activity: "正在思考",
        }),
      })
    ).toBeNull()
    expect(summary.querySelector(".native-activity-chevron")).toBeNull()
    fireEvent.click(thinking)
    expect(within(summary).queryByText("pnpm test")).toBeNull()
    expect(within(summary).getByText("正在思考", { exact: true })).toBe(
      thinking
    )
  })

  it("keeps thinking visible while named subagents work in the background", () => {
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeCollabAgentEvent({
              id: "collab-spawning",
              sequence: 2,
              method: "item/started",
              status: "inProgress",
              agents: [
                { agentKey: agentKeyA, status: "notFound" },
                { agentKey: agentKeyB, status: "running" },
                { agentKey: agentKeyC, status: "pendingInit" },
              ],
            }),
            nativeSubAgentActivityEvent({
              id: "agent-a-started",
              sequence: 3,
              kind: "started",
              agentKey: agentKeyA,
              agentLabel: "纽约概览",
            }),
            nativeSubAgentActivityEvent({
              id: "agent-b-started",
              sequence: 4,
              kind: "started",
              agentKey: agentKeyB,
              agentLabel: "纽约历史",
            }),
            nativeSubAgentActivityEvent({
              id: "agent-c-started",
              sequence: 5,
              kind: "started",
              agentKey: agentKeyC,
              agentLabel: "纽约旅行",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("已开始工作")).toBeVisible()
    expect(within(summary).queryByText("未找到")).toBeNull()
    expect(within(summary).getByText("正在思考", { exact: true })).toBeVisible()
  })

  it("does not flash thinking after the final answer is already visible", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:12.000Z"))
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const userMessage = completedConversation.messages!.find(
      (message) => message.role === "user"
    )!

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            {
              id: "message-final",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              content: "你好！有什么需要我帮忙的吗？",
              created_at: "2026-07-11T08:00:12.000Z",
              streaming: false,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "你好！有什么需要我帮忙的吗？"
      )
    ).toBeVisible()

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("正在处理", { exact: true })).toBeVisible()
    expect(within(summary).queryByText("正在思考", { exact: true })).toBeNull()
    expect(summary.querySelector(".turn-thinking-activity")).toBeNull()
    expect(summary.querySelector(".activity-panel")).toBeNull()
  })

  it("does not reserve an empty activity panel above a streaming final answer", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T08:00:12.000Z"))
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const userMessage = completedConversation.messages!.find(
      (message) => message.role === "user"
    )!

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            {
              id: "message-final",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              content: "我可以帮你：",
              created_at: "2026-07-11T08:00:12.000Z",
              streaming: true,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "我可以帮你："
      )
    ).toBeVisible()

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("正在处理", { exact: true })).toBeVisible()
    expect(within(summary).queryByText("正在思考", { exact: true })).toBeNull()
    expect(summary.querySelector(".activity-panel")).toBeNull()
  })

  it("reserves a stable assistant action row while streaming and fills it after completion", () => {
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      model: "gpt-5.6-luna",
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const userMessage = completedConversation.messages!.find(
      (message) => message.role === "user"
    )!
    const streamingAssistantMessage = {
      id: "message-final",
      role: "assistant" as const,
      turn_id: "turn-1",
      phase: "final_answer" as const,
      content: "还可以继续补充",
      created_at: "2026-07-11T14:25:00",
      streaming: true,
    }
    const modelCatalog = [
      {
        id: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        enabled: true,
        context_window: null,
        supported_reasoning_efforts: ["medium" as const],
        default_reasoning_effort: "medium" as const,
      },
    ]
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [userMessage, streamingAssistantMessage],
          turns: [runningTurn],
          running_turn: runningTurn,
        }}
        modelCatalog={modelCatalog}
        onDownload={vi.fn()}
      />
    )

    let assistantMessage = screen.getByRole("article", { name: "助手回复" })
    expect(within(assistantMessage).getByText("还可以继续补充")).toBeVisible()
    const streamingActions = assistantMessage.querySelector(".message-actions")
    expect(streamingActions).not.toBeNull()
    expect(streamingActions).toHaveAttribute("aria-hidden", "true")
    expect(streamingActions).toHaveAttribute("data-placeholder", "true")
    expect(
      within(assistantMessage).queryByRole("button", { name: "复制消息" })
    ).toBeNull()
    expect(within(assistantMessage).queryByText("14:25")).toBeNull()
    expect(within(assistantMessage).queryByText("GPT-5.6 Luna")).toBeNull()

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            userMessage,
            {
              ...streamingAssistantMessage,
              streaming: false,
            },
          ],
          turns: [
            {
              ...runningTurn,
              status: "completed",
              completed_at: "2026-07-11T08:00:15.000Z",
            },
          ],
          running_turn: null,
        }}
        modelCatalog={modelCatalog}
        onDownload={vi.fn()}
      />
    )

    assistantMessage = screen.getByRole("article", { name: "助手回复" })
    expect(assistantMessage.querySelector(".message-actions")).toBe(
      streamingActions
    )
    expect(streamingActions).not.toHaveAttribute("aria-hidden")
    expect(streamingActions).not.toHaveAttribute("data-placeholder")
    expect(
      within(assistantMessage).getByRole("button", { name: "复制消息" })
    ).toBeVisible()
    expect(within(assistantMessage).getByText("14:25")).toBeVisible()
    expect(within(assistantMessage).getByText("GPT-5.6 Luna")).toBeVisible()
  })

  it("shows only explicitly active stream reconnect state and ignores stale retry events", () => {
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const completedToolEvents = [
      nativeLifecycleEvent({
        id: "event-tool-started",
        sequence: 3,
        method: "item/started",
        status: "inProgress",
      }),
      nativeLifecycleEvent({
        id: "event-tool-completed",
        sequence: 5,
        method: "item/completed",
        status: "completed",
      }),
    ]
    const conversation = {
      ...completedConversation,
      messages: [completedConversation.messages![0]!],
      turns: [runningTurn],
      running_turn: runningTurn,
      events: [
        ...completedToolEvents,
        nativeReconnectEvent({ id: "event-reconnecting", sequence: 7 }),
      ],
    }
    const { rerender } = render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(
      within(summary).queryByText("正在重新连接 1/5", { exact: true })
    ).toBeNull()
    expect(within(summary).getByText("正在思考", { exact: true })).toBeVisible()

    rerender(
      <ConversationThread
        conversation={conversation}
        nativeReconnectState={{
          turnId: "turn-1",
          phase: "reconnecting",
          round: 1,
          attempt: 1,
          roundCount: 3,
          attemptsPerRound: 5,
        }}
        onDownload={vi.fn()}
      />
    )

    const reconnecting = within(summary).getByText("正在重新连接 1/5", {
      exact: true,
    })
    const reconnectingRow = reconnecting.closest(".turn-reconnecting-activity")
    expect(reconnectingRow).toHaveAttribute("role", "status")
    expect(reconnectingRow).toHaveAttribute("aria-busy", "true")
    expect(reconnectingRow?.querySelector(".lucide-wifi")).not.toBeNull()
    expect(reconnecting).toHaveClass("shimmer")
    expect(reconnectingRow?.querySelectorAll(".shimmer")).toHaveLength(1)
    expect(within(summary).queryByText("正在思考", { exact: true })).toBeNull()

    rerender(
      <ConversationThread
        conversation={conversation}
        nativeReconnectState={null}
        onDownload={vi.fn()}
      />
    )

    expect(
      within(summary).queryByText("正在重新连接 1/5", { exact: true })
    ).toBeNull()
    expect(within(summary).getByText("正在思考", { exact: true })).toBeVisible()
  })

  it("shows only the stable inline disconnect error after reconnect rounds are exhausted", () => {
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    const reconnectFailure = {
      turnId: "turn-1",
      phase: "failed" as const,
      round: 3,
      attempt: 5,
      roundCount: 3 as const,
      attemptsPerRound: 5 as const,
      stoppedAtMs: Date.parse("2026-07-11T08:01:15.000Z"),
    }
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "event-interrupted-command",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
            }),
          ],
        }}
        nativeReconnectState={reconnectFailure}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    const error = within(summary).getByRole("alert")
    expect(error).toHaveTextContent("stream disconnected before completion.")
    expect(error.textContent).toBe("stream disconnected before completion.")
    expect(error.querySelector(".lucide-circle-alert")).not.toBeNull()
    expect(within(summary).getByText("已中断", { exact: true })).toBeVisible()
    expect(
      within(summary).getByText("运行了一个命令", { exact: true })
    ).toBeVisible()
    expect(within(summary).queryByText(/正在重新连接/u)).not.toBeInTheDocument()
    expect(
      within(summary).queryByText("正在思考", { exact: true })
    ).not.toBeInTheDocument()
    expect(summary.querySelector('[aria-busy="true"]')).toBeNull()
    expect(summary.querySelector(".animate-spin")).toBeNull()
    expect(summary.querySelector(".shimmer")).toBeNull()

    rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [completedConversation.messages![0]!],
          turns: [
            {
              ...runningTurn,
              status: "interrupted",
              completed_at: "2026-07-11T08:01:15.000Z",
              interrupted_at: "2026-07-11T08:01:15.000Z",
            },
          ],
          running_turn: null,
        }}
        nativeReconnectState={reconnectFailure}
        onDownload={vi.fn()}
      />
    )

    expect(within(summary).getByRole("alert")).toHaveTextContent(
      "stream disconnected before completion."
    )
    expect(within(summary).getByText("已中断", { exact: true })).toBeVisible()
    expect(summary.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it("renders a static summary without an empty disclosure when no steps exist", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-empty-commentary",
              role: "assistant",
              turn_id: "turn-1",
              phase: "commentary",
              content: " \n ",
            },
            completedConversation.messages![1]!,
          ],
          activities: [
            {
              id: "activity-hidden-capability",
              turn_id: "turn-1",
              type: "capability_attached",
              capability_name: "pptx",
            },
          ],
          events: [],
          loaded_capabilities: [],
          priority_capabilities: [],
          used_capabilities: [],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("用时", { exact: true })).toBeVisible()
    expect(within(summary).getByText("3s", { exact: true })).toBeVisible()
    expect(within(summary).queryByRole("button")).toBeNull()
    expect(summary.querySelector("svg")).toBeNull()
    expect(summary.querySelector(".activity-panel")).toBeNull()
    expect(screen.queryByText("暂无可展示的执行步骤")).toBeNull()
  })

  it("renders a proposed plan card separately from an ordinary final answer", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-proposed-plan",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              output_kind: "plan",
              content: "## 实施方案\n\n- 先检查现有实现\n- 再补齐测试",
              created_at: "2026-07-11T15:53:00",
            },
            {
              id: "message-ordinary-final",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              output_kind: "agent_message",
              content: "普通最终答复",
              created_at: "2026-07-11T15:54:00",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const plan = screen.getByRole("region", { name: "方案" })
    expect(plan.closest(".message-content")).toHaveClass("w-full")
    expect(
      within(plan).getByRole("heading", { name: "实施方案" })
    ).toBeVisible()
    expect(within(plan).getByText("先检查现有实现")).toBeVisible()
    expect(within(plan).queryByText("普通最终答复")).toBeNull()

    const finalAnswer = screen.getByText("普通最终答复")
    expect(finalAnswer).toBeVisible()
    expect(
      finalAnswer.closest('[data-testid="conversation-proposed-plan"]')
    ).toBeNull()
    expect(screen.getAllByRole("article", { name: "助手回复" })).toHaveLength(2)
  })

  it("renders a tagged plan inside a historical agent message without exposing its markers", async () => {
    const interaction = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue()
    const content = [
      "这是计划前的说明。",
      "",
      "<proposed_plan>",
      "## 霓虹俄罗斯方块",
      "",
      "- 实现游戏棋盘",
      "</proposed_plan>",
      "",
      "这是计划后的补充。",
    ].join("\n")

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-tagged-agent-plan",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              output_kind: "agent_message",
              content,
              created_at: "2026-07-11T15:54:00",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    const plan = within(assistant).getByRole("region", { name: "方案" })
    expect(plan.closest(".message-content")).toHaveClass("w-full")
    expect(
      within(plan).getByRole("heading", { name: "霓虹俄罗斯方块" })
    ).toBeVisible()
    expect(within(plan).getByText("实现游戏棋盘")).toBeVisible()
    expect(within(plan).queryByText("这是计划前的说明。")).toBeNull()
    expect(within(plan).queryByText("这是计划后的补充。")).toBeNull()
    expect(within(assistant).getByText("这是计划前的说明。")).toBeVisible()
    expect(within(assistant).getByText("这是计划后的补充。")).toBeVisible()
    expect(assistant).not.toHaveTextContent("<proposed_plan>")
    expect(assistant).not.toHaveTextContent("</proposed_plan>")

    await interaction.click(
      within(assistant).getByRole("button", { name: "复制消息" })
    )
    expect(writeText).toHaveBeenLastCalledWith(
      [
        "这是计划前的说明。",
        "",
        "## 霓虹俄罗斯方块",
        "",
        "- 实现游戏棋盘",
        "",
        "这是计划后的补充。",
      ].join("\n")
    )
  })

  it("keeps knowledge citations at their original segments in a tagged agent plan", () => {
    const before = "😀计划前说明。"
    const planContent = "计划实施内容。"
    const after = "计划后补充。"
    const content = [
      before,
      "",
      "<proposed_plan>",
      planContent,
      "</proposed_plan>",
      "",
      after,
    ].join("\n")
    const summary = {
      knowledge_base_name: "产品知识库",
      document_name: "规划说明.pdf",
      title_path: ["实施方案"],
      page_numbers: [1],
    }

    render(
      <MemoryRouter>
        <ConversationThread
          conversation={{
            ...completedConversation,
            messages: [
              completedConversation.messages![0]!,
              {
                id: "message-tagged-agent-plan-with-citations",
                role: "assistant",
                turn_id: "turn-1",
                phase: "final_answer",
                output_kind: "agent_message",
                content,
                created_at: "2026-07-11T15:54:00",
                knowledge_citations: [
                  {
                    citation_id: "10000000-0000-4000-8000-000000000021",
                    citation_no: 1,
                    summary,
                    anchors: [
                      {
                        occurrence_no: 1,
                        after_offset_utf16: "😀".length,
                      },
                    ],
                  },
                  {
                    citation_id: "10000000-0000-4000-8000-000000000022",
                    citation_no: 2,
                    summary,
                    anchors: [
                      {
                        occurrence_no: 2,
                        after_offset_utf16:
                          content.indexOf(planContent) + planContent.length,
                      },
                    ],
                  },
                  {
                    citation_id: "10000000-0000-4000-8000-000000000023",
                    citation_no: 3,
                    summary,
                    anchors: [
                      {
                        occurrence_no: 3,
                        after_offset_utf16:
                          content.indexOf(after) + after.length,
                      },
                    ],
                  },
                  {
                    citation_id: "10000000-0000-4000-8000-000000000024",
                    citation_no: 4,
                    summary,
                    anchors: [
                      {
                        occurrence_no: 4,
                        after_offset_utf16:
                          content.indexOf("<proposed_plan>") +
                          "<proposed_plan>".length,
                      },
                    ],
                  },
                ],
              },
            ],
          }}
          onDownload={vi.fn()}
        />
      </MemoryRouter>
    )

    const assistant = screen.getByRole("article", { name: "助手回复" })
    const plan = within(assistant).getByRole("region", { name: "方案" })
    const markdownSegments = assistant.querySelectorAll(".assistant-markdown")
    expect(markdownSegments).toHaveLength(3)
    expect(markdownSegments[0]).toHaveTextContent("😀1计划前说明。")
    expect(
      within(markdownSegments[0] as HTMLElement).getByRole("link", {
        name: "打开知识库引用 1",
      })
    ).toBeVisible()
    expect(
      within(markdownSegments[0] as HTMLElement).queryByRole("link", {
        name: "打开知识库引用 2",
      })
    ).toBeNull()
    expect(
      within(markdownSegments[0] as HTMLElement).queryByRole("link", {
        name: "打开知识库引用 3",
      })
    ).toBeNull()
    expect(
      within(markdownSegments[0] as HTMLElement).queryByRole("link", {
        name: "打开知识库引用 4",
      })
    ).toBeNull()
    expect(plan).toHaveTextContent(`${planContent}2`)
    expect(
      within(plan).getByRole("link", { name: "打开知识库引用 2" })
    ).toBeVisible()
    expect(
      within(plan).queryByRole("link", { name: "打开知识库引用 1" })
    ).toBeNull()
    expect(
      within(plan).queryByRole("link", { name: "打开知识库引用 3" })
    ).toBeNull()
    expect(
      within(plan).queryByRole("link", { name: "打开知识库引用 4" })
    ).toBeNull()
    expect(markdownSegments[2]).toHaveTextContent(`${after}3`)
    expect(
      within(markdownSegments[2] as HTMLElement).getByRole("link", {
        name: "打开知识库引用 3",
      })
    ).toBeVisible()
    expect(
      within(markdownSegments[2] as HTMLElement).queryByRole("link", {
        name: "打开知识库引用 1",
      })
    ).toBeNull()
    expect(
      within(markdownSegments[2] as HTMLElement).queryByRole("link", {
        name: "打开知识库引用 2",
      })
    ).toBeNull()
    expect(
      within(markdownSegments[2] as HTMLElement).queryByRole("link", {
        name: "打开知识库引用 4",
      })
    ).toBeNull()
    expect(
      within(assistant).getAllByRole("link", {
        name: /打开知识库引用/u,
      })
    ).toHaveLength(3)
  })

  it("treats a completed turn with only a proposed plan as successful output", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-plan-only",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              output_kind: "plan",
              content: "## 唯一方案输出\n\n1. 核对边界\n2. 等待用户确认",
              created_at: "2026-07-11T15:54:00",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByRole("region", { name: "方案" })).toBeVisible()
    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("用时", { exact: true })).toBeVisible()
    expect(within(summary).queryByText("失败", { exact: true })).toBeNull()
    expect(
      screen.queryByText("本轮执行已结束，但没有产出可展示的内容，请重新执行。")
    ).toBeNull()
  })

  it("hides only the synthetic implement message matched by follow-up turn id", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            {
              id: "message-implement-request",
              role: "user",
              turn_id: "turn-plan-implement",
              content: "Implement the plan.",
              created_at: "2026-07-11T15:40:00",
            },
            {
              id: "message-implement-plan",
              role: "assistant",
              turn_id: "turn-plan-implement",
              output_kind: "plan",
              content: "## 实施计划\n\n- 执行变更",
              created_at: "2026-07-11T15:41:00",
            },
            {
              id: "message-synthetic-implement",
              role: "user",
              turn_id: "turn-implement-follow-up",
              content: "Implement the plan.",
              created_at: "2026-07-11T15:42:00",
            },
            {
              id: "message-implemented-result",
              role: "assistant",
              turn_id: "turn-implement-follow-up",
              phase: "final_answer",
              content: "实施已完成",
              created_at: "2026-07-11T15:43:00",
            },
            {
              id: "message-revise-request",
              role: "user",
              turn_id: "turn-plan-revise",
              content: "请再制定一份发布计划",
              created_at: "2026-07-11T15:44:00",
            },
            {
              id: "message-revise-plan",
              role: "assistant",
              turn_id: "turn-plan-revise",
              output_kind: "plan",
              content: "## 发布计划\n\n- 发布新版本",
              created_at: "2026-07-11T15:45:00",
            },
            {
              id: "message-revision-feedback",
              role: "user",
              turn_id: "turn-revise-follow-up",
              content: "请在计划中增加回滚步骤。",
              created_at: "2026-07-11T15:46:00",
            },
            {
              id: "message-revised-result",
              role: "assistant",
              turn_id: "turn-revise-follow-up",
              phase: "final_answer",
              content: "已根据反馈修改方案",
              created_at: "2026-07-11T15:47:00",
            },
          ],
          turns: [
            {
              id: "turn-plan-implement",
              status: "completed",
              started_at: "2026-07-11T15:40:00",
              completed_at: "2026-07-11T15:41:00",
            },
            {
              id: "turn-implement-follow-up",
              status: "completed",
              started_at: "2026-07-11T15:42:00",
              completed_at: "2026-07-11T15:43:00",
            },
            {
              id: "turn-plan-revise",
              status: "completed",
              started_at: "2026-07-11T15:44:00",
              completed_at: "2026-07-11T15:45:00",
            },
            {
              id: "turn-revise-follow-up",
              status: "completed",
              started_at: "2026-07-11T15:46:00",
              completed_at: "2026-07-11T15:47:00",
            },
          ],
          plan_reviews: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              conversation_id: completedConversation.id,
              source_turn_id: "turn-plan-implement",
              plan_message_id: "message-implement-plan",
              status: "resolved",
              decision: "implement",
              follow_up_turn_id: "turn-implement-follow-up",
              resolved_at: "2026-07-11T15:42:00",
              created_at: "2026-07-11T15:41:00",
              updated_at: "2026-07-11T15:42:00",
            },
            {
              id: "10000000-0000-4000-8000-000000000002",
              conversation_id: completedConversation.id,
              source_turn_id: "turn-plan-revise",
              plan_message_id: "message-revise-plan",
              status: "resolved",
              decision: "revise",
              follow_up_turn_id: "turn-revise-follow-up",
              resolved_at: "2026-07-11T15:46:00",
              created_at: "2026-07-11T15:45:00",
              updated_at: "2026-07-11T15:46:00",
            },
          ],
          running_turn: null,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getAllByText("Implement the plan.")).toHaveLength(1)
    expect(
      document.getElementById(
        "conversation-message-message-synthetic-implement"
      )
    ).toBeNull()
    expect(screen.getByText("请在计划中增加回滚步骤。")).toBeVisible()
    expect(screen.getByText("实施已完成")).toBeVisible()
    expect(screen.getByText("已根据反馈修改方案")).toBeVisible()
  })

  it("keeps the latest native execution plan in a completed turn summary", async () => {
    const interaction = userEvent.setup()
    const onActivityDisclosureToggle = vi.fn()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          activities: [],
          turn_file_change_counts: { "turn-1": 4 },
          events: [
            nativePlanEvent({
              id: "plan-old",
              sequence: 2,
              steps: [
                { step: "检查旧计划", status: "inProgress" },
                { step: "旧步骤", status: "pending" },
              ],
            }),
            nativePlanEvent({
              id: "plan-latest",
              sequence: 8,
              steps: [
                { step: "核对现有实现", status: "completed" },
                { step: "实现右上角清单", status: "completed" },
                { step: "完成回归测试", status: "completed" },
              ],
            }),
          ],
        }}
        onDownload={vi.fn()}
        onActivityDisclosureToggle={onActivityDisclosureToggle}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).queryByText("执行计划")).toBeNull()

    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    expect(onActivityDisclosureToggle).toHaveBeenCalledTimes(1)
    expect(within(summary).getByText("执行计划")).toBeVisible()
    expect(within(summary).getByText("第 3 / 3 步")).toBeVisible()
    expect(within(summary).getByText("4 个文件已更改")).toBeVisible()
    expect(within(summary).getByText("实现右上角清单")).toBeVisible()
    expect(within(summary).queryByText("旧步骤")).toBeNull()
    expect(
      within(summary).getByText("完成回归测试").closest("li")
    ).toHaveAttribute("data-status", "completed")
  })

  it("keeps commentary prominent until the native final answer has visible content", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-commentary",
              role: "assistant",
              turn_id: "turn-1",
              item_id: "agent-commentary",
              phase: "commentary",
              content: "我正在等待最终答案",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              started_at: "2026-07-11T08:00:00.000Z",
              completed_at: null,
            },
          ],
          running_turn: {
            id: "turn-1",
            status: "running",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: null,
          },
          events: [nativeFinalAnswerStartedEvent()],
        }}
        onDownload={vi.fn()}
      />
    )

    const commentary = screen
      .getByText("我正在等待最终答案")
      .closest(".process-commentary")
    expect(commentary).toHaveAttribute("data-final-answer-visible", "false")
    expect(screen.queryByRole("article", { name: "助手回复" })).toBeNull()
  })

  it("mutes legacy commentary when a completed turn uses its last unphased message as the final answer", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-legacy-commentary",
              role: "assistant",
              turn_id: "turn-1",
              content: "旧版中间过程",
            },
            {
              id: "message-legacy-final",
              role: "assistant",
              turn_id: "turn-1",
              content: "旧版最终答案",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(
      within(summary).getByText("旧版中间过程").closest(".process-commentary")
    ).toHaveAttribute("data-final-answer-visible", "true")
    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "旧版最终答案"
      )
    ).toBeVisible()
  })

  it("keeps unphased commentary prominent when a failed turn has no final answer", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-failed-commentary",
              role: "assistant",
              turn_id: "turn-1",
              content: "失败前中间过程",
            },
            {
              id: "message-failed-tail",
              role: "assistant",
              turn_id: "turn-1",
              content: "任务未能完成",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "failed",
              error_message: "模型服务拒绝请求：服务用量已达上限。",
              started_at: "2026-07-11T08:00:00.000Z",
              completed_at: "2026-07-11T08:00:03.250Z",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(
      within(summary).getByText("模型服务拒绝请求：服务用量已达上限。")
    ).toBeVisible()
    expect(
      within(summary).queryByText("本轮执行失败。你可以调整输入后继续重试。")
    ).toBeNull()
    expect(
      within(summary).getByText("失败前中间过程").closest(".process-commentary")
    ).toHaveAttribute("data-final-answer-visible", "false")
  })

  it("falls back to the generic failure text for historical turns without a reason", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          turns: [
            {
              id: "turn-1",
              status: "failed",
              started_at: "2026-07-11T08:00:00.000Z",
              completed_at: "2026-07-11T08:00:03.250Z",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(
      within(summary).getByText("本轮执行失败。你可以调整输入后继续重试。")
    ).toBeVisible()
  })

  it("does not expose the internal execution platform from a raw turn failure", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          turns: [
            {
              id: "turn-1",
              status: "failed",
              error_message: "CodeX app-server failed to start.",
              started_at: "2026-07-11T08:00:00.000Z",
              completed_at: "2026-07-11T08:00:03.250Z",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(
      within(summary).getByText("本轮执行失败。你可以调整输入后继续重试。")
    ).toBeVisible()
    expect(within(summary).queryByText(/codex/iu)).not.toBeInTheDocument()
  })

  it("collapses native commentary and tool calls while keeping the final answer and artifact visible once", async () => {
    const interaction = userEvent.setup()
    const artifact = {
      id: "artifact-1",
      name: "report.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 90_522,
      kind: "artifact" as const,
      turn_id: "turn-1",
      status: "available",
      created_at: "2026-07-11T08:00:03",
      download_available: true,
    }
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-commentary",
              role: "assistant",
              turn_id: "turn-1",
              item_id: "agent-commentary",
              phase: "commentary",
              event_sequence_no: 4,
              created_at: "2026-07-11T08:00:01.000Z",
              content: "我正在检查项目配置",
              artifacts: [artifact],
            },
            {
              id: "message-final",
              role: "assistant",
              turn_id: "turn-1",
              item_id: "agent-final",
              phase: "final_answer",
              event_sequence_no: 6,
              created_at: "2026-07-11T08:00:03.000Z",
              content: "配置检查完成",
              artifacts: [artifact],
            },
          ],
          activities: [
            {
              id: "activity-file-service",
              turn_id: "turn-1",
              type: "system_capability_used",
              capability_name: "LinkSense File Service",
              sequence_no: 5,
              created_at: "2026-07-11T08:00:02.500Z",
            },
          ],
          events: [
            nativeLifecycleEvent({
              id: "event-command-started",
              sequence: 3,
              method: "item/started",
              status: "inProgress",
            }),
            nativeLifecycleEvent({
              id: "event-command-completed",
              sequence: 5,
              method: "item/completed",
              status: "completed",
            }),
          ],
          artifacts: [artifact],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    const finalReply = screen.getByRole("article", { name: "助手回复" })
    expect(within(finalReply).getByText("配置检查完成")).toBeVisible()
    expect(screen.queryByText("我正在检查项目配置")).toBeNull()
    expect(screen.queryByText("pnpm test")).toBeNull()
    const artifactCard = screen.getByRole("button", {
      name: "下载 report.xlsx",
    })
    expect(artifactCard).toHaveClass("artifact-tile", "file-tile")
    expect(artifactCard).not.toHaveClass("attachment-tile")
    expect(
      screen.getAllByRole("button", { name: "下载 report.xlsx" })
    ).toHaveLength(1)
    const artifactName = within(artifactCard).getByText("report.xlsx")
    expect(artifactName).toHaveClass("file-tile-name", "truncate")
    expect(artifactName.parentElement).toHaveClass("min-w-0")
    expect(within(artifactCard).getByText(/88\.4\s*kB/u)).toHaveClass(
      "file-tile-meta"
    )
    expect(artifactCard).not.toHaveTextContent("2026-07-11 08:00")
    expect(within(artifactCard).queryByText(/application\/vnd/u)).toBeNull()
    expect(
      artifactCard.querySelector('[data-file-icon-kind="excel"]')
    ).toBeVisible()

    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    const commentary = within(summary).getByText("我正在检查项目配置")
    const toolCall = within(summary).getByText("运行了一个命令")
    const fileServiceActivity = within(summary).getByText("已使用文件服务")
    const fileServiceMarker = fileServiceActivity.closest(
      '[data-slot="marker"]'
    )
    expect(commentary).toBeVisible()
    expect(commentary.closest(".process-commentary")).toHaveAttribute(
      "data-final-answer-visible",
      "true"
    )
    expect(toolCall).toBeVisible()
    expect(fileServiceMarker).not.toBeNull()
    expect(fileServiceMarker?.closest(".legacy-activity-item")).not.toBeNull()
    expect(
      within(fileServiceMarker as HTMLElement).getByText(
        "LinkSense File Service"
      )
    ).toBeVisible()
    expect(
      fileServiceActivity
        .closest('[data-slot="marker-content"]')
        ?.querySelector(".trace-chip")
    ).toHaveTextContent("LinkSense File Service")
    expect(
      toolCall.closest(".activity-item-main")?.querySelector("svg")
    ).toHaveClass("size-3.5")
    expect(fileServiceMarker?.querySelector("svg")).toHaveClass("size-3.5")
    expect(
      toolCall.compareDocumentPosition(commentary) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      summary.compareDocumentPosition(finalReply) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await interaction.click(
      within(summary).getByRole("button", { name: "收起中间过程" })
    )
    expect(screen.queryByText("我正在检查项目配置")).toBeNull()
    expect(screen.queryByText("pnpm test")).toBeNull()
    expect(within(finalReply).getByText("配置检查完成")).toBeVisible()
  })

  it("groups only adjacent command executions in the turn timeline", async () => {
    const interaction = userEvent.setup()
    const onActivityDisclosureToggle = vi.fn()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "message-command-divider",
              role: "assistant",
              turn_id: "turn-1",
              item_id: "commentary-divider",
              phase: "commentary",
              event_sequence_no: 5,
              created_at: "2026-07-11T08:00:05.000Z",
              content: "开始下一阶段",
            },
            {
              id: "message-command-final",
              role: "assistant",
              turn_id: "turn-1",
              item_id: "agent-final",
              phase: "final_answer",
              event_sequence_no: 8,
              created_at: "2026-07-11T08:00:08.000Z",
              content: "命令执行完成",
            },
          ],
          events: [
            nativeLifecycleEvent({
              id: "command-completed-1",
              itemId: "command-1",
              sequence: 2,
              method: "item/completed",
              status: "completed",
              command: "pnpm test",
            }),
            nativeLifecycleEvent({
              id: "command-completed-2",
              itemId: "command-2",
              sequence: 3,
              method: "item/completed",
              status: "completed",
              command: "pnpm typecheck",
            }),
            nativeLifecycleEvent({
              id: "command-completed-3",
              itemId: "command-3",
              sequence: 4,
              method: "item/completed",
              status: "completed",
              command: "pnpm lint",
            }),
            nativeLifecycleEvent({
              id: "command-completed-4",
              itemId: "command-4",
              sequence: 6,
              method: "item/completed",
              status: "completed",
              command: "pnpm build",
            }),
            nativeLifecycleEvent({
              id: "command-completed-5",
              itemId: "command-5",
              sequence: 7,
              method: "item/completed",
              status: "completed",
              command: "git diff --check",
            }),
          ],
        }}
        onDownload={vi.fn()}
        onActivityDisclosureToggle={onActivityDisclosureToggle}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    expect(onActivityDisclosureToggle).toHaveBeenCalledTimes(1)

    expect(within(summary).getByText("开始下一阶段")).toBeVisible()
    expect(within(summary).getAllByText("运行了多个命令")).toHaveLength(2)
    expect(summary.querySelectorAll(".native-activity-item")).toHaveLength(2)
    expect(within(summary).queryByText("pnpm test")).toBeNull()

    const commandGroupTriggers = within(summary).getAllByRole("button", {
      name: "展开“运行了多个命令”的详情",
    })
    expect(commandGroupTriggers).toHaveLength(2)
    await interaction.click(commandGroupTriggers[0]!)

    expect(onActivityDisclosureToggle).toHaveBeenCalledTimes(2)
    expect(within(summary).getByText("pnpm test")).toBeVisible()
    expect(within(summary).getByText("pnpm typecheck")).toBeVisible()
    expect(within(summary).getByText("pnpm lint")).toBeVisible()
    expect(within(summary).queryByText("pnpm build")).toBeNull()
  })

  it("inserts current-turn guidance at its event position before the response it changed", () => {
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
      completed_at: null,
    }
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "commentary-before-guidance",
              role: "assistant",
              turn_id: "turn-1",
              phase: "commentary",
              event_sequence_no: 4,
              created_at: "2026-07-11T08:00:04.000Z",
              content: "我先核对需要删除的图片对象。",
            },
            {
              id: "guided-user-message",
              role: "user",
              turn_id: "turn-1",
              usage_type: "steer_current_turn",
              event_sequence_no: 6,
              created_at: "2026-07-11T08:00:06.000Z",
              content: "所有页面的这种图片都把它去掉",
            },
            {
              id: "commentary-after-guidance",
              role: "assistant",
              turn_id: "turn-1",
              phase: "commentary",
              event_sequence_no: 7,
              created_at: "2026-07-11T08:00:07.000Z",
              content: "收到，我把范围扩大到全部页面。",
              streaming: true,
            },
          ],
          turns: [runningTurn],
          running_turn: runningTurn,
          events: [
            nativeLifecycleEvent({
              id: "file-change-before-guidance",
              itemId: "file-change-1",
              sequence: 5,
              method: "item/completed",
              status: "completed",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const before = screen.getByText("我先核对需要删除的图片对象。")
    const tool = screen.getByText("运行了一个命令")
    const guidance = screen.getByText("所有页面的这种图片都把它去掉")
    const after = screen.getByText("收到，我把范围扩大到全部页面。")
    const guidanceMessage = guidance.closest("article")

    expect(guidanceMessage).toHaveAttribute("aria-label", "用户消息")
    expect(screen.getAllByRole("article", { name: "用户消息" })).toHaveLength(2)
    expect(
      before.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      tool.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      guidance.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(guidance.closest(".turn-guidance-message")).not.toBeNull()
  })

  it("keeps current-turn guidance visible once when completed activity is collapsed", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              id: "commentary-before-collapsed-guidance",
              role: "assistant",
              turn_id: "turn-1",
              phase: "commentary",
              event_sequence_no: 4,
              created_at: "2026-07-11T08:00:04.000Z",
              content: "正在核对全部页面。",
            },
            {
              id: "collapsed-guided-user-message",
              role: "user",
              turn_id: "turn-1",
              usage_type: "steer_current_turn",
              event_sequence_no: 5,
              created_at: "2026-07-11T08:00:05.000Z",
              content: "所有页面都按这个规则处理",
              attachments: [
                {
                  id: "guided-attachment-that-must-not-repeat",
                  name: "原始附件.pdf",
                  size: 1_024,
                  kind: "attachment",
                  status: "bound",
                  turn_id: "turn-1",
                  download_available: false,
                },
              ],
              selected_capabilities: [
                {
                  id: "skill-guided-repeat",
                  name: "不应重复的技能",
                  type: "skill",
                },
              ],
            },
            {
              id: "final-after-collapsed-guidance",
              role: "assistant",
              turn_id: "turn-1",
              phase: "final_answer",
              event_sequence_no: 6,
              created_at: "2026-07-11T08:00:06.000Z",
              content: "全部页面已经处理完成。",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(
      within(summary).getByRole("button", { name: "展开中间过程" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByText("所有页面都按这个规则处理")).toHaveLength(1)
    expect(screen.queryByText("正在核对全部页面。")).toBeNull()
    expect(screen.queryByText("原始附件.pdf")).toBeNull()
    expect(screen.queryByText("不应重复的技能")).toBeNull()
    expect(screen.getByText("全部页面已经处理完成。")).toBeVisible()

    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    expect(screen.getByText("正在核对全部页面。")).toBeVisible()
    expect(screen.getAllByText("所有页面都按这个规则处理")).toHaveLength(1)
    expect(screen.queryByText("原始附件.pdf")).toBeNull()
    expect(screen.queryByText("不应重复的技能")).toBeNull()
  })

  it("groups adjacent native tools into the Codex Desktop semantic sentence", async () => {
    const interaction = userEvent.setup()
    const skillAndExplorationCommand = {
      id: "semantic-thread-command-1",
      type: "commandExecution" as const,
      status: "completed" as const,
      commandActions: [
        {
          type: "read" as const,
          command: "sed -n '1,240p' $SKILL_ROOT/SKILL.md",
          name: "SKILL.md",
          path: "$SKILL_ROOT/SKILL.md",
        },
        {
          type: "read" as const,
          command: "sed -n '1,240p' $OTHER_SKILL_ROOT/SKILL.md",
        },
        {
          type: "read" as const,
          command: "sed -n '1,240p' apps/web/src/app.tsx",
          name: "app.tsx",
          path: "$WORKSPACE/apps/web/src/app.tsx",
        },
        {
          type: "listFiles" as const,
          command: "rg --files apps/web/src",
          path: "$WORKSPACE/apps/web/src",
        },
        {
          type: "search" as const,
          command: "rg TODO apps/web/src",
          query: "TODO",
          path: "$WORKSPACE/apps/web/src",
        },
        {
          type: "unknown" as const,
          command: "pnpm --filter @linksense/web test:unit",
        },
      ],
    } satisfies NativeCodexItem
    const fileChange = {
      id: "semantic-thread-file-change",
      type: "fileChange" as const,
      status: "completed" as const,
      changes: [
        {
          path: "$WORKSPACE/apps/web/src/app.tsx",
          kind: { type: "update" as const },
        },
        {
          path: "$WORKSPACE/apps/web/src/new-view.tsx",
          kind: { type: "add" as const },
        },
        {
          path: "$WORKSPACE/apps/web/src/new-view.tsx",
          kind: { type: "add" as const },
        },
      ],
    } satisfies NativeCodexItem
    const secondCommand = {
      id: "semantic-thread-command-2",
      type: "commandExecution" as const,
      status: "completed" as const,
      commandActions: [
        {
          type: "unknown" as const,
          command: "pnpm --filter @linksense/web typecheck",
        },
      ],
    } satisfies NativeCodexItem
    const webSearch = {
      id: "semantic-thread-web-search",
      type: "webSearch" as const,
      query: "Codex app-server schema",
      action: {
        type: "search" as const,
        query: "Codex app-server schema",
        queries: ["Codex app-server schema"],
      },
    } satisfies NativeCodexItem

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeItemLifecycleEvent({
              id: "semantic-thread-event-1",
              sequence: 2,
              item: skillAndExplorationCommand,
            }),
            nativeItemLifecycleEvent({
              id: "semantic-thread-event-2",
              sequence: 3,
              item: fileChange,
            }),
            nativeItemLifecycleEvent({
              id: "semantic-thread-event-3",
              sequence: 4,
              item: secondCommand,
            }),
            nativeItemLifecycleEvent({
              id: "semantic-thread-event-4",
              sequence: 5,
              item: webSearch,
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    const semanticSummary =
      "已加载工具 编辑了多个文件 读取文件 运行了多个命令 已搜索网页"
    expect(within(summary).getByText(semanticSummary)).toBeVisible()
    expect(summary.querySelectorAll(".native-activity-item")).toHaveLength(1)

    await interaction.click(
      within(summary).getByRole("button", {
        name: `展开“${semanticSummary}”的详情`,
      })
    )

    const fileDetails = within(summary).getByRole("list", {
      name: "文件变更详情",
    })
    expect(within(fileDetails).getAllByRole("listitem")).toHaveLength(2)
  })

  it("keeps a dynamic tool call in the adjacent Codex Desktop activity group", async () => {
    const interaction = userEvent.setup()
    const command = {
      id: "semantic-dynamic-command",
      type: "commandExecution" as const,
      status: "completed" as const,
      commandActions: [
        {
          type: "unknown" as const,
          command: "pnpm --filter @linksense/web typecheck",
        },
      ],
    } satisfies NativeCodexItem
    const dynamicTool = {
      id: "semantic-dynamic-tool",
      type: "dynamicToolCall" as const,
      namespace: "imagegen",
      tool: "render_image",
      status: "completed" as const,
      success: true,
    } satisfies NativeCodexItem

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeItemLifecycleEvent({
              id: "semantic-dynamic-event-1",
              sequence: 2,
              item: command,
            }),
            nativeItemLifecycleEvent({
              id: "semantic-dynamic-event-2",
              sequence: 3,
              item: dynamicTool,
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    expect(
      within(summary).getByText("运行了一个命令 imagegen · render_image")
    ).toBeVisible()
    expect(summary.querySelectorAll(".native-activity-item")).toHaveLength(1)
  })

  it("keeps a generic file-change title when an older event has no change preview", async () => {
    const interaction = userEvent.setup()
    const fileChangeWithoutPreview = {
      id: "legacy-file-change",
      type: "fileChange" as const,
      status: "completed" as const,
      changes: [],
    } satisfies NativeCodexItem

    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeItemLifecycleEvent({
              id: "legacy-file-change-event",
              sequence: 2,
              item: fileChangeWithoutPreview,
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    expect(within(summary).getByText("已更新文件")).toBeVisible()
    expect(summary.querySelectorAll(".native-activity-item")).toHaveLength(1)
  })

  it("renders native subagent transitions as grouped chips instead of raw protocol terms", async () => {
    const interaction = userEvent.setup()
    const onSubAgentSelect = vi.fn()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeCollabAgentEvent({
              id: "collab-spawned",
              sequence: 2,
              agents: [
                { agentKey: agentKeyA, status: "running" },
                { agentKey: agentKeyB, status: "running" },
              ],
            }),
            nativeSubAgentActivityEvent({
              id: "subagent-updated",
              sequence: 3,
              kind: "interacted",
              agentKey: agentKeyA,
              agentLabel: "前端站点链接",
            }),
            nativeCollabAgentEvent({
              id: "collab-completed",
              sequence: 4,
              agents: [
                { agentKey: agentKeyA, status: "completed" },
                { agentKey: agentKeyB, status: "completed" },
              ],
            }),
          ],
        }}
        onSubAgentSelect={onSubAgentSelect}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    expect(summary.querySelectorAll(".native-subagent-activity")).toHaveLength(
      1
    )
    expect(within(summary).getAllByText("前端站点链接")).toHaveLength(1)
    expect(within(summary).getAllByText("子智能体 2")).toHaveLength(1)
    expect(within(summary).queryByText("已开始工作")).toBeNull()
    expect(within(summary).queryByText("已更新")).toBeNull()
    expect(
      within(summary)
        .getAllByText("已完成")
        .every((status) => !status.classList.contains("shimmer"))
    ).toBe(true)
    expect(within(summary).getAllByText("已完成")).toHaveLength(1)
    expect(within(summary).queryByText("spawnAgent")).toBeNull()
    expect(within(summary).queryByText("interacted")).toBeNull()
    expect(within(summary).queryByText(agentKeyA)).toBeNull()

    await interaction.click(
      within(summary).getByRole("button", {
        name: "打开前端站点链接子智能体",
      })
    )
    expect(onSubAgentSelect).toHaveBeenCalledWith({
      turnId: "turn-1",
      agent: expect.objectContaining({
        id: agentKeyA,
        label: "前端站点链接",
      }),
    })
  })

  it("groups adjacent collaboration transitions into horizontal chip rows", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeCollabAgentEvent({
              id: "collab-spawn-all",
              sequence: 1,
              agents: [
                { agentKey: agentKeyA, status: "running" },
                { agentKey: agentKeyB, status: "running" },
                { agentKey: agentKeyC, status: "running" },
              ],
            }),
            nativeSubAgentActivityEvent({
              id: "agent-a-started",
              sequence: 2,
              kind: "started",
              agentKey: agentKeyA,
              agentLabel: "纽约概览",
            }),
            nativeSubAgentActivityEvent({
              id: "agent-b-started",
              sequence: 3,
              kind: "started",
              agentKey: agentKeyB,
              agentLabel: "纽约历史",
            }),
            nativeSubAgentActivityEvent({
              id: "agent-c-started",
              sequence: 4,
              kind: "started",
              agentKey: agentKeyC,
              agentLabel: "纽约旅行",
            }),
            nativeItemLifecycleEvent({
              id: "command-boundary",
              sequence: 5,
              item: {
                id: "command-boundary",
                type: "commandExecution",
                status: "completed",
                commandActions: [{ type: "read", command: "读取进度" }],
              },
            }),
            nativeCollabAgentEvent({
              id: "collab-a-completed",
              sequence: 6,
              tool: "wait",
              agents: [{ agentKey: agentKeyA, status: "completed" }],
            }),
            nativeCollabAgentEvent({
              id: "collab-b-completed",
              sequence: 7,
              tool: "wait",
              agents: [{ agentKey: agentKeyB, status: "completed" }],
            }),
            nativeCollabAgentEvent({
              id: "collab-c-completed",
              sequence: 8,
              tool: "wait",
              agents: [{ agentKey: agentKeyC, status: "completed" }],
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    const subAgentGroups = summary.querySelectorAll<HTMLElement>(
      ".native-subagent-activity-group"
    )
    expect(subAgentGroups).toHaveLength(2)
    for (const subAgentGroup of subAgentGroups) {
      expect(subAgentGroup).toHaveAttribute("data-subagent-count", "3")
      expect(
        subAgentGroup.querySelectorAll(".native-subagent-activity-segment")
      ).toHaveLength(3)
      expect(
        subAgentGroup.querySelectorAll(".native-subagent-agent")
      ).toHaveLength(3)
    }
    expect(within(subAgentGroups[0]!).getByText("已开始工作")).toBeVisible()
    expect(within(subAgentGroups[0]!).queryByText("已完成")).toBeNull()
    expect(within(subAgentGroups[1]!).getByText("已完成")).toBeVisible()
    expect(within(subAgentGroups[1]!).queryByText("已开始工作")).toBeNull()
    expect(
      subAgentGroups[0]!.querySelectorAll(
        '.native-subagent-agent-entry[data-subagent-status="started"]'
      )
    ).toHaveLength(3)
    expect(
      subAgentGroups[1]!.querySelectorAll(
        '.native-subagent-agent-entry[data-subagent-status="completed"]'
      )
    ).toHaveLength(3)
    expect(within(summary).queryByText("已协调子智能体")).toBeNull()
  })

  it("keeps an active child marker running after its parent turn completes", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeCollabAgentEvent({
              id: "collab-stuck-pending",
              sequence: 2,
              agents: [{ agentKey: agentKeyA, status: "pendingInit" }],
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    const marker = summary.querySelector(".native-subagent-activity")
    expect(within(summary).getByText("已开始工作")).not.toHaveClass("shimmer")
    expect(within(summary).queryByText("未完成")).toBeNull()
    expect(marker).toHaveAttribute("data-running", "true")
    expect(marker).toHaveAttribute("aria-busy", "true")
  })

  it("reconciles completed subagents and stops a dangling coordination marker", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          events: [
            nativeCollabAgentEvent({
              id: "collab-coordinator",
              sequence: 2,
              method: "item/started",
              status: "inProgress",
              agents: [],
            }),
            nativeCollabAgentEvent({
              id: "collab-agent-a",
              sequence: 3,
              agents: [{ agentKey: agentKeyA, status: "pendingInit" }],
            }),
            nativeCollabAgentEvent({
              id: "collab-agent-b",
              sequence: 4,
              agents: [{ agentKey: agentKeyB, status: "pendingInit" }],
            }),
            nativeCollabAgentEvent({
              id: "collab-agent-c",
              sequence: 5,
              agents: [{ agentKey: agentKeyC, status: "pendingInit" }],
            }),
            nativeCollabAgentEvent({
              id: "collab-agent-b-completed",
              sequence: 6,
              tool: "wait",
              agents: [{ agentKey: agentKeyB, status: "completed" }],
            }),
            nativeCollabAgentEvent({
              id: "collab-agent-c-completed",
              sequence: 7,
              tool: "wait",
              agents: [{ agentKey: agentKeyC, status: "completed" }],
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )

    expect(within(summary).queryByText("正在协调子智能体")).toBeNull()
    expect(within(summary).getByText("已协调子智能体")).not.toHaveClass(
      "shimmer"
    )
    expect(within(summary).queryByText("未完成")).toBeNull()
    expect(within(summary).getByText("已开始工作")).toBeVisible()
    expect(within(summary).queryByText("已完成")).toBeNull()
    expect(summary.querySelector(".native-subagent-status.shimmer")).toBeNull()
    expect(
      summary.querySelectorAll(
        '.native-subagent-agent-entry[data-subagent-status="completed"]'
      )
    ).toHaveLength(2)
    expect(
      summary.querySelectorAll(
        '.native-subagent-agent-entry[data-subagent-status="started"]'
      )
    ).toHaveLength(1)
  })

  it("filters persisted Codex reasoning summaries from the timeline", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          activities: [],
          events: [
            nativeReasoningEvent({
              id: "reasoning-started-1",
              itemId: "reasoning-1",
              sequence: 1,
              method: "item/started",
              summary: [],
            }),
            nativeReasoningEvent({
              id: "reasoning-completed-1",
              itemId: "reasoning-1",
              sequence: 2,
              method: "item/completed",
              summary: ["确认 Codex 原生事件字段"],
            }),
            nativeReasoningEvent({
              id: "reasoning-completed-2",
              itemId: "reasoning-2",
              sequence: 3,
              method: "item/completed",
              summary: ["复核安全展示边界"],
            }),
            nativeReasoningEvent({
              id: "reasoning-completed-legacy",
              itemId: "reasoning-legacy",
              sequence: 4,
              method: "item/completed",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).queryByText("确认 Codex 原生事件字段")).toBeNull()
    expect(within(summary).queryByText("复核安全展示边界")).toBeNull()
    expect(within(summary).queryByText("已完成分析和规划")).toBeNull()
    expect(within(summary).queryByText("思考内容")).toBeNull()
    expect(summary.querySelector(".reasoning-activity-row")).toBeNull()
  })

  it("renders an image artifact thumbnail once and opens the shared preview", async () => {
    const interaction = userEvent.setup()
    const imageArtifact = {
      id: "artifact-image-1",
      name: "小狗和可乐.png",
      mime_type: "image/png",
      size: 235_520,
      kind: "artifact" as const,
      turn_id: "turn-1",
      status: "available",
      created_at: "2026-07-14T10:44:00.000Z",
      download_available: true,
    }
    const loadArtifactPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/dog-and-cola.png",
      expiresAt: "2099-07-14T10:49:00.000Z",
    })
    const onDownload = vi.fn()
    const onPreviewOfficeDocument = vi.fn()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              ...completedConversation.messages![1]!,
              artifacts: [imageArtifact],
            },
          ],
          artifacts: [imageArtifact],
        }}
        loadArtifactPreview={loadArtifactPreview}
        onDownload={onDownload}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
      />
    )

    const thumbnail = await screen.findByRole("button", {
      name: "预览图片 小狗和可乐.png",
    })
    expect(loadArtifactPreview).toHaveBeenCalledTimes(1)
    expect(loadArtifactPreview).toHaveBeenCalledWith(
      imageArtifact,
      expect.any(AbortSignal)
    )
    const card = thumbnail.closest(".artifact-image-tile")
    expect(card).not.toBeNull()
    expect(
      within(card as HTMLElement).getByText("小狗和可乐.png")
    ).toBeVisible()
    expect(within(card as HTMLElement).getByText(/230\s*kB/u)).toBeVisible()
    expect(within(card as HTMLElement).queryByText(/2026-07-14/u)).toBeNull()
    expect(
      screen.getAllByRole("button", { name: "下载 小狗和可乐.png" })
    ).toHaveLength(1)

    await interaction.click(
      within(card as HTMLElement).getByText("小狗和可乐.png")
    )
    expect(onPreviewOfficeDocument).toHaveBeenCalledWith(imageArtifact)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(onDownload).not.toHaveBeenCalled()
  })

  it("renders a registered inline artifact inside Markdown without a duplicate artifact card", async () => {
    const interaction = userEvent.setup()
    const fileId = "30000000-0000-4000-8000-000000000001"
    const inlineImage = {
      id: fileId,
      name: "inline-image-1.png",
      mime_type: "image/png",
      size: 68,
      kind: "artifact" as const,
      turn_id: "turn-1",
      status: "available",
      created_at: "2026-07-14T10:44:00.000Z",
      download_available: true,
    }
    let resolvePreview:
      ((source: { url: string; expiresAt: string }) => void) | undefined
    const preview = new Promise<{
      url: string
      expiresAt: string
    }>((resolve) => {
      resolvePreview = resolve
    })
    const loadArtifactPreview = vi.fn().mockReturnValue(preview)
    const conversation = {
      ...completedConversation,
      messages: [
        completedConversation.messages![0]!,
        {
          ...completedConversation.messages![1]!,
          content: `生成结果：\n\n![风格参考](linksense-artifact:${fileId})`,
          artifacts: [inlineImage],
        },
      ],
      artifacts: [inlineImage],
    }
    const { rerender } = render(
      <ConversationThread
        conversation={conversation}
        loadArtifactPreview={loadArtifactPreview}
        onDownload={vi.fn()}
      />
    )

    const placeholder = screen.getByRole("status", {
      name: "正在加载图片 风格参考",
    })
    expect(placeholder).toHaveClass(
      "assistant-inline-image-placeholder",
      "assistant-inline-image-thumbnail-placeholder"
    )
    expect(placeholder).toHaveTextContent("")

    await act(async () =>
      resolvePreview?.({
        url: "https://files.example.test/inline-image.png",
        expiresAt: "2099-07-14T10:49:00.000Z",
      })
    )

    const image = await screen.findByRole("img", { name: "风格参考" })
    expect(image).toHaveAttribute(
      "src",
      "https://files.example.test/inline-image.png"
    )
    expect(loadArtifactPreview).toHaveBeenCalledOnce()
    expect(loadArtifactPreview).toHaveBeenCalledWith(
      inlineImage,
      expect.any(AbortSignal)
    )
    expect(
      screen.queryByRole("button", { name: "下载 inline-image-1.png" })
    ).toBeNull()

    const previewButton = screen.getByRole("button", {
      name: "预览图片 风格参考",
    })
    expect(previewButton).toHaveClass("conversation-image-thumbnail-trigger")

    await interaction.click(previewButton)
    expect(
      await within(screen.getByRole("dialog")).findByRole("img", {
        name: "风格参考",
      })
    ).toHaveAttribute("src", "https://files.example.test/inline-image.png")

    rerender(
      <ConversationThread
        conversation={{
          ...conversation,
          messages: conversation.messages.map((message) => ({
            ...message,
            artifacts: message.artifacts?.map((artifact) => ({
              ...artifact,
            })),
          })),
          artifacts: conversation.artifacts.map((artifact) => ({
            ...artifact,
          })),
        }}
        loadArtifactPreview={loadArtifactPreview}
        onDownload={vi.fn()}
      />
    )
    await act(async () => Promise.resolve())
    expect(loadArtifactPreview).toHaveBeenCalledOnce()
  })

  it("renders a projected image-view artifact without a duplicate download card", async () => {
    const interaction = userEvent.setup()
    const fileId = "30000000-0000-4000-8000-000000000003"
    const viewedImage = {
      id: fileId,
      name: "contact.png",
      mime_type: "image/png",
      size: 2_048,
      kind: "artifact" as const,
      turn_id: "turn-1",
      status: "available",
      created_at: "2026-07-14T10:44:00.000Z",
      download_available: true,
    }
    const loadArtifactPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/contact.png",
      expiresAt: "2099-07-14T10:49:00.000Z",
    })
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          artifacts: [viewedImage],
          events: [
            nativeItemLifecycleEvent({
              id: "event-image-view-1",
              sequence: 2,
              item: {
                id: "image-view-1",
                type: "imageView",
                path: "$WORKSPACE/temp/pdfs/contact.png",
                fileId,
              },
            }),
          ],
        }}
        loadArtifactPreview={loadArtifactPreview}
        onDownload={vi.fn()}
      />
    )

    const summary = screen.getByTestId("turn-summary-turn-1")
    await interaction.click(
      within(summary).getByRole("button", { name: "展开中间过程" })
    )
    await interaction.click(
      within(summary).getByRole("button", {
        name: "展开“已查看图像”的详情",
      })
    )

    expect(
      await within(summary).findByRole("img", { name: "contact.png" })
    ).toHaveAttribute("src", "https://files.example.test/contact.png")
    expect(loadArtifactPreview).toHaveBeenCalledWith(
      viewedImage,
      expect.any(AbortSignal)
    )
    expect(
      screen.queryByRole("button", { name: "下载 contact.png" })
    ).toBeNull()
  })

  it("blocks historical runner-local image paths instead of requesting them", async () => {
    const loadArtifactPreview = vi.fn()
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            completedConversation.messages![0]!,
            {
              ...completedConversation.messages![1]!,
              content:
                "旧消息：\n\n![风格参考](/data/linksense/codex-homes/private/.agents/skills/presentations/assets/theme.png)",
            },
          ],
        }}
        loadArtifactPreview={loadArtifactPreview}
        onDownload={vi.fn()}
      />
    )

    expect(await screen.findByText("无法预览图片 风格参考")).toBeVisible()
    expect(document.querySelector('img[src^="/data/linksense/"]')).toBeNull()
    expect(loadArtifactPreview).not.toHaveBeenCalled()
  })

  it.each([
    [
      "the turn summary before a final answer",
      {
        ...completedConversation,
        messages: [completedConversation.messages![0]!],
        turns: [
          {
            id: "turn-1",
            status: "running" as const,
            started_at: "2026-07-11T08:00:00.000Z",
          },
        ],
        running_turn: {
          id: "turn-1",
          status: "running" as const,
          started_at: "2026-07-11T08:00:00.000Z",
        },
      },
      "turn-1",
    ],
    ["the conversation fallback area", completedConversation, null],
  ])("renders image artifacts in %s", async (_label, source, turnId) => {
    const imageArtifact = {
      id: `artifact-image-${turnId ?? "orphan"}`,
      name: `preview-${turnId ?? "orphan"}.png`,
      mime_type: "image/png",
      size: 1_024,
      kind: "artifact" as const,
      turn_id: turnId,
      download_available: true,
    }
    const loadArtifactPreview = vi.fn().mockResolvedValue({
      url: `https://files.example.test/${imageArtifact.name}`,
      expiresAt: "2099-07-14T10:49:00.000Z",
    })

    render(
      <ConversationThread
        conversation={{ ...source, artifacts: [imageArtifact] }}
        loadArtifactPreview={loadArtifactPreview}
        onDownload={vi.fn()}
      />
    )

    expect(
      await screen.findByRole("button", {
        name: `预览图片 ${imageArtifact.name}`,
      })
    ).toBeVisible()
    expect(loadArtifactPreview).toHaveBeenCalledOnce()
  })

  it("keeps an expanded native item open when commentary arrives and the item completes", async () => {
    const interaction = userEvent.setup()
    const runningTurn = {
      id: "turn-1",
      status: "running" as const,
      started_at: "2026-07-11T08:00:00.000Z",
    }
    const runningConversation: Conversation = {
      ...completedConversation,
      messages: [completedConversation.messages![0]!],
      turns: [runningTurn],
      running_turn: runningTurn,
      activities: [],
      events: [
        nativeLifecycleEvent({
          id: "event-command-started-stable",
          sequence: 3,
          method: "item/started",
          status: "inProgress",
          command: "pnpm test",
        }),
      ],
    }
    const { rerender } = render(
      <ConversationThread
        conversation={runningConversation}
        onDownload={vi.fn()}
      />
    )

    await interaction.click(
      screen.getByRole("button", {
        name: "展开“正在运行一个命令”的详情",
      })
    )
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()

    const runningWithCommentary: Conversation = {
      ...runningConversation,
      messages: [
        completedConversation.messages![0]!,
        {
          id: "message-streamed-commentary",
          role: "assistant",
          turn_id: "turn-1",
          item_id: "agent-commentary",
          phase: "commentary",
          event_sequence_no: 4,
          created_at: "2026-07-11T08:00:04.000Z",
          content: "正在执行测试",
          streaming: true,
        },
      ],
    }
    rerender(
      <ConversationThread
        conversation={runningWithCommentary}
        onDownload={vi.fn()}
      />
    )

    const runningCommentary = screen
      .getByText("正在执行测试")
      .closest(".process-commentary")
    expect(runningCommentary).toBeVisible()
    expect(runningCommentary).toHaveAttribute("data-running", "true")
    expect(
      screen.getByRole("button", {
        name: "收起“正在运行一个命令”的详情",
      })
    ).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()

    rerender(
      <ConversationThread
        conversation={{
          ...runningWithCommentary,
          turns: [
            {
              ...runningTurn,
              status: "completed",
              completed_at: "2026-07-11T08:00:03.000Z",
            },
          ],
          running_turn: null,
          events: [
            nativeLifecycleEvent({
              id: "event-command-completed-stable",
              sequence: 4,
              method: "item/completed",
              status: "completed",
              command: "pnpm test",
            }),
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      screen.getByRole("button", {
        name: "收起“运行了一个命令”的详情",
      })
    ).toHaveAttribute("aria-expanded", "true")
    const completedActivity = screen
      .getByText("运行了一个命令", {
        selector: ".native-activity-summary > span",
      })
      .closest(".native-activity-item")
    expect(completedActivity).not.toHaveAttribute("data-running")
    expect(
      screen
        .getByText("运行了一个命令", {
          selector: ".native-activity-summary > span",
        })
        .closest(".native-activity-summary")
    ).not.toHaveClass("shimmer")
    expect(
      screen.getByText("正在执行测试").closest(".process-commentary")
    ).not.toHaveAttribute("data-running")
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()
  })

  it("uses an unbranded English elapsed-time label without invalid text", async () => {
    await i18n.changeLanguage("en-US")
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          turns: [
            {
              id: "turn-1",
              status: "completed",
              started_at: "invalid",
              completed_at: "2026-07-11T08:00:03.250Z",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(
      screen.getByRole("article", { name: "Assistant response" })
    ).toBeVisible()
    expect(screen.getByText("Took", { exact: true })).toBeVisible()
    expect(screen.queryByText(/NaN|-/u)).toBeNull()
    expect(screen.queryByText("LinkSense", { exact: true })).toBeNull()
  })

  it("folds long manual and application messages and copies the complete content while collapsed", async () => {
    const interaction = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue()
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = getComputedStyle(element)
      Object.defineProperty(style, "lineHeight", {
        configurable: true,
        value: "24px",
      })
      return style
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 300, height: 384 })
    )
    const applicationContent = "完整应用研究要求\n".repeat(20).trimEnd()
    const manualContent = "完整手动输入要求\n".repeat(20).trimEnd()
    const completedUserMessage = completedConversation.messages?.find(
      (message) => message.role === "user"
    )
    const completedAssistantMessage = completedConversation.messages?.find(
      (message) => message.role === "assistant"
    )
    if (!completedUserMessage || !completedAssistantMessage) {
      throw new Error("Expected the completed conversation fixture messages")
    }
    const applicationMessage = {
      id: "application-message",
      role: "user" as const,
      turn_id: "turn-1",
      content: applicationContent,
      display: {
        kind: "interactive_application" as const,
        application_id: "20000000-0000-4000-8000-000000000001",
      },
    }
    const view = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            applicationMessage,
            {
              ...completedUserMessage,
              content: manualContent,
            },
            completedAssistantMessage,
          ],
        }}
        onDownload={vi.fn()}
      />
    )
    expect(screen.getAllByRole("button", { name: "显示更多" })).toHaveLength(2)
    const [appMessage, manualMessage] = screen.getAllByRole("article", {
      name: "用户消息",
    })
    expect(
      within(manualMessage!).getByRole("button", { name: "显示更多" })
    ).toBeVisible()
    await interaction.click(
      within(appMessage!).getByRole("button", { name: "复制消息" })
    )
    expect(writeText).toHaveBeenLastCalledWith(applicationContent)
    await interaction.click(
      within(appMessage!).getByRole("button", { name: "显示更多" })
    )
    view.rerender(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            { ...applicationMessage },
            {
              ...completedUserMessage,
              content: manualContent,
            },
            completedAssistantMessage,
          ],
        }}
        onDownload={vi.fn()}
      />
    )
    expect(
      within(appMessage!).getByRole("button", { name: "收起" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("exposes role-specific message actions and copies either message", async () => {
    const interaction = userEvent.setup()
    const execCommand = mockExecCommand(true)
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue()
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onRegenerateMessage={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const assistantMessage = screen.getByRole("article", { name: "助手回复" })
    const userActions = userMessage.querySelector(".message-actions")
    const assistantActions = assistantMessage.querySelector(".message-actions")

    expect(userActions).not.toBeNull()
    expect(assistantActions).not.toBeNull()
    expect(within(userMessage).getByText("15:47").tagName).toBe("TIME")
    expect(within(assistantMessage).getByText("15:54").tagName).toBe("TIME")
    const editButton = within(userMessage).getByRole("button", {
      name: "编辑消息",
    })
    expect(editButton).toBeVisible()
    expect(
      within(assistantMessage).queryByRole("button", { name: "编辑消息" })
    ).toBeNull()
    const copyButton = within(userMessage).getByRole("button", {
      name: "复制消息",
    })
    expect(copyButton).toHaveClass("message-copy-button")
    expect(copyButton.querySelector("svg")).toHaveClass("size-3")
    expect(copyButton.querySelector("svg")).toHaveAttribute(
      "stroke-width",
      "1.5"
    )
    expect(editButton.querySelector("svg")).toHaveClass("size-3")
    expect(editButton.querySelector("svg")).toHaveAttribute(
      "stroke-width",
      "1.5"
    )
    expect(userActions?.children[0]).toHaveTextContent("15:47")
    expect(assistantActions?.children[1]).toHaveTextContent("15:54")
    expect(
      within(userMessage).queryByLabelText(/使用模型/u)
    ).not.toBeInTheDocument()

    await interaction.click(
      within(userMessage).getByRole("button", { name: "复制消息" })
    )
    expect(writeText).toHaveBeenLastCalledWith("请给出处理结果")
    expect(execCommand).not.toHaveBeenCalled()
    expect(
      within(userMessage).getByRole("button", { name: "消息已复制" })
    ).toBeVisible()
    expect(
      within(userMessage)
        .getByRole("button", { name: "消息已复制" })
        .querySelector("svg")
    ).toHaveAttribute("stroke-width", "1.5")

    await interaction.click(
      within(assistantMessage).getByRole("button", { name: "复制消息" })
    )
    expect(writeText).toHaveBeenLastCalledWith(
      completedConversation.messages![1]!.content
    )
    expect(execCommand).not.toHaveBeenCalled()
  })

  it("shows assistant action names immediately without tooltip arrows", () => {
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onForkMessage={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const assistantMessage = screen.getByRole("article", { name: "助手回复" })
    const copyButton = within(assistantMessage).getByRole("button", {
      name: "复制消息",
    })
    const forkButton = within(assistantMessage).getByRole("button", {
      name: "分支到新聊天",
    })

    expect(copyButton).not.toHaveAttribute("title")
    expect(forkButton).not.toHaveAttribute("title")

    fireEvent.pointerEnter(copyButton, { pointerType: "mouse" })
    fireEvent.mouseEnter(copyButton)
    fireEvent.mouseMove(copyButton, { movementX: 3, movementY: 0 })
    const copyTooltip = screen.getByRole("tooltip")
    expect(copyTooltip).toHaveTextContent("复制消息")
    expect(copyTooltip).toHaveClass(
      "rounded-md",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "font-medium",
      "text-[var(--app-text)]"
    )
    expect(copyTooltip).not.toHaveClass("rounded-full", "rounded-xl")

    fireEvent.pointerLeave(copyButton, { pointerType: "mouse" })
    fireEvent.mouseLeave(copyButton)
    fireEvent.pointerEnter(forkButton, { pointerType: "mouse" })
    fireEvent.mouseEnter(forkButton)
    fireEvent.mouseMove(forkButton, { movementX: 3, movementY: 0 })
    const forkTooltip = screen.getByRole("tooltip")
    expect(forkTooltip).toHaveTextContent("分支到新聊天")
    expect(forkTooltip).toHaveClass(
      "rounded-md",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "font-medium",
      "text-[var(--app-text)]"
    )
    expect(forkTooltip).not.toHaveClass("rounded-full", "rounded-xl")
    expect(document.querySelector(".rotate-45")).not.toBeInTheDocument()
  })

  it("separates a new user turn after more than two hours of inactivity", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T12:00:00"))
    const nextUserMessage = {
      id: "message-user-2",
      role: "user" as const,
      turn_id: "turn-2",
      content: "继续处理",
      created_at: "2026-07-11T10:15:00.001",
    }
    const conversation: Conversation = {
      ...completedConversation,
      messages: [
        {
          ...completedConversation.messages![0]!,
          created_at: "2026-07-11T08:00:00",
        },
        {
          ...completedConversation.messages![1]!,
          created_at: "2026-07-11T08:15:00",
        },
        nextUserMessage,
        {
          id: "message-assistant-2",
          role: "assistant",
          turn_id: "turn-2",
          content: "已继续处理",
          created_at: "2026-07-11T10:16:00",
        },
      ],
      turns: [
        ...completedConversation.turns!,
        {
          id: "turn-2",
          status: "completed",
          started_at: nextUserMessage.created_at,
          completed_at: "2026-07-11T10:16:00",
        },
      ],
    }

    render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )

    const separator = screen.getByRole("separator", {
      name: "消息时间：2026年7月11日，10:15",
    })
    const nextUserMessageArticle = screen
      .getByText("继续处理")
      .closest("article")
    expect(separator).toHaveTextContent("今天 10:15")
    expect(
      separator.compareDocumentPosition(nextUserMessageArticle!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("does not separate a long-running turn from its assistant reply", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            {
              ...completedConversation.messages![0]!,
              created_at: "2026-07-11T08:00:00",
            },
            {
              ...completedConversation.messages![1]!,
              created_at: "2026-07-11T11:00:01",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )

    expect(screen.queryByRole("separator")).toBeNull()
  })

  it("shows a completed Goal marker below the final assistant reply", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          goal: {
            thread_id: "codex-thread-goal",
            objective: "帮我写一篇介绍美国的文章",
            status: "complete",
            token_budget: null,
            tokens_used: 1_280,
            time_used_seconds: 30,
            created_at: "2026-07-11T08:00:00.000Z",
            updated_at: "2026-07-11T08:00:30.000Z",
          },
        }}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const assistantMessage = screen.getByRole("article", { name: "助手回复" })
    const completionLabel =
      within(assistantMessage).getByText("已在 30s 内达成目标")
    const completion = completionLabel.closest(".message-goal-completion")

    expect(completion).not.toBeNull()
    expect(completion?.closest(".message-actions")).toBe(
      assistantMessage.querySelector(".message-actions")
    )
    expect(userMessage.querySelector(".message-goal-completion")).toBeNull()
    expect(completion?.querySelector("svg")).toHaveClass(
      "message-goal-completion-icon"
    )
    expect(completion?.querySelector("svg")).toHaveAttribute(
      "stroke-width",
      "1.5"
    )
    expect(completion?.querySelector("circle")).not.toBeNull()
  })

  it("shows the turn model name after the message time and falls back to its id", () => {
    const conversationWithModel: Conversation = {
      ...completedConversation,
      turns: completedConversation.turns?.map((turn) => ({
        ...turn,
        model: "gpt-5.6-sol",
      })),
    }
    const { rerender } = render(
      <ConversationThread
        conversation={conversationWithModel}
        modelCatalog={[
          {
            id: "gpt-5.6-sol",
            display_name: "5.6 Sol",
            enabled: true,
            context_window: null,
            supported_reasoning_efforts: ["medium"],
            default_reasoning_effort: "medium",
          },
        ]}
        onDownload={vi.fn()}
      />
    )

    for (const articleName of ["用户消息", "助手回复"]) {
      const message = screen.getByRole("article", { name: articleName })
      const time = within(message).getByText(
        articleName === "用户消息" ? "15:47" : "15:54"
      )
      const model = within(message).getByText("5.6 Sol")

      expect(model).toHaveClass("message-action-model")
      expect(model).toHaveAccessibleName("使用模型 5.6 Sol")
      expect(time.nextElementSibling).toBe(model)
      expect(model.closest(".message-actions")).not.toBeNull()
    }

    rerender(
      <ConversationThread
        conversation={{
          ...conversationWithModel,
          turns: conversationWithModel.turns?.map((turn) => ({
            ...turn,
            model: "retired-model",
          })),
        }}
        modelCatalog={[]}
        onDownload={vi.fn()}
      />
    )

    for (const articleName of ["用户消息", "助手回复"]) {
      expect(
        within(screen.getByRole("article", { name: articleName })).getByText(
          "retired-model"
        )
      ).toHaveAccessibleName("使用模型 retired-model")
    }
  })

  it("shows a persisted model-change marker before the next turn's first user message", () => {
    const conversationWithModelChange: Conversation = {
      ...completedConversation,
      messages: [
        ...completedConversation.messages!,
        {
          id: "message-user-2",
          role: "user",
          turn_id: "turn-2",
          content: "继续处理",
          created_at: "2026-07-11T15:55:00",
        },
        {
          id: "message-assistant-2",
          role: "assistant",
          turn_id: "turn-2",
          content: "已继续处理",
          created_at: "2026-07-11T15:56:00",
        },
      ],
      turns: [
        {
          ...completedConversation.turns![0]!,
          model: "gpt-5.6-sol",
        },
        {
          id: "turn-2",
          status: "completed",
          model: "gpt-5.6-terra",
          started_at: "2026-07-11T08:05:00.000Z",
          completed_at: "2026-07-11T08:06:00.000Z",
        },
      ],
    }
    const modelCatalog = [
      {
        id: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        enabled: true,
        context_window: null,
        supported_reasoning_efforts: ["medium" as const],
        default_reasoning_effort: "medium" as const,
      },
      {
        id: "gpt-5.6-terra",
        display_name: "GPT-5.6 Terra",
        enabled: true,
        context_window: null,
        supported_reasoning_efforts: ["medium" as const],
        default_reasoning_effort: "medium" as const,
      },
    ]
    const { rerender } = render(
      <ConversationThread
        conversation={conversationWithModelChange}
        modelCatalog={modelCatalog}
        onDownload={vi.fn()}
      />
    )

    const marker = screen.getByRole("note", {
      name: "模型已从 GPT-5.6 Sol 更改为 GPT-5.6 Terra。",
    })
    const nextUserMessage = screen.getByText("继续处理").closest("article")

    expect(marker).toHaveTextContent(
      "模型已从 GPT-5.6 Sol 更改为 GPT-5.6 Terra。"
    )
    expect(
      within(marker).getByText("模型已从 GPT-5.6 Sol 更改为 GPT-5.6 Terra。")
    ).toHaveClass(
      "flex",
      "min-h-4",
      "items-center",
      "text-[length:var(--app-font-13)]",
      "leading-none",
      "text-muted-foreground/70"
    )
    const icon = marker.querySelector("svg")
    expect(icon).not.toBeNull()
    expect(icon).toHaveClass("size-[15px]")
    expect(nextUserMessage).not.toBeNull()
    expect(
      marker.compareDocumentPosition(nextUserMessage!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    rerender(
      <ConversationThread
        conversation={{
          ...conversationWithModelChange,
          turns: conversationWithModelChange.turns?.map((turn) => ({
            ...turn,
            model: "gpt-5.6-sol",
          })),
        }}
        modelCatalog={modelCatalog}
        onDownload={vi.fn()}
      />
    )

    expect(screen.queryByRole("note")).not.toBeInTheDocument()
  })

  it("falls back to a temporary DOM selection and restores focus and selection", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new DOMException("Not allowed", "NotAllowedError")
    )
    const execCommand = mockExecCommand(true)
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const copyButton = within(userMessage).getByRole("button", {
      name: "复制消息",
    })
    const messageText = within(userMessage).getByText("请给出处理结果")
    const range = document.createRange()
    range.selectNodeContents(messageText)
    copyButton.focus()
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.click(copyButton)

    expect(
      await within(userMessage).findByRole("button", { name: "消息已复制" })
    ).toBeVisible()
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(document.querySelector(".clipboard-copy-fallback")).toBeNull()
    expect(document.activeElement).toBe(copyButton)
    expect(window.getSelection()?.toString()).toBe("请给出处理结果")
  })

  it("reports a copy error when both clipboard paths fail and still cleans up", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new DOMException("Not allowed", "NotAllowedError")
    )
    const execCommand = mockExecCommand(false)
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    const copyButton = within(userMessage).getByRole("button", {
      name: "复制消息",
    })
    copyButton.focus()
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(within(userMessage).getByRole("alert")).toHaveTextContent(
        "无法复制消息，请重试。"
      )
    })
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(document.querySelector(".clipboard-copy-fallback")).toBeNull()
    expect(document.activeElement).toBe(copyButton)
  })

  it("edits a user message in place and sends non-blank content", async () => {
    const interaction = userEvent.setup()
    const onRegenerateMessage = vi.fn().mockResolvedValue(undefined)
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onRegenerateMessage={onRegenerateMessage}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )

    const textbox = within(userMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    const send = within(userMessage).getByRole("button", { name: "发送" })
    expect(userMessage).toHaveClass("message-row-user", "message-row-editing")
    expect(textbox).toHaveClass("message-edit-textarea")
    expect(textbox).toHaveValue("请给出处理结果")
    expect(send).toBeEnabled()

    await interaction.click(send)

    await waitFor(() => {
      expect(onRegenerateMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "message-user-1" }),
        "请给出处理结果"
      )
    })
    expect(within(userMessage).queryByRole("textbox")).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(userMessage).getByRole("button", { name: "编辑消息" })
      )
    })

    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const updatedTextbox = within(userMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    const updatedSend = within(userMessage).getByRole("button", {
      name: "发送",
    })

    await interaction.clear(updatedTextbox)
    expect(updatedSend).toBeDisabled()
    await interaction.type(updatedTextbox, "请给出新的处理结果")
    expect(updatedSend).toBeEnabled()
    await interaction.click(updatedSend)

    expect(onRegenerateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-user-1" }),
      "请给出新的处理结果"
    )
    expect(within(userMessage).queryByRole("textbox")).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(userMessage).getByRole("button", { name: "编辑消息" })
      )
    })

    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    await interaction.type(
      within(userMessage).getByRole("textbox"),
      "，这次不发送"
    )
    await interaction.click(
      within(userMessage).getByRole("button", { name: "取消" })
    )
    expect(within(userMessage).queryByRole("textbox")).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(userMessage).getByRole("button", { name: "编辑消息" })
      )
    })
    expect(onRegenerateMessage).toHaveBeenCalledTimes(2)
  })

  it("supports Escape, Enter, and Shift+Enter while restoring edit focus", async () => {
    const interaction = userEvent.setup()
    const onRegenerateMessage = vi.fn().mockResolvedValue(undefined)
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onRegenerateMessage={onRegenerateMessage}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const firstTextbox = within(userMessage).getByRole(
      "textbox"
    ) as HTMLTextAreaElement
    expect(firstTextbox).not.toHaveFocus()
    await interaction.click(firstTextbox)
    await interaction.keyboard("{Shift>}{Enter}{/Shift}")
    expect(firstTextbox.value).toContain("\n")
    expect(firstTextbox.value.replace("\n", "")).toBe("请给出处理结果")
    expect(onRegenerateMessage).not.toHaveBeenCalled()

    await interaction.keyboard("{Escape}")
    expect(within(userMessage).queryByRole("textbox")).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(userMessage).getByRole("button", { name: "编辑消息" })
      )
    })

    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const secondTextbox = within(userMessage).getByRole("textbox")
    await interaction.clear(secondTextbox)
    await interaction.type(secondTextbox, "按回车重新生成")
    await interaction.keyboard("{Enter}")

    expect(onRegenerateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-user-1" }),
      "按回车重新生成"
    )
    expect(within(userMessage).queryByRole("textbox")).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(userMessage).getByRole("button", { name: "编辑消息" })
      )
    })
  })

  it("closes the editor and displays the edited message before regeneration is accepted", async () => {
    const interaction = userEvent.setup()
    let resolveRegeneration: (() => void) | undefined
    const onRegenerateMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRegeneration = resolve
        })
    )
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onRegenerateMessage={onRegenerateMessage}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const textbox = within(userMessage).getByRole("textbox")
    await interaction.clear(textbox)
    await interaction.type(textbox, "立即显示的编辑内容")
    await interaction.click(
      within(userMessage).getByRole("button", { name: "发送" })
    )

    expect(within(userMessage).queryByRole("textbox")).toBeNull()
    expect(within(userMessage).getByText("立即显示的编辑内容")).toBeVisible()
    expect(
      within(userMessage).queryByRole("button", { name: "正在发送" })
    ).toBeNull()

    await act(async () => resolveRegeneration?.())
  })

  it("keeps the edited content available when regeneration fails", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onRegenerateMessage={vi.fn().mockRejectedValue(new Error("offline"))}
      />
    )

    const userMessage = screen.getByRole("article", { name: "用户消息" })
    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const textbox = within(userMessage).getByRole("textbox")
    await interaction.clear(textbox)
    await interaction.type(textbox, "失败后保留的内容")
    await interaction.click(
      within(userMessage).getByRole("button", { name: "发送" })
    )

    expect(await within(userMessage).findByRole("alert")).toHaveTextContent(
      "重新生成失败，请重试。"
    )
    expect(textbox).toHaveValue("失败后保留的内容")
    expect(textbox).toBeEnabled()
  })

  it("does not offer editing while a turn is running or editing is disabled", () => {
    const onRegenerateMessage = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          turns: [
            {
              id: "turn-1",
              status: "running",
              started_at: "2026-07-11T08:00:00.000Z",
              completed_at: null,
            },
          ],
          running_turn: {
            id: "turn-1",
            status: "running",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: null,
          },
        }}
        onDownload={vi.fn()}
        onRegenerateMessage={onRegenerateMessage}
      />
    )

    expect(screen.queryByRole("button", { name: "编辑消息" })).toBeNull()

    rerender(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        onRegenerateMessage={onRegenerateMessage}
        editingDisabled
      />
    )
    expect(screen.queryByRole("button", { name: "编辑消息" })).toBeNull()
    expect(screen.getAllByRole("button", { name: "复制消息" })).toHaveLength(2)
  })

  it("reveals and focuses a blocking panel when its identity changes", async () => {
    const onBlockingPanelReveal = vi.fn()
    const blockingPanel = (label: string) => (
      <section role="region" aria-label={label} tabIndex={-1}>
        {label}
      </section>
    )
    const { rerender } = render(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        blockingPanel={blockingPanel("确认计划")}
        blockingPanelKey="plan-review:1"
        onBlockingPanelReveal={onBlockingPanelReveal}
      />
    )

    await waitFor(() => {
      expect(onBlockingPanelReveal).toHaveBeenCalledOnce()
      expect(screen.getByRole("region", { name: "确认计划" })).toHaveFocus()
    })

    rerender(
      <ConversationThread
        conversation={completedConversation}
        onDownload={vi.fn()}
        blockingPanel={blockingPanel("确认问题")}
        blockingPanelKey="user-input:2"
        onBlockingPanelReveal={onBlockingPanelReveal}
      />
    )

    await waitFor(() => {
      expect(onBlockingPanelReveal).toHaveBeenCalledTimes(2)
      expect(screen.getByRole("region", { name: "确认问题" })).toHaveFocus()
    })
    expect(screen.getByRole("log")).toContainElement(
      screen.getByTestId("conversation-blocking-panel")
    )
  })

  it("only offers editing for the primary user message of the latest terminal turn", () => {
    render(
      <ConversationThread
        conversation={{
          ...completedConversation,
          messages: [
            ...completedConversation.messages!,
            {
              id: "message-user-2",
              role: "user",
              turn_id: "turn-2",
              created_at: "2026-07-11T08:01:00.000Z",
              content: "请继续补充",
            },
            {
              id: "message-assistant-2",
              role: "assistant",
              turn_id: "turn-2",
              created_at: "2026-07-11T08:01:02.000Z",
              content: "补充完成",
            },
          ],
          turns: [
            ...completedConversation.turns!,
            {
              id: "turn-2",
              status: "completed",
              started_at: "2026-07-11T08:01:00.000Z",
              completed_at: "2026-07-11T08:01:02.000Z",
            },
          ],
        }}
        onDownload={vi.fn()}
        onRegenerateMessage={vi.fn().mockResolvedValue(undefined)}
      />
    )

    const userMessages = screen.getAllByRole("article", { name: "用户消息" })
    expect(
      within(userMessages[0]!).queryByRole("button", { name: "编辑消息" })
    ).toBeNull()
    expect(
      within(userMessages[1]!).getByRole("button", { name: "编辑消息" })
    ).toBeVisible()
  })
})

function nativeLifecycleEvent({
  id,
  itemId = "command-1",
  sequence,
  method,
  status,
  command = "pnpm test",
}: {
  id: string
  itemId?: string
  sequence: number
  method: "item/started" | "item/completed"
  status: string
  command?: string
}) {
  return {
    id,
    type: method,
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:0${sequence}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: itemId,
          type: "commandExecution",
          status,
          commandActions: command
            ? [{ type: "unknown" as const, command }]
            : [],
          ...(command ? { command } : {}),
        },
      },
    },
  }
}

function nativeItemLifecycleEvent({
  id,
  sequence,
  item,
  method = "item/completed",
}: {
  id: string
  sequence: number
  item: NativeCodexItem
  method?: "item/started" | "item/completed"
}) {
  return {
    id,
    type: method,
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:0${sequence}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item,
      },
    },
  }
}

function nativeReasoningEvent({
  id,
  itemId,
  sequence,
  method,
  summary,
}: {
  id: string
  itemId: string
  sequence: number
  method: "item/started" | "item/completed"
  summary?: string[]
}) {
  return {
    id,
    type: method,
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:0${sequence}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: itemId,
          type: "reasoning" as const,
          ...(summary ? { summary } : {}),
        },
      },
    },
  }
}

function nativeCollabAgentEvent({
  id,
  sequence,
  agents,
  method = "item/completed",
  status = "completed",
  tool = "spawnAgent",
}: {
  id: string
  sequence: number
  method?: "item/started" | "item/completed"
  status?: "inProgress" | "completed" | "failed"
  tool?: "spawnAgent" | "sendInput" | "wait" | "closeAgent"
  agents: Array<{
    agentKey: string
    status:
      | "pendingInit"
      | "running"
      | "interrupted"
      | "completed"
      | "errored"
      | "shutdown"
      | "notFound"
  }>
}) {
  return {
    id,
    type: method,
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id,
          type: "collabAgentToolCall" as const,
          tool,
          status,
          agents,
        },
      },
    },
  }
}

function nativeSubAgentActivityEvent({
  id,
  sequence,
  kind,
  agentKey,
  agentLabel,
}: {
  id: string
  sequence: number
  kind: "started" | "interacted" | "interrupted"
  agentKey: string
  agentLabel?: string
}) {
  return {
    id,
    type: "item/completed",
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method: "item/completed" as const,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id,
          type: "subAgentActivity" as const,
          kind,
          agentKey,
          ...(agentLabel ? { agentLabel } : {}),
        },
      },
    },
  }
}

function nativeReconnectEvent({
  id,
  sequence,
}: {
  id: string
  sequence: number
}) {
  return {
    id,
    type: "error",
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method: "error" as const,
      params: {
        threadId: "thread-1",
        turnId: "native-turn-1",
        willRetry: true,
        error: {
          codexErrorInfo: {
            responseStreamDisconnected: { httpStatusCode: null },
          },
        },
      },
    },
  }
}

function nativeFinalAnswerStartedEvent() {
  return {
    id: "event-final-answer-started",
    type: "item/started",
    turn_id: "turn-1",
    sequence_no: 6,
    created_at: "2026-07-11T08:00:06.000Z",
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method: "item/started" as const,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "agent-final",
          type: "agentMessage" as const,
          phase: "final_answer" as const,
          text: "",
        },
      },
    },
  }
}

function nativePlanEvent({
  id,
  sequence,
  steps,
}: {
  id: string
  sequence: number
  steps: Array<{
    step: string
    status: "pending" | "inProgress" | "completed"
  }>
}) {
  return {
    id,
    type: "turn/plan/updated",
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-11T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2 as const,
      source: "codex_app_server" as const,
      method: "turn/plan/updated" as const,
      params: {
        threadId: "thread-1",
        turnId: "native-turn-1",
        plan: steps,
      },
    },
  }
}
