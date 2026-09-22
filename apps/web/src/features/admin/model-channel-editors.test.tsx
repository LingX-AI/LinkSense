import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ModelProviderSettings } from "@/api/contracts"
import i18n from "@/i18n"
import { ChannelEditor, ModelEditor } from "./model-channel-editors"
import { newModel } from "./model-settings-draft"

const channel: ModelProviderSettings["providers"][number] = {
  id: "primary",
  name: "Primary",
  provider: "openai_compatible",
  provider_project: null,
  provider_location: null,
  base_url: "https://models.example.test/v1",
  protocol_mode: "native_responses",
  api_key_configured: true,
  models: [{ ...newModel(), id: "model-a", display_name: "Model A" }],
}
const settings: ModelProviderSettings = {
  configured: true,
  revision: 1,
  providers: [
    channel,
    {
      ...channel,
      id: "secondary",
      name: "Secondary",
      models: [{ ...newModel(), id: "model-b", display_name: "Model B" }],
    },
  ],
  default_model: "model-a",
  memory_extraction_model: null,
  title_model: "model-a",
}

afterEach(cleanup)

describe("model editor conflict feedback", () => {
  it.each(["zh-CN", "en-US", "de-DE"])(
    "warns about same-channel and cross-channel model display names while allowing save in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <ModelEditor
          channel={channel}
          initialModel={null}
          settings={settings}
          pending={false}
          error={null}
          onClose={vi.fn()}
          onSave={onSave}
        />
      )
      await user.type(
        screen.getByLabelText(language === "en-US" ? "Model ID" : "模型 ID"),
        "model-c"
      )
      const name = screen.getByLabelText(
        language === "en-US" ? "Display name" : "显示名称"
      )
      const message =
        language === "en-US"
          ? "A model with this display name already exists. Consider a different name to distinguish them."
          : "已存在同名模型，建议修改显示名称以便区分。"
      expect(name).not.toHaveAttribute("aria-describedby")
      for (const value of ["Model A", " Model B "]) {
        await user.clear(name)
        await user.type(name, value)
        expect(name).toHaveAccessibleDescription(message)
        expect(name).toHaveClass(
          "border-destructive",
          "dark:border-destructive/50"
        )
        expect(screen.getByText(message)).toBeVisible()
        expect(screen.getByText(message)).toHaveClass("text-destructive")
        expect(
          screen.getByRole("button", {
            name:
              language === "en-US"
                ? `Save model ${value.trim()}`
                : `保存模型 ${value.trim()}`,
          })
        ).toBeEnabled()
      }
      await user.click(
        screen.getByRole("button", {
          name:
            language === "en-US" ? "Save model Model B" : "保存模型 Model B",
        })
      )
      expect(onSave).toHaveBeenCalledOnce()
      await user.clear(name)
      expect(name).not.toHaveAttribute("aria-describedby")
      await user.type(name, "New model")
      expect(name).not.toHaveClass("border-destructive")
      expect(screen.queryByText(message)).not.toBeInTheDocument()
    }
  )

  it("excludes the edited model's own display name even when its ID changes", async () => {
    await i18n.changeLanguage("en-US")
    const user = userEvent.setup()
    render(
      <ModelEditor
        channel={channel}
        initialModel={channel.models[0]!}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    const name = screen.getByLabelText("Display name")
    expect(name).not.toHaveAttribute("aria-describedby")
    await user.clear(screen.getByLabelText("Model ID"))
    await user.type(screen.getByLabelText("Model ID"), "renamed-id")
    expect(name).not.toHaveAttribute("aria-describedby")
    await user.clear(name)
    await user.type(name, "Model B")
    expect(name).toHaveAccessibleDescription(
      "A model with this display name already exists. Consider a different name to distinguish them."
    )
    await user.clear(name)
    await user.type(name, "Model A")
    expect(name).not.toHaveAttribute("aria-describedby")
    expect(
      screen.getByRole("button", { name: "Save model Model A" })
    ).toBeEnabled()
  })

  it.each(["zh-CN", "en-US", "de-DE"])(
    "warns about a duplicate channel name without changing the existing naming rules in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <ChannelEditor
          channel={null}
          settings={settings}
          pending={false}
          error={null}
          onClose={vi.fn()}
          onSave={onSave}
        />
      )
      const name = screen.getByLabelText(
        language === "en-US" ? "Channel name" : "渠道名称"
      )
      await user.type(name, " Primary ")
      expect(name).toHaveAccessibleDescription(
        language === "en-US"
          ? "A model channel with this name already exists. Consider a different name to distinguish them."
          : "已存在同名模型渠道，建议修改名称以便区分。"
      )
      const warning = screen.getByText(
        language === "en-US"
          ? "A model channel with this name already exists. Consider a different name to distinguish them."
          : "已存在同名模型渠道，建议修改名称以便区分。"
      )
      expect(warning).toBeVisible()
      expect(warning).toHaveClass("text-destructive")
      expect(name).toHaveClass(
        "border-destructive",
        "dark:border-destructive/50"
      )
      await user.type(
        screen.getByLabelText("Base URL"),
        "https://models.example.test/v1"
      )
      await user.type(screen.getByLabelText("API_KEY"), "test-key")
      const save = screen.getByRole("button", {
        name:
          language === "en-US"
            ? "Save model channel Primary"
            : "保存模型渠道 Primary",
      })
      expect(save).toBeEnabled()
      await user.clear(name)
      await user.type(name, "New channel")
      expect(name).not.toHaveClass("border-destructive")
      expect(name).not.toHaveAttribute("aria-describedby")
      expect(save).toBeEnabled()
      await user.click(save)
      expect(onSave).toHaveBeenCalledOnce()
    }
  )

  it("does not warn about a channel's own name while editing it", async () => {
    await i18n.changeLanguage("en-US")
    const user = userEvent.setup()
    render(
      <ChannelEditor
        channel={channel}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    const name = screen.getByLabelText("Channel name")
    expect(name).not.toHaveAttribute("aria-describedby")
    await user.clear(name)
    await user.type(name, "Secondary")
    expect(name).toHaveAccessibleDescription(
      "A model channel with this name already exists. Consider a different name to distinguish them."
    )
    await user.clear(name)
    await user.type(name, "Primary")
    expect(name).not.toHaveAttribute("aria-describedby")
  })

  it.each(["zh-CN", "en-US", "de-DE"])(
    "shows and clears duplicate model feedback in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <ModelEditor
          channel={channel}
          initialModel={null}
          settings={settings}
          pending={false}
          error={null}
          onClose={vi.fn()}
          onSave={onSave}
        />
      )
      const id = screen.getByLabelText(
        language === "en-US" ? "Model ID" : "模型 ID"
      )
      await user.type(
        screen.getByLabelText(
          language === "en-US" ? "Display name" : "显示名称"
        ),
        "New model"
      )
      const save = screen.getByRole("button", {
        name:
          language === "en-US" ? "Save model New model" : "保存模型 New model",
      })
      for (const value of ["model-a", " model-b "]) {
        await user.clear(id)
        await user.type(id, value)
        expect(id).toHaveAttribute("aria-invalid", "true")
        expect(id).toHaveAccessibleDescription(
          language === "en-US"
            ? "This model ID already exists in the model catalog. Use a different ID."
            : "模型列表中已存在此模型 ID，请使用其他 ID。"
        )
        expect(screen.getByRole("alert")).toBeVisible()
        expect(screen.getByRole("alert")).toHaveClass("text-destructive")
        expect(save).toBeDisabled()
        await user.click(save)
        expect(onSave).not.toHaveBeenCalled()
      }
      await user.clear(id)
      await user.type(id, "model-c")
      expect(id).toHaveAttribute("aria-invalid", "false")
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(save).toBeEnabled()
      await user.click(save)
      expect(onSave).toHaveBeenCalledOnce()
    }
  )

  it("allows the original model ID during editing but reports a rename collision", async () => {
    await i18n.changeLanguage("en-US")
    const user = userEvent.setup()
    render(
      <ModelEditor
        channel={channel}
        initialModel={channel.models[0]!}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    const id = screen.getByLabelText("Model ID")
    const save = screen.getByRole("button", { name: "Save model Model A" })
    expect(id).toHaveAttribute("aria-invalid", "false")
    expect(save).toBeEnabled()
    await user.clear(id)
    await user.type(id, "model-b")
    expect(id).toHaveAttribute("aria-invalid", "true")
    expect(save).toBeDisabled()
    await user.clear(id)
    await user.type(id, "model-a")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(save).toBeEnabled()
  })
})
