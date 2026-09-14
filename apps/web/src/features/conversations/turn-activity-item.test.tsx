import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  TurnActivityItem,
  type TurnActivitySource,
} from "@/features/conversations/turn-activity-item"
import i18n from "@/i18n"

const completedTools: TurnActivitySource = {
  kind: "native",
  grouped: true,
  activities: [
    {
      method: "item/completed",
      item: {
        id: "command",
        type: "commandExecution",
        status: "completed",
        commandActions: [{ type: "unknown", command: "pnpm test" }],
      },
    },
  ],
}
const runningTools: TurnActivitySource = {
  kind: "native",
  grouped: true,
  activities: [
    {
      method: "item/started",
      item: {
        id: "command",
        type: "commandExecution",
        status: "inProgress",
        commandActions: [{ type: "unknown", command: "pnpm test" }],
      },
    },
  ],
}

describe("TurnActivityItem", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each([
    ["item/started", false, "正在压缩上下文"],
    ["item/completed", false, "上下文已压缩"],
    ["item/completed", true, "上下文已压缩"],
    ["item/started", true, "上下文压缩未完成"],
  ] as const)(
    "preserves compaction %s (stopped=%s) when given generic thinking progress",
    (method, stopped, label) => {
      const { container, rerender } = render(
        <TurnActivityItem source={completedTools} progress="thinking" />
      )
      expect(screen.getByText("正在思考")).toBeVisible()
      rerender(
        <TurnActivityItem
          source={{
            kind: "native",
            grouped: false,
            activities: [
              { method, item: { id: "compact", type: "contextCompaction" } },
            ],
          }}
          progress="thinking"
          reasoningSummary="分析下一步"
          stopped={stopped}
        />
      )
      expect(screen.getByText(label)).toBeVisible()
      expect(
        container.querySelector('[data-native-activity-icon="compact"]')
      ).toHaveClass(
        method === "item/completed"
          ? "lucide-context-compacted"
          : "lucide-context-compaction"
      )
      expect(screen.queryByText("正在思考")).not.toBeInTheDocument()
      expect(screen.queryByText("分析下一步")).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(15_000))
      expect(screen.getByText(label)).toBeVisible()
    }
  )

  it("keeps the tool disclosure open and its actual details current when the tool finishes", () => {
    const { container, rerender } = render(
      <TurnActivityItem source={runningTools} progress="active" />
    )
    const label = screen.getByText("正在运行一个命令")
    const row = label.closest('[data-slot="marker"]')
    fireEvent.click(screen.getByRole("button"))
    const details = within(screen.getByRole("list")).getByText("pnpm test")
    expect(details).toBeVisible()
    rerender(<TurnActivityItem source={completedTools} stopped />)
    expect(screen.getByText("运行了一个命令")).toBe(label)
    expect(label.closest('[data-slot="marker"]')).toBe(row)
    expect(within(screen.getByRole("list")).getByText("pnpm test")).toBe(
      details
    )
    expect(container.querySelectorAll(".shimmer")).toHaveLength(0)
  })

  it.each([undefined, "Comparing options"])(
    "never exposes a tool disclosure while displaying thinking summary %s",
    (reasoningSummary) => {
      const { container, rerender } = render(
        <TurnActivityItem
          source={completedTools}
          progress="thinking"
          reasoningSummary={reasoningSummary}
        />
      )
      const label = screen.getByText(reasoningSummary ?? "正在思考")
      expect(screen.queryByRole("button")).toBeNull()
      expect(container.querySelector(".native-activity-chevron")).toBeNull()
      fireEvent.click(label)
      expect(screen.queryByRole("list")).toBeNull()
      rerender(<TurnActivityItem source={runningTools} progress="active" />)
      expect(screen.queryByRole("button")).toBeNull()
      act(() => vi.advanceTimersByTime(1_000))
      fireEvent.click(screen.getByRole("button"))
      expect(screen.getByRole("list")).toBeVisible()
      rerender(
        <TurnActivityItem
          source={completedTools}
          progress="thinking"
          reasoningSummary={reasoningSummary}
        />
      )
      act(() => vi.advanceTimersByTime(1_000))
      expect(screen.getByText(reasoningSummary ?? "正在思考")).toBe(label)
      expect(screen.queryByRole("button")).toBeNull()
      expect(container.querySelector(".native-activity-chevron")).toBeNull()
      expect(screen.queryByRole("list")).toBeNull()
    }
  )

  it("shows completed history immediately and prevents a delayed tool label from returning", () => {
    const { container, rerender } = render(
      <TurnActivityItem source={completedTools} progress="thinking" />
    )
    act(() => vi.advanceTimersByTime(100))
    rerender(<TurnActivityItem source={runningTools} progress="active" />)
    rerender(<TurnActivityItem source={completedTools} stopped />)
    expect(screen.getByText("运行了一个命令")).toBeVisible()
    expect(container.querySelector(".shimmer")).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.queryByText("正在思考")).toBeNull()
    expect(screen.queryByText("正在运行一个命令")).toBeNull()
  })

  it("shows a command preview in the collapsed row and keeps full details expandable", () => {
    const { container } = render(
      <TurnActivityItem source={runningTools} progress="active" />
    )
    const trigger = screen.getByRole("button")
    expect(trigger).toHaveTextContent("正在运行一个命令 pnpm test")
    expect(trigger).toHaveAccessibleDescription("pnpm test")
    expect(
      container.querySelector(".native-activity-preview")
    ).toHaveTextContent("pnpm test")
    fireEvent.click(trigger)
    expect(screen.getByRole("list")).toHaveTextContent("pnpm test")
    expect(container.querySelector(".native-activity-summary")).toHaveClass(
      "truncate",
      "min-w-0"
    )
  })

  it("gives active tools priority over reasoning and switches the entire summary together", () => {
    const { container, rerender } = render(
      <TurnActivityItem
        source={completedTools}
        progress="thinking"
        reasoningSummary="Comparing options"
      />
    )
    const label = screen.getByText("Comparing options")
    expect(container.querySelector(".native-activity-preview")).toBeNull()
    rerender(
      <TurnActivityItem
        source={runningTools}
        progress="active"
        reasoningSummary="Reviewing results"
      />
    )
    expect(label).toHaveTextContent("Comparing options")
    expect(container.querySelector(".native-activity-preview")).toBeNull()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByText("正在运行一个命令")).toBe(label)
    expect(
      container.querySelector(".native-activity-preview")
    ).toHaveTextContent("pnpm test")
    expect(screen.queryByText("Reviewing results")).toBeNull()
    rerender(
      <TurnActivityItem
        source={completedTools}
        progress="thinking"
        reasoningSummary="Reviewing results"
      />
    )
    expect(container.querySelector(".native-activity-preview")).toBeNull()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByText("Reviewing results")).toBe(label)
    expect(container.querySelector(".native-activity-preview")).toBeNull()
  })

  it("hides legacy tool badges when the row is showing thinking or reasoning", () => {
    const source: TurnActivitySource = {
      kind: "legacy",
      id: "files",
      label: "已使用文件服务",
      running: false,
      capabilityName: "LinkSense File Service",
    }
    const { container, rerender } = render(
      <TurnActivityItem source={source} progress="thinking" />
    )
    expect(screen.getByText("正在思考")).toBeVisible()
    expect(screen.queryByText("LinkSense File Service")).toBeNull()
    rerender(
      <TurnActivityItem
        source={source}
        progress="thinking"
        reasoningSummary="Reviewing results"
      />
    )
    expect(screen.getByText("Reviewing results")).toBeVisible()
    expect(container.querySelector(".trace-chip")).toBeNull()
    rerender(<TurnActivityItem source={source} stopped />)
    expect(screen.getByText("LinkSense File Service")).toBeVisible()
  })

  it.each([
    ["zh-CN", "正在思考", "正在运行一个命令"],
    ["en-US", "Thinking", "Running a command"],
    ["fr-FR", "正在思考", "正在运行一个命令"],
  ])(
    "renders %s labels and preserves the row through translated status changes",
    async (language, thinkingLabel, toolLabel) => {
      await i18n.changeLanguage(language)
      const { rerender } = render(
        <TurnActivityItem source={{ kind: "thinking" }} progress="thinking" />
      )
      const label = screen.getByText(thinkingLabel)
      rerender(
        <TurnActivityItem
          source={{ kind: "thinking" }}
          progress="thinking"
          reasoningSummary="Comparing options"
        />
      )
      expect(screen.getByText("Comparing options")).toBe(label)
      rerender(
        <TurnActivityItem
          source={{ kind: "thinking" }}
          progress="thinking"
          reasoningSummary="  "
        />
      )
      expect(screen.getByText(thinkingLabel)).toBe(label)
      rerender(<TurnActivityItem source={runningTools} progress="active" />)
      act(() => vi.advanceTimersByTime(1_000))
      expect(screen.getByText(toolLabel)).toBe(label)
      expect(screen.getByRole("button")).toHaveAccessibleName(
        i18n.t("conversation.nativeActivityDetails.expand", {
          activity: toolLabel,
        })
      )
    }
  )
})
