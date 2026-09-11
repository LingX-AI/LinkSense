import { updateModelProviderSettingsSchema } from "@linksense/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelProviderSettings } from "@/api/contracts"
import {
  InitialUserTokenQuotaSettingsForm,
  ModelProviderSettingsForm,
} from "@/features/admin/model-provider-settings-form"
import i18n from "@/i18n"

const settings: ModelProviderSettings = {
  management_enabled: true,
  configured: true,
  revision: 3,
  providers: [
    {
      id: "provider-1",
      name: "Primary",
      provider: "openai_compatible",
      provider_project: null,
      provider_location: null,
      base_url: "https://models.example.test/v1",
      protocol_mode: "native_responses",
      api_key_configured: true,
      models: [
        {
          id: "model-a",
          display_name: "Model A",
          kind: "chat",
          enabled: true,
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: "0",
          supports_image_input: false,
          context_window: null,
          supported_reasoning_efforts: ["medium"],
          default_reasoning_effort: "medium",
        },
      ],
    },
  ],
  default_model: "model-a",
  title_model: "model-a",
  token_limits: {
    weekly_token_limit: null,
    monthly_token_limit: null,
  },
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderModels(value = settings) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ModelProviderSettingsForm settings={value} />
    </QueryClientProvider>
  )
  return queryClient
}

function installSaveMock(
  initial = settings,
  detectContext = false,
  discoveredModels: unknown[] = []
) {
  let saved = initial
  const requests: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init?: RequestInit) => {
      if (String(_url).includes("/discoverable-models")) {
        return Response.json({
          success: true,
          data: {
            provider_id: "provider-1",
            models: discoveredModels,
          },
        })
      }
      const input = updateModelProviderSettingsSchema.parse(
        JSON.parse(String(init?.body))
      )
      requests.push(input)
      saved = {
        ...saved,
        configured: true,
        revision: saved.revision + 1,
        default_model: input.default_model,
        title_model: input.title_model ?? input.default_model,
        token_limits: input.token_limits,
        providers: input.providers.map((provider) => {
          const { api_key: apiKey, ...connection } = provider
          return {
            ...connection,
            name: provider.name ?? null,
            protocol_mode: provider.protocol_mode ?? "native_responses",
            api_key_configured:
              Boolean(apiKey) ||
              saved.providers.some(
                (previous) =>
                  previous.id === provider.id && previous.api_key_configured
              ),
            models: provider.models.map((model) =>
              model.kind === "chat" && detectContext
                ? { ...model, context_window: model.context_window ?? 150000 }
                : model
            ),
          }
        }),
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { code: "SYSTEM_SETTINGS_UPDATED", settings: saved },
        }),
        { headers: { "content-type": "application/json" } }
      )
    })
  )
  return requests
}

