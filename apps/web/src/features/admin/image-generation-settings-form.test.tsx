import {
  imageGenerationProviderDefinitions,
  imageGenerationSettingsSchema,
  updateImageGenerationSettingsSchema,
  type ImageGenerationSettings,
  type UpdateImageGenerationSettings,
} from "@linksense/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelProviderSettings } from "@/api/contracts"
import { ImageGenerationSettingsForm } from "@/features/admin/image-generation-settings-form"
import { formLabelPattern } from "@/features/admin/required-field-label.test-helper"
import i18n, { supportedLanguages } from "@/i18n"

const settings = imageGenerationSettingsSchema.parse({
  configured: true,
  revision: 2,
  enabled: true,
  provider: "openai",
  provider_options: { workspace_id: null, region: null },
  base_url: "https://api.openai.com/v1",
  api_key_configured: true,
  model: "gpt-image-2",
  price_per_image: "0.25",
  currency: "USD",
  providers: imageGenerationProviderDefinitions,
})

const modelSettings: ModelProviderSettings = {
  management_enabled: true,
  configured: false,
  revision: 0,
  providers: [],
  default_model: null,
  memory_extraction_model: null,
  title_model: null,
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderSettings(value = settings, readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ImageGenerationSettingsForm
        settings={value}
        modelSettings={{ ...modelSettings, management_enabled: !readOnly }}
      />
    </QueryClientProvider>
  )
}

function baseUrlControl() {
  return screen.getByRole("textbox", {
    name: formLabelPattern(i18n.t("admin.imageGeneration.baseUrl")),
  })
}

function saveControl() {
  return screen.getByRole("button", {
    name: i18n.t("admin.imageGeneration.save"),
  })
}

