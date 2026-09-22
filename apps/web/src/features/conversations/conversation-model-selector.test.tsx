import { useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelPreference, ReasoningEffort } from "@linksense/shared"

import { ConversationModelSelector } from "@/features/conversations/conversation-model-selector"
import i18n from "@/i18n"

const contextUsageRender = vi.hoisted(() => vi.fn())
const modelSelectorRender = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/popover", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/ui/popover")>()
  return {
    ...original,
    Popover: (props: React.ComponentProps<typeof original.Popover>) => {
      modelSelectorRender()
      return <original.Popover {...props} />
    },
  }
})
vi.mock("@/components/ui/hover-card", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/ui/hover-card")>()
  return {
    ...original,
    HoverCard: (props: React.ComponentProps<typeof original.HoverCard>) => {
      contextUsageRender()
      return <original.HoverCard {...props} />
    },
  }
})

describe("ConversationModelSelector", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        // Base UI measures the track and thumb to keep the end stops inside the pill.
        if (this.dataset.slot === "slider-control")
          return new DOMRect(0, 0, 200, 24)
        if (this.dataset.slot === "slider-thumb")
          return new DOMRect(0, 0, 20, 20)
        return getBoundingClientRect.call(this)
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("does not rerender context usage while saving effort, but updates changed usage", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ConversationModelSelector
        preference={modelPreference}
        pending={false}
        onChange={onChange}
        contextUsage={modelContextUsage}
      />
    )
    const renders = contextUsageRender.mock.calls.length
    rerender(
      <ConversationModelSelector
        preference={modelPreference}
        pending
        onChange={onChange}
        contextUsage={{ ...modelContextUsage }}
      />
    )
    expect(contextUsageRender).toHaveBeenCalledTimes(renders)
    rerender(
      <ConversationModelSelector
        preference={{ ...modelPreference, selected_reasoning_effort: "high" }}
        pending={false}
        onChange={onChange}
        contextUsage={{ ...modelContextUsage }}
      />
    )
    expect(contextUsageRender).toHaveBeenCalledTimes(renders)
    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    ).toHaveTextContent("高")
    rerender(
      <ConversationModelSelector
        preference={modelPreference}
        pending={false}
        onChange={onChange}
        contextUsage={{ ...modelContextUsage, usedTokens: 129_000 }}
      />
    )
    expect(screen.getByLabelText("背景信息窗口：50% 已用")).toBeVisible()
    expect(contextUsageRender).toHaveBeenCalledTimes(renders + 1)
  })

  it("skips unchanged settings from parent renders without retaining an old change callback", async () => {
    const interaction = userEvent.setup()
    const initial = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(
      <ConversationModelSelector
        preference={modelPreference}
        pending={false}
        onChange={initial}
        contextUsage={modelContextUsage}
      />
    )
    const renders = modelSelectorRender.mock.calls.length
    rerender(
      <ConversationModelSelector
        preference={modelPreference}
        pending={false}
        onChange={initial}
        contextUsage={{ ...modelContextUsage }}
      />
    )
    expect(modelSelectorRender).toHaveBeenCalledTimes(renders)
    rerender(
      <ConversationModelSelector
        preference={modelPreference}
        pending={false}
        onChange={latest}
        contextUsage={{ ...modelContextUsage }}
      />
    )
    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    screen.getByRole("slider", { name: "推理强度" }).focus()
    await interaction.keyboard("{End}")
    expect(initial).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledExactlyOnceWith("gpt-5.6-sol", "ultra")
  })

  it("shows models in the preference order supplied by model settings", async () => {
    const interaction = userEvent.setup()
    const ordered = [...modelPreference.models].reverse()
    render(
      <ConversationModelSelector
        pending={false}
        onChange={vi.fn()}
        preference={{ ...modelPreference, models: ordered }}
      />
    )
    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    await interaction.click(screen.getByRole("button", { name: "模型" }))
    const menu = await screen.findByRole("group", { name: "模型" })
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent)
    ).toEqual(ordered.map((model) => model.display_name))
  })

  it("opens an effort slider with the current model, effort, and reset control", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationModelSelector
        pending={false}
        onChange={vi.fn()}
        preference={modelPreference}
        contextUsage={modelContextUsage}
      />
    )

    const selector = screen.getByRole("button", {
      name: "选择模型与推理强度",
    })
    expect(selector).toHaveClass(
      "w-fit",
      "max-w-[min(20rem,calc(100vw-6rem))]",
      "bg-muted/40",
      "hover:bg-hover",
      "aria-expanded:bg-muted/60"
    )
    const contextTrigger = screen.getByLabelText("背景信息窗口：60% 已用")
    expect(contextTrigger).toBeVisible()
    expect(contextTrigger).toHaveClass("size-7")
    expect(contextTrigger.querySelector("svg")).toHaveClass("size-4")
    expect(contextTrigger).not.toHaveTextContent("258K")
    expect(
      contextTrigger.querySelector('circle[stroke-dasharray="60 40"]')
    ).toBeInTheDocument()

    await interaction.click(selector)
    const popup = await screen.findByRole("dialog", {
      name: "选择模型与推理强度",
    })
    expect(popup).toHaveClass(
      "w-[min(14rem,calc(100vw-2rem))]",
      "rounded-2xl",
      "gap-2",
      "px-3",
      "py-2.5"
    )
    const modelTrigger = within(popup).getByRole("button", { name: "模型" })
    expect(modelTrigger).toHaveClass("py-1")
    expect(modelTrigger).toHaveTextContent("GPT-5.6-Sol")
    expect(modelTrigger).toHaveTextContent("轻量")
    expect(modelTrigger).toHaveAttribute("aria-haspopup", "menu")
    expect(within(modelTrigger).getByText("轻量")).toHaveClass("text-xs")
    expect(within(modelTrigger).getByText("GPT-5.6-Sol")).toHaveClass("text-xs")
    const slider = within(popup).getByRole("slider", { name: "推理强度" })
    expect(slider.closest('[data-slot="slider-control"]')).toHaveClass("h-6")
    expect(slider.closest('[data-slot="slider-thumb"]')).toHaveClass("size-5")
    expect(popup.querySelector('[data-slot="slider-track"]')).toHaveClass(
      "data-horizontal:h-4"
    )
    expect(popup.querySelector(".lucide-zap")).not.toBeInTheDocument()
    expect(slider).toHaveValue("0")
    expect(slider).toHaveAttribute("max", "5")
    expect(slider).toHaveAttribute("aria-valuetext", "轻量")
    const effortPoints = popup.querySelectorAll("[data-reasoning-effort-point]")
    expect(effortPoints).toHaveLength(6)
    for (const point of effortPoints) {
      expect(point).toHaveClass(
        "pointer-events-auto",
        "transition-transform",
        "duration-150",
        "ease-out",
        "hover:scale-[1.75]",
        "motion-reduce:transition-none"
      )
    }
    expect(
      within(popup).getByRole("button", { name: "恢复默认推理强度" })
    ).toBeDisabled()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    await interaction.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(selector).toHaveFocus()
  })

  it("shows model context window details on hover", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationModelSelector
        pending={false}
        onChange={vi.fn()}
        preference={modelPreference}
        contextUsage={modelContextUsage}
      />
    )

    await interaction.hover(screen.getByLabelText("背景信息窗口：60% 已用"))

    const popup = await screen.findByRole("dialog", {
      name: "背景信息窗口：",
    })
    expect(within(popup).getByText("背景信息窗口：")).toBeVisible()
    expect(within(popup).getByText("60% 已用")).toBeVisible()
    expect(within(popup).getByText("已用 151.4k，共 252k")).toBeVisible()
  })

  it.each([
    {
      language: "zh-CN",
      badge: "背景信息窗口：50% 已用",
      detail: "已用 128k，共 256k",
    },
    {
      language: "en-US",
      badge: "Background context window: 50% used",
      detail: "128k used, 256k total",
    },
    {
      language: "de-DE",
      badge: "背景信息窗口：50% 已用",
      detail: "已用 128k，共 256k",
    },
  ])(
    "shows runtime context counts in units of 1024 with $language translations or fallback",
    async ({ language, badge, detail }) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      render(
        <ConversationModelSelector
          pending={false}
          onChange={vi.fn()}
          preference={modelPreference}
          contextUsage={{
            turnId: "turn-binary-context",
            usedTokens: 131_072,
            modelContextWindow: 262_144,
          }}
        />
      )

      const trigger = screen.getByLabelText(badge)
      expect(
        trigger.querySelector('circle[stroke-dasharray="50 50"]')
      ).toBeInTheDocument()
      await interaction.hover(trigger)
      expect(await screen.findByText(detail)).toBeVisible()
    }
  )

  it.each(["zh-CN", "en-US", "de-DE"])(
    "omits the token unit for zero, one, many, and compact counts in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const renderSelector = (usedTokens: number) => (
        <ConversationModelSelector
          pending={false}
          onChange={vi.fn()}
          preference={modelPreference}
          contextUsage={{
            turnId: "turn-token-unit",
            usedTokens,
            modelContextWindow: 1_024,
          }}
        />
      )
      const { rerender } = render(renderSelector(0))
      await interaction.hover(
        screen.getByRole("button", {
          name:
            language === "en-US"
              ? "Background context window: 0% used"
              : "背景信息窗口：0% 已用",
        })
      )
      for (const [usedTokens, used] of [
        [0, "0"],
        [1, "1"],
        [2, "2"],
        [1_024, "1k"],
      ] as const) {
        rerender(renderSelector(usedTokens))
        expect(
          await screen.findByText(
            language === "en-US"
              ? `${used} used, 1k total`
              : `已用 ${used}，共 1k`
          )
        ).toBeVisible()
      }
    }
  )

  it.each([0, 84, 85, 100, 141])(
    "keeps the context ring in the foreground color at %i percent usage",
    (percentage) => {
      render(
        <ConversationModelSelector
          pending={false}
          onChange={vi.fn()}
          preference={modelPreference}
          contextUsage={{
            turnId: "turn-ring-color",
            usedTokens: percentage * 1_000,
            modelContextWindow: 100_000,
          }}
        />
      )

      const ring = screen
        .getByLabelText(`背景信息窗口：${percentage}% 已用`)
        .querySelector("svg")
      expect(ring).toHaveClass("text-foreground")
      expect(ring).not.toHaveClass("text-destructive")
    }
  )

  it("shows the real percentage while capping an over-limit ring", () => {
    render(
      <ConversationModelSelector
        pending={false}
        onChange={vi.fn()}
        preference={modelPreference}
        contextUsage={{
          turnId: "turn-over-limit",
          usedTokens: 364_043,
          modelContextWindow: 258_000,
        }}
      />
    )

    const contextTrigger = screen.getByLabelText("背景信息窗口：141% 已用")
    expect(
      contextTrigger.querySelector('circle[stroke-dasharray="100 0"]')
    ).toBeInTheDocument()
  })

  it("shows an unknown context state when the selected model has no context window", async () => {
    const interaction = userEvent.setup()
    render(
      <ConversationModelSelector
        pending={false}
        onChange={vi.fn()}
        preference={{
          ...modelPreference,
          models: [
            {
              id: "gpt-5.6-sol",
              display_name: "GPT-5.6-Sol",
              enabled: true,
              context_window: null,
              supported_reasoning_efforts: [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
                "ultra",
              ],
              default_reasoning_effort: "low",
            },
          ],
        }}
      />
    )

    const contextTrigger = screen.getByLabelText("背景信息窗口：暂无用量")
    expect(contextTrigger.querySelector("svg")).toHaveClass("text-foreground")
    await interaction.hover(contextTrigger)

    expect(await screen.findByText("背景信息窗口：")).toBeVisible()
    expect(screen.getByText("暂无用量")).toBeVisible()
    expect(screen.getByText("暂无上下文用量")).toBeVisible()
  })

  it("updates the effort choices with the selected model and forwards native values", async () => {
    const onChange = vi.fn()
    const interaction = userEvent.setup()
    render(<ControlledModelSelector onChange={onChange} />)

    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    const slider = screen.getByRole("slider", { name: "推理强度" })
    slider.focus()
    await interaction.keyboard("{End}")
    expect(onChange).toHaveBeenLastCalledWith("gpt-5.6-sol", "ultra")

    await interaction.click(screen.getByRole("button", { name: "模型" }))
    await interaction.click(
      await screen.findByRole("menuitemradio", { name: "Model B" })
    )
    expect(onChange).toHaveBeenCalledWith("model-b", "low")
    expect(screen.getByRole("slider", { name: "推理强度" })).toBeDisabled()
    expect(screen.getByRole("slider", { name: "推理强度" })).toHaveAttribute(
      "aria-valuetext",
      "轻量"
    )

    await interaction.click(screen.getByRole("button", { name: "模型" }))
    await interaction.click(
      await screen.findByRole("menuitemradio", { name: "GPT-5.6-Sol" })
    )
    expect(onChange).toHaveBeenLastCalledWith("gpt-5.6-sol", "low")
    expect(screen.getByRole("slider", { name: "推理强度" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "模型" })).toHaveTextContent(
      "GPT-5.6-Sol"
    )
  })

  it("previews pointer movement and saves only the final supported effort on release", async () => {
    const interaction = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledModelSelector onChange={onChange} />)
    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    const slider = screen.getByRole("slider", { name: "推理强度" })
    const control = slider.closest('[data-slot="slider-control"]')
    if (!(control instanceof HTMLElement))
      throw new Error("Missing slider control")
    control.setPointerCapture = vi.fn()
    control.hasPointerCapture = vi.fn(() => false)

    fireEvent.pointerDown(control, {
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: 82,
    })
    expect(slider).toHaveAttribute("aria-valuetext", "高")
    expect(screen.getByRole("button", { name: "模型" })).toHaveTextContent("高")
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.pointerMove(document, { buttons: 1, pointerId: 1, clientX: 154 })
    expect(slider).toHaveAttribute("aria-valuetext", "最高")
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(document, { button: 0, pointerId: 1, clientX: 154 })
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gpt-5.6-sol", "max")
    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    ).toHaveTextContent("最高")
  })

  it.each([false, true])(
    "saves a mobile track tap once when pointer and touch events both fire (drag: %s)",
    async (drag) => {
      const interaction = userEvent.setup()
      const onChange = vi.fn()
      render(<ControlledModelSelector onChange={onChange} />)
      const selector = screen.getByRole("button", {
        name: "选择模型与推理强度",
      })
      await interaction.click(selector)
      const slider = screen.getByRole("slider", { name: "推理强度" })
      const control = slider.closest('[data-slot="slider-control"]')
      if (!(control instanceof HTMLElement))
        throw new Error("Missing slider control")
      control.setPointerCapture = vi.fn()
      control.hasPointerCapture = vi.fn(() => false)

      const pointer = {
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "touch",
        clientX: 82,
        clientY: 12,
      }
      const touch = { identifier: 1, clientX: 82, clientY: 12, target: control }
      // Mobile browsers dispatch pointerdown before touchstart for one contact.
      fireEvent.pointerDown(control, pointer)
      fireEvent.touchStart(control, {
        touches: [touch],
        changedTouches: [touch],
      })
      expect(slider).toHaveAttribute("aria-valuetext", "高")
      expect(onChange).not.toHaveBeenCalled()

      const clientX = drag ? 154 : 82
      if (drag) {
        fireEvent.pointerMove(control, { ...pointer, clientX })
        fireEvent.touchMove(control, {
          touches: [{ ...touch, clientX }],
          changedTouches: [{ ...touch, clientX }],
        })
        expect(slider).toHaveAttribute("aria-valuetext", "最高")
        expect(onChange).not.toHaveBeenCalled()
      }
      fireEvent.pointerUp(control, { ...pointer, buttons: 0, clientX })
      fireEvent.touchEnd(control, {
        touches: [],
        changedTouches: [{ ...touch, clientX }],
      })

      expect(onChange).toHaveBeenCalledExactlyOnceWith(
        "gpt-5.6-sol",
        drag ? "max" : "high"
      )
      expect(selector).toHaveTextContent(drag ? "最高" : "高")
      await interaction.keyboard("{Escape}")
      await interaction.click(selector)
      expect(screen.getByRole("slider", { name: "推理强度" })).toHaveAttribute(
        "aria-valuetext",
        drag ? "最高" : "高"
      )
    }
  )

  it("orders a sparse set of supported efforts from low to high and supports keyboard selection", async () => {
    const onChange = vi.fn()
    const interaction = userEvent.setup()
    render(
      <ConversationModelSelector
        pending={false}
        onChange={onChange}
        preference={{
          ...modelPreference,
          selected_reasoning_effort: "minimal",
          models: modelPreference.models.map((model) => ({
            ...model,
            supported_reasoning_efforts: ["ultra", "minimal", "high"],
            default_reasoning_effort: "high",
          })),
        }}
      />
    )
    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    const slider = screen.getByRole("slider", { name: "推理强度" })
    expect(slider).toHaveAttribute("max", "2")
    slider.focus()
    await interaction.keyboard("{ArrowRight}")
    expect(onChange).toHaveBeenLastCalledWith("gpt-5.6-sol", "high")
    expect(slider).toHaveAttribute("aria-valuetext", "高")
    await interaction.keyboard("{End}")
    expect(onChange).toHaveBeenLastCalledWith("gpt-5.6-sol", "ultra")
    expect(slider).toHaveAttribute("aria-valuetext", "极致")
    await interaction.keyboard("{ArrowRight}")
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("restores the current model's default effort without changing the model", async () => {
    const onChange = vi.fn()
    const interaction = userEvent.setup()
    render(
      <ConversationModelSelector
        pending={false}
        onChange={onChange}
        preference={{
          ...modelPreference,
          selected_reasoning_effort: "ultra",
          models: modelPreference.models.map((model) => ({
            ...model,
            default_reasoning_effort:
              model.id === "gpt-5.6-sol" ? "high" : "low",
          })),
        }}
      />
    )
    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    const reset = screen.getByRole("button", { name: "恢复默认推理强度" })
    await interaction.click(reset)
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gpt-5.6-sol", "high")
    expect(screen.getByRole("slider", { name: "推理强度" })).toHaveAttribute(
      "aria-valuetext",
      "高"
    )
    expect(reset).toBeDisabled()
  })

  it.each([
    { result: "success", savedEffort: "ultra", label: "极致" },
    { result: "failure", savedEffort: "low", label: "轻量" },
  ] as const)(
    "keeps the preview while saving and reflects the saved value after $result",
    async ({ savedEffort, label }) => {
      const onChange = vi.fn()
      const interaction = userEvent.setup()
      const { rerender } = render(
        <ConversationModelSelector
          pending={false}
          onChange={onChange}
          preference={modelPreference}
        />
      )
      await interaction.click(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      )
      const slider = screen.getByRole("slider", { name: "推理强度" })
      slider.focus()
      await interaction.keyboard("{End}")
      expect(onChange).toHaveBeenCalledExactlyOnceWith("gpt-5.6-sol", "ultra")

      rerender(
        <ConversationModelSelector
          pending
          onChange={onChange}
          preference={modelPreference}
        />
      )
      expect(slider).toHaveAttribute("aria-valuetext", "极致")
      expect(slider).toBeDisabled()
      expect(slider.closest('[data-slot="slider-control"]')).toHaveClass(
        "data-disabled:opacity-100"
      )
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveAttribute("aria-busy", "true")
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveClass("disabled:opacity-100")
      expect(screen.getByRole("button", { name: "模型" })).toBeDisabled()
      expect(
        screen.getByRole("button", { name: "恢复默认推理强度" })
      ).toBeDisabled()

      rerender(
        <ConversationModelSelector
          pending={false}
          onChange={onChange}
          preference={{
            ...modelPreference,
            selected_reasoning_effort: savedEffort,
          }}
        />
      )
      expect(slider).toHaveAttribute("aria-valuetext", label)
      expect(slider).toBeEnabled()
      expect(onChange).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    {
      language: "zh-CN",
      selector: "选择模型与推理强度",
      slider: "推理强度",
      value: "轻量",
      reset: "恢复默认推理强度",
    },
    {
      language: "en-US",
      selector: "Choose model and reasoning effort",
      slider: "Reasoning effort",
      value: "Light",
      reset: "Reset reasoning effort to default",
    },
    {
      language: "de-DE",
      selector: "选择模型与推理强度",
      slider: "推理强度",
      value: "轻量",
      reset: "恢复默认推理强度",
    },
  ])(
    "localizes the slider and reset control in $language or uses the fallback",
    async ({ language, selector, slider, value, reset }) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      render(
        <ConversationModelSelector
          pending={false}
          onChange={vi.fn()}
          preference={modelPreference}
        />
      )
      await interaction.click(screen.getByRole("button", { name: selector }))
      expect(screen.getByRole("slider", { name: slider })).toHaveAttribute(
        "aria-valuetext",
        value
      )
      expect(screen.getByRole("button", { name: reset })).toBeVisible()
    }
  )

  it("disables selection when the model service is unconfigured", () => {
    render(
      <ConversationModelSelector
        pending={false}
        onChange={vi.fn()}
        preference={{ ...modelPreference, configured: false }}
      />
    )
    expect(
      screen.getByRole("button", { name: "模型服务未配置" })
    ).toBeDisabled()
    expect(screen.queryByRole("slider")).not.toBeInTheDocument()
  })
})

