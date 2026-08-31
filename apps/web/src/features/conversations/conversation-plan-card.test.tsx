import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  ConversationPlanCard,
  type ConversationPlanStep,
} from "@/features/conversations/conversation-plan-card"
import i18n from "@/i18n"

const steps: ConversationPlanStep[] = [
  { step: "核对现有实现", status: "completed" },
  { step: "实现计划清单", status: "inProgress" },
  { step: "补充回归测试", status: "pending" },
]

beforeAll(() => {
  i18n.addResourceBundle(
    "zh-CN",
    "translation",
    {
      conversation: {
        planTitle: "执行计划",
        planProgress: "第 {{current}} / {{total}} 步",
        planChangedFiles_one: "{{count}} 个文件已更改",
        planChangedFiles_other: "{{count}} 个文件已更改",
        planExpand: "展开执行计划",
        planCollapse: "收起执行计划",
        planStepPending: "待处理",
        planStepInProgress: "正在执行",
        planStepCompleted: "已完成",
      },
    },
    true,
    true
  )
  i18n.addResourceBundle(
    "en-US",
    "translation",
    {
      conversation: {
        planTitle: "Execution plan",
        planProgress: "Step {{current}} of {{total}}",
        planChangedFiles_one: "{{count}} file changed",
        planChangedFiles_other: "{{count}} files changed",
        planExpand: "Expand execution plan",
        planCollapse: "Collapse execution plan",
        planStepPending: "Pending",
        planStepInProgress: "In progress",
        planStepCompleted: "Completed",
      },
    },
    true,
    true
  )
})

