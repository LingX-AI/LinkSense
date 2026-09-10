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

describe("ConversationModelSelector", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(cleanup)

  it("renders model and reasoning effort as separate side submenus", async () => {
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
    const menu = await screen.findByRole("menu")
    const modelTrigger = within(menu).getByRole("menuitem", {
      name: /^模型\s*GPT-5\.6-Sol$/,
    })
    const effortTrigger = within(menu).getByRole("menuitem", {
      name: /^推理强度\s*轻量$/,
    })
    expect(modelTrigger).toHaveAttribute("aria-haspopup", "menu")
    expect(effortTrigger).toHaveAttribute("aria-haspopup", "menu")
    expect(modelTrigger).toHaveClass(
      "focus:bg-hover",
      "data-popup-open:bg-accent",
      "data-open:bg-accent"
    )
    expect(effortTrigger).toHaveClass(
      "focus:bg-hover",
      "data-popup-open:bg-accent",
      "data-open:bg-accent"
    )
    expect(menu).toHaveClass("w-max", "min-w-52", "max-w-[calc(100vw-1rem)]")
    expect(menu).not.toHaveClass("w-64")
    expect(within(menu).queryByRole("menuitemradio")).not.toBeInTheDocument()
    expect(screen.queryByText("速度")).not.toBeInTheDocument()

    await interaction.hover(effortTrigger)
    const effortSection = await screen.findByRole("group", {
      name: "推理强度",
    })
    expect(
      within(effortSection).queryByRole("menuitemradio", { name: "最小" })
    ).not.toBeInTheDocument()
    for (const label of ["轻量", "中", "高", "超高", "最高", "极致"]) {
      expect(
        within(effortSection).getByRole("menuitemradio", { name: label })
      ).toBeVisible()
    }
    for (const item of within(effortSection).getAllByRole("menuitemradio")) {
      expect(item).toHaveClass("min-h-9", "text-sm")
    }
    expect(effortSection.closest('[role="menu"]')).toHaveClass(
      "w-max",
      "min-w-36",
      "max-w-[calc(100vw-1rem)]"
    )
    expect(effortSection.closest('[role="menu"]')).not.toHaveClass("w-56")

    await interaction.hover(modelTrigger)
    const modelSection = await screen.findByRole("group", { name: "模型" })
    for (const modelName of ["GPT-5.6-Sol", "Model B"]) {
      expect(
        within(modelSection).getByRole("menuitemradio", { name: modelName })
      ).toHaveClass("min-h-9", "text-sm")
    }
    expect(modelSection.closest('[role="menu"]')).toHaveClass(
      "w-max",
      "min-w-48",
      "max-w-[calc(100vw-1rem)]"
    )
    expect(modelSection.closest('[role="menu"]')).not.toHaveClass("w-64")
    await interaction.keyboard("{Escape}{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
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
    expect(within(popup).getByText("已用 151.4k 标记，共 252k")).toBeVisible()
  })

  it.each([
    {
      language: "zh-CN",
      badge: "背景信息窗口：50% 已用",
      detail: "已用 128k 标记，共 256k",
    },
    {
      language: "en-US",
      badge: "Background context window: 50% used",
      detail: "128k tokens used, 256k total",
    },
    {
      language: "fr-FR",
      badge: "背景信息窗口：50% 已用",
      detail: "已用 128k 标记，共 256k",
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

    await interaction.hover(screen.getByLabelText("背景信息窗口：暂无用量"))

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
    await interaction.hover(
      await screen.findByRole("menuitem", { name: /^推理强度\s*轻量$/ })
    )
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "极致" }))
    expect(onChange).toHaveBeenLastCalledWith("gpt-5.6-sol", "ultra")

    await interaction.hover(
      screen.getByRole("menuitem", { name: /^模型\s*GPT-5\.6-Sol$/ })
    )
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Model B" })
    )
    expect(onChange).toHaveBeenCalledWith("model-b", "low")
    await interaction.hover(
      screen.getByRole("menuitem", { name: /^推理强度\s*轻量$/ })
    )
    const effortSection = await screen.findByRole("group", {
      name: "推理强度",
    })
    expect(
      within(effortSection).getByRole("menuitemradio", { name: "轻量" })
    ).toBeVisible()
    expect(
      within(effortSection).queryByRole("menuitemradio", { name: "中" })
    ).not.toBeInTheDocument()

    await interaction.hover(
      screen.getByRole("menuitem", { name: /^模型\s*Model B$/ })
    )
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "GPT-5.6-Sol" })
    )
    expect(onChange).toHaveBeenLastCalledWith("gpt-5.6-sol", "low")
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /^模型\s*GPT-5\.6-Sol$/ })
      ).toBeVisible()
    )
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
