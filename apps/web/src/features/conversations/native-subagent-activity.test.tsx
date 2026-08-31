import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NativeCodexItem } from "@/api/contracts"
import {
  NativeSubAgentActivityGroup,
  NativeSubAgentActivityItem,
} from "@/features/conversations/native-activity-item"
import {
  buildNativeSubAgentActivityViewModels,
  type NativeSubAgentState,
} from "@/features/conversations/native-subagent-activity"
import i18n from "@/i18n"

const agentKeyA = `agent_${"a".repeat(24)}`
const agentKeyB = `agent_${"b".repeat(24)}`
const agentKeyC = `agent_${"c".repeat(24)}`

type TestCollabItem = Extract<
  NativeCodexItem,
  { type: "collabAgentToolCall" }
> & {
  agents: Array<{
    agentKey: string
    agentLabel?: string
    status: NativeSubAgentState | null
  }>
}

type TestSubAgentActivityItem = Extract<
  NativeCodexItem,
  { type: "subAgentActivity" }
> & {
  agentKey: string
  agentLabel?: string
}

function collabItem({
  id,
  status,
  agents,
  tool = "spawnAgent",
}: {
  id: string
  status: "inProgress" | "completed" | "failed" | "interrupted"
  agents: TestCollabItem["agents"]
  tool?:
    | "spawnAgent"
    | "sendInput"
    | "resumeAgent"
    | "wait"
    | "closeAgent"
    | "sendMessage"
    | "followupTask"
    | "interruptAgent"
    | "listAgents"
}): TestCollabItem {
  return {
    id,
    type: "collabAgentToolCall",
    tool,
    status,
    agents,
  }
}

function subAgentActivityItem({
  id,
  kind,
  agentKey,
  agentLabel,
}: {
  id: string
  kind: "started" | "interacted" | "interrupted" | "completed"
  agentKey: string
  agentLabel?: string
}): TestSubAgentActivityItem {
  return {
    id,
    type: "subAgentActivity",
    kind,
    agentKey,
    ...(agentLabel ? { agentLabel } : {}),
  }
}

