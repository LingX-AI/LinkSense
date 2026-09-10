import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ConversationEvent,
  ConversationFile,
  NativeCodexItem,
} from "@/api/contracts"
import { ConversationTaskOverviewPanel } from "@/features/conversations/conversation-task-overview-panel"
import i18n from "@/i18n"
import appStyles from "@/index.css?raw"

const agentKeyA = `agent_${"a".repeat(24)}`
const agentKeyB = `agent_${"b".repeat(24)}`
const agentKeyC = `agent_${"c".repeat(24)}`

const artifact: ConversationFile = {
  id: "artifact-1",
  name: "ai-overview.pdf",
  kind: "artifact",
  mime_type: "application/pdf",
  size: 1024,
  download_available: true,
}

function nativeEvent({
  id,
  sequence,
  item,
}: {
  id: string
  sequence: number
  item: NativeCodexItem
}): ConversationEvent {
  return {
    id,
    type: "item/completed",
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: "2026-07-20T08:00:00.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item,
      },
    },
  }
}

describe("ConversationTaskOverviewPanel", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("uses compact rows and matching action icons for files and sources", async () => {
    const props = {
      events: [],
      files: [artifact, { ...artifact, id: "artifact-2", name: "second.pdf" }],
      onDownload: vi.fn(),
      sourcesState: {
        sources: [
          { url: "https://example.test/a", title: "资料 A" },
          { url: "https://example.test/b", title: "资料 B" },
        ],
      },
    }
    const view = render(<ConversationTaskOverviewPanel {...props} />)
    const downloads = await screen.findAllByRole("button", { name: /^下载 / })
    const links = screen.getAllByRole("link")
    expect(downloads).toHaveLength(2)
    expect(links).toHaveLength(2)
    for (const row of [...downloads, ...links]) {
      expect(row).toHaveClass("h-8")
      expect(row.lastElementChild).toHaveClass("size-3.5")
    }
    expect(downloads[0].parentElement).toHaveClass("flex", "flex-col", "gap-0")
    expect(links[0].closest("ul")).toHaveClass("gap-0")
    view.rerender(
      <ConversationTaskOverviewPanel
        {...props}
        downloadingFileId={artifact.id}
      />
    )
    expect(downloads[0]).toBeDisabled()
    expect(downloads[0].lastElementChild).toHaveClass(
      "size-3.5",
      "animate-spin"
    )
  })

  it("stays open until the title-bar button explicitly toggles it", async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <>
        <div data-testid="conversation-canvas">页面空白区域</div>
        <ConversationTaskOverviewPanel
          events={[
            nativeEvent({
              id: "spawn-subagents",
              sequence: 1,
              item: {
                id: "spawn-subagents",
                type: "collabAgentToolCall",
                tool: "spawnAgent",
                status: "completed",
                agents: [
                  { agentKey: agentKeyA, status: "completed" },
                  { agentKey: agentKeyB, status: "completed" },
                  { agentKey: agentKeyC, status: "completed" },
                ],
              },
            }),
          ]}
          files={[artifact]}
          onDownload={onDownload}
          onOpenChange={onOpenChange}
        />
      </>
    )

    const overviewCard = await screen.findByRole("region", {
      name: "任务概览",
    })
    const overviewButton = screen.getByRole("button", {
      name: "关闭任务概览",
    })
    expect(overviewCard.parentElement).toHaveStyle({
      transform: "translate(0px, 28px)",
    })
    expect(overviewCard).toHaveClass(
      "task-overview-card-border",
      "task-overview-card-shadow",
      "shadow-none",
      "ring-0"
    )
    expect(overviewCard).not.toHaveClass("shadow-sm")
    expect(overviewCard).not.toHaveClass("shadow-md")
    expect(overviewCard).not.toHaveClass("shadow-lg")
    expect(overviewCard).not.toHaveClass("ring-1")
    expect(overviewCard).not.toHaveFocus()
    expect(screen.getByText("3 / 3 已完成")).toBeInTheDocument()
    expect(
      document.querySelectorAll('[data-slot="subagent-icon"]')
    ).toHaveLength(3)

    await user.click(screen.getByTestId("conversation-canvas"))
    expect(screen.getByText("任务概览")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.getByText("任务概览")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "下载 ai-overview.pdf" })
    )
    expect(onDownload).toHaveBeenCalledWith(artifact)
    expect(overviewCard).toBeInTheDocument()

    await user.click(overviewButton)
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)

    expect(window.localStorage.getItem("linksense.taskOverviewOpen")).toBe(
      "false"
    )

    await user.click(screen.getByRole("button", { name: "打开任务概览" }))
    expect(await screen.findByText("任务概览")).toBeInTheDocument()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    expect(window.localStorage.getItem("linksense.taskOverviewOpen")).toBe(
      "true"
    )
  })

  it("keeps a manual hidden preference when the panel is remounted", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ConversationTaskOverviewPanel
        key="task-1"
        events={[]}
        files={[artifact]}
        onDownload={vi.fn()}
      />
    )

    await user.click(screen.getByRole("button", { name: "关闭任务概览" }))
    rerender(
      <ConversationTaskOverviewPanel
        key="task-2"
        events={[]}
        files={[artifact]}
        onDownload={vi.fn()}
      />
    )

    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "打开任务概览" }))
    expect(await screen.findByText("任务概览")).toBeVisible()
  })

  it("uses a large low-opacity centered shadow in both themes", () => {
    expect(appStyles).toContain(
      ".task-overview-card-border {\n  border: 1px solid var(--app-border);\n}"
    )
    expect(appStyles).toContain(
      ".task-overview-card-shadow {\n  box-shadow: var(--app-task-overview-shadow);\n}"
    )
    expect(appStyles).toContain(
      "--app-task-overview-shadow: 0 0 28px rgb(0 0 0 / 8%);"
    )
    expect(appStyles).toContain(
      "--app-task-overview-shadow: 0 0 28px rgb(0 0 0 / 24%);"
    )
  })

  it("recenters the content while keeping the thread scrollbar at the outer edge", () => {
    expect(appStyles).toContain(
      "--conversation-task-overview-lane-width: 20rem;"
    )
    expect(appStyles).toContain(
      '.conversation-workspace[data-task-overview-open="true"]'
    )
    expect(appStyles).toContain(
      "transform: translate3d(var(--conversation-task-overview-shift-x), 0, 0);"
    )
    expect(appStyles).toContain(
      "transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);"
    )
    expect(appStyles).toContain(
      ".conversation-workspace > .conversation-scroll > .conversation-column,\n.conversation-workspace > .conversation-bottom-stack"
    )
    expect(appStyles).not.toContain(
      ".conversation-workspace > .conversation-scroll,\n.conversation-workspace > .conversation-bottom-stack"
    )
    expect(appStyles).toContain(
      "@container conversation-workspace (max-width: 87rem)"
    )
    expect(appStyles).toContain("@media (prefers-reduced-motion: reduce)")
  })

  it("hides the subagent section when no subagents were used", async () => {
    render(
      <ConversationTaskOverviewPanel
        events={[]}
        files={[artifact]}
        onDownload={vi.fn()}
      />
    )

    expect(await screen.findByText("任务概览")).toBeInTheDocument()
    expect(screen.queryByText("子智能体")).not.toBeInTheDocument()
    expect(screen.queryByText("0 完成")).not.toBeInTheDocument()
    expect(screen.getByText("产出文件")).toBeInTheDocument()
    expect(screen.getByText("ai-overview.pdf")).toBeInTheDocument()
  })

  it("uses compact typography for the empty output state", async () => {
    render(
      <ConversationTaskOverviewPanel
        events={[]}
        files={[]}
        onDownload={vi.fn()}
      />
    )

    const emptyState = await screen.findByText("暂无产出文件")
    expect(emptyState).toHaveClass("text-xs")
    expect(emptyState).not.toHaveClass("text-sm")
  })

  it("uses readable typography and compact icon sizing for output file rows", async () => {
    render(
      <ConversationTaskOverviewPanel
        events={[]}
        files={[artifact]}
        onDownload={vi.fn()}
      />
    )

    const fileRow = await screen.findByRole("button", {
      name: "下载 ai-overview.pdf",
    })
    const fileIcon = fileRow.querySelector('[data-file-icon-kind="pdf"]')

    expect(appStyles).toContain("--text-sm: var(--app-ui-font-size);")
    expect(screen.getByText("任务概览")).toHaveClass("text-sm")
    expect(screen.getByText("任务概览")).not.toHaveClass("text-base")
    expect(screen.getByText("产出文件")).toHaveClass("text-sm")
    expect(screen.getByText("产出文件")).not.toHaveClass("text-base")
    expect(fileRow).toHaveClass("text-sm", "hover:bg-hover")
    expect(fileIcon).toHaveClass("size-4")
  })
})
