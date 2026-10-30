import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ConversationEvent,
  ConversationFile,
  NativeCodexItem,
} from "@/api/contracts"
import { ConversationTaskOverviewPanel } from "@/features/conversations/conversation-task-overview-panel"
import i18n, { supportedLanguages } from "@/i18n"
import appStyles from "@/index.css?raw"
import { formatFileSize } from "@/i18n/date"

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
  const originalResizeObserver = globalThis.ResizeObserver
  beforeEach(async () => {
    window.localStorage.clear()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it("follows header resizing throughout preview open, drag, close, and reopen without remounting", async () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
      2000
    )
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
      1000
    )
    const resizeCallbacks = new Map<Element, () => void>()
    const disconnect = vi.fn()
    globalThis.ResizeObserver = class {
      private targets = new Set<Element>()
      private callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        this.targets.add(target)
        resizeCallbacks.set(target, () => this.callback([], this))
      }
      unobserve(target: Element) {
        this.targets.delete(target)
        resizeCallbacks.delete(target)
      }
      disconnect() {
        disconnect()
        for (const target of this.targets) resizeCallbacks.delete(target)
      }
    }
    let headerRight = 1800
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("conversation-top-bar")) {
          return new DOMRect(300, 0, headerRight - 300, 52)
        }
        if (this.dataset.slot === "popover-trigger") {
          return new DOMRect(headerRight - 40, 12, 28, 28)
        }
        return originalRect.call(this)
      }
    )
    const user = userEvent.setup()
    const view = render(
      <header className="conversation-top-bar">
        <ConversationTaskOverviewPanel
          events={[]}
          files={[artifact]}
          onDownload={vi.fn()}
        />
      </header>
    )
    const popup = await screen.findByRole("region", { name: "任务概览" })
    const header = screen.getByRole("banner")
    expect(resizeCallbacks.has(header)).toBe(true)
    const positioner = popup.parentElement
    await waitFor(() =>
      expect(positioner).toHaveStyle("transform: translate(1772px, 76px)")
    )

    for (const nextRight of [1100, 1350, 950, 1800, 1100, 1800]) {
      headerRight = nextRight
      act(() => resizeCallbacks.get(header)?.())
      await waitFor(() =>
        expect(positioner).toHaveStyle(
          `transform: translate(${nextRight - 28}px, 76px)`
        )
      )
      expect(screen.getByRole("region", { name: "任务概览" })).toBe(popup)
    }

    await user.click(screen.getByRole("button", { name: "关闭任务概览" }))
    expect(resizeCallbacks.has(header)).toBe(false)
    headerRight = 1450
    await user.click(screen.getByRole("button", { name: "打开任务概览" }))
    const reopenedPopup = await screen.findByRole("region", {
      name: "任务概览",
    })
    await waitFor(() =>
      expect(reopenedPopup.parentElement).toHaveStyle(
        "transform: translate(1422px, 76px)"
      )
    )
    expect(resizeCallbacks.has(header)).toBe(true)
    view.unmount()
    expect(resizeCallbacks.has(header)).toBe(false)
    expect(disconnect).toHaveBeenCalled()
  })

  it("matches the design's panel spacing, counted groups, and two-line file cards", async () => {
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
    const panel = screen.getByRole("region", { name: "任务概览" })
    expect(panel).toHaveClass("w-80", "p-4", "gap-5", "rounded-card")
    for (const name of ["产出文件", "来源"]) {
      const group = within(panel).getByRole("region", { name })
      expect(within(group).getByText("2")).toHaveClass("text-xs", "font-normal")
      expect(group).toHaveClass("gap-2")
      expect(group).not.toHaveClass("px-4", "py-3")
    }
    for (const row of [...downloads, ...links]) {
      expect(row).toHaveClass(
        "min-h-14",
        "border",
        "border-border",
        "bg-(--app-activity-surface)",
        "rounded-lg",
        "px-2"
      )
      expect(row.firstElementChild).toHaveClass("size-7")
      expect(row.lastElementChild).toHaveClass("size-7")
      expect(row.lastElementChild?.firstElementChild).toHaveClass(
        "size-5",
        "forced-colors:bg-[ButtonText]",
        "forced-colors:forced-color-adjust-none"
      )
    }
    expect(downloads[0].parentElement).toHaveClass("flex", "flex-col", "gap-2")
    expect(links[0].closest("ul")).toHaveClass("gap-2")
    expect(
      within(downloads[0]).getByText(
        `PDF · ${formatFileSize(artifact.size, "zh-CN")}`
      )
    ).toHaveClass("text-xs", "font-normal")
    expect(within(links[0]).getByText("example.test")).toHaveClass("text-xs")
    view.rerender(
      <ConversationTaskOverviewPanel
        {...props}
        downloadingFileId={artifact.id}
      />
    )
    expect(downloads[0]).toBeDisabled()
    expect(downloads[0].lastElementChild?.firstElementChild).toHaveClass(
      "size-5",
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
    expect(overviewButton).toHaveClass("aria-expanded:bg-transparent")
    expect(overviewCard.parentElement).toHaveStyle({
      transform: "translate(0px, 24px)",
    })
    expect(overviewCard).toHaveClass(
      "task-overview-card-border",
      "task-overview-card-shadow",
      "rounded-card",
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

  it("allows temporary controlled visibility without changing the saved preference", async () => {
    window.localStorage.setItem("linksense.taskOverviewOpen", "true")
    const panelRef = { current: null as HTMLDivElement | null }
    const onOpenChange = vi.fn()
    const props = {
      events: [],
      files: [],
      onDownload: vi.fn(),
      panelRef,
      onOpenChange,
    }
    const { rerender } = render(
      <ConversationTaskOverviewPanel {...props} open={false} />
    )
    expect(
      screen.queryByRole("region", { name: "任务概览" })
    ).not.toBeInTheDocument()
    rerender(<ConversationTaskOverviewPanel {...props} open />)
    expect(await screen.findByRole("region", { name: "任务概览" })).toBe(
      panelRef.current
    )
    expect(window.localStorage.getItem("linksense.taskOverviewOpen")).toBe(
      "true"
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("uses the shared information-overlay shadow instead of a centered halo", () => {
    expect(appStyles).toContain(
      ".task-overview-card-border {\n  border: 1px solid var(--app-border);\n}"
    )
    expect(appStyles).toContain(
      ".task-overview-card-shadow {\n  box-shadow: var(--app-task-overview-shadow);\n}"
    )
    expect(appStyles).toContain(
      "--app-task-overview-shadow: var(--app-dialog-shadow);"
    )
    expect(appStyles).not.toContain("--app-task-overview-shadow: 0 0 28px")
  })

  it("recenters the content while keeping the thread scrollbar at the outer edge", () => {
    expect(appStyles).toContain(
      "--conversation-task-overview-lane-width: 21.75rem;"
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
      ".conversation-workspace > .conversation-scroll > .conversation-column,\n.conversation-workspace\n  > .conversation-bottom-stack\n  > :not(.conversation-attribution)"
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

  it("uses the design's title hierarchy and 20px icons in 28px slots", async () => {
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
    expect(screen.getByText("任务概览")).toHaveClass("text-base", "leading-6")
    expect(screen.getByText("任务概览")).not.toHaveClass("text-sm")
    expect(screen.getByText("产出文件")).toHaveClass("text-sm")
    expect(screen.getByText("产出文件")).not.toHaveClass("text-base")
    expect(fileRow).toHaveClass("text-sm", "hover:bg-hover")
    expect(fileIcon).toHaveClass("size-5")
    expect(fileIcon?.parentElement).toHaveClass("size-7")
  })

  it("shows existing files without size metadata and keeps unavailable downloads disabled", async () => {
    render(
      <ConversationTaskOverviewPanel
        events={[]}
        files={[
          {
            ...artifact,
            name: "README",
            size: undefined,
            download_available: false,
          },
        ]}
        onDownload={vi.fn()}
      />
    )
    const download = await screen.findByRole("button", { name: "下载 README" })
    expect(download).toBeDisabled()
    expect(download).toHaveTextContent("README")
    expect(download).not.toHaveTextContent("undefined")
    expect(download).not.toHaveTextContent("NaN")
  })

  it.each([
    ["application/pdf", "PDF"],
    ["text/csv", "CSV"],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "XLSX",
    ],
  ])(
    "shows the known format for an extensionless %s file",
    async (mimeType, format) => {
      render(
        <ConversationTaskOverviewPanel
          events={[]}
          files={[{ ...artifact, name: "download", mime_type: mimeType }]}
          onDownload={vi.fn()}
        />
      )
      const download = await screen.findByRole("button", {
        name: "下载 download",
      })
      expect(download).toHaveTextContent(
        `${format} · ${formatFileSize(artifact.size, "zh-CN")}`
      )
    }
  )

  it.each(supportedLanguages)(
    "localizes file details and group labels in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      render(
        <ConversationTaskOverviewPanel
          events={[]}
          files={[artifact]}
          onDownload={vi.fn()}
        />
      )
      const panel = await screen.findByRole("region", {
        name: i18n.t("conversation.taskOverview.title"),
      })
      expect(
        within(panel).getByText(i18n.t("conversation.taskOverview.outputFiles"))
      ).toBeVisible()
      expect(
        within(panel).getByText(i18n.t("conversation.taskOverview.sources"))
      ).toBeVisible()
      expect(
        within(panel).getByText(
          `PDF · ${formatFileSize(artifact.size, language)}`.replace(
            /\s/gu,
            " "
          )
        )
      ).toBeVisible()
    }
  )
})
