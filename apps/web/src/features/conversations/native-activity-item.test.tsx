import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NativeCodexItem } from "@/api/contracts"
import { NativeActivityItem } from "@/features/conversations/native-activity-item"
import { buildNativeActivityViewModel } from "@/features/conversations/native-activity-view-model"
import i18n from "@/i18n"

describe("NativeActivityItem", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("adds a busy shimmer while a tool is running and removes it on completion", () => {
    const runningItem = {
      id: "running-command",
      type: "commandExecution" as const,
      status: "inProgress" as const,
      commandActions: [],
      command: "pnpm test",
    }
    const { container, rerender } = render(
      <NativeActivityItem method="item/started" item={runningItem} />
    )

    const runningLabel = screen.getByText("正在运行一个命令")
    const runningActivity = container.querySelector(".native-activity-item")
    expect(runningLabel.closest(".native-activity-summary")).toHaveClass(
      "shimmer"
    )
    expect(runningActivity).toHaveAttribute("data-running", "true")
    expect(runningActivity).toHaveAttribute("aria-busy", "true")
    expect(runningLabel.closest('[data-slot="marker-content"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="marker-icon"]')).not.toBeNull()

    rerender(
      <NativeActivityItem
        method="item/completed"
        item={{ ...runningItem, status: "completed" }}
      />
    )

    const completedLabel = screen.getByText("运行了一个命令")
    const completedActivity = container.querySelector(".native-activity-item")
    expect(completedLabel.closest(".native-activity-summary")).not.toHaveClass(
      "shimmer"
    )
    expect(completedActivity).not.toHaveAttribute("data-running")
    expect(completedActivity).not.toHaveAttribute("aria-busy")
  })

  it("filters a running reasoning item from the activity timeline", () => {
    const { container } = render(
      <NativeActivityItem
        method="item/started"
        item={{
          id: "reasoning-running",
          type: "reasoning",
          summary: ["正在确认组件结构"],
        }}
      />
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText("正在确认组件结构")).toBeNull()
    expect(screen.queryByText("思考内容")).toBeNull()
  })

  it("filters a completed reasoning summary from the activity timeline", () => {
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "reasoning-markdown",
          type: "reasoning",
          summary: [
            "## 幻灯片规划\n\n1. **标题页**：发展历程\n2. `时间线`：关键节点",
          ],
        }}
      />
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("heading", { name: "幻灯片规划" })).toBeNull()
    expect(screen.queryByText("思考内容")).toBeNull()
  })

  it("renders an interrupted native item as static completed history", () => {
    const { container } = render(
      <NativeActivityItem
        method="item/started"
        stopped
        item={{
          id: "interrupted-command",
          type: "commandExecution",
          status: "inProgress",
          command: "pnpm test",
          commandActions: [],
        }}
      />
    )

    const activity = container.querySelector(".native-activity-item")
    expect(screen.getByText("运行了一个命令")).toBeVisible()
    expect(activity).not.toHaveAttribute("data-running")
    expect(activity).not.toHaveAttribute("aria-busy")
    expect(activity?.querySelector(".shimmer")).toBeNull()
  })

  it("groups sanitized commands in a collapsed accessible activity", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "command-1",
          type: "commandExecution",
          status: "completed",
          command: "pnpm ignored-top-level",
          commandActions: [
            { type: "unknown", command: "pnpm test" },
            { type: "search", command: "rg TODO apps/web" },
            { type: "unknown", command: "pnpm typecheck" },
            { type: "unknown", command: "pnpm test" },
          ],
          source: "agent",
          exitCode: 0,
          durationMs: 1250,
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“已读取文件 运行了多个命令”的详情",
    })
    const activityMain = trigger.querySelector(":scope > .activity-item-main")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(activityMain).not.toBeNull()
    expect(activityMain).toHaveAttribute("data-slot", "marker")
    expect(
      activityMain?.querySelector(
        ".native-activity-chevron .lucide-chevron-right"
      )
    ).not.toBeNull()
    expect(
      container.querySelector('[data-native-activity-icon="file-search"]')
    ).toHaveClass("size-3.5")
    expect(container.querySelector(".lucide-circle-check")).toBeNull()
    expect(screen.queryByText("pnpm test", { selector: "code" })).toBeNull()
    expect(screen.getByText("已读取文件 运行了多个命令")).toBeVisible()
    expect(screen.queryByText("pnpm ignored-top-level")).toBeNull()

    await interaction.click(trigger)

    expect(
      screen.getByRole("button", {
        name: "收起“已读取文件 运行了多个命令”的详情",
      })
    ).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByText("pnpm test", { selector: "code" })).toHaveLength(
      2
    )
    expect(
      screen.getByText("rg TODO apps/web", { selector: "code" })
    ).toBeVisible()
    expect(
      screen.getByText("pnpm typecheck", { selector: "code" })
    ).toBeVisible()
    const commandItems = screen.getAllByRole("listitem")
    expect(commandItems).toHaveLength(4)
    expect(
      commandItems[0]?.closest(".native-command-activity-details")
    ).not.toBeNull()
    expect(
      commandItems.every((item) => item.querySelector("svg") === null)
    ).toBe(true)
    expect(screen.queryByText("操作")).toBeNull()
    expect(screen.queryByText("来源")).toBeNull()
    expect(screen.queryByText("退出码")).toBeNull()
    expect(screen.queryByText("耗时")).toBeNull()
    expect(screen.queryByText("Agent")).toBeNull()
    expect(screen.queryByText("0", { selector: "code" })).toBeNull()
    expect(screen.queryByText("1.3 s")).toBeNull()
  })

  it("updates one command group as adjacent executions stream in", async () => {
    const interaction = userEvent.setup()
    const firstRunning = {
      id: "command-stream-1",
      type: "commandExecution" as const,
      status: "inProgress" as const,
      command: "pnpm test",
      commandActions: [{ type: "unknown" as const, command: "pnpm test" }],
    } satisfies NativeCodexItem
    const firstCompleted = {
      ...firstRunning,
      status: "completed" as const,
    } satisfies NativeCodexItem
    const secondRunning = {
      id: "command-stream-2",
      type: "commandExecution" as const,
      status: "inProgress" as const,
      command: "pnpm typecheck",
      commandActions: [{ type: "unknown" as const, command: "pnpm typecheck" }],
    } satisfies NativeCodexItem
    const secondCompleted = {
      ...secondRunning,
      status: "completed" as const,
    } satisfies NativeCodexItem
    const { container, rerender } = render(
      <NativeActivityItem
        method="item/started"
        item={firstRunning}
        commandActivities={[{ item: firstRunning, method: "item/started" }]}
      />
    )

    expect(screen.getByText("正在运行一个命令")).toBeVisible()
    expect(container.querySelector(".native-activity-item")).toHaveAttribute(
      "data-running",
      "true"
    )

    rerender(
      <NativeActivityItem
        method="item/completed"
        item={firstCompleted}
        commandActivities={[
          { item: firstCompleted, method: "item/completed" },
          { item: secondRunning, method: "item/started" },
        ]}
      />
    )

    expect(screen.getByText("运行了一个命令 正在运行一个命令")).toBeVisible()
    expect(container.querySelector(".native-activity-item")).toHaveAttribute(
      "data-running",
      "true"
    )

    rerender(
      <NativeActivityItem
        method="item/completed"
        item={firstCompleted}
        commandActivities={[
          { item: firstCompleted, method: "item/completed" },
          { item: secondCompleted, method: "item/completed" },
        ]}
      />
    )

    expect(screen.getByText("运行了多个命令")).toBeVisible()
    expect(
      container.querySelector(".native-activity-item")
    ).not.toHaveAttribute("data-running")

    await interaction.click(
      screen.getByRole("button", {
        name: "展开“运行了多个命令”的详情",
      })
    )

    const commandItems = screen.getAllByRole("listitem")
    expect(commandItems).toHaveLength(2)
    expect(commandItems[0]).toHaveClass("native-command-detail-item")
    expect(commandItems[1]).toHaveClass("native-command-detail-item")
    expect(within(commandItems[0]!).getByText("pnpm test")).toBeVisible()
    expect(within(commandItems[1]!).getByText("pnpm typecheck")).toBeVisible()
  })

  it("matches the Codex Desktop semantic summary for adjacent tool activity", async () => {
    const interaction = userEvent.setup()
    const skillAndExplorationCommand = {
      id: "semantic-command-1",
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
    const secondCommand = {
      id: "semantic-command-2",
      type: "commandExecution" as const,
      status: "completed" as const,
      commandActions: [
        {
          type: "unknown" as const,
          command: "pnpm --filter @linksense/web typecheck",
        },
      ],
    } satisfies NativeCodexItem
    const fileChange = {
      id: "semantic-file-change",
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
    const webSearch = {
      id: "semantic-web-search",
      type: "webSearch" as const,
      query: "Codex app-server schema",
      action: {
        type: "search" as const,
        query: "Codex app-server schema",
        queries: ["Codex app-server schema"],
      },
    } satisfies NativeCodexItem

    render(
      <NativeActivityItem
        method="item/completed"
        item={skillAndExplorationCommand}
        activityGroup={[
          { item: skillAndExplorationCommand, method: "item/completed" },
          { item: fileChange, method: "item/completed" },
          { item: secondCommand, method: "item/completed" },
          { item: webSearch, method: "item/completed" },
        ]}
      />
    )

    const semanticSummary =
      "已加载工具 编辑了多个文件 读取文件 运行了多个命令 已搜索网页"
    const trigger = screen.getByRole("button", {
      name: `展开“${semanticSummary}”的详情`,
    })
    expect(screen.getByText(semanticSummary)).toBeVisible()

    await interaction.click(trigger)

    const fileDetails = screen.getByRole("list", { name: "文件变更详情" })
    expect(within(fileDetails).getAllByRole("listitem")).toHaveLength(2)
    expect(
      within(fileDetails).getAllByText("$WORKSPACE/apps/web/src/new-view.tsx", {
        selector: "code",
      })
    ).toHaveLength(1)
  })

  it("classifies node repl as a command and preserves dynamic tool names", () => {
    const nodeRepl = {
      id: "semantic-node-repl",
      type: "mcpToolCall" as const,
      server: "node_repl",
      tool: "js",
      status: "completed" as const,
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
      <NativeActivityItem
        method="item/completed"
        item={nodeRepl}
        activityGroup={[
          { item: nodeRepl, method: "item/completed" },
          { item: dynamicTool, method: "item/completed" },
          { item: dynamicTool, method: "item/completed" },
        ]}
      />
    )

    expect(
      screen.getByText("运行了一个命令 imagegen · render_image")
    ).toBeVisible()
    expect(screen.queryByText("调用了一个工具")).toBeNull()
    expect(screen.getAllByText(/imagegen · render_image/)).toHaveLength(1)
  })

  it("renders knowledge retrieval as a localized non-expandable activity", async () => {
    const running = {
      id: "knowledge-search-1",
      type: "mcpToolCall" as const,
      server: "linksense_core",
      tool: "search_knowledge_base",
      status: "inProgress" as const,
    }
    const { rerender } = render(
      <NativeActivityItem method="item/started" item={running} />
    )

    expect(screen.getByText("正在检索知识库")).toBeVisible()
    expect(screen.queryByText("linksense_core")).toBeNull()
    expect(screen.queryByText("search_knowledge_base")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()

    rerender(
      <NativeActivityItem
        method="item/completed"
        item={{ ...running, status: "completed" }}
      />
    )
    expect(screen.getByText("已完成知识库检索")).toBeVisible()

    rerender(
      <NativeActivityItem
        method="item/completed"
        item={{ ...running, status: "failed" }}
      />
    )
    expect(screen.getByText("知识库检索失败")).toBeVisible()

    const noAvailableBases = {
      ...running,
      status: "completed" as const,
      failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES" as const,
    }
    rerender(
      <NativeActivityItem method="item/completed" item={noAvailableBases} />
    )
    expect(screen.getByText("本轮没有可用的知识库")).toBeVisible()
    expect(screen.queryByText("KNOWLEDGE_NO_AVAILABLE_BASES")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()

    await i18n.changeLanguage("en-US")
    rerender(
      <NativeActivityItem method="item/completed" item={noAvailableBases} />
    )
    expect(
      screen.getByText("No knowledge bases are available for this run")
    ).toBeVisible()
  })

  it("deduplicates changed paths across adjacent file-change items", async () => {
    const interaction = userEvent.setup()
    const firstChange = {
      id: "semantic-file-dedupe-1",
      type: "fileChange" as const,
      status: "completed" as const,
      changes: [
        {
          path: "$WORKSPACE/apps/web/src/app.tsx",
          kind: { type: "update" as const },
        },
      ],
    } satisfies NativeCodexItem
    const secondChange = {
      id: "semantic-file-dedupe-2",
      type: "fileChange" as const,
      status: "completed" as const,
      changes: [
        {
          path: "$WORKSPACE/apps/web/src/app.tsx",
          kind: { type: "update" as const },
        },
      ],
    } satisfies NativeCodexItem

    render(
      <NativeActivityItem
        method="item/completed"
        item={firstChange}
        activityGroup={[
          { item: firstChange, method: "item/completed" },
          { item: secondChange, method: "item/completed" },
        ]}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“编辑了一个文件”的详情",
    })
    await interaction.click(trigger)

    const details = screen.getByRole("list", { name: "文件变更详情" })
    expect(within(details).getAllByRole("listitem")).toHaveLength(1)
  })

  it("shows MCP identity and safe metadata only after expansion", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "mcp-1",
          type: "mcpToolCall",
          status: "completed",
          server: "documents-server",
          tool: "create_document",
          pluginId: "documents-plugin",
          durationMs: 80,
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“documents-server · create_document”的详情",
    })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(
      container.querySelector('[data-native-activity-icon="document"]')
    ).toHaveClass("size-3.5")
    expect(container.querySelector(".lucide-circle-check")).toBeNull()
    expect(screen.queryByText("documents-plugin")).toBeNull()

    await interaction.click(trigger)

    const details = screen.getByText("documents-plugin").closest("dl")
    expect(details).not.toBeNull()
    expect(within(details as HTMLElement).getByText("服务")).toBeVisible()
    expect(
      within(details as HTMLElement).getByText("documents-server", {
        selector: "code",
      })
    ).toBeVisible()
    expect(
      within(details as HTMLElement).getByText("create_document", {
        selector: "code",
      })
    ).toBeVisible()
    expect(within(details as HTMLElement).getByText("80 ms")).toBeVisible()
  })

  it("expands file-change details while retaining the file type icon", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "file-change-1",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "$WORKSPACE/apps/web/src/app.tsx",
              kind: { type: "update" },
            },
            {
              path: "$WORKSPACE/apps/web/src/new-view.tsx",
              kind: { type: "add" },
            },
          ],
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“已更新 2 个文件”的详情",
    })
    expect(container.querySelector(".lucide-file-pen-line")).toHaveClass(
      "size-3.5"
    )
    expect(container.querySelector(".lucide-circle-check")).toBeNull()

    await interaction.click(trigger)

    const details = screen.getByRole("list", { name: "文件变更详情" })
    expect(
      within(details).getByText("$WORKSPACE/apps/web/src/app.tsx", {
        selector: "code",
      })
    ).toBeVisible()
    expect(
      within(details).getByText("$WORKSPACE/apps/web/src/new-view.tsx", {
        selector: "code",
      })
    ).toBeVisible()
    expect(within(details).getByText("更新")).toBeVisible()
    expect(within(details).getByText("新增")).toBeVisible()
  })

  it("expands failed dynamic-tool details while retaining the tool type icon", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "dynamic-tool-1",
          type: "dynamicToolCall",
          status: "failed",
          namespace: "imagegen",
          tool: "render_image",
          success: false,
          durationMs: 220,
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“imagegen · render_image”的详情",
    })
    expect(
      container.querySelector('[data-native-activity-icon="image-generation"]')
    ).toHaveClass("size-3.5")
    expect(container.querySelector(".lucide-circle-x")).toBeNull()

    await interaction.click(trigger)

    const details = screen.getByText("命名空间").closest("dl")
    expect(details).not.toBeNull()
    expect(
      within(details as HTMLElement).getByText("imagegen", {
        selector: "code",
      })
    ).toBeVisible()
    expect(
      within(details as HTMLElement).getByText("render_image", {
        selector: "code",
      })
    ).toBeVisible()
    expect(within(details as HTMLElement).getByText("失败")).toBeVisible()
    expect(within(details as HTMLElement).getByText("220 ms")).toBeVisible()
  })

  it("expands web-search queries and safe action metadata", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "web-search-1",
          type: "webSearch",
          query: "Codex app-server schema",
          action: {
            type: "findInPage",
            url: "https://developers.openai.com/codex/app-server",
            pattern: "event schema",
          },
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“Codex app-server schema”的详情",
    })
    expect(
      container.querySelector('[data-native-activity-icon="web"]')
    ).toHaveClass("size-3.5")
    expect(container.querySelector(".lucide-circle-check")).toBeNull()

    await interaction.click(trigger)

    const queries = screen.getByRole("list", { name: "搜索查询详情" })
    expect(
      within(queries).getByText("Codex app-server schema", {
        selector: "code",
      })
    ).toBeVisible()
    const details = screen.getByText("动作").closest("dl")
    expect(details).not.toBeNull()
    expect(within(details as HTMLElement).getByText("页内查找")).toBeVisible()
    expect(
      within(details as HTMLElement).getByText(
        "https://developers.openai.com/codex/app-server",
        { selector: "code" }
      )
    ).toBeVisible()
    expect(
      within(details as HTMLElement).getByText("event schema", {
        selector: "code",
      })
    ).toBeVisible()
  })

  it("expands image-view details while retaining the image type icon", async () => {
    const interaction = userEvent.setup()
    const fileId = "30000000-0000-4000-8000-000000000001"
    const onPreviewImage = vi.fn()
    const loadArtifactPreview = vi.fn(async () => ({
      url: "https://files.example/preview.png",
      expiresAt: "2999-01-01T00:00:00.000Z",
    }))
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "image-view-1",
          type: "imageView",
          path: "$WORKSPACE/artifacts/preview.png",
          fileId,
        }}
        artifactFilesById={
          new Map([
            [
              fileId,
              {
                id: fileId,
                name: "preview.png",
                mime_type: "image/png",
                size: 2_048,
                kind: "artifact",
                download_available: true,
              },
            ],
          ])
        }
        loadArtifactPreview={loadArtifactPreview}
        onPreviewImage={onPreviewImage}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“已查看图像”的详情",
    })
    expect(container.querySelector(".lucide-image")).toHaveClass("size-3.5")
    expect(container.querySelector(".lucide-circle-check")).toBeNull()

    await interaction.click(trigger)

    const details = screen.getByText("路径").closest("dl")
    expect(details).not.toBeNull()
    expect(
      within(details as HTMLElement).getByText(
        "$WORKSPACE/artifacts/preview.png",
        { selector: "code" }
      )
    ).toBeVisible()
    expect(
      await screen.findByRole("img", { name: "preview.png" })
    ).toHaveAttribute("src", "https://files.example/preview.png")
    const previewButton = screen.getByRole("button", {
      name: "预览图片 preview.png",
    })
    expect(previewButton).toHaveClass("native-activity-image-preview-trigger")
    expect(screen.getByRole("img", { name: "preview.png" })).toHaveClass(
      "native-activity-image-preview-image"
    )
    expect(loadArtifactPreview).toHaveBeenCalledOnce()

    await interaction.click(previewButton)

    expect(onPreviewImage).toHaveBeenCalledWith({
      id: fileId,
      name: "preview.png",
      src: "https://files.example/preview.png",
      alt: "preview.png",
      downloadable: true,
    })
    expect(screen.queryByRole("dialog", { name: "图片预览" })).toBeNull()
  })

  it("renders failed image-view previews as a retryable status card", async () => {
    const interaction = userEvent.setup()
    const fileId = "30000000-0000-4000-8000-000000000002"
    const loadArtifactPreview = vi.fn(async () => {
      throw new Error("preview load failed")
    })

    render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "image-view-error",
          type: "imageView",
          path: "$CODEX_HOME/.agents/skills/dashi-ppt/assets/skill/theme-style-grid.png",
          fileId,
        }}
        artifactFilesById={
          new Map([
            [
              fileId,
              {
                id: fileId,
                name: "theme-style-grid.png",
                mime_type: "image/png",
                size: 2_048,
                kind: "artifact",
                download_available: true,
              },
            ],
          ])
        }
        loadArtifactPreview={loadArtifactPreview}
      />
    )

    await interaction.click(
      screen.getByRole("button", {
        name: "展开“已查看图像”的详情",
      })
    )

    const errorCard = await screen.findByRole("img", {
      name: "无法预览图片 theme-style-grid.png",
    })
    expect(errorCard).toHaveClass(
      "assistant-inline-image-state",
      "assistant-inline-image-error"
    )
    expect(screen.getByRole("button", { name: "重试" })).toHaveClass(
      "assistant-inline-image-retry"
    )
    expect(loadArtifactPreview).toHaveBeenCalledOnce()
  })

  it("supports Enter and Space for expanding details", async () => {
    const interaction = userEvent.setup()
    render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "keyboard-command",
          type: "commandExecution",
          status: "completed",
          commandActions: [],
          command: "pnpm test",
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“运行了一个命令”的详情",
    })
    trigger.focus()

    await interaction.keyboard("{Enter}")
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()

    await interaction.keyboard("{Enter}")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await interaction.keyboard(" ")
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()
  })

  it("updates its internal state while notifying an optional open observer", async () => {
    const interaction = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <NativeActivityItem
        method="item/completed"
        onOpenChange={onOpenChange}
        item={{
          id: "observed-command",
          type: "commandExecution",
          status: "completed",
          commandActions: [],
          command: "pnpm test",
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "展开“运行了一个命令”的详情",
    })
    await interaction.click(trigger)

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()
  })

  it("keeps a historical command activity visible without inventing command text", () => {
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "historical-command",
          type: "commandExecution",
          status: "completed",
          commandActions: [{ type: "search" }],
          source: "agent",
          exitCode: 0,
          durationMs: 1250,
        }}
      />
    )

    expect(container.querySelector(".native-activity-item")).toBeVisible()
    expect(screen.getByText("已读取文件")).toBeVisible()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps a failed Codex command available without showing a failure badge", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "failed-command",
          type: "commandExecution",
          status: "failed",
          commandActions: [],
          command: "pnpm test",
        }}
      />
    )

    expect(screen.getByText("运行了一个命令")).toBeVisible()
    expect(screen.queryByText("pnpm test")).toBeNull()
    expect(screen.queryByText("pnpm test", { selector: "code" })).toBeNull()
    expect(screen.queryByText("执行失败")).toBeNull()
    expect(container.querySelector(".native-activity-status")).toBeNull()
    expect(
      container.querySelector('[data-native-activity-icon="test"]')
    ).toHaveClass("size-3.5")
    expect(container.querySelector(".lucide-circle-x")).toBeNull()
    expect(container.querySelector(".lucide-circle-check")).toBeNull()

    await interaction.click(
      screen.getByRole("button", {
        name: "展开“运行了一个命令”的详情",
      })
    )
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()
  })

  it("renders the command summary and accessible controls in English", async () => {
    await i18n.changeLanguage("en-US")
    const interaction = userEvent.setup()
    render(
      <NativeActivityItem
        method="item/completed"
        item={{
          id: "command-en",
          type: "commandExecution",
          status: "completed",
          commandActions: [],
          command: "pnpm test",
        }}
      />
    )

    const trigger = screen.getByRole("button", {
      name: "Expand details for Ran a command",
    })
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await interaction.click(trigger)

    expect(
      screen.getByRole("button", {
        name: "Collapse details for Ran a command",
      })
    ).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("pnpm test", { selector: "code" })).toBeVisible()
  })

  it("uses Codex reasoning summaries and plan text without exposing details", () => {
    const reasoning = buildNativeActivityViewModel(
      {
        id: "reasoning-1",
        type: "reasoning",
        summary: ["确认真实事件字段", "规划展示顺序"],
      },
      "item/completed"
    )
    const plan = buildNativeActivityViewModel(
      {
        id: "plan-1",
        type: "plan",
        text: "按 Codex 最终计划执行",
      },
      "item/completed"
    )

    expect(reasoning.expandable).toBe(false)
    expect(plan.expandable).toBe(false)
    expect(reasoning.summary).toBe("确认真实事件字段 · 规划展示顺序")
    expect(plan.summary).toBe("按 Codex 最终计划执行")
  })

  it("supplies localized semantic labels for native items without previews", () => {
    expect(
      buildNativeActivityViewModel(
        {
          id: "collab-1",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
        },
        "item/completed"
      ).summaryKey
    ).toBe("conversation.nativeActivities.collabAgentCompleted")
    expect(
      buildNativeActivityViewModel(
        {
          id: "subagent-1",
          type: "subAgentActivity",
          kind: "interacted",
        },
        "item/completed"
      ).summaryKey
    ).toBe("conversation.nativeActivities.subAgentUpdated")
    expect(
      buildNativeActivityViewModel(
        {
          id: "subagent-completed-1",
          type: "subAgentActivity",
          kind: "completed",
        },
        "item/completed"
      ).summaryKey
    ).toBe("conversation.nativeActivities.subAgentCompleted")
    expect(
      buildNativeActivityViewModel(
        { id: "sleep-1", type: "sleep", durationMs: 2500 },
        "item/completed"
      ).summary
    ).toBe("2500 ms")
    expect(
      buildNativeActivityViewModel(
        {
          id: "image-generation-1",
          type: "imageGeneration",
          status: "completed",
          revisedPrompt: "A warm yellow circle",
          savedPath: "$WORKSPACE/artifacts/circle.png",
        },
        "item/completed"
      ).summaryKey
    ).toBe("conversation.nativeActivities.imageGenerationCompleted")
    expect(
      buildNativeActivityViewModel(
        {
          id: "review-1",
          type: "enteredReviewMode",
          review: "Review the current changes",
        },
        "item/completed"
      ).summaryKey
    ).toBe("conversation.nativeActivities.enteredReviewMode")
    expect(
      buildNativeActivityViewModel(
        { id: "reasoning-empty", type: "reasoning" },
        "item/completed"
      ).summary
    ).toBeNull()
    expect(
      buildNativeActivityViewModel(
        { id: "compact-1", type: "contextCompaction" },
        "item/completed"
      ).summaryKey
    ).toBe("conversation.nativeActivities.contextCompactionCompleted")
  })

  it("renders the context-compaction lifecycle labels", () => {
    const item = {
      id: "compact-exact-label",
      type: "contextCompaction" as const,
    }
    const { rerender } = render(
      <NativeActivityItem method="item/started" item={item} />
    )

    expect(screen.getByText("正在压缩上下文")).toBeVisible()
    expect(screen.queryByRole("button")).toBeNull()

    rerender(<NativeActivityItem method="item/completed" item={item} />)

    expect(screen.getByText("上下文已压缩")).toBeVisible()
    expect(screen.queryByText("正在压缩上下文")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("does not report a started context compaction as completed after the turn stops", async () => {
    const item = {
      id: "compact-stopped-before-completion",
      type: "contextCompaction" as const,
    }
    const { rerender } = render(
      <NativeActivityItem method="item/started" item={item} stopped />
    )

    expect(screen.getByText("上下文压缩未完成")).toBeVisible()
    expect(screen.queryByText("正在压缩上下文")).toBeNull()
    expect(screen.queryByText("上下文已压缩")).toBeNull()

    await i18n.changeLanguage("en-US")
    rerender(<NativeActivityItem method="item/started" item={item} stopped />)

    expect(
      screen.getByText("Context compaction did not complete")
    ).toBeVisible()
  })
})
