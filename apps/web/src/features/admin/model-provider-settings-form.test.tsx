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

describe("ModelProviderSettingsForm", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
  })

  it("places the model provider before Base URL in the same responsive row", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ModelProviderSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const providerSelect = screen.getByRole("combobox", {
      name: "Model provider",
    })
    const baseUrlInput = screen.getByLabelText("Base URL")
    const providerField = providerSelect.closest('[data-slot="field"]')
    const baseUrlField = baseUrlInput.closest('[data-slot="field"]')
    if (!providerField || !baseUrlField) {
      throw new Error("Expected model provider and Base URL fields")
    }

    expect(providerField.parentElement).toBe(baseUrlField.parentElement)
    expect(providerField.parentElement).toHaveClass("lg:grid-cols-2")
    expect(
      providerField.compareDocumentPosition(baseUrlField) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(baseUrlField).not.toHaveClass("lg:col-span-2")
    expect(
      screen.getByText(/Manage models and their connections in one place/u)
    ).toHaveClass("form-hint")
    expect(screen.getByText("Models added: 1.")).toHaveClass("form-hint")
    expect(
      screen.getByText(/Models here share this channel's connection and key/u)
    ).toHaveClass("form-hint")
    expect(
      screen.getByRole("heading", { level: 2, name: "Model channels" })
    ).toHaveClass("text-sm", "leading-5", "font-semibold")
  })

  it("saves channel edits after clicking the channel save button", async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >
        requestBodies.push(requestBody)
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...settings,
                revision: 4,
                default_model: requestBody.default_model,
                title_model: requestBody.title_model,
                providers: requestBody.providers,
                token_limits: requestBody.token_limits,
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
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <ModelProviderSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const provider = screen.getByRole("group", { name: "Primary" })
    const baseUrlInput = screen.getByLabelText("Base URL")
    await user.clear(baseUrlInput)
    await user.type(baseUrlInput, "https://models-2.example.test/v1")

    expect(requestBodies).toHaveLength(0)
    await user.click(
      within(provider).getByRole("button", {
        name: "Save model channel Primary",
      })
    )
    await waitFor(() => expect(requestBodies).toHaveLength(1))
    expect(requestBodies[0]).toMatchObject({
      expected_revision: 3,
      providers: [
        {
          id: "provider-1",
          name: "Primary",
          base_url: "https://models-2.example.test/v1",
          models: [{ id: "model-a" }],
        },
      ],
      default_model: "model-a",
      title_model: "model-a",
    })
    expect(requestBodies).toHaveLength(1)
  })

  it("omits an untouched added model from channel save but includes it in model save", async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)))
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              code: "SYSTEM_SETTINGS_UPDATED",
              settings,
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
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <ModelProviderSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const provider = screen.getByRole("group", { name: "Primary" })
    await user.click(
      within(provider).getByRole("button", { name: "Add model" })
    )
    expect(within(provider).getAllByLabelText("Model ID")).toHaveLength(2)

    await user.click(
      within(provider).getByRole("button", {
        name: "Save model channel Primary",
      })
    )
    await waitFor(() => expect(requestBodies).toHaveLength(1))
    expect(requestBodies[0]?.providers).toMatchObject([
      {
        models: [{ id: "model-a" }],
      },
    ])

    await user.click(
      within(provider).getByRole("button", { name: "Save model Model 2" })
    )
    await waitFor(() => expect(requestBodies).toHaveLength(2))
    expect(requestBodies[1]?.providers).toMatchObject([
      {
        models: [{ id: "model-a" }, { id: "model-2" }],
      },
    ])
  })

  it("fills detected model context length after save and allows manual override", async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >
        requestBodies.push(requestBody)
        const submittedProviders = requestBody.providers as Array<{
          models: Array<{ id: string; context_window: number | null }>
        }>
        const [submittedProvider] = submittedProviders
        const [submittedModel] = submittedProvider?.models ?? []
        if (!submittedProvider || !submittedModel) {
          throw new Error("expected one submitted model provider")
        }
        const [settingsProvider] = settings.providers
        if (!settingsProvider) {
          throw new Error("expected one configured model provider")
        }
        const [settingsModel] = settingsProvider.models
        if (!settingsModel) {
          throw new Error("expected one configured model")
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...settings,
                revision: 4 + requestBodies.length,
                default_model: requestBody.default_model,
                title_model: requestBody.title_model,
                providers: [
                  {
                    ...settingsProvider,
                    ...submittedProvider,
                    api_key_configured: true,
                    models: [
                      {
                        ...settingsModel,
                        ...submittedModel,
                        context_window: submittedModel.context_window ?? 150000,
                      },
                    ],
                  },
                ],
                token_limits: requestBody.token_limits,
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
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <ModelProviderSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const provider = screen.getByRole("group", { name: "Primary" })
    const contextWindowInput = within(provider).getByLabelText(
      "Model context length"
    )
    expect(contextWindowInput).toHaveValue("")

    await user.click(
      within(provider).getByRole("button", {
        name: "Save model channel Primary",
      })
    )

    await waitFor(() => expect(requestBodies).toHaveLength(1))
    expect(requestBodies[0]?.providers).toMatchObject([
      {
        models: [{ id: "model-a", context_window: null }],
      },
    ])
    await waitFor(() => expect(contextWindowInput).toHaveValue("150000"))

    await user.clear(contextWindowInput)
    await user.type(contextWindowInput, "128000")
    await user.click(
      within(provider).getByRole("button", { name: "Save model Model A" })
    )

    await waitFor(() => expect(requestBodies).toHaveLength(2))
    expect(requestBodies[1]?.providers).toMatchObject([
      {
        models: [{ id: "model-a", context_window: 128000 }],
      },
    ])
  })

  it("blocks invalid model context length values", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <ModelProviderSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const provider = screen.getByRole("group", { name: "Primary" })
    await user.type(
      within(provider).getByLabelText("Model context length"),
      "0"
    )

    expect(
      screen.getByText(
        "Enter an integer greater than 0, or leave blank to auto-detect."
      )
    ).toBeVisible()
    expect(
      within(provider).getByRole("button", {
        name: "Save model channel Primary",
      })
    ).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("deletes an unsaved added model without confirmation or API request", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <ModelProviderSettingsForm settings={settings} />
      </QueryClientProvider>
    )

    const provider = screen.getByRole("group", { name: "Primary" })
    await user.click(
      within(provider).getByRole("button", { name: "Add model" })
    )
    expect(
      within(provider).getByRole("group", { name: "Model 2" })
    ).toBeVisible()

    await user.click(
      within(provider).getByRole("button", { name: "Delete model Model 2" })
    )

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      within(provider).queryByRole("group", { name: "Model 2" })
    ).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
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
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Initial user token usage",
      })
    ).toHaveClass("text-sm", "leading-5", "font-semibold")
    expect(
      screen.getByText(/New or imported users receive these initial weekly/u)
    ).toHaveClass("form-hint")
    for (const hint of screen.getAllByText(/Enter an amount greater than 0/u)) {
      expect(hint).toHaveClass("form-hint")
    }
    await user.type(screen.getByLabelText("Weekly usage (M tokens)"), "0.05")
    await user.type(screen.getByLabelText("Monthly usage (M tokens)"), "0.2")
    const saveButton = screen.getByRole("button", { name: "Save" })
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
