import {
  cleanup,
  render as renderComponent,
  screen,
} from "@testing-library/react"
import type { ReactElement } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  modelProviderPresets,
  modelServiceProviderValues,
} from "@linksense/shared"
import type { ModelProviderSettings } from "@/api/contracts"
import i18n, { supportedLanguages } from "@/i18n"
import { ChannelEditor, ModelEditor } from "./model-channel-editors"
import { newModel } from "./model-settings-draft"
import {
  expectRequiredLabel,
  formLabelPattern,
} from "./required-field-label.test-helper"

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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function render(element: ReactElement) {
  return renderComponent(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>
  )
}

describe("model editor conflict feedback", () => {
  it.each(supportedLanguages)(
    "opens and saves a new channel without crypto.randomUUID in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal("crypto", {
        getRandomValues: crypto.getRandomValues.bind(crypto),
      })
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
      await user.type(
        screen.getByLabelText(
          formLabelPattern(i18n.t("admin.modelProvider.providerName"))
        ),
        "LAN channel"
      )
      await user.type(
        screen.getByLabelText(
          formLabelPattern(i18n.t("admin.modelProvider.baseUrl"))
        ),
        "https://models.example.test/v1"
      )
      await user.type(
        screen.getByLabelText(
          formLabelPattern(i18n.t("admin.modelProvider.apiKey"))
        ),
        "test-key"
      )
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("admin.modelProvider.saveProvider", {
            name: "LAN channel",
          }),
        })
      )
      expect(onSave).toHaveBeenCalledOnce()
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(
                /^provider-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
              ),
              name: "LAN channel",
              api_key: "test-key",
            }),
          ]),
        })
      )
    }
  )

  it.each(
    supportedLanguages.flatMap((language) => [
      { language, mode: "new", editedChannel: null },
      { language, mode: "existing", editedChannel: channel },
    ])
  )(
    "renders the provider before the channel name for a $mode channel in $language",
    async ({ language, editedChannel }) => {
      await i18n.changeLanguage(language)
      render(
        <ChannelEditor
          channel={editedChannel}
          settings={settings}
          pending={false}
          error={null}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      )
      const provider = screen.getByRole("combobox", {
        name: i18n.t("admin.modelProvider.serviceProvider"),
      })
      const name = screen.getByRole("textbox", {
        name: i18n.t("admin.modelProvider.providerName"),
      })
      const providerField = provider.closest('[data-slot="field"]')
      const nameField = name.closest('[data-slot="field"]')
      expect(providerField?.parentElement?.children[0]).toBe(providerField)
      expect(providerField?.nextElementSibling).toBe(nameField)
      expect(nameField?.nextElementSibling).toContainElement(
        screen.getByRole("textbox", {
          name: i18n.t("admin.modelProvider.baseUrl"),
        })
      )
    }
  )

  it("marks channel credentials only when a new key is needed", async () => {
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
    expectRequiredLabel(screen.getByRole("textbox", { name: "Channel name" }))
    const url = screen.getByRole("textbox", { name: "Base URL" })
    expectRequiredLabel(url)
    const key = screen.getByLabelText(/^API_KEY\s*\*?$/)
    expectRequiredLabel(key, false)
    await user.clear(url)
    await user.type(url, "https://other-models.example.test/v1")
    expectRequiredLabel(key)
    expectRequiredLabel(
      screen.getByRole("combobox", { name: i18n.t("modelSetup.testModel") }),
      false
    )
  })

  it("marks the model identity and prices while leaving context length optional", async () => {
    await i18n.changeLanguage("en-US")
    render(
      <ModelEditor
        channel={channel}
        initialModel={channel.models[0] ?? null}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    expectRequiredLabel(screen.getByRole("textbox", { name: "Model ID" }))
    expectRequiredLabel(screen.getByRole("textbox", { name: "Display name" }))
    expectRequiredLabel(screen.getByRole("combobox", { name: "Model type" }))
    for (const key of ["inputPrice", "cachedInputPrice", "outputPrice"]) {
      expectRequiredLabel(
        screen.getByRole("textbox", {
          name: i18n.t(`admin.modelProvider.${key}`),
        })
      )
    }
    expectRequiredLabel(
      screen.getByRole("textbox", {
        name: i18n.t("admin.modelProvider.contextWindow"),
      }),
      false
    )
    expectRequiredLabel(
      screen.getByRole("button", {
        name: i18n.t("admin.modelProvider.supportedEfforts"),
      })
    )
    expectRequiredLabel(
      screen.getByRole("combobox", {
        name: i18n.t("admin.modelProvider.defaultEffort"),
      })
    )
  })

  it("disables connection fields and actions while a channel is being saved", async () => {
    await i18n.changeLanguage("en-US")
    render(
      <ChannelEditor
        channel={channel}
        settings={settings}
        pending
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    for (const label of ["Channel name", "Base URL", "API_KEY"]) {
      expect(screen.getByLabelText(formLabelPattern(label))).toBeDisabled()
    }
    for (const name of ["Model provider", "Protocol compatibility mode"]) {
      expect(screen.getByRole("combobox", { name })).toBeDisabled()
    }
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Save model channel Primary" })
    ).toBeDisabled()
  })

  it.each(supportedLanguages)(
    "keeps connection fields visible and editable after switching providers in %s",
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
        formLabelPattern(i18n.t("admin.modelProvider.providerName"))
      )
      const url = screen.getByLabelText(
        formLabelPattern(i18n.t("admin.modelProvider.baseUrl"))
      )
      const key = screen.getByLabelText(
        formLabelPattern(i18n.t("admin.modelProvider.apiKey"))
      )
      expectRequiredLabel(name)
      expectRequiredLabel(url)
      expectRequiredLabel(key)
      await user.type(name, "New channel")
      await user.type(key, "test-key")

      for (const provider of modelServiceProviderValues) {
        await user.click(
          screen.getByRole("combobox", {
            name: i18n.t("admin.modelProvider.serviceProvider"),
          })
        )
        await user.click(
          await screen.findByRole("option", {
            name: i18n.t(`admin.imageUnderstanding.providers.${provider}`),
          })
        )
        expect(name).toBeVisible()
        expect(name).toHaveValue("New channel")
        expect(url).toBeVisible()
        expect(url).toHaveValue(modelProviderPresets[provider].base_url ?? "")
        expect(key).toBeVisible()
        expect(key).toHaveValue("test-key")
        if (provider === "google_vertex") {
          expectRequiredLabel(
            screen.getByRole("textbox", {
              name: i18n.t("admin.imageUnderstanding.project"),
            })
          )
          expectRequiredLabel(
            screen.getByRole("textbox", {
              name: i18n.t("admin.imageUnderstanding.location"),
            })
          )
        }
        expect(
          screen.getByRole("combobox", {
            name: i18n.t("admin.modelProvider.serviceProvider"),
          })
        ).toBeVisible()
        expect(
          screen.getByRole("combobox", {
            name: i18n.t("admin.modelProvider.protocolMode"),
          })
        ).toHaveTextContent(
          i18n.t(
            `admin.modelProvider.protocolModes.${modelProviderPresets[provider].protocol_mode}`
          )
        )
      }

      await user.type(name, " edited")
      await user.type(url, "https://models.example.test/v1")
      await user.type(key, "-edited")
      expect(name).toHaveValue("New channel edited")
      expect(url).toHaveValue("https://models.example.test/v1")
      expect(key).toHaveValue("test-key-edited")
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("admin.modelProvider.saveProvider", {
            name: "New channel edited",
          }),
        })
      )
      expect(onSave).toHaveBeenCalledOnce()
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.arrayContaining([
            expect.objectContaining({
              name: "New channel edited",
              provider: "openai_compatible",
              base_url: "https://models.example.test/v1",
              api_key: "test-key-edited",
              protocol_mode:
                modelProviderPresets.openai_compatible.protocol_mode,
            }),
          ]),
        })
      )
    }
  )

  it("suggests OpenAI connection settings only after the user selects that provider", async () => {
    await i18n.changeLanguage("en-US")
    const user = userEvent.setup()
    render(
      <ChannelEditor
        channel={null}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )
    expect(screen.getByLabelText(formLabelPattern("Base URL"))).toHaveValue("")
    expect(
      screen.getByRole("combobox", { name: "Protocol compatibility mode" })
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Advanced settings" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "Model provider" }))
    await user.click(await screen.findByRole("option", { name: "OpenAI" }))
    expect(screen.getByLabelText(formLabelPattern("Base URL"))).toHaveValue(
      "https://api.openai.com/v1"
    )
  })

  it("preserves a saved provider's custom URL and protocol when opening the editor", async () => {
    await i18n.changeLanguage("en-US")
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <ChannelEditor
        channel={{
          ...channel,
          provider: "openai",
          protocol_mode: "responses_tool_compat",
        }}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={onSave}
      />
    )
    expect(screen.getByLabelText(formLabelPattern("Base URL"))).toHaveValue(
      channel.base_url
    )
    expect(
      screen.getByRole("combobox", { name: "Protocol compatibility mode" })
    ).toHaveTextContent(
      i18n.t("admin.modelProvider.protocolModes.responses_tool_compat")
    )
    await user.click(
      screen.getByRole("button", { name: "Save model channel Primary" })
    )
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.arrayContaining([
          expect.objectContaining({
            id: channel.id,
            base_url: channel.base_url,
            protocol_mode: "responses_tool_compat",
          }),
        ]),
      })
    )
  })

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
      await user.click(
        screen.getByRole("button", { name: i18n.t("modelSetup.manual") })
      )
      await user.type(
        screen.getByLabelText(
          formLabelPattern(language === "en-US" ? "Model ID" : "模型 ID")
        ),
        "model-c"
      )
      const name = screen.getByLabelText(
        formLabelPattern(language === "en-US" ? "Display name" : "显示名称")
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
    const name = screen.getByLabelText(formLabelPattern("Display name"))
    expect(name).not.toHaveAttribute("aria-describedby")
    await user.clear(screen.getByLabelText(formLabelPattern("Model ID")))
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID")),
      "renamed-id"
    )
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
        formLabelPattern(language === "en-US" ? "Channel name" : "渠道名称")
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
        screen.getByLabelText(formLabelPattern("Base URL")),
        "https://models.example.test/v1"
      )
      await user.type(
        screen.getByLabelText(formLabelPattern("API_KEY")),
        "test-key"
      )
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
    const name = screen.getByLabelText(formLabelPattern("Channel name"))
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
      await user.click(
        screen.getByRole("button", { name: i18n.t("modelSetup.manual") })
      )
      const id = screen.getByLabelText(
        formLabelPattern(language === "en-US" ? "Model ID" : "模型 ID")
      )
      await user.type(
        screen.getByLabelText(
          formLabelPattern(language === "en-US" ? "Display name" : "显示名称")
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
    const id = screen.getByLabelText(formLabelPattern("Model ID"))
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
