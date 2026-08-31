import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ThreadGoal } from "@/api/contracts"
import { ConversationGoalBar } from "@/features/conversations/conversation-goal-bar"
import {
  formatGoalDuration,
  projectGoalElapsedSeconds,
} from "@/features/conversations/conversation-goal-utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import i18n from "@/i18n"

function goalFixture(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    thread_id: "codex-thread-1",
    objective: "完整实现目标功能",
    status: "active",
    token_budget: 12_000,
    tokens_used: 800,
    time_used_seconds: 38,
    created_at: "2026-08-06T03:00:00.000Z",
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderGoalBar(
  overrides: {
    goal?: ThreadGoal
    pendingAction?: "edit" | "pause" | "resume" | "clear" | null
    synchronizing?: boolean
  } = {}
) {
  const callbacks = {
    onEdit: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onClear: vi.fn(),
  }
  return {
    ...callbacks,
    ...render(
      <TooltipProvider>
        <ConversationGoalBar
          goal={overrides.goal ?? goalFixture()}
          pendingAction={overrides.pendingAction}
          synchronizing={overrides.synchronizing}
          {...callbacks}
        />
      </TooltipProvider>
    ),
  }
}

describe("ConversationGoalBar", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("shows the compact active state and exposes native pause and edit controls", async () => {
    const interaction = userEvent.setup()
    const fixture = renderGoalBar()

    expect(screen.getByRole("region", { name: "目标状态" })).toHaveTextContent(
      "进行中的目标"
    )
    expect(screen.getByText("完整实现目标功能")).toBeVisible()
    expect(
      fixture.container.querySelectorAll(".conversation-goal-action")
    ).toHaveLength(3)

    await interaction.click(screen.getByRole("button", { name: "暂停目标" }))
    expect(fixture.onPause).toHaveBeenCalledOnce()

    await interaction.click(screen.getByRole("button", { name: "编辑目标" }))
    const dialog = screen.getByRole("dialog", { name: "编辑目标" })
    const objective = within(dialog).getByLabelText("目标")
    expect(within(dialog).queryByLabelText("Token 预算")).toBeNull()
    await interaction.clear(objective)
    await interaction.type(objective, "交付完整的目标功能")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    expect(fixture.onEdit).toHaveBeenCalledWith({
      objective: "交付完整的目标功能",
    })
  })

  it("resumes a paused Goal and exposes usage details and clear confirmation", async () => {
    const interaction = userEvent.setup()
    const fixture = renderGoalBar({
      goal: goalFixture({
        status: "paused",
        time_used_seconds: 125,
      }),
    })

    expect(screen.getByText("已暂停的目标")).toBeVisible()
    expect(screen.queryByRole("button", { name: "暂停目标" })).toBeNull()
    await interaction.click(screen.getByRole("button", { name: "继续目标" }))
    expect(fixture.onResume).toHaveBeenCalledOnce()

    await interaction.click(
      screen.getByRole("button", { name: "查看目标详情" })
    )
    const details = screen.getByRole("dialog", { name: "目标详情" })
    expect(within(details).getByText("2m 5s")).toBeVisible()
    expect(within(details).getByText("800")).toBeVisible()
    expect(within(details).getByText("12,000")).toBeVisible()
    await interaction.click(
      within(details).getAllByRole("button", { name: "关闭" })[0]!
    )

    await interaction.click(screen.getByRole("button", { name: "清除目标" }))
    const confirmation = screen.getByRole("dialog", {
      name: "清除这个目标？",
    })
    await interaction.click(
      within(confirmation).getByRole("button", { name: "清除目标" })
    )
    expect(fixture.onClear).toHaveBeenCalledOnce()
  })

  it("formats token counts with the active application locale", async () => {
    await i18n.changeLanguage("en-US")
    const OriginalNumberFormat = Intl.NumberFormat
    const numberFormatDescriptor = Object.getOwnPropertyDescriptor(
      Intl,
      "NumberFormat"
    )
    let observedLocales: Intl.LocalesArgument | undefined
    class LocaleProbeNumberFormat extends OriginalNumberFormat {
      constructor(
        locales?: Intl.LocalesArgument,
        options?: Intl.NumberFormatOptions
      ) {
        observedLocales = locales
        super(locales, options)
      }
    }
    Object.defineProperty(Intl, "NumberFormat", {
      ...numberFormatDescriptor,
      value: LocaleProbeNumberFormat,
    })

    try {
      const interaction = userEvent.setup()
      renderGoalBar()
      await interaction.click(
        screen.getByRole("button", { name: "View Goal Details" })
      )

      expect(observedLocales).toBe("en-US")
    } finally {
      if (numberFormatDescriptor) {
        Object.defineProperty(Intl, "NumberFormat", numberFormatDescriptor)
      }
    }
  })

  it("waits for native Goal state before showing elapsed time or enabling actions", () => {
    const fixture = renderGoalBar({
      goal: goalFixture({
        time_used_seconds: 0,
      }),
      synchronizing: true,
    })

    expect(screen.queryByRole("button", { name: "查看目标详情" })).toBeNull()
    for (const action of fixture.container.querySelectorAll(
      ".conversation-goal-action"
    )) {
      expect(action).toBeDisabled()
    }
  })

  it("smoothly interpolates an active Goal from the latest Codex snapshot", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T03:00:10.000Z"))
    renderGoalBar({
      goal: goalFixture({
        time_used_seconds: 10,
        updated_at: "2026-08-06T03:00:10.000Z",
      }),
    })

    expect(
      screen.getByRole("button", { name: "查看目标详情" })
    ).toHaveTextContent("10s")

    act(() => vi.advanceTimersByTime(3_000))

    expect(
      screen.getByRole("button", { name: "查看目标详情" })
    ).toHaveTextContent("13s")
  })

  it("freezes a non-active Goal at the exact elapsed time reported by Codex", () => {
    const goal = goalFixture({
      status: "paused",
      time_used_seconds: 10,
      updated_at: "2026-08-06T03:00:10.000Z",
    })

    expect(
      projectGoalElapsedSeconds(goal, Date.parse("2026-08-06T03:01:00.000Z"))
    ).toBe(10)
  })

  it("rebases active elapsed time on each authoritative Codex snapshot", () => {
    const nowMs = Date.parse("2026-08-06T03:00:15.000Z")

    expect(
      projectGoalElapsedSeconds(
        goalFixture({
          time_used_seconds: 10,
          updated_at: "2026-08-06T03:00:10.000Z",
        }),
        nowMs
      )
    ).toBe(15)
    expect(
      projectGoalElapsedSeconds(
        goalFixture({
          time_used_seconds: 14,
          updated_at: "2026-08-06T03:00:15.000Z",
        }),
        nowMs
      )
    ).toBe(14)
  })

  it("formats elapsed Goal time without allowing negative values", () => {
    expect(formatGoalDuration(-5)).toBe("0s")
    expect(formatGoalDuration(59)).toBe("59s")
    expect(formatGoalDuration(125)).toBe("2m 5s")
    expect(formatGoalDuration(3_661)).toBe("1h 01m")
  })
})