function installSaveMock(initial = settings) {
  let saved: ImageGenerationSettings = initial
  const requests: UpdateImageGenerationSettings[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const input = updateImageGenerationSettingsSchema.parse(
        JSON.parse(String(init?.body))
      )
      requests.push(input)
      const definition = initial.providers.find(
        ({ key }) => key === input.provider
      )
      saved = {
        ...saved,
        configured: true,
        revision: saved.revision + 1,
        enabled: input.enabled,
        provider: input.provider,
        provider_options: input.provider_options,
        base_url: input.base_url ?? definition?.base_url ?? null,
        api_key_configured: true,
        model: input.model,
        price_per_image: input.price_per_image,
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

describe("ImageGenerationSettingsForm", () => {
  it.each(supportedLanguages)(
    "fetches the image model list with the saved connection and saves a selected model in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (String(url).endsWith("/discover"))
            return Response.json({
              success: true,
              data: {
                status: "supported",
                truncated: false,
                models: [
                  {
                    id: "gpt-image-test",
                    display_name: "Image test model",
                    context_window: null,
                    supports_image_input: null,
                  },
                ],
              },
            })
          const input = updateImageGenerationSettingsSchema.parse(
            JSON.parse(String(init?.body))
          )
          return Response.json({
            success: true,
            data: {
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: { ...settings, revision: 3, model: input.model },
            },
          })
        })
      vi.stubGlobal("fetch", fetcher)
      renderSettings()
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
      )
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
      expect(
        JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
      ).toMatchObject({ provider: "openai", base_url: settings.base_url })
      expect(
        JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
      ).not.toHaveProperty("api_key")
      const model = screen.getByRole("combobox", {
        name: formLabelPattern(i18n.t("admin.imageGeneration.model")),
      })
      await user.clear(model)
      await user.type(model, "Image test")
      await user.click(
        await screen.findByRole("option", {
          name: "Image test model (gpt-image-test)",
        })
      )
      expect(model).toHaveValue("gpt-image-test")
      await user.click(saveControl())
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
      expect(
        JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
      ).toMatchObject({ model: "gpt-image-test" })
    }
  )

  it("requires a key for the new target before fetching its image models", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        success: true,
        data: { status: "supported", models: [], truncated: false },
      })
    )
    vi.stubGlobal("fetch", fetcher)
    renderSettings()
    const user = userEvent.setup()
    await user.clear(baseUrlControl())
    await user.type(baseUrlControl(), "https://new-images.example.test/v1")
    const discover = screen.getByRole("button", {
      name: i18n.t("modelSetup.discover"),
    })
    expect(discover).toBeDisabled()
    expect(
      screen.getByText(i18n.t("modelSetup.discoveryCredentialsChanged"))
    ).toBeVisible()
    await user.type(
      screen.getByLabelText(
        formLabelPattern(i18n.t("admin.imageGeneration.apiKey"))
      ),
      "new-image-key"
    )
    await user.click(
      screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      base_url: "https://new-images.example.test/v1",
      api_key: "new-image-key",
    })
  })

  it.each(["manual_required", "error"])(
    "keeps manual image model entry available when discovery returns %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockImplementation(async () =>
          status === "error"
            ? Response.json(
                {
                  success: false,
                  error_code: "MODEL_PROVIDER_DISCOVERY_FAILED",
                },
                { status: 502 }
              )
            : Response.json({
                success: true,
                data: { status, models: [], truncated: false },
              })
        )
      )
      renderSettings()
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
      )
      if (status === "error")
        expect(await screen.findByRole("alert")).toBeVisible()
      else
        expect(
          await screen.findByText(i18n.t("modelSetup.manualRequired"))
        ).toBeVisible()
      const model = screen.getByRole("combobox", {
        name: formLabelPattern(i18n.t("admin.imageGeneration.model")),
      })
      expect(model).toHaveValue(settings.model)
      await user.clear(model)
      await user.type(model, "custom-image-model")
      await user.tab()
      expect(model).toHaveValue("custom-image-model")
      expect(saveControl()).toBeEnabled()
    }
  )

  it("discards a late image catalog after connection settings change", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("discovery not started")
    }
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        if (body.base_url === settings.base_url) return pending
        return Response.json({
          success: true,
          data: {
            status: "supported",
            truncated: false,
            models: [
              {
                id: "fresh-image",
                display_name: "Fresh image",
                context_window: null,
                supports_image_input: null,
              },
            ],
          },
        })
      })
    vi.stubGlobal("fetch", fetcher)
    renderSettings()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
    )
    await user.clear(baseUrlControl())
    await user.type(baseUrlControl(), "https://new-images.example.test/v1")
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await user.type(
      screen.getByLabelText(
        formLabelPattern(i18n.t("admin.imageGeneration.apiKey"))
      ),
      "new-image-key"
    )
    await user.click(
      screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await act(async () => {
      finish(
        Response.json({
          success: true,
          data: {
            status: "supported",
            truncated: false,
            models: [
              {
                id: "old-image",
                display_name: "Old image",
                context_window: null,
                supports_image_input: null,
              },
            ],
          },
        })
      )
      await pending
    })
    const model = screen.getByRole("combobox", {
      name: formLabelPattern(i18n.t("admin.imageGeneration.model")),
    })
    await user.clear(model)
    await user.click(model)
    expect(
      await screen.findByRole("option", { name: "Fresh image (fresh-image)" })
    ).toBeVisible()
    expect(
      screen.queryByRole("option", { name: "Old image (old-image)" })
    ).not.toBeInTheDocument()
  })

  it.each(supportedLanguages)(
    "selects and saves an OpenAI-compatible image connection in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const requests = installSaveMock()
      renderSettings()
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("combobox", {
          name: formLabelPattern(i18n.t("admin.imageGeneration.provider")),
        })
      )
      await user.keyboard("{ArrowDown}")
      await user.click(
        await screen.findByRole("option", {
          name: i18n.t("admin.imageGeneration.providers.openai_compatible"),
        })
      )
      expect(baseUrlControl()).toBeEnabled()
      expect(baseUrlControl()).not.toHaveAttribute("readonly")
      await user.clear(baseUrlControl())
      await user.type(
        baseUrlControl(),
        "http://images.example.test:8080/custom/v1/"
      )
      const apiKey = screen.getByLabelText(
        formLabelPattern(i18n.t("admin.imageGeneration.apiKey"))
      )
      await user.type(apiKey, "synthetic-image-key")
      const model = screen.getByRole("combobox", {
        name: formLabelPattern(i18n.t("admin.imageGeneration.model")),
      })
      await user.clear(model)
      await user.type(model, "custom-image-model")
      await user.click(saveControl())
      await waitFor(() => expect(requests).toHaveLength(1))
      expect(requests[0]).toMatchObject({
        provider: "openai_compatible",
        base_url: "http://images.example.test:8080/custom/v1",
        api_key: "synthetic-image-key",
        model: "custom-image-model",
      })
      await waitFor(() =>
        expect(baseUrlControl()).toHaveValue(
          "http://images.example.test:8080/custom/v1"
        )
      )
      expect(apiKey).toHaveValue("")
    }
  )

  it.each(imageGenerationProviderDefinitions)(
    "allows editing the Base URL for $key",
    async (definition) => {
      renderSettings({
        ...settings,
        provider: definition.key,
        provider_options: {
          workspace_id: "workspace",
          region: definition.default_region,
        },
        base_url: definition.base_url
          .replace("{workspace_id}", "workspace")
          .replace("{region}", definition.default_region ?? ""),
        model: definition.default_model,
      })
      const user = userEvent.setup()
      expect(baseUrlControl()).toBeEnabled()
      expect(baseUrlControl()).not.toHaveAttribute("readonly")
      await user.clear(baseUrlControl())
      await user.type(baseUrlControl(), "https://images.example.test/custom")
      expect(baseUrlControl()).toHaveValue("https://images.example.test/custom")
      expect(saveControl()).toBeEnabled()
    }
  )

  it("saves a custom OpenAI address while retaining the configured API key", async () => {
    const requests = installSaveMock()
    renderSettings()
    const user = userEvent.setup()
    await user.clear(baseUrlControl())
    await user.type(baseUrlControl(), "https://images.example.test/v1")
    await user.click(saveControl())
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      provider: "openai",
      base_url: "https://images.example.test/v1",
    })
    expect(requests[0]).not.toHaveProperty("api_key")
  })

  it("reloads a saved custom address and resets it when switching providers", async () => {
    renderSettings({ ...settings, base_url: "https://images.example.test/v1" })
    expect(baseUrlControl()).toHaveValue("https://images.example.test/v1")
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("combobox", {
        name: formLabelPattern(i18n.t("admin.imageGeneration.provider")),
      })
    )
    await user.keyboard("{ArrowDown}")
    await user.click(await screen.findByRole("option", { name: "Together AI" }))
    expect(baseUrlControl()).toHaveValue("https://api.together.ai/v1")
    expect(saveControl()).toBeDisabled()
    expect(
      screen.getByLabelText(
        formLabelPattern(i18n.t("admin.imageGeneration.apiKey"))
      )
    ).toHaveAttribute("required")
  })

  it("updates the Bailian default address with its workspace and preserves a custom address", async () => {
    const definition = imageGenerationProviderDefinitions[0]
    renderSettings({
      ...settings,
      provider: "alibaba_bailian",
      provider_options: { workspace_id: "workspace", region: "cn-beijing" },
      model: definition.default_model,
      base_url:
        "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    })
    const user = userEvent.setup()
    const workspace = screen.getByRole("textbox", {
      name: formLabelPattern(i18n.t("admin.imageGeneration.workspaceId")),
    })
    await user.clear(workspace)
    await user.type(workspace, "new-workspace")
    expect(baseUrlControl()).toHaveValue(
      "https://new-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    )
    await user.clear(baseUrlControl())
    await user.type(baseUrlControl(), "https://images.example.test/generation")
    await user.type(workspace, "-updated")
    expect(baseUrlControl()).toHaveValue(
      "https://images.example.test/generation"
    )
  })

  it.each([
    "",
    "file:///tmp/image",
    "https://user:password@images.example.test/v1",
    "https://images.example.test/v1?key=secret",
  ])(
    "prevents saving an enabled connection with an invalid Base URL: %s",
    async (baseUrl) => {
      renderSettings()
      const user = userEvent.setup()
      await user.clear(baseUrlControl())
      if (baseUrl) await user.type(baseUrlControl(), baseUrl)
      expect(saveControl()).toBeDisabled()
    }
  )

  it("preserves the model management read-only setting", () => {
    renderSettings(settings, true)
    expect(baseUrlControl()).toBeDisabled()
    expect(saveControl()).toBeDisabled()
  })

  it("keeps the edited address when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error_code: "CONFLICT",
              message_key: "errors.common.conflict",
            }),
            { status: 409, headers: { "content-type": "application/json" } }
          )
      )
    )
    renderSettings()
    const user = userEvent.setup()
    await user.clear(baseUrlControl())
    await user.type(baseUrlControl(), "https://images.example.test/v1")
    await user.click(saveControl())
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible())
    expect(baseUrlControl()).toHaveValue("https://images.example.test/v1")
    expect(saveControl()).toBeEnabled()
  })
})
