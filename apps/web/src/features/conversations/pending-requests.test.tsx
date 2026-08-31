import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { reorderPendingRequestIds } from "@/features/conversations/pending-request-order"
import { PendingRequests } from "@/features/conversations/pending-requests"
import i18n from "@/i18n"

describe("pending request summaries", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(cleanup)

  it("renders a compact queued request and keeps its details on demand", async () => {
    const onCancel = vi.fn()
    const onEdit = vi.fn()
    const request = {
      id: "pending-1",
      sequence_no: 1,
      status: "waiting_previous_turn",
      input_text: "补充雨天活动预案，并列出负责人。",
      priority_capability_ids: ["builtin:capability:linksense-browser"],
      created_at: "2026-07-11T08:00:00.000Z",
      attachments: [
        {
          id: "file-1",
          name: "活动名单.xlsx",
          kind: "attachment" as const,
          size: 2048,
          download_available: false,
        },
      ],
    }
    const interaction = userEvent.setup()
    render(
      <PendingRequests
        requests={[request]}
        capabilities={[
          {
            id: "builtin:capability:linksense-browser",
            name: "linksense-browser",
            slug: "linksense-browser",
            type: "skill",
            description: null,
            status: "active",
            source_type: "builtin",
            marketplace_listing_id: null,
            marketplace_release_id: null,
            builtin_key: "linksense-browser",
            is_builtin: true,
            can_select: false,
            can_delete: false,
            logo_url: null,
            is_owner: false,
            can_manage: false,
            can_govern: true,
            has_logo: false,
            preference_status: "enabled",
            manifest: null,
            risk_summary: null,
            created_at: null,
            updated_at: null,
            personally_disabled: false,
          },
        ]}
        canGuideCurrentTurn
        onGuide={vi.fn()}
        onStart={vi.fn()}
        onEdit={onEdit}
        onCancel={onCancel}
      />
    )

    const summary = screen.getByRole("region", { name: "后续请求" })
    expect(summary).toHaveClass("pending-requests")
    expect(screen.getByText(request.input_text)).toHaveClass(
      "pending-request-context-input"
    )
    expect(screen.getByText("排队")).toBeVisible()
    expect(screen.queryByRole("button", { name: "引导" })).toBeNull()
    expect(screen.queryByText("活动名单.xlsx")).not.toBeInTheDocument()
    expect(
      screen.queryByText(/优先插件\/Skill.*LinkSense 浏览器/)
    ).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "查看后续请求详情" })
    )
    expect(await screen.findByText("活动名单.xlsx")).toBeVisible()
    expect(screen.getByText(/优先插件\/Skill.*LinkSense 浏览器/)).toBeVisible()
    expect(screen.getByText("2 kB")).toBeVisible()
    expect(screen.queryByText("第 1 条")).not.toBeInTheDocument()
    expect(screen.queryByText(/创建时间/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2026-07-11/)).not.toBeInTheDocument()
    const editItem = screen.getByRole("menuitem", { name: "编辑信息" })
    const closeItem = screen.getByRole("menuitem", { name: "关闭排队" })
    expect(editItem).toHaveAttribute("data-variant", "default")
    expect(closeItem).toHaveAttribute("data-variant", "default")

    await interaction.click(editItem)
    expect(onEdit).toHaveBeenCalledWith(request)

    await interaction.click(
      screen.getByRole("button", { name: "查看后续请求详情" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "关闭排队" })
    )
    expect(onCancel).toHaveBeenCalledWith(request)

    await interaction.click(screen.getByRole("button", { name: "关闭排队" }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it("shows a guide action only for the first plain-text request while a turn runs", async () => {
    const onGuide = vi.fn()
    const first = {
      id: "pending-guide-1",
      sequence_no: 1,
      status: "waiting_previous_turn",
      input_text: "优先检查麦克风切换。",
      priority_capability_ids: [],
      attachments: [],
    }
    const second = {
      id: "pending-guide-2",
      sequence_no: 2,
      status: "waiting_previous_turn",
      input_text: "再补充错误处理。",
      priority_capability_ids: [],
      attachments: [],
    }
    const interaction = userEvent.setup()
    render(
      <PendingRequests
        requests={[first, second]}
        capabilities={[]}
        canGuideCurrentTurn
        onGuide={onGuide}
        onStart={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole("button", { name: "引导" })).toBeVisible()
    expect(screen.getByText("排队")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "引导" }))
    expect(onGuide).toHaveBeenCalledWith(first)
  })

  it("shows a queued Office selection as an annotation immediately", () => {
    const request = {
      id: "pending-office-1",
      sequence_no: 1,
      status: "waiting_previous_turn",
      input_text: "删除这一列",
      display: {
        kind: "spreadsheet_annotation" as const,
        file_id: "70000000-0000-4000-8000-000000000001",
        file_name: "男生信息汇总.xlsx",
        annotations: [
          {
            request: "删除这一列",
            sheet_name: "男生信息",
            sheet_index: 0,
            selection_type: "range" as const,
            selection_label: "K:K",
            selection_count: 1 as const,
          },
        ],
        annotation_count: 1 as const,
      },
      priority_capability_ids: [],
      attachments: [],
    }

    render(
      <PendingRequests
        requests={[request]}
        capabilities={[]}
        canGuideCurrentTurn
        onGuide={vi.fn()}
        onStart={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const annotation = screen.getByText("1 条注释")
    expect(annotation).toBeVisible()
    expect(annotation).toHaveAttribute("title", "删除这一列")
    expect(screen.queryByText("删除这一列")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "引导" })).toBeNull()
    expect(screen.getByText("排队")).toBeVisible()
  })

  it("renders a keyboard-accessible leading reorder handle", () => {
    const onReorder = vi.fn(async () => undefined)
    const requests = [
      {
        id: "pending-first",
        sequence_no: 1,
        status: "waiting_previous_turn",
        input_text: "第一条后续请求",
        priority_capability_ids: [],
        attachments: [],
      },
      {
        id: "pending-second",
        sequence_no: 2,
        status: "waiting_previous_turn",
        input_text: "第二条后续请求",
        priority_capability_ids: [],
        attachments: [],
      },
    ]
    render(
      <PendingRequests
        requests={requests}
        capabilities={[]}
        onGuide={vi.fn()}
        onStart={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onReorder={onReorder}
      />
    )

    const firstHandle = screen.getByRole("button", {
      name: "调整第 1 条后续请求顺序",
    })
    expect(firstHandle).toHaveAttribute("aria-roledescription", "sortable")
    expect(firstHandle).not.toBeDisabled()
  })

  it("moves the dragged request to the hovered queue position", () => {
    expect(
      reorderPendingRequestIds(
        ["pending-first", "pending-second"],
        "pending-first",
        "pending-second"
      )
    ).toEqual(["pending-second", "pending-first"])
  })

  it("keeps recovery actions for a blocked first request in the details menu", async () => {
    const onStart = vi.fn()
    const request = {
      id: "pending-blocked",
      sequence_no: 1,
      status: "blocked_overload",
      input_text: "继续生成演示文稿",
      priority_capability_ids: [],
      attachments: [],
    }
    const interaction = userEvent.setup()
    render(
      <PendingRequests
        requests={[request]}
        capabilities={[]}
        onGuide={vi.fn()}
        onStart={onStart}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await interaction.click(
      screen.getByRole("button", { name: "查看后续请求详情" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "继续执行" })
    )

    expect(onStart).toHaveBeenCalledWith(request)
  })
})