const modelPreference: ModelPreference = {
  configured: true,
  default_model: "gpt-5.6-sol",
  selected_model: "gpt-5.6-sol",
  selected_reasoning_effort: "low",
  models: [
    {
      id: "gpt-5.6-sol",
      display_name: "GPT-5.6-Sol",
      enabled: true,
      context_window: 258_000,
      supported_reasoning_efforts: [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ],
      default_reasoning_effort: "low",
    },
    {
      id: "model-b",
      display_name: "Model B",
      enabled: true,
      context_window: null,
      supported_reasoning_efforts: ["low"],
      default_reasoning_effort: "low",
    },
  ],
}

const modelContextUsage = {
  turnId: "turn-1",
  usedTokens: 155_000,
  modelContextWindow: 258_000,
} as const

function ControlledModelSelector({
  onChange,
}: {
  onChange: (model: string, reasoningEffort: ReasoningEffort) => void
}) {
  const [preference, setPreference] = useState<ModelPreference>(modelPreference)

  return (
    <ConversationModelSelector
      preference={preference}
      pending={false}
      onChange={(model, reasoningEffort) => {
        onChange(model, reasoningEffort)
        setPreference((current) => ({
          ...current,
          selected_model: model,
          selected_reasoning_effort: reasoningEffort,
        }))
      }}
    />
  )
}