describe("ConversationPlanCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("renders a compact composer indicator and reveals the full plan on hover", async () => {
    const interaction = userEvent.setup()
    const { container } = render(
      <ConversationPlanCard
        steps={steps}
        changedFileCount={4}
        running
        placement="composer"
      />
    )

    const card = container.querySelector(".conversation-plan-card-composer")
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute("data-placement", "composer")
    expect(card).toHaveAttribute("data-running", "true")

    const trigger = screen.getByRole("button", { name: "展开执行计划" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    const titleIcon = trigger.querySelector(".conversation-plan-title-icon")
    expect(titleIcon).toHaveAttribute("aria-hidden", "true")
    expect(titleIcon).toHaveClass("size-[18px]")
    expect(titleIcon).toHaveAttribute("data-progress", "33")
    const progressTrack = titleIcon?.querySelector(
      ".conversation-plan-progress-track"
    )
    expect(progressTrack).toHaveClass(
      "stroke-[color-mix(in_srgb,var(--app-selection)_28%,transparent)]"
    )
    expect(progressTrack).toHaveAttribute("stroke-width", "2")
    const progressValue = titleIcon?.querySelector(
      ".conversation-plan-progress-value"
    )
    expect(progressValue).toHaveAttribute("stroke-width", "2")
    expect(progressValue).toHaveAttribute("stroke-dasharray", "33 67")
    expect(screen.getByText("第 2 / 3 步")).toBeVisible()
    expect(screen.queryByText("4 个文件已更改")).toBeNull()
    expect(screen.queryByRole("list", { name: "执行计划" })).toBeNull()

    await interaction.hover(trigger)

    const plan = await screen.findByRole("list", { name: "执行计划" })
    expect(
      screen.getByRole("button", { name: "收起执行计划" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(plan.closest('[data-slot="hover-card-content"]')).not.toBeNull()
    expect(plan).toBeVisible()

    const completed = screen.getByText("核对现有实现").closest("li")
    const inProgress = screen.getByText("实现计划清单").closest("li")
    const pending = screen.getByText("补充回归测试").closest("li")
    expect(completed).toHaveAttribute("data-status", "completed")
    expect(completed).toHaveTextContent("已完成: 核对现有实现")
    expect(inProgress).toHaveAttribute("data-status", "inProgress")
    expect(inProgress).toHaveAttribute("aria-current", "step")
    expect(inProgress).toHaveTextContent("正在执行: 实现计划清单")
    expect(inProgress).toHaveClass(
      "gap-1.5",
      "py-1",
      "leading-[var(--app-ui-compact-line-height)]"
    )
    expect(inProgress?.querySelector("span")).toHaveClass(
      "mt-[calc((var(--app-ui-compact-line-height)-1rem)/2)]"
    )
    expect(inProgress?.querySelector("svg")).toHaveClass(
      "animate-spin",
      "motion-reduce:animate-none"
    )
    expect(pending).toHaveAttribute("data-status", "pending")
    expect(pending).toHaveTextContent("待处理: 补充回归测试")

    const liveMeta = screen.getByText("第 2 / 3 步").parentElement
    expect(liveMeta).toHaveAttribute("aria-live", "polite")

    await interaction.unhover(trigger)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "展开执行计划" })
      ).toHaveAttribute("aria-expanded", "false")
      expect(screen.queryByRole("list", { name: "执行计划" })).toBeNull()
    })
  })

  it("opens from keyboard activation and closes with Escape", async () => {
    const interaction = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <ConversationPlanCard
        steps={steps}
        placement="composer"
        onOpenChange={onOpenChange}
      />
    )

    const trigger = screen.getByRole("button", { name: "展开执行计划" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("核对现有实现")).toBeNull()

    await interaction.tab()
    expect(trigger).toHaveFocus()
    await interaction.keyboard(" ")
    expect(await screen.findByText("核对现有实现")).toBeVisible()
    expect(
      screen.getByRole("button", { name: "收起执行计划" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    await interaction.keyboard("{Escape}")

    expect(
      screen.getByRole("button", { name: "展开执行计划" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("核对现有实现")).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(trigger).toHaveFocus()
  })

  it("ignores touch hover and toggles the full plan with taps", async () => {
    render(<ConversationPlanCard steps={steps} placement="composer" />)
    const trigger = screen.getByRole("button", { name: "展开执行计划" })

    fireEvent.pointerEnter(trigger, { pointerType: "touch" })
    expect(screen.queryByRole("list", { name: "执行计划" })).toBeNull()

    fireEvent.click(trigger)
    expect(await screen.findByRole("list", { name: "执行计划" })).toBeVisible()

    fireEvent.click(trigger)
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "执行计划" })).toBeNull()
    )
  })

  it("closes the composer plan with Escape", () => {
    const { container } = render(
      <ConversationPlanCard steps={steps} placement="composer" defaultOpen />
    )
    const card = container.querySelector(
      ".conversation-plan-card-composer"
    ) as HTMLElement
    const plan = screen.getByRole("list", { name: "执行计划" })

    fireEvent.keyDown(card, { key: "Escape" })

    expect(plan).not.toBeVisible()
    expect(
      screen.getByRole("button", { name: "展开执行计划" })
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("uses an explicit current index and clamps it to the available steps", () => {
    render(
      <ConversationPlanCard
        steps={steps}
        currentStepIndex={99}
        placement="composer"
        open
      />
    )

    expect(screen.getByText("第 3 / 3 步")).toBeVisible()
    expect(screen.getByText("补充回归测试").closest("li")).toHaveAttribute(
      "aria-current",
      "step"
    )
  })

  it("keeps an interrupted in-progress step visible without spinning", () => {
    render(<ConversationPlanCard steps={steps} placement="inline" />)

    const inProgressIcon = screen
      .getByText("实现计划清单")
      .closest("li")
      ?.querySelector("svg")
    expect(inProgressIcon).not.toHaveClass("animate-spin")
    expect(inProgressIcon).not.toHaveClass("motion-reduce:animate-none")
  })

  it("updates the circular progress when live step statuses change", () => {
    const liveSteps: ConversationPlanStep[] = [
      { step: "第一步", status: "inProgress" },
      { step: "第二步", status: "pending" },
      { step: "第三步", status: "pending" },
    ]
    const { container, rerender } = render(
      <ConversationPlanCard steps={liveSteps} running placement="composer" />
    )

    const getProgressIcon = () =>
      container.querySelector(".conversation-plan-title-icon")
    const getProgressValue = () =>
      getProgressIcon()?.querySelector(".conversation-plan-progress-value")

    expect(getProgressIcon()).toHaveAttribute("data-progress", "0")
    expect(getProgressValue()).toHaveAttribute("stroke-dasharray", "0 100")
    expect(
      getProgressIcon()?.querySelector(".conversation-plan-progress-check")
    ).toBeNull()

    rerender(
      <ConversationPlanCard
        steps={[
          { step: "第一步", status: "completed" },
          { step: "第二步", status: "completed" },
          { step: "第三步", status: "inProgress" },
        ]}
        running
        placement="composer"
      />
    )

    expect(getProgressIcon()).toHaveAttribute("data-progress", "67")
    expect(getProgressValue()).toHaveAttribute("stroke-dasharray", "67 33")
    expect(
      getProgressIcon()?.querySelector(".conversation-plan-progress-check")
    ).toBeNull()

    rerender(
      <ConversationPlanCard
        steps={[
          { step: "第一步", status: "completed" },
          { step: "第二步", status: "completed" },
          { step: "第三步", status: "completed" },
        ]}
        placement="composer"
        open
      />
    )

    expect(getProgressIcon()).toHaveAttribute("data-progress", "100")
    expect(getProgressValue()).toHaveAttribute("stroke-dasharray", "100 0")
    const completedCheck = getProgressIcon()?.querySelector(
      ".conversation-plan-progress-check"
    )
    expect(completedCheck).toHaveClass(
      "stroke-[color-mix(in_srgb,var(--app-selection)_65%,transparent)]"
    )
    expect(completedCheck).toHaveAttribute("d", "m7.25 10 1.8 1.8 3.7-3.7")
    expect(completedCheck).toHaveAttribute("stroke-width", "1.5")
    expect(
      getProgressIcon()?.querySelector(".conversation-plan-progress-check")
    ).toHaveAttribute("stroke-linecap", "round")
  })

  it("renders historical plans inline as an always-visible read-only list", async () => {
    await i18n.changeLanguage("en-US")
    const { container } = render(
      <ConversationPlanCard
        steps={[
          { step: "Inspect the implementation", status: "completed" },
          { step: "Add regression tests", status: "completed" },
        ]}
        changedFileCount={2}
        placement="inline"
      />
    )

    const card = container.querySelector(".conversation-plan-card-inline")
    expect(card).not.toBeNull()
    expect(card).toHaveAttribute("data-placement", "inline")
    expect(card).not.toHaveClass("fixed")
    expect(screen.queryByRole("button")).toBeNull()
    const title = screen.getByRole("heading", { name: "Execution plan" })
    expect(title).toBeVisible()
    const titleIcon = title.querySelector(".conversation-plan-title-icon")
    expect(titleIcon).toHaveAttribute("aria-hidden", "true")
    expect(titleIcon).toHaveClass("size-[18px]")
    expect(titleIcon).toHaveClass("text-[var(--app-muted)]")
    expect(titleIcon).not.toHaveAttribute("data-progress")
    expect(
      titleIcon?.querySelector(".conversation-plan-progress-value")
    ).toBeNull()
    expect(
      titleIcon?.querySelector(".conversation-plan-progress-check")
    ).toBeNull()
    expect(screen.getByText("Step 2 of 2")).toBeVisible()
    expect(screen.getByText("2 files changed")).toBeVisible()

    const list = screen.getByRole("list", { name: "Execution plan" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    expect(within(list).getByText("Inspect the implementation")).toBeVisible()
    expect(within(list).getByText("Add regression tests")).toBeVisible()
    expect(
      within(list).getByText("Inspect the implementation").closest("li")
    ).toHaveClass("py-1", "leading-[var(--app-ui-copy-line-height)]")
  })

  it("uses the singular English file label for one changed file", async () => {
    await i18n.changeLanguage("en-US")
    render(
      <ConversationPlanCard
        steps={steps}
        changedFileCount={1}
        placement="inline"
      />
    )

    expect(screen.getByText("1 file changed")).toBeVisible()
  })

  it("does not render an empty plan or zero-value file metadata", () => {
    const { container, rerender } = render(
      <ConversationPlanCard steps={[]} placement="composer" />
    )
    expect(container).toBeEmptyDOMElement()

    rerender(
      <ConversationPlanCard
        steps={steps}
        changedFileCount={0}
        placement="inline"
      />
    )
    expect(screen.queryByText("0 个文件已更改")).toBeNull()
  })
})
