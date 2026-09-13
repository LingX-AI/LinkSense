import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationUserInputRequest } from "@/api/contracts"
import { ConversationUserInputRequestCard } from "@/features/conversations/conversation-user-input-request-card"
import i18n from "@/i18n"
import conversationStyles from "@/index.css?raw"

const request: Extract<ConversationUserInputRequest, { kind: "questions" }> = {
  id: "30000000-0000-4000-8000-000000000005",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: "30000000-0000-4000-8000-000000000003",
  item_id: "native-user-input-item-1",
  kind: "questions",
  questions: [
    {
      id: "implementation_scope",
      header: "范围",
      question: "请选择实施范围。",
      is_other: true,
      is_secret: false,
      options: [
        {
          label: "完整实现（推荐）",
          description: "完成前后端与测试。",
        },
        { label: "仅做界面", description: "只增加入口。" },
      ],
    },
    {
      id: "private_context",
      header: "敏感信息",
      question: "请输入仅供本次执行使用的信息。",
      is_other: true,
      is_secret: true,
      options: null,
    },
  ],
  status: "pending",
  auto_resolve_at: null,
  resolved_at: null,
  resolved_action: null,
  created_at: "2026-08-09T08:00:00.000Z",
  updated_at: "2026-08-09T08:00:00.000Z",
}

const tallRequest: Extract<
  ConversationUserInputRequest,
  { kind: "questions" }
> = {
  ...request,
  id: "30000000-0000-4000-8000-000000000006",
  questions: ["visual_style", "control_target", "feature_scope"].map(
    (id, questionIndex) => ({
      id,
      header: `问题 ${questionIndex + 1}`,
      question: `请选择第 ${questionIndex + 1} 项产品偏好。`,
      is_other: true,
      is_secret: false,
      options: ["推荐方案", "备选方案", "精简方案"].map(
        (label, optionIndex) => ({
          label: `${label} ${questionIndex + 1}-${optionIndex + 1}`,
          description: "这是一段会在较窄视口中换行的选项说明。",
        })
      ),
    })
  ),
}

const formRequest: Extract<ConversationUserInputRequest, { kind: "form" }> = {
  id: "30000000-0000-4000-8000-000000000007",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: "30000000-0000-4000-8000-000000000003",
  item_id: "linksense-form-18",
  kind: "form",
  server_name: "linksense_core",
  message: "请确认 **发布信息**。\n\n- 保持草稿",
  requested_schema: {
    type: "object",
    properties: {
      title: { type: "string", title: "标题", maxLength: 100 },
      notes: { type: "string", title: "说明", maxLength: 1_000 },
      channel: {
        type: "string",
        title: "渠道",
        default: "teams",
        oneOf: [
          { const: "email", title: "邮件" },
          { const: "teams", title: "Teams" },
        ],
      },
      tags: {
        type: "array",
        title: "标签",
        minItems: 1,
        items: {
          anyOf: [
            { const: "product", title: "产品" },
            { const: "engineering", title: "研发" },
          ],
        },
      },
      publish_date: {
        type: "string",
        title: "发布日期",
        format: "date",
        default: "2026-08-15",
      },
      publish_at: {
        type: "string",
        title: "发布时间",
        format: "date-time",
        default: "2026-08-15T09:30:00.000Z",
      },
      retries: {
        type: "integer",
        title: "重试次数",
        minimum: 0,
        maximum: 3,
        default: 2,
      },
      notify: { type: "boolean", title: "发送通知", default: true },
    },
    required: [
      "title",
      "notes",
      "channel",
      "tags",
      "publish_date",
      "publish_at",
      "retries",
      "notify",
    ],
  },
  ui_hints: {
    title: { control: "text", placeholder: "输入标题" },
    notes: { control: "textarea", placeholder: "输入说明" },
    retries: { control: "number", placeholder: "0～3" },
  },
  response_semantics: { kind: "input" },
  response_content: null,
  status: "pending",
  auto_resolve_at: "2026-08-14T08:10:00.000Z",
  resolved_at: null,
  resolved_action: null,
  created_at: "2026-08-14T08:00:00.000Z",
  updated_at: "2026-08-14T08:00:00.000Z",
}