describe("native subagent activity", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("aggregates safe native collaboration states for a turn and resolves labels without exposing agent keys", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-spawn",
          status: "completed",
          agents: [
            { agentKey: agentKeyA, status: "running" },
            { agentKey: agentKeyB, status: "running" },
          ],
        }),
      },
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "subagent-update",
          kind: "interacted",
          agentKey: agentKeyA,
          agentLabel: "前端链接接入",
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-completed",
          status: "completed",
          agents: [
            { agentKey: agentKeyA, status: "completed" },
            { agentKey: agentKeyB, status: "completed" },
          ],
        }),
      },
    ])

    expect(models).toHaveLength(3)
    expect(models[0]).toMatchObject({
      itemId: "collab-spawn",
      source: "collaboration",
      status: "started",
      running: false,
      agents: [
        { ordinal: 1, label: "前端链接接入", status: "started" },
        { ordinal: 2, label: null, status: "started" },
      ],
    })
    expect(models[1]).toMatchObject({
      itemId: "subagent-update",
      source: "activity",
      status: "updated",
      running: false,
      agents: [{ ordinal: 1, label: "前端链接接入", status: "updated" }],
    })
    expect(models[2]).toMatchObject({
      itemId: "collab-completed",
      source: "collaboration",
      status: "completed",
      running: false,
    })
  })

  it("keeps native started, working, and updated activity labels while agents are active", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-started",
          status: "completed",
          agents: [{ agentKey: agentKeyA, status: "running" }],
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-working",
          status: "completed",
          tool: "wait",
          agents: [{ agentKey: agentKeyA, status: "running" }],
        }),
      },
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "subagent-updated",
          kind: "interacted",
          agentKey: agentKeyA,
          agentLabel: "状态审计",
        }),
      },
    ])

    expect(models.map((model) => model.status)).toEqual(["started", "updated"])
    expect(models.map((model) => model.running)).toEqual([false, true])

    const { container } = render(
      <>
        {models.map((model) => (
          <NativeSubAgentActivityItem key={model.itemId} activity={model} />
        ))}
      </>
    )
    expect(screen.getByText("已开始工作")).toBeVisible()
    expect(screen.queryByText("正在工作中")).toBeNull()
    expect(screen.getByText("已更新")).not.toHaveClass("shimmer")
    expect(
      container.querySelectorAll(
        '.native-subagent-activity[data-running="true"]'
      )
    ).toHaveLength(1)
  })

  it("treats a spawn-time notFound snapshot as initialization instead of flashing a terminal status", () => {
    const models = buildNativeSubAgentActivityViewModels(
      [
        {
          method: "item/started",
          item: collabItem({
            id: "collab-initializing",
            status: "inProgress",
            agents: [{ agentKey: agentKeyA, status: "notFound" }],
          }),
        },
        {
          method: "item/completed",
          item: subAgentActivityItem({
            id: "subagent-started",
            kind: "started",
            agentKey: agentKeyA,
            agentLabel: "纽约概览",
          }),
        },
      ],
      {
        summaries: [
          {
            agentKey: agentKeyA,
            agentLabel: "纽约概览",
            status: "notFound",
          },
        ],
      }
    )

    expect(models).toHaveLength(2)
    expect(models).toEqual([
      expect.objectContaining({
        itemId: "collab-initializing",
        status: "started",
        running: false,
        agents: [expect.objectContaining({ status: "started" })],
      }),
      expect.objectContaining({
        itemId: "subagent-started",
        status: "started",
        running: true,
        agents: [
          expect.objectContaining({ label: "纽约概览", status: "started" }),
        ],
      }),
    ])

    render(<NativeSubAgentActivityGroup activities={models} />)
    expect(screen.getByText("已开始工作")).toBeVisible()
    expect(screen.queryByText("未找到")).toBeNull()
  })

  it("preserves earlier native activity labels after agents complete", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-started",
          status: "completed",
          agents: [{ agentKey: agentKeyA, status: "running" }],
        }),
      },
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "subagent-updated",
          kind: "interacted",
          agentKey: agentKeyA,
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-completed",
          status: "completed",
          tool: "wait",
          agents: [{ agentKey: agentKeyA, status: "completed" }],
        }),
      },
    ])

    expect(models.map((model) => model.status)).toEqual([
      "started",
      "updated",
      "completed",
    ])
    expect(models.every((model) => !model.running)).toBe(true)
  })

  it("suppresses redundant spawn and repeated terminal snapshots", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "spawn-all",
          status: "completed",
          agents: [
            { agentKey: agentKeyA, status: "running" },
            { agentKey: agentKeyB, status: "running" },
            { agentKey: agentKeyC, status: "running" },
          ],
        }),
      },
      ...[agentKeyA, agentKeyB, agentKeyC].map((agentKey, index) => ({
        method: "item/completed" as const,
        item: subAgentActivityItem({
          id: `agent-${index + 1}-started`,
          kind: "started",
          agentKey,
          agentLabel: `纽约子任务 ${index + 1}`,
        }),
      })),
      ...[agentKeyB, agentKeyA, agentKeyC].map((agentKey, index) => ({
        method: "item/completed" as const,
        item: collabItem({
          id: `agent-${index + 1}-completed`,
          status: "completed",
          tool: "wait",
          agents: [{ agentKey, status: "completed" }],
        }),
      })),
      {
        method: "item/completed",
        item: collabItem({
          id: "repeated-all-completed",
          status: "completed",
          tool: "wait",
          agents: [
            { agentKey: agentKeyA, status: "completed" },
            { agentKey: agentKeyB, status: "completed" },
            { agentKey: agentKeyC, status: "completed" },
          ],
        }),
      },
    ])

    expect(models.map((model) => model.itemId)).toEqual([
      "agent-1-started",
      "agent-2-started",
      "agent-3-started",
      "agent-1-completed",
      "agent-2-completed",
      "agent-3-completed",
    ])
  })

  it("uses a localized ordinal when no safe agent label is available", () => {
    const [activity] = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-no-label",
          status: "completed",
          agents: [{ agentKey: agentKeyA, status: "completed" }],
        }),
      },
    ])
    if (!activity) throw new Error("Missing subagent activity")

    const { container } = render(
      <NativeSubAgentActivityItem activity={activity} />
    )

    expect(screen.getByText("子智能体 1")).toBeVisible()
    expect(screen.getByText("已完成")).toBeVisible()
    expect(screen.queryByText(agentKeyA)).toBeNull()
    expect(
      container.querySelector(".native-subagent-agent-entry")
    ).toHaveAttribute("data-subagent-status", "completed")
    expect(
      container.querySelector(".native-subagent-activity")
    ).toHaveAttribute("data-subagent-status", "completed")
  })

  it("uses the label projected directly on the collaboration item", () => {
    const [activity] = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-named",
          status: "completed",
          agents: [
            {
              agentKey: agentKeyA,
              agentLabel: "Feishu requirements",
              status: "running",
            },
          ],
        }),
      },
    ])
    if (!activity) throw new Error("Missing subagent activity")

    render(<NativeSubAgentActivityItem activity={activity} />)

    expect(screen.getByText("Feishu requirements")).toBeVisible()
    expect(screen.queryByText("子智能体 1")).toBeNull()
    expect(screen.getByText("已开始工作")).not.toHaveClass("shimmer")
  })

  it("renders one shared native status after adjacent agent chips", () => {
    const activities = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "agent-a-started",
          kind: "started",
          agentKey: agentKeyA,
          agentLabel: "Feishu requirements",
        }),
      },
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "agent-b-started",
          kind: "started",
          agentKey: agentKeyB,
          agentLabel: "Feishu data ui docs",
        }),
      },
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "agent-c-started",
          kind: "started",
          agentKey: agentKeyC,
          agentLabel: "Feishu help",
        }),
      },
    ])

    const { container } = render(
      <NativeSubAgentActivityGroup activities={activities} />
    )

    expect(screen.getAllByRole("button")).toHaveLength(3)
    expect(screen.getAllByText("已开始工作")).toHaveLength(1)
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    expect(
      container.querySelectorAll(
        '.native-subagent-agent-entry[data-subagent-status="started"]'
      )
    ).toHaveLength(3)
    expect(
      container.querySelector(".native-subagent-activity")
    ).toHaveAttribute("data-subagent-status", "started")
    expect(
      container.querySelectorAll('[data-slot="subagent-agent-status"]')
    ).toHaveLength(0)
    expect(
      container.querySelector('[data-slot="subagent-group-status"]')
    ).toHaveTextContent("已开始工作")
  })

  it("allows resumeAgent to move an interrupted agent back to running", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-interrupted",
          status: "completed",
          tool: "wait",
          agents: [{ agentKey: agentKeyA, status: "interrupted" }],
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-resumed",
          status: "completed",
          tool: "resumeAgent",
          agents: [{ agentKey: agentKeyA, status: "running" }],
        }),
      },
    ])

    expect(models.at(-1)).toMatchObject({
      itemId: "collab-resumed",
      status: "updated",
      running: true,
      agents: [{ status: "updated" }],
    })
  })

  it("projects the 0.150.1 completed activity and interrupted tool status", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "subagent-completed",
          kind: "completed",
          agentKey: agentKeyA,
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "followup-interrupted",
          status: "interrupted",
          tool: "followupTask",
          agents: [{ agentKey: agentKeyA, status: "interrupted" }],
        }),
      },
    ])

    expect(models[0]).toMatchObject({
      itemId: "subagent-completed",
      status: "completed",
      running: false,
    })
    expect(models.at(-1)).toMatchObject({
      itemId: "followup-interrupted",
      status: "interrupted",
      running: false,
    })
  })

  it("keeps every agent as a subtle outlined chip with a transparent hover state", () => {
    const activities = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "agent-a-label",
          kind: "interacted",
          agentKey: agentKeyA,
          agentLabel: "协议审计",
        }),
      },
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "agent-b-label",
          kind: "interacted",
          agentKey: agentKeyB,
          agentLabel: "配置审计",
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "agents-complete",
          status: "completed",
          tool: "wait",
          agents: [
            { agentKey: agentKeyA, status: "completed" },
            { agentKey: agentKeyB, status: "completed" },
          ],
        }),
      },
    ])
    const activity = activities.at(-1)
    if (!activity) throw new Error("Missing subagent activity")
    const onAgentSelect = vi.fn()
    const { container } = render(
      <NativeSubAgentActivityItem
        activity={activity}
        selectedAgentId={agentKeyB}
        onAgentSelect={onAgentSelect}
      />
    )

    const buttons = screen.getAllByRole("button")
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveClass(
      "rounded-full",
      "border",
      "border-border",
      "bg-transparent",
      "shadow-none",
      "hover:bg-transparent"
    )
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true")
    expect(buttons[1]).toHaveClass(
      "rounded-full",
      "border",
      "border-border",
      "bg-transparent",
      "shadow-none",
      "hover:bg-transparent"
    )
    expect(buttons[1].className).toBe(buttons[0].className)
    expect(buttons[1]).not.toHaveClass("border-foreground/35")
    expect(
      buttons[1].querySelector('[data-slot="subagent-agent-name"]')
    ).toHaveClass("font-medium")
    expect(
      new Set(
        buttons.map(
          (button) =>
            button
              .querySelector('[data-slot="subagent-icon"]')
              ?.getAttribute("src") ?? ""
        )
      ).size
    ).toBe(2)
    expect(
      container.querySelector(".conversation-marker-content > span")
    ).toHaveClass("flex-wrap")

    fireEvent.click(buttons[0]!)
    expect(onAgentSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: agentKeyA,
        label: "协议审计",
        ordinal: 1,
      })
    )
  })

  it("ignores a path-shaped label instead of exposing it in the conversation", () => {
    const [activity] = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: subAgentActivityItem({
          id: "subagent-path-label",
          kind: "started",
          agentKey: agentKeyA,
          agentLabel: "/workspace/internal/agent-task",
        }),
      },
    ])
    if (!activity) throw new Error("Missing subagent activity")

    render(<NativeSubAgentActivityItem activity={activity} />)

    expect(screen.getByText("子智能体 1")).toBeVisible()
    expect(screen.getByText("已开始工作")).not.toHaveClass("shimmer")
    expect(screen.queryByText("/workspace/internal/agent-task")).toBeNull()
  })

  it("uses the child-thread projection for names and one shared terminal status", () => {
    const activities = [agentKeyA, agentKeyB, agentKeyC].map(
      (agentKey, index) => ({
        method: "item/completed" as const,
        item: subAgentActivityItem({
          id: `subagent-start-${index + 1}`,
          kind: "started",
          agentKey,
        }),
      })
    )
    const models = buildNativeSubAgentActivityViewModels(activities, {
      summaries: [
        {
          agentKey: agentKeyA,
          agentLabel: "纽约城市概览",
          status: "completed",
        },
        {
          agentKey: agentKeyB,
          agentLabel: "纽约文化生活",
          status: "completed",
        },
        {
          agentKey: agentKeyC,
          agentLabel: "纽约旅行体验",
          status: "completed",
        },
      ],
    })

    expect(models).toHaveLength(3)
    expect(models.every((model) => !model.running)).toBe(true)
    expect(models.flatMap((model) => model.agents)).toMatchObject([
      { label: "纽约城市概览", status: "completed" },
      { label: "纽约文化生活", status: "completed" },
      { label: "纽约旅行体验", status: "completed" },
    ])

    const { container } = render(
      <NativeSubAgentActivityGroup activities={models} />
    )

    expect(screen.getByText("纽约城市概览")).toBeVisible()
    expect(screen.getByText("纽约文化生活")).toBeVisible()
    expect(screen.getByText("纽约旅行体验")).toBeVisible()
    expect(screen.getAllByText("已完成")).toHaveLength(1)
    expect(
      Array.from(container.querySelectorAll(".native-subagent-status")).every(
        (status) => !status.classList.contains("shimmer")
      )
    ).toBe(true)
    expect(
      container.querySelectorAll(
        '.native-subagent-agent-entry[data-subagent-status="completed"]'
      )
    ).toHaveLength(3)
  })

  it("keeps child activity independent from the completed parent turn", () => {
    const models = buildNativeSubAgentActivityViewModels([
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-pending",
          status: "inProgress",
          agents: [
            { agentKey: agentKeyA, status: "pendingInit" },
            { agentKey: agentKeyB, status: "pendingInit" },
            { agentKey: agentKeyC, status: "pendingInit" },
          ],
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-one-completed",
          status: "completed",
          agents: [{ agentKey: agentKeyB, status: "completed" }],
        }),
      },
      {
        method: "item/completed",
        item: collabItem({
          id: "collab-two-completed",
          status: "completed",
          agents: [{ agentKey: agentKeyC, status: "completed" }],
        }),
      },
    ])

    expect(models).toMatchObject([
      {
        itemId: "collab-pending",
        source: "collaboration",
        status: "started",
        running: true,
        agents: [
          { status: "started" },
          { status: "started" },
          { status: "started" },
        ],
      },
      {
        itemId: "collab-one-completed",
        status: "completed",
        running: false,
        agents: [{ status: "completed" }],
      },
      {
        itemId: "collab-two-completed",
        status: "completed",
        running: false,
        agents: [{ status: "completed" }],
      },
    ])

    const { container } = render(
      <NativeSubAgentActivityItem activity={models[0]!} />
    )
    expect(screen.getByText("已开始工作")).not.toHaveClass("shimmer")
    expect(screen.queryByText("已完成")).toBeNull()
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".native-subagent-agent-entry")
      ).map((entry) => entry.dataset.subagentStatus)
    ).toEqual(["started", "started", "started"])
    expect(screen.queryByText("未完成")).toBeNull()
    expect(
      container.querySelector(".native-subagent-activity")
    ).toHaveAttribute("aria-busy", "true")
  })
})