describe("ModelProviderSettingsForm", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
  })

  it.each([
    {
      locale: "zh-CN",
      table: "模型列表",
      edit: "编辑模型 Model A",
      modelKind: "对话模型",
      apiKeyConfigured: true,
      channelSummary:
        "当前渠道通过 OpenAI 兼容 / vLLM 接入，已添加 1 个模型，且密钥已配置",
      priceUnit: "，价格单位为元 / 百万 Token。",
      priceHeader: "输入 / 输入命中缓存 / 输出单价",
    },
    {
      locale: "en-US",
      table: "Models",
      edit: "Edit model Model A",
      modelKind: "Chat model",
      apiKeyConfigured: false,
      channelSummary:
        "This channel connects through OpenAI-compatible / vLLM and includes 1 model. No API key is configured yet",
      priceUnit: ". Prices are shown in CNY / 1M tokens.",
      priceHeader: "Input / cached input / output price",
    },
    {
      locale: "fr-FR",
      table: "模型列表",
      edit: "编辑模型 Model A",
      modelKind: "对话模型",
      apiKeyConfigured: true,
      channelSummary:
        "当前渠道通过 OpenAI 兼容 / vLLM 接入，已添加 1 个模型，且密钥已配置",
      priceUnit: "，价格单位为元 / 百万 Token。",
      priceHeader: "输入 / 输入命中缓存 / 输出单价",
    },
  ])(
    "shows a compact catalog with $locale translations or fallback",
    async ({
      locale,
      table,
      edit,
      modelKind,
      apiKeyConfigured,
      channelSummary,
      priceUnit,
      priceHeader,
    }) => {
      await i18n.changeLanguage(locale)
      renderModels({
        ...settings,
        providers: settings.providers.map((provider) => ({
          ...provider,
          api_key_configured: apiKeyConfigured,
          models: provider.models.map((model) => ({
            ...model,
            input_price_per_million: "1.5",
            cached_input_price_per_million: "0.2",
            output_price_per_million: "4.5",
          })),
        })),
      })
      const catalog = screen.getByRole("table", { name: table })
      expect(catalog.closest('[role="group"]')).toHaveClass(
        "rounded-2xl",
        "border",
        "border-[color:var(--app-border)]",
        "bg-card",
        "p-4"
      )
      expect(
        within(catalog).getByRole("columnheader", { name: priceHeader })
      ).toBeVisible()
      expect(
        within(catalog).getByRole("cell", { name: "1.5 / 0.2 / 4.5" })
      ).toBeVisible()
      const modelRow = within(catalog).getByRole("row", { name: "Model A" })
      expect(modelRow).toBeVisible()
      const modelKindBadge = within(modelRow)
        .getByText(modelKind)
        .closest('[data-slot="badge"]')
      expect(modelKindBadge).toHaveAttribute("data-variant", "ghost")
      expect(modelKindBadge).not.toHaveClass("bg-secondary")
      const channelGroup = screen.getByRole("group", { name: "Primary" })
      const channelSummaryLabel = within(channelGroup).getByText(channelSummary)
      const priceUnitLabel = within(channelGroup).getByText(priceUnit)
      expect(priceUnitLabel).toHaveClass("whitespace-nowrap")
      expect(channelSummaryLabel.parentElement).toBe(
        priceUnitLabel.parentElement
      )
      expect(channelSummaryLabel.parentElement).toHaveClass(
        "leading-relaxed",
        "text-muted-foreground"
      )
      expect(channelSummaryLabel.parentElement?.textContent).toBe(
        `${channelSummary}${priceUnit}`
      )
      expect(within(catalog).getByText("model-a")).toBeVisible()
      expect(within(catalog).queryByRole("textbox")).not.toBeInTheDocument()
      expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole("button", { name: edit }))
      expect(screen.getByRole("dialog", { name: edit })).toBeVisible()
    }
  )

  it("uses the plural channel summary when multiple models are configured", async () => {
    await i18n.changeLanguage("en-US")
    const channel = settings.providers[0]
    const model = channel?.models[0]
    if (!channel || !model) {
      throw new Error("Expected the model settings fixture to include a model")
    }

    renderModels({
      ...settings,
      providers: [
        {
          ...channel,
          models: [
            model,
            {
              ...model,
              id: "model-b",
              display_name: "Model B",
            },
          ],
        },
      ],
    })

    expect(
      screen.getByText(
        "This channel connects through OpenAI-compatible / vLLM and includes 2 models. The API key is configured"
      )
    ).toBeVisible()
  })

  it.each([
    {
      locale: "zh-CN",
      modelActions: "模型 Model A 的操作",
      channelActions: "渠道操作",
      modelLabel: "删除模型",
      channelLabel: "删除渠道",
      editLabel: "编辑渠道",
    },
    {
      locale: "en-US",
      modelActions: "Actions for model Model A",
      channelActions: "Channel actions",
      modelLabel: "Delete model",
      channelLabel: "Delete channel",
      editLabel: "Edit channel",
    },
    {
      locale: "fr-FR",
      modelActions: "模型 Model A 的操作",
      channelActions: "渠道操作",
      modelLabel: "删除模型",
      channelLabel: "删除渠道",
      editLabel: "编辑渠道",
    },
  ])(
    "uses short, single-line deletion menu labels in $locale",
    async ({
      locale,
      modelActions,
      channelActions,
      modelLabel,
      channelLabel,
      editLabel,
    }) => {
      await i18n.changeLanguage(locale)
      renderModels()
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: modelActions }))
      const deleteModel = await screen.findByRole("menuitem", {
        name: modelLabel,
      })
      expect(deleteModel).toHaveTextContent(modelLabel)
      expect(deleteModel).not.toHaveTextContent("Model A")
      expect(deleteModel).toHaveClass("whitespace-nowrap")
      await user.keyboard("{Escape}")
      await user.click(screen.getByRole("button", { name: channelActions }))
      const deleteChannel = await screen.findByRole("menuitem", {
        name: channelLabel,
      })
      expect(deleteChannel).toHaveTextContent(channelLabel)
      expect(deleteChannel).not.toHaveTextContent("Primary")
      expect(deleteChannel).toHaveClass("whitespace-nowrap")
      const editChannel = screen.getByRole("menuitem", { name: editLabel })
      expect(screen.getAllByRole("menuitem")[0]).toBe(editChannel)
      expect(
        screen.queryByRole("button", { name: editLabel })
      ).not.toBeInTheDocument()
      await user.click(editChannel)
      expect(
        await screen.findByRole("dialog", { name: editLabel })
      ).toBeVisible()
    }
  )

  it("saves channel connection settings before adding any models", async () => {
    const empty: ModelProviderSettings = {
      ...settings,
      configured: false,
      revision: 0,
      providers: [],
      default_model: null,
      title_model: null,
    }
    const requests = installSaveMock(empty)
    renderModels(empty)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Add model channel" }))
    const dialog = screen.getByRole("dialog", { name: "Add model channel" })
    expect(within(dialog).queryByLabelText("Model ID")).not.toBeInTheDocument()
    expect(
      within(dialog).queryByLabelText("Display name")
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole("combobox", { name: "Model type" })
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByText("Add the first model")
    ).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText("Channel name"), "Primary")
    await user.type(
      within(dialog).getByLabelText("Base URL"),
      "https://models.example.test/v1"
    )
    await user.type(within(dialog).getByLabelText("API_KEY"), "test-key")
    await user.click(
      within(dialog).getByRole("button", { name: "Save model channel Primary" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(requests[0]).toMatchObject({
      providers: [{ name: "Primary", models: [] }],
      default_model: null,
      title_model: null,
    })
    expect(screen.getByText("No models in this channel")).toBeVisible()
    const emptyChannelSummary = within(
      screen.getByRole("group", { name: "Primary" })
    ).getByText(
      "This channel connects through OpenAI-compatible / vLLM and includes 0 models. The API key is configured"
    )
    expect(emptyChannelSummary.parentElement?.textContent).toBe(
      "This channel connects through OpenAI-compatible / vLLM and includes 0 models. The API key is configured."
    )
    expect(screen.queryByText(/Prices are shown in/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Conversation default model" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add model" }))
    await user.type(screen.getByLabelText("Model ID"), "model-a")
    await user.type(screen.getByLabelText("Display name"), "Model A")
    await user.click(screen.getByRole("button", { name: "Save model Model A" }))
    expect(await screen.findByRole("row", { name: "Model A" })).toBeVisible()
    expect(requests[1]).toMatchObject({
      expected_revision: 1,
      providers: [{ models: [{ id: "model-a" }] }],
      default_model: "model-a",
      title_model: "model-a",
    })
  })

  it("loads a searchable provider catalog and fills a selected model while keeping manual fields editable", async () => {
    const requests = installSaveMock(settings, false, [
      {
        id: "remote-model",
        display_name: "Remote Model",
        kind: "chat",
        context_window: 128_000,
        supports_image_input: true,
        supported_reasoning_efforts: ["low", "medium", "high"],
        default_reasoning_effort: "medium",
      },
    ])
    renderModels()
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Add model" }))
    const catalog = await screen.findByRole("combobox", {
      name: "Model from provider (optional)",
    })
    await user.click(catalog)
    await user.type(catalog, "Remote")
    await user.click(
      await screen.findByRole("option", { name: /Remote Model/u })
    )

    expect(screen.getByLabelText("Model ID")).toHaveValue("remote-model")
    expect(screen.getByLabelText("Display name")).toHaveValue("Remote Model")
    expect(screen.getByLabelText("Model context length")).toHaveValue("128000")
    expect(
      screen.getByRole("switch", { name: "Supports image understanding" })
    ).toBeChecked()

    await user.clear(screen.getByLabelText("Display name"))
    await user.type(screen.getByLabelText("Display name"), "Custom name")
    await user.click(
      screen.getByRole("button", { name: "Save model Custom name" })
    )
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      providers: [
        {
          models: [
            { id: "model-a" },
            {
              id: "remote-model",
              display_name: "Custom name",
              context_window: 128_000,
              supports_image_input: true,
            },
          ],
        },
      ],
    })
  })

  it("opens channel connection fields in a centered shared dialog and saves only those fields", async () => {
    const requests = installSaveMock()
    renderModels()
    const user = userEvent.setup()
    expect(
      screen.queryByRole("button", { name: "Connection settings" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Channel actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit channel" })
    )
    const panel = screen.getByRole("dialog", { name: "Edit channel" })
    expect(panel).toHaveAttribute("data-slot", "dialog-content")
    expect(panel).toHaveClass(
      "top-1/2",
      "left-1/2",
      "sm:max-w-2xl",
      "max-h-[calc(100dvh-2rem)]"
    )
    const provider = within(panel).getByRole("combobox", {
      name: "Model provider",
    })
    const baseUrl = within(panel).getByLabelText("Base URL")
    const providerField = provider.closest('[data-slot="field"]')
    expect(providerField?.parentElement).toBe(
      baseUrl.closest('[data-slot="field"]')?.parentElement
    )
    expect(providerField?.parentElement).toHaveClass("sm:grid-cols-2")
    expect(within(panel).queryByLabelText("Model ID")).not.toBeInTheDocument()
    await user.clear(baseUrl)
    await user.type(baseUrl, "https://models-2.example.test/v1")
    expect(requests).toHaveLength(0)
    await user.click(
      within(panel).getByRole("button", { name: "Save model channel Primary" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      expected_revision: 3,
      providers: [
        {
          id: "provider-1",
          base_url: "https://models-2.example.test/v1",
          models: [{ id: "model-a" }],
        },
      ],
      default_model: "model-a",
      title_model: "model-a",
    })
  })

  it("cancels a new model locally and does not include it in a later channel save", async () => {
    const requests = installSaveMock()
    renderModels()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Add model" }))
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(requests).toHaveLength(0)
    expect(
      screen.queryByRole("button", { name: "Connection settings" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Channel actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit channel" })
    )
    await user.click(
      screen.getByRole("button", { name: "Save model channel Primary" })
    )
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      providers: [{ models: [{ id: "model-a" }] }],
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole("button", { name: "Add model" }))
    await user.type(screen.getByLabelText("Model ID"), "model-b")
    await user.type(screen.getByLabelText("Display name"), "Model B")
    await user.click(screen.getByRole("button", { name: "Save model Model B" }))
    expect(await screen.findByRole("row", { name: "Model B" })).toBeVisible()
    expect(requests[1]).toMatchObject({
      providers: [{ models: [{ id: "model-a" }, { id: "model-b" }] }],
    })
  })

  it("fills detected context length after saving and allows a manual override", async () => {
    const requests = installSaveMock(settings, true)
    renderModels()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit model Model A" }))
    expect(screen.getByLabelText("Model context length")).toHaveValue("")
    await user.click(screen.getByRole("button", { name: "Save model Model A" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(requests[0]).toMatchObject({
      providers: [{ models: [{ context_window: null }] }],
    })
    await user.click(screen.getByRole("button", { name: "Edit model Model A" }))
    const context = screen.getByLabelText("Model context length")
    expect(context).toHaveValue("150000")
    await user.clear(context)
    await user.type(context, "128000")
    await user.click(screen.getByRole("button", { name: "Save model Model A" }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({
      expected_revision: 4,
      providers: [{ models: [{ context_window: 128000 }] }],
    })
  })

  it.each(["0", "-1", "1.5", "9007199254740992"])(
    "blocks the invalid context length %s",
    async (value) => {
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      renderModels()
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("button", { name: "Edit model Model A" })
      )
      await user.type(screen.getByLabelText("Model context length"), value)
      expect(
        screen.getByText(
          "Enter an integer greater than 0, or leave blank to auto-detect."
        )
      ).toBeVisible()
      expect(
        screen.getByRole("button", { name: "Save model Model A" })
      ).toBeDisabled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it("requires confirmation to discard edits and restores the saved values on reopening", async () => {
    renderModels()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit model Model A" }))
    await user.type(screen.getByLabelText("Display name"), " changed")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(
      screen.getByRole("dialog", { name: "Discard unsaved changes?" })
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Discard changes" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole("button", { name: "Edit model Model A" }))
    expect(screen.getByLabelText("Display name")).toHaveValue("Model A")
  })

  it("does not submit unsaved global selections when saving one model", async () => {
    const first = settings.providers[0]
    const model = first?.models[0]
    if (!first || !model) throw new Error("Missing fixture")
    const data = {
      ...settings,
      providers: [
        {
          ...first,
          models: [model, { ...model, id: "model-b", display_name: "Model B" }],
        },
      ],
    }
    const requests = installSaveMock(data)
    renderModels(data)
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("combobox", { name: "Conversation default model" })
    )
    await user.click(await screen.findByRole("option", { name: "Model B" }))
    await user.click(screen.getByRole("button", { name: "Edit model Model A" }))
    await user.type(screen.getByLabelText("Display name"), " updated")
    await user.click(
      screen.getByRole("button", { name: "Save model Model A updated" })
    )
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      default_model: "model-a",
      title_model: "model-a",
      providers: [
        {
          models: [
            { display_name: "Model A updated" },
            { display_name: "Model B" },
          ],
        },
      ],
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("combobox", { name: "Conversation default model" })
    ).toHaveTextContent("Model B")
  })

  it("saves model and channel ordering and invalidates composer preferences", async () => {
    const first = settings.providers[0]
    const model = first?.models[0]
    if (!first || !model) throw new Error("Missing fixture")
    const data = {
      ...settings,
      providers: [
        {
          ...first,
          models: [model, { ...model, id: "model-b", display_name: "Model B" }],
        },
        {
          ...first,
          id: "provider-2",
          name: "Secondary",
          models: [{ ...model, id: "model-c", display_name: "Model C" }],
        },
      ],
    }
    const requests = installSaveMock(data)
    const queryClient = renderModels(data)
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Actions for model Model B" })
    )
    await user.click(await screen.findByRole("menuitem", { name: "Move up" }))
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("row")
          .slice(1)
          .map((row) => row.getAttribute("aria-label"))
      ).toEqual(["Model B", "Model A"])
    )
    expect(requests[0]).toMatchObject({
      providers: [
        { models: [{ id: "model-b" }, { id: "model-a" }] },
        { models: [{ id: "model-c" }] },
      ],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["me", "model-preference"],
    })
    await user.click(screen.getByRole("button", { name: "Channel actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Move channel down" })
    )
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({
      expected_revision: 4,
      providers: [{ id: "provider-2" }, { id: "provider-1" }],
    })
  })

  it("keeps the saved order after a failed reorder and displays the error", async () => {
    const first = settings.providers[0]
    const model = first?.models[0]
    if (!first || !model) throw new Error("Missing fixture")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ success: false, error_code: "CONFLICT" }),
            { status: 409, headers: { "content-type": "application/json" } }
          )
      )
    )
    renderModels({
      ...settings,
      providers: [
        {
          ...first,
          models: [model, { ...model, id: "model-b", display_name: "Model B" }],
        },
      ],
    })
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Actions for model Model B" })
    )
    await user.click(await screen.findByRole("menuitem", { name: "Move up" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.getAttribute("aria-label"))
    ).toEqual(["Model A", "Model B"])
  })

  it("disables editing, availability, and sorting in read-only mode", () => {
    renderModels({ ...settings, management_enabled: false })
    for (const name of [
      "Add model channel",
      "Channel actions",
      "Add model",
      "Edit model Model A",
      "Actions for model Model A",
      "Reorder model Model A",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled()
    }
    expect(
      screen.getByRole("switch", {
        name: "Available in conversations: Model A",
      })
    ).toHaveAttribute("aria-disabled", "true")
  })
})