function getStructuredField(card: HTMLElement, label: string): HTMLElement {
  const field = Array.from(
    card.querySelectorAll<HTMLElement>('[data-slot="field"]')
  ).find((candidate) =>
    candidate
      .querySelector('[data-slot="field-label"]')
      ?.textContent?.startsWith(label)
  )
  if (!field) throw new Error(`Missing structured field: ${label}`)
  return field
}

describe("ConversationUserInputRequestCard", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "shows nonblocking questions in %s and submits only after an explicit click",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const onSubmit = vi.fn()
      const asyncRequest: ConversationUserInputRequest = {
        ...request,
        kind: "async_questions",
        response_content: null,
        questions: [request.questions[0]!],
      }
      const user = userEvent.setup()
      render(
        <ConversationUserInputRequestCard
          request={asyncRequest}
          submitting={false}
          onSubmit={onSubmit}
        />
      )
      expect(screen.getByRole("radio", { name: /完整实现/ })).toBeChecked()
      expect(
        screen.getByText(
          locale === "en-US"
            ? "LinkSense can keep working while you answer. You can also reply after it finishes."
            : "你可以稍后回答，LinkSense 会继续工作；任务结束后仍可提交回答。"
        )
      ).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
      await user.click(
        screen.getByRole("button", {
          name: locale === "en-US" ? "Submit answers" : "提交回答",
        })
      )
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
        action: "accept",
        content: { implementation_scope: "完整实现（推荐）" },
      })
    }
  )

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  it.each(["pending", "answering"] as const)(
    "resubmits a persisted %s async answer without allowing a different answer or cancellation",
    async (status) => {
      const onSubmit = vi.fn()
      const user = userEvent.setup()
      render(
        <ConversationUserInputRequestCard
          request={{
            ...request,
            kind: "async_questions",
            status,
            questions: [request.questions[0]!],
            response_content: { implementation_scope: "仅做界面" },
          }}
          submitting={false}
          onSubmit={onSubmit}
        />
      )
      expect(screen.getByRole("radio", { name: /仅做界面/ })).toBeChecked()
      expect(screen.getByRole("radio", { name: /完整实现/ })).toHaveAttribute(
        "aria-disabled",
        "true"
      )
      expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
      await user.click(screen.getByRole("button", { name: "提交回答" }))
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
        action: "accept",
        content: { implementation_scope: "仅做界面" },
      })
    }
  )

  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage("zh-CN")
    vi.restoreAllMocks()
  })

  it("collects one answer per native question and keeps secret input masked", async () => {
    const interaction = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ConversationUserInputRequestCard
        request={request}
        submitting={false}
        onSubmit={onSubmit}
      />
    )

    const card = screen.getByTestId("conversation-user-input-request")
    expect(card).toHaveAttribute("role", "region")
    expect(card).toHaveAttribute("tabindex", "-1")
    expect(
      within(card).getByRole("heading", { name: "需要你的回答" })
    ).toBeVisible()
    const submit = within(card).getByRole("button", { name: "提交回答" })
    expect(submit).toBeDisabled()

    const scopeOption = within(card).getByRole("radio", {
      name: /完整实现（推荐）/,
    })
    await interaction.click(scopeOption)
    const scopeOptionLabel = scopeOption.closest("label")
    expect(scopeOptionLabel).toHaveClass("has-data-[checked]:bg-muted/50")
    expect(scopeOptionLabel).not.toHaveClass(
      "border",
      "border-[color:var(--app-border)]"
    )
    expect(scopeOptionLabel?.className).not.toContain(
      "has-data-[checked]:border"
    )
    const secretInput = within(card).getByPlaceholderText("输入你的回答")
    expect(secretInput).toHaveAttribute("type", "password")
    await interaction.type(secretInput, "  temporary-secret  ")
    expect(submit).toBeEnabled()
    expect(screen.queryByText("temporary-secret")).not.toBeInTheDocument()

    await interaction.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({
      action: "accept",
      content: {
        implementation_scope: "完整实现（推荐）",
        private_context: "  temporary-secret  ",
      },
    })
  })

  it("disables all inputs after the native request is no longer pending", () => {
    render(
      <ConversationUserInputRequestCard
        request={{ ...request, status: "answered" }}
        submitting={false}
        onSubmit={vi.fn()}
      />
    )

    expect(
      screen.getByRole("radio", { name: /完整实现（推荐）/ })
    ).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByPlaceholderText("输入你的回答")).toBeDisabled()
    expect(screen.getByRole("button", { name: "提交回答" })).toBeDisabled()
  })

  it("lets a tall multi-question request grow without an internal scrollbar", () => {
    render(
      <ConversationUserInputRequestCard
        request={tallRequest}
        submitting={false}
        onSubmit={vi.fn()}
      />
    )

    const card = screen.getByTestId("conversation-user-input-request")
    const questionArea = card.querySelector<HTMLElement>(
      '[data-slot="card-content"]'
    )
    const questionLegends = card.querySelectorAll<HTMLElement>(
      '[data-slot="field-legend"]'
    )
    const submit = screen.getByRole("button", { name: "提交回答" })

    expect(card).toHaveAttribute("data-size", "sm")
    expect(card).toHaveClass(
      "max-w-2xl",
      "data-[size=sm]:[--card-spacing:--spacing(3)]"
    )
    expect(card).not.toHaveClass("max-h-[min(64svh,40rem)]")
    expect(card).toHaveClass("border-[color:var(--app-border)]", "bg-card")
    expect(card).toHaveClass("mr-auto", "shadow-none")
    expect(card).not.toHaveClass("mx-auto", "shadow-sm")
    expect(card).not.toHaveClass("bg-[var(--app-surface)]")
    expect(questionArea).not.toBeNull()
    expect(questionArea).not.toHaveClass("overflow-y-auto")
    expect(questionArea).not.toHaveClass("overscroll-contain")
    expect(questionLegends).toHaveLength(3)
    for (const legend of questionLegends) {
      expect(legend).toHaveClass("mb-1.5")
      expect(legend).not.toHaveClass("mb-2")
    }
    expect(screen.getAllByRole("radio")).toHaveLength(12)
    expect(questionArea).not.toContainElement(submit)
    expect(submit.closest('[data-slot="card-footer"]')).not.toBeNull()
  })

  it("renders and submits the first-phase structured form controls", async () => {
    const interaction = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ConversationUserInputRequestCard
        request={formRequest}
        submitting={false}
        onSubmit={onSubmit}
      />
    )

    const card = screen.getByTestId("conversation-user-input-request")
    expect(card).toHaveAttribute("data-request-kind", "form")
    expect(card).toHaveClass("max-w-none")
    expect(card).not.toHaveClass("max-w-2xl")
    expect(
      within(card).getByRole("heading", { name: "需要你确认信息" })
    ).toBeVisible()
    expect(within(card).getByText("发布信息").tagName).toBe("STRONG")
    expect(within(card).getByText("保持草稿")).toBeVisible()
    expect(
      card.querySelector(
        ".conversation-user-input-request-description-markdown"
      )
    ).not.toBeNull()

    const fieldGroup = card.querySelector<HTMLElement>(
      '[data-slot="field-group"]'
    )
    expect(fieldGroup).toHaveClass(
      "grid",
      "gap-x-4",
      "gap-y-4",
      "sm:grid-cols-2"
    )
    expect(fieldGroup).not.toHaveClass("sm:grid-cols-12")

    const title = within(card).getByPlaceholderText("输入标题")
    expect(title.closest('[data-slot="field"]')).toHaveClass("sm:col-span-2")
    await interaction.type(title, "季度复盘")
    const notes = within(card).getByPlaceholderText("输入说明")
    expect(notes.tagName).toBe("TEXTAREA")
    expect(notes).toHaveAttribute("rows", "3")
    await interaction.type(notes, "覆盖产品与研发进展")

    const channel = within(card).getByRole("combobox", { name: /渠道/ })
    expect(channel).toHaveTextContent("Teams")
    expect(channel).toHaveAttribute("data-size", "default")
    expect(channel).toHaveClass("data-[size=default]:h-8")
    expect(channel.closest('[data-slot="field"]')).toHaveClass("sm:col-span-1")
    const publishDate = within(card).getByLabelText(/发布日期/)
    expect(publishDate).toHaveClass("h-8")
    expect(getStructuredField(card, "发布日期")).toHaveClass("sm:col-span-1")
    expect(getStructuredField(card, "发布时间")).toHaveClass("sm:col-span-2")
    await interaction.click(
      within(card).getByRole("checkbox", { name: "产品" })
    )
    const productCheckbox = within(card).getByRole("checkbox", {
      name: "产品",
    })
    const productOption = productCheckbox.closest("label")
    expect(productCheckbox.tagName).toBe("BUTTON")
    expect(productCheckbox).toHaveAttribute("type", "button")
    expect(productOption?.querySelector('input[type="checkbox"]')).toBeNull()
    expect(productCheckbox).not.toHaveClass("data-checked:border-transparent")
    expect(productOption).toHaveClass("has-data-[checked]:bg-muted/50")
    expect(productOption).not.toHaveClass(
      "border",
      "border-[color:var(--app-border)]"
    )
    expect(productOption?.className).not.toContain("has-data-[checked]:border")
    const retries = within(card).getByRole("spinbutton", {
      name: /重试次数/,
    })
    expect(retries).toHaveValue(2)
    expect(retries).toHaveAttribute("placeholder", "0～3")
    expect(
      within(card).getByRole("checkbox", { name: /发送通知/ })
    ).toBeChecked()
    expect(
      within(card)
        .getByRole("spinbutton", { name: /重试次数/ })
        .closest('[data-slot="field"]')
    ).toHaveClass("sm:col-span-1")
    expect(
      within(card)
        .getByRole("checkbox", { name: /发送通知/ })
        .closest('[data-slot="field"]')
    ).toHaveClass("sm:col-span-1")
    for (const field of card.querySelectorAll('[data-slot="field"]')) {
      expect(field).not.toHaveClass("sm:col-span-4")
      expect(field).not.toHaveClass("sm:col-span-8")
      expect(field).not.toHaveClass("sm:col-span-12")
    }

    const submit = within(card).getByRole("button", { name: "提交回答" })
    expect(submit).toHaveClass("h-7")
    await interaction.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({
      action: "accept",
      content: {
        title: "季度复盘",
        notes: "覆盖产品与研发进展",
        channel: "teams",
        tags: ["product"],
        publish_date: "2026-08-15",
        publish_at: "2026-08-15T09:30:00.000Z",
        retries: 2,
        notify: true,
      },
    })
  })

  it("keeps form interactions in place without adding inner option borders", async () => {
    const interaction = userEvent.setup()
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView)
    const onInteractionStart = vi.fn()
    render(
      <ConversationUserInputRequestCard
        request={formRequest}
        submitting={false}
        onSubmit={vi.fn()}
        onInteractionStart={onInteractionStart}
      />
    )

    const channel = screen.getByRole("combobox", { name: /渠道/ })
    await interaction.click(channel)
    const emailOption = await screen.findByRole("option", { name: "邮件" })
    expect(document.body.style.overflow).not.toBe("hidden")
    scrollIntoView.mockClear()
    await interaction.click(emailOption)

    expect(channel).toHaveTextContent("邮件")
    expect(scrollIntoView).not.toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" })
    )

    const productCheckbox = screen.getByRole("checkbox", { name: "产品" })
    await interaction.click(productCheckbox)
    const productOption = productCheckbox.closest("label")
    expect(onInteractionStart).toHaveBeenCalled()
    expect(productOption).toHaveClass("has-data-[checked]:bg-muted/50")
    expect(productOption).not.toHaveClass(
      "border",
      "border-[color:var(--app-border)]"
    )
    expect(productOption?.className).not.toContain("has-data-[checked]:border")
    expect(productCheckbox).not.toHaveClass("data-checked:border-transparent")
  })

  it("cancels without submitting field content", async () => {
    const interaction = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ConversationUserInputRequestCard
        request={formRequest}
        submitting={false}
        onSubmit={onSubmit}
      />
    )

    await interaction.click(screen.getByRole("button", { name: "取消" }))
    expect(onSubmit).toHaveBeenCalledWith({ action: "cancel" })
  })

  it("keeps a submitted form visible with persisted values and no active controls", () => {
    render(
      <ConversationUserInputRequestCard
        request={{
          ...formRequest,
          status: "answered",
          resolved_action: "accept",
          resolved_at: "2026-08-14T08:01:00.000Z",
          updated_at: "2026-08-14T08:01:00.000Z",
          response_content: {
            title: "季度复盘",
            notes: "覆盖产品与研发进展",
            channel: "email",
            tags: ["product", "engineering"],
            publish_date: "2026-08-18",
            publish_at: "2026-08-18T10:45:00.000Z",
            retries: 3,
            notify: false,
          },
        }}
        submitting={false}
      />
    )

    const card = screen.getByTestId("conversation-user-input-request")
    const form = within(card).getByPlaceholderText("输入标题").closest("form")
    expect(card).toHaveAttribute("data-request-status", "submitted")
    expect(form).toHaveClass("conversation-structured-user-input-form-readonly")
    expect(
      within(card).getByRole("heading", { name: "已处理的表单" })
    ).toBeVisible()
    expect(within(card).getByText("已提交")).toBeVisible()
    expect(within(card).getByPlaceholderText("输入标题")).toHaveValue(
      "季度复盘"
    )
    expect(within(card).getByPlaceholderText("输入标题")).toBeDisabled()
    expect(
      within(card).getByRole("combobox", { name: /渠道/ })
    ).toHaveTextContent("邮件")
    expect(within(card).getByRole("checkbox", { name: "产品" })).toBeChecked()
    expect(within(card).getByRole("checkbox", { name: "研发" })).toBeChecked()
    expect(
      within(card).getByRole("spinbutton", { name: /重试次数/ })
    ).toHaveValue(3)
    expect(
      within(card).getByRole("checkbox", { name: /发送通知/ })
    ).not.toBeChecked()
    expect(
      within(card).queryByRole("button", { name: "提交回答" })
    ).not.toBeInTheDocument()
    expect(
      within(card).queryByRole("button", { name: "取消" })
    ).not.toBeInTheDocument()
  })

  it("keeps terminal structured forms visually enabled while using a blocked cursor", () => {
    expect(conversationStyles).toMatch(
      /\.conversation-structured-user-input-form-readonly\s*\{[^}]*cursor:\s*not-allowed;/u
    )
    expect(conversationStyles).toMatch(
      /\.conversation-structured-user-input-form-readonly\s+\[data-disabled="true"\],\s*\.conversation-structured-user-input-form-readonly\s+\[data-disabled="true"\]\s+\*\s*\{[^}]*opacity:\s*1;/u
    )
    expect(conversationStyles).toMatch(
      /\.conversation-structured-user-input-form-readonly[\s\S]*?:is\([\s\S]*?label,[\s\S]*?input:disabled,[\s\S]*?textarea:disabled,[\s\S]*?button:disabled,[\s\S]*?\[data-disabled="true"\],[\s\S]*?\[aria-disabled="true"\][\s\S]*?\)\s*\{[^}]*cursor:\s*not-allowed;/u
    )
    expect(conversationStyles).toMatch(
      /\.conversation-structured-user-input-form-readonly[\s\S]*?:is\([\s\S]*?input:disabled,[\s\S]*?textarea:disabled,[\s\S]*?button:disabled,[\s\S]*?\[data-disabled="true"\],[\s\S]*?\[aria-disabled="true"\][\s\S]*?\)\s*\{[^}]*pointer-events:\s*auto;/u
    )
  })

  it.each([
    ["approve", "approved", "已同意"],
    ["reject", "rejected", "已拒绝"],
  ] as const)(
    "shows an explicit approval decision %s as %s",
    (decision, expectedStatus, expectedLabel) => {
      render(
        <ConversationUserInputRequestCard
          request={{
            ...formRequest,
            requested_schema: {
              type: "object",
              properties: {
                decision: {
                  type: "string",
                  title: "审批结果",
                  oneOf: [
                    { const: "approve", title: "同意" },
                    { const: "reject", title: "拒绝" },
                  ],
                },
              },
              required: ["decision"],
            },
            ui_hints: {},
            response_semantics: {
              kind: "approval",
              decision_field_id: "decision",
              approve_value: "approve",
              reject_value: "reject",
            },
            response_content: { decision },
            status: "answered",
            resolved_action: "accept",
            resolved_at: "2026-08-14T08:01:00.000Z",
            updated_at: "2026-08-14T08:01:00.000Z",
          }}
          submitting={false}
        />
      )

      const card = screen.getByTestId("conversation-user-input-request")
      expect(card).toHaveAttribute("data-request-status", expectedStatus)
      expect(within(card).getByText(expectedLabel)).toBeVisible()
      expect(
        within(card).getByRole("combobox", { name: /审批结果/ })
      ).toBeDisabled()
    }
  )

  it.each([
    ["cancelled", "decline", "rejected", "已拒绝"],
    ["cancelled", "cancel", "cancelled", "已取消"],
    ["cancelled", null, "terminated", "已终止"],
    ["expired", "cancel", "expired", "已超时"],
  ] as const)(
    "shows %s with action %s as %s",
    (status, resolvedAction, expectedStatus, expectedLabel) => {
      render(
        <ConversationUserInputRequestCard
          request={{
            ...formRequest,
            status,
            resolved_action: resolvedAction,
            resolved_at: "2026-08-14T08:01:00.000Z",
            updated_at: "2026-08-14T08:01:00.000Z",
          }}
          submitting={false}
        />
      )

      const card = screen.getByTestId("conversation-user-input-request")
      expect(card).toHaveAttribute("data-request-status", expectedStatus)
      expect(within(card).getByText(expectedLabel)).toBeVisible()
    }
  )

  it("does not present schema defaults as historical submitted values", () => {
    render(
      <ConversationUserInputRequestCard
        request={{
          ...formRequest,
          status: "cancelled",
          resolved_action: null,
          resolved_at: "2026-08-14T08:01:00.000Z",
          updated_at: "2026-08-14T08:01:00.000Z",
          response_content: null,
        }}
        submitting={false}
      />
    )

    const card = screen.getByTestId("conversation-user-input-request")
    expect(within(card).getByPlaceholderText("输入标题")).toHaveValue("")
    expect(
      within(card).getByRole("combobox", { name: /渠道/ })
    ).not.toHaveTextContent("Teams")
    expect(
      within(card).getByRole("spinbutton", { name: /重试次数/ })
    ).toHaveValue(null)
    expect(
      within(card).getByRole("checkbox", { name: /发送通知/ })
    ).not.toBeChecked()
  })

  it("shows a localized format error and submits only after the value is valid", async () => {
    const interaction = userEvent.setup()
    const onSubmit = vi.fn()
    const emailRequest: Extract<
      ConversationUserInputRequest,
      { kind: "form" }
    > = {
      ...formRequest,
      requested_schema: {
        type: "object",
        properties: {
          contact: {
            type: "string",
            title: "联系邮箱",
            format: "email",
          },
        },
        required: ["contact"],
      },
      ui_hints: {},
    }
    render(
      <ConversationUserInputRequestCard
        request={emailRequest}
        submitting={false}
        onSubmit={onSubmit}
      />
    )

    const input = screen.getByRole("textbox", { name: /联系邮箱/ })
    await interaction.type(input, "invalid-address")
    await interaction.click(screen.getByRole("button", { name: "提交回答" }))

    expect(screen.getByText("请输入有效的邮箱地址。")).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()

    await interaction.clear(input)
    await interaction.type(input, "owner@example.com")
    await interaction.click(screen.getByRole("button", { name: "提交回答" }))

    expect(onSubmit).toHaveBeenCalledWith({
      action: "accept",
      content: { contact: "owner@example.com" },
    })
  })

  it("renders the structured form and validation feedback in English", async () => {
    await i18n.changeLanguage("en-US")
    const interaction = userEvent.setup()
    const emailRequest: Extract<
      ConversationUserInputRequest,
      { kind: "form" }
    > = {
      ...formRequest,
      requested_schema: {
        type: "object",
        properties: {
          contact: {
            type: "string",
            title: "Contact email",
            format: "email",
          },
        },
        required: ["contact"],
      },
      ui_hints: {},
    }
    render(
      <ConversationUserInputRequestCard
        request={emailRequest}
        submitting={false}
        onSubmit={vi.fn()}
      />
    )

    expect(
      screen.getByRole("heading", { name: "Please confirm these details" })
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible()
    const input = screen.getByRole("textbox", { name: /Contact email/ })
    await interaction.type(input, "invalid-address")
    await interaction.click(
      screen.getByRole("button", { name: "Submit answers" })
    )

    expect(screen.getByText("Enter a valid email address.")).toBeVisible()
  })
})
