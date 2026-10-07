import { formLabelPattern } from "@/features/admin/required-field-label.test-helper"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { updateModelProviderSettingsSchema } from "@linksense/shared"
import type { ModelProviderSettings } from "@/api/contracts"
import i18n, { supportedLanguages } from "@/i18n"
import { ChannelEditor, ModelEditor } from "./model-channel-editors"
import { ModelProviderSettingsForm } from "./model-provider-settings-form"

const channel: ModelProviderSettings["providers"][number] = {
  id: "main",
  name: "Primary",
  provider: "openai_compatible",
  provider_project: null,
  provider_location: null,
  base_url: "https://models.example.test/v1",
  protocol_mode: "chat_completions_bridge",
  api_key_configured: true,
  models: [],
}
const settings: ModelProviderSettings = {
  configured: false,
  revision: 1,
  providers: [channel],
  default_model: null,
  title_model: null,
  memory_extraction_model: null,
}
function response(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  })
}
function renderModel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelEditor
        channel={channel}
        initialModel={null}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    </QueryClientProvider>
  )
}
function renderChannel(saved = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelEditor
        channel={saved ? channel : null}
        settings={settings}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    </QueryClientProvider>
  )
}
const foundModel = {
  id: "remote-model",
  display_name: "Remote model",
  context_window: 128000,
  supports_image_input: true,
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("model setup", () => {
  it.each(supportedLanguages)(
    "allows typing a test model before discovery in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      renderChannel(false)
      const user = userEvent.setup()
      const model = screen.getByRole("combobox", {
        name: i18n.t("modelSetup.testModel"),
      })
      expect(model).toBeEnabled()
      expect(
        screen.getByRole("button", {
          name: i18n.t("modelSetup.discover"),
        })
      ).toBeDisabled()
      await user.type(model, "manual-model")
      await user.tab()
      expect(model).toHaveValue("manual-model")
    }
  )

  it.each([true, false])(
    "discovers, selects and tests a model, then accepts a manual ID (saved channel: %s)",
    async (saved) => {
      const probes: Array<{ path: string; body: Record<string, unknown> }> = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init?: RequestInit) => {
          const path = String(url)
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          probes.push({ path, body })
          return response(
            path.endsWith("/discover")
              ? { status: "supported", models: [foundModel], truncated: false }
              : { status: "success", model_id: body.model_id }
          )
        })
      )
      renderChannel(saved)
      const user = userEvent.setup()
      if (!saved) {
        await user.type(
          screen.getByLabelText(formLabelPattern("Base URL")),
          channel.base_url
        )
        await user.type(
          screen.getByLabelText(formLabelPattern("API_KEY")),
          "draft-test-key"
        )
      }
      const model = screen.getByLabelText(formLabelPattern("Model ID to test"))
      await user.type(model, "first-manual-id")
      await user.click(
        screen.getByRole("button", { name: "Get available models" })
      )
      await waitFor(() => expect(probes).toHaveLength(1))
      expect(model).toHaveValue("first-manual-id")
      if (saved) {
        expect(probes[0]?.body).toMatchObject({ channel_id: channel.id })
        expect(probes[0]?.body).not.toHaveProperty("api_key")
      } else {
        expect(probes[0]?.body).toMatchObject({
          base_url: channel.base_url,
          api_key: "draft-test-key",
        })
        expect(probes[0]?.body).not.toHaveProperty("channel_id")
      }
      await user.clear(model)
      await user.type(model, "Remote")
      await user.click(
        await screen.findByRole("option", {
          name: "Remote model (remote-model)",
        })
      )
      expect(model).toHaveValue("remote-model")
      await user.click(
        screen.getByRole("button", { name: "Test model connection" })
      )
      expect(
        await screen.findByText(/Model remote-model responded successfully/)
      ).toBeVisible()
      await user.clear(model)
      await user.type(model, "custom-model")
      await user.tab()
      expect(model).toHaveValue("custom-model")
      expect(
        screen.queryByText(/responded successfully/)
      ).not.toBeInTheDocument()
      await user.click(
        screen.getByRole("button", { name: "Test model connection" })
      )
      expect(
        await screen.findByText(/Model custom-model responded successfully/)
      ).toBeVisible()
      expect(probes.map(({ body }) => body.model_id)).toEqual([
        undefined,
        "remote-model",
        "custom-model",
      ])
    }
  )

  it.each(["empty", "unsupported", "error"])(
    "keeps manual testing available when channel discovery returns %s",
    async (result) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init?: RequestInit) => {
          if (String(url).endsWith("/test-connection")) {
            return response({
              status: "success",
              model_id: JSON.parse(String(init?.body)).model_id,
            })
          }
          if (result === "error") throw new TypeError("Network unavailable")
          return response({
            status: result === "unsupported" ? "manual_required" : "supported",
            models: [],
            truncated: false,
          })
        })
      )
      renderChannel()
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("button", { name: "Get available models" })
      )
      if (result === "error")
        expect(await screen.findByRole("alert")).toBeVisible()
      else
        expect(
          await screen.findByText(
            result === "empty"
              ? /returned no available models/
              : /does not offer an available model list/
          )
        ).toBeVisible()
      await user.type(
        screen.getByLabelText(formLabelPattern("Model ID to test")),
        "manual-model"
      )
      await user.click(
        screen.getByRole("button", { name: "Test model connection" })
      )
      expect(
        await screen.findByText(/Model manual-model responded successfully/)
      ).toBeVisible()
    }
  )

  it("ignores a late model list after connection settings change and permits a fresh request", async () => {
    let finish: ((result: Response) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderChannel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    expect(
      screen.getByRole("button", { name: "Getting models…" })
    ).toBeDisabled()
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID to test")),
      "manual-model"
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Base URL")),
      "/changed"
    )
    expect(
      screen.getByRole("button", { name: "Get available models" })
    ).toBeDisabled()
    finish?.(
      response({ status: "supported", models: [foundModel], truncated: false })
    )
    await user.click(
      screen.getByLabelText(formLabelPattern("Model ID to test"))
    )
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
    expect(
      screen.getByLabelText(formLabelPattern("Model ID to test"))
    ).toHaveValue("manual-model")
    await user.type(
      screen.getByLabelText(formLabelPattern("API_KEY")),
      "new-test-key"
    )
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    finish?.(
      response({ status: "supported", models: [foundModel], truncated: false })
    )
    const model = screen.getByLabelText(formLabelPattern("Model ID to test"))
    await user.clear(model)
    await user.click(model)
    expect(
      await screen.findByRole("option", { name: "Remote model (remote-model)" })
    ).toBeVisible()
  })

  it.each(supportedLanguages)(
    "shows discovery beside selection and all advanced fields immediately in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      renderModel()
      const selection = screen.getByRole("combobox", {
        name: i18n.t("modelSetup.selectModel"),
      })
      const discover = screen.getByRole("button", {
        name: i18n.t("modelSetup.discover"),
      })
      expect(selection).toBeDisabled()
      const controls = selection.closest(
        '[data-slot="input-group"]'
      )?.parentElement
      expect(controls).toHaveClass("flex", "items-center")
      expect(controls).toContainElement(discover)
      expect(
        selection.compareDocumentPosition(discover) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        screen.getByLabelText(
          formLabelPattern(i18n.t("admin.modelProvider.inputPrice"))
        )
      ).toBeVisible()
      expect(
        screen.getByLabelText(
          formLabelPattern(i18n.t("admin.modelProvider.contextWindow"))
        )
      ).toBeVisible()
      expect(
        screen.queryByRole("button", { name: i18n.t("modelSetup.advanced") })
      ).not.toBeInTheDocument()
    }
  )
  it("creates a channel, discovers and tests its first model, then saves it as the default and title model", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    let saved: ModelProviderSettings = {
      ...settings,
      revision: 0,
      providers: [],
    }
    const writes: Array<
      ReturnType<typeof updateModelProviderSettingsSchema.parse>
    > = []
    const probes: Array<{ path: string; body: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init?: RequestInit) => {
        const path = String(url)
        const body: unknown = JSON.parse(String(init?.body))
        if (path.endsWith("/discover")) {
          probes.push({ path, body })
          return response({
            status: "supported",
            models: [foundModel],
            truncated: false,
          })
        }
        if (path.endsWith("/test-connection")) {
          probes.push({ path, body })
          return response({ status: "success", model_id: foundModel.id })
        }
        const input = updateModelProviderSettingsSchema.parse(body)
        writes.push(input)
        saved = {
          ...saved,
          configured: input.default_model !== null,
          revision: saved.revision + 1,
          default_model: input.default_model,
          title_model: input.title_model ?? null,
          providers: input.providers.map(({ api_key, ...provider }) => ({
            ...provider,
            name: provider.name ?? null,
            protocol_mode: provider.protocol_mode ?? "native_responses",
            api_key_configured:
              Boolean(api_key) ||
              saved.providers.some(
                (previous) =>
                  previous.id === provider.id && previous.api_key_configured
              ),
          })),
        }
        return response({ code: "SYSTEM_SETTINGS_UPDATED", settings: saved })
      })
    )
    render(
      <QueryClientProvider client={client}>
        <ModelProviderSettingsForm settings={saved} />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Add model channel" }))
    await user.type(
      screen.getByLabelText(formLabelPattern("Channel name")),
      "Primary"
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Base URL")),
      channel.base_url
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("API_KEY")),
      "test-key"
    )
    await user.click(
      screen.getByRole("button", { name: "Save model channel Primary" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(writes[0]).toMatchObject({ default_model: null, title_model: null })
    await user.click(screen.getByRole("button", { name: "Add model" }))
    expect(
      screen.queryByLabelText(formLabelPattern("Model ID"))
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText(formLabelPattern("Input price"))).toBeVisible()
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    const selection = await screen.findByRole("combobox", {
      name: "Select an available model",
    })
    await waitFor(() => expect(selection).toBeEnabled())
    await user.click(selection)
    await user.type(selection, "Remote")
    await user.click(
      await screen.findByRole("option", { name: "Remote model (remote-model)" })
    )
    expect(screen.getByLabelText(formLabelPattern("Model ID"))).toHaveValue(
      "remote-model"
    )
    expect(screen.getByLabelText(formLabelPattern("Display name"))).toHaveValue(
      "Remote model"
    )
    expect(screen.getByText("Context length: 128000 tokens")).toBeVisible()
    expect(screen.queryByText(/responded successfully/)).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    expect(
      await screen.findByText(/Model remote-model responded successfully/)
    ).toBeVisible()
    expect(probes).toHaveLength(2)
    expect(probes[0]?.body).not.toHaveProperty("api_key")
    expect(probes[1]?.body).toMatchObject({
      channel_id: saved.providers[0]?.id,
      model_id: "remote-model",
      kind: "chat",
      protocol_mode: "chat_completions_bridge",
    })
    await user.click(
      screen.getByRole("button", { name: "Save model Remote model" })
    )
    expect(
      await screen.findByRole("row", { name: "Remote model" })
    ).toBeVisible()
    expect(writes[1]).toMatchObject({
      default_model: "remote-model",
      title_model: "remote-model",
      providers: [
        {
          models: [
            {
              id: "remote-model",
              context_window: 128000,
              supports_image_input: true,
            },
          ],
        },
      ],
    })
    expect(
      client.getQueryData(["admin", "model-provider-settings"])
    ).toMatchObject({ default_model: "remote-model" })
  })

  it("keeps unknown discovered capabilities visible and provides a manual route for unsupported discovery", async () => {
    let supported = true
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          supported
            ? {
                status: "supported",
                models: [
                  {
                    ...foundModel,
                    context_window: null,
                    supports_image_input: null,
                  },
                ],
                truncated: true,
              }
            : { status: "manual_required", models: [], truncated: false }
        )
      )
    )
    renderModel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    const selection = screen.getByRole("combobox", {
      name: "Select an available model",
    })
    await waitFor(() => expect(selection).toBeEnabled())
    await user.click(selection)
    await user.click(
      await screen.findByRole("option", { name: "Remote model (remote-model)" })
    )
    expect(screen.getByText("Context length: not provided")).toBeVisible()
    expect(screen.getByText("Image input support: not provided")).toBeVisible()
    expect(screen.getByText(/Only some models are shown/)).toBeVisible()
    cleanup()
    supported = false
    renderModel()
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    expect(
      await screen.findByText(
        /This service does not offer an available model list/
      )
    ).toBeVisible()
    await user.click(
      screen.getByRole("button", { name: "Enter a model manually" })
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID")),
      "manual-model"
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Display name")),
      "Manual model"
    )
    expect(
      screen.getByRole("button", { name: "Save model Manual model" })
    ).toBeEnabled()
  })

  it("shows empty discovery results and allows retrying a failed list request", async () => {
    let fail = true
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail) throw new TypeError("Network unavailable")
        return response({ status: "supported", models: [], truncated: false })
      })
    )
    renderModel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    expect(await screen.findByRole("alert")).toBeVisible()
    fail = false
    await user.click(
      screen.getByRole("button", { name: "Get available models" })
    )
    expect(
      await screen.findByText(/The service returned no available models/)
    ).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("retries a failed inference request and invalidates its success as soon as the model draft changes", async () => {
    let fail = true
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail)
          return new Response(
            JSON.stringify({ success: false, error_code: "FORBIDDEN" }),
            { status: 403, headers: { "content-type": "application/json" } }
          )
        return response({ status: "success", model_id: "manual-model" })
      })
    )
    renderModel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Enter a model manually" })
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID")),
      "manual-model"
    )
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    expect(await screen.findByRole("alert")).toBeVisible()
    fail = false
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    expect(await screen.findByText(/responded successfully/)).toBeVisible()
    await user.type(
      screen.getByLabelText(formLabelPattern("Display name")),
      "Changed"
    )
    expect(screen.queryByText(/responded successfully/)).not.toBeInTheDocument()
  })

  it("does not apply a late test success after the user changes the model", async () => {
    let finish: ((result: Response) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderModel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Enter a model manually" })
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID")),
      "old-model"
    )
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    expect(
      screen.getByRole("button", { name: "Testing model…" })
    ).toBeDisabled()
    await user.clear(screen.getByLabelText(formLabelPattern("Model ID")))
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID")),
      "new-model"
    )
    finish?.(response({ status: "success", model_id: "old-model" }))
    await waitFor(() =>
      expect(
        screen.queryByText(/responded successfully/)
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("button", { name: "Test model connection" })
    ).toBeEnabled()
  })

  it("reports unsupported inference separately from a successful model response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ status: "unsupported", model_id: "embedding-model" })
      )
    )
    renderModel()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: "Enter a model manually" })
    )
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID")),
      "embedding-model"
    )
    await user.click(screen.getByRole("combobox", { name: "Model type" }))
    await user.click(
      await screen.findByRole("option", { name: "Embedding model" })
    )
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    expect(
      await screen.findByText(
        /Connection testing is not supported for this model type/
      )
    ).toBeVisible()
    expect(screen.queryByText(/responded successfully/)).not.toBeInTheDocument()
  })

  it("requires a new key to probe a changed saved endpoint and clears its old success", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({ status: "success", model_id: "model-a" })
    )
    vi.stubGlobal("fetch", fetchMock)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChannelEditor
          channel={channel}
          settings={settings}
          pending={false}
          error={null}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    await user.type(
      screen.getByLabelText(formLabelPattern("Model ID to test")),
      "model-a"
    )
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    expect(await screen.findByText(/responded successfully/)).toBeVisible()
    await user.type(
      screen.getByLabelText(formLabelPattern("Base URL")),
      "/other"
    )
    expect(screen.queryByText(/responded successfully/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Test model connection" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Save model channel Primary" })
    ).toBeDisabled()
    expect(
      screen.getByText(/The address or provider has changed/)
    ).toBeVisible()
    await user.type(
      screen.getByLabelText(formLabelPattern("API_KEY")),
      "new-key"
    )
    expect(
      screen.getByRole("button", { name: "Save model channel Primary" })
    ).toBeEnabled()
    await user.click(
      screen.getByRole("button", { name: "Test model connection" })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    ).toMatchObject({
      api_key: "new-key",
      base_url: `${channel.base_url}/other`,
    })
    expect(await screen.findByText(/responded successfully/)).toBeVisible()
    await user.type(
      screen.getByLabelText(formLabelPattern("Channel name")),
      " renamed"
    )
    expect(screen.queryByText(/responded successfully/)).not.toBeInTheDocument()
  })
})