describe("InitialUserTokenQuotaSettingsForm", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
  })

  it("sends initial user token usage with the model provider update", async () => {
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...settings,
                revision: 4,
                token_limits: requestBody?.token_limits,
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <InitialUserTokenQuotaSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const user = userEvent.setup()
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Initial user token usage",
    })
    expect(heading).toHaveClass("text-sm", "leading-5", "font-semibold")
    expect(heading.closest("form")).toHaveClass("w-full")
    expect(heading.closest("form")).not.toHaveClass("max-w-[720px]")
    expect(heading.closest('[data-slot="model-settings-card"]')).toHaveClass(
      "rounded-2xl",
      "border",
      "border-[color:var(--app-border)]"
    )
    expect(
      screen.getByText(/New or imported users receive these initial weekly/u)
    ).toHaveClass("form-hint")
    for (const hint of screen.getAllByText(/Enter an amount greater than 0/u)) {
      expect(hint).toHaveClass("form-hint")
    }
    const weeklyInput = screen.getByLabelText("Weekly usage (M tokens)")
    const monthlyInput = screen.getByLabelText("Monthly usage (M tokens)")
    const weeklyField = weeklyInput.closest('[data-slot="field"]')
    expect(weeklyField?.parentElement).toBe(
      monthlyInput.closest('[data-slot="field"]')?.parentElement
    )
    expect(weeklyField?.parentElement).toHaveClass("grid-cols-1")
    await user.type(weeklyInput, "0.05")
    await user.type(monthlyInput, "0.2")
    const saveButton = screen.getByRole("button", {
      name: "Save configuration",
    })
    expect(saveButton).toHaveClass("w-auto", "justify-self-start")
    await user.click(saveButton)

    await waitFor(() => {
      expect(requestBody).toMatchObject({
        expected_revision: 3,
        providers: [
          {
            id: "provider-1",
            name: "Primary",
            base_url: "https://models.example.test/v1",
            models: [{ id: "model-a" }],
          },
        ],
        token_limits: {
          weekly_token_limit: "50000",
          monthly_token_limit: "200000",
        },
      })
    })
  })
})
