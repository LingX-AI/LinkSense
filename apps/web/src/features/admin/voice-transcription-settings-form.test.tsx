import {
  voiceTranscriptionProviderDefinitions,
  voiceTranscriptionSettingsSchema,
} from "@linksense/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelProviderSettings } from "@/api/contracts"
import { VoiceTranscriptionSettingsForm } from "@/features/admin/voice-transcription-settings-form"
import { formLabelPattern } from "@/features/admin/required-field-label.test-helper"
import i18n, { supportedLanguages } from "@/i18n"

const settings = voiceTranscriptionSettingsSchema.parse({
  configured: true,
  revision: 2,
  enabled: true,
  provider: "openai_compatible",
  provider_options: { api_version: null },
  base_url: "https://speech.example.test/v1",
  api_key_configured: true,
  model: "whisper-1",
  providers: voiceTranscriptionProviderDefinitions,
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

function renderSettings(value = settings) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <VoiceTranscriptionSettingsForm
        settings={voiceTranscriptionSettingsSchema.parse(value)}
        modelSettings={modelSettings}
      />
    </QueryClientProvider>
  )
}

describe("voice transcription model selection", () => {
  it.each(supportedLanguages)(
    "fetches and saves a selected model in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (String(url).endsWith("/discover")) {
            return Response.json({
              success: true,
              data: {
                status: "supported",
                truncated: false,
                models: [
                  {
                    id: "new-speech-model",
                    display_name: "Speech model",
                    context_window: null,
                    supports_image_input: null,
                  },
                ],
              },
            })
          }
          const body = JSON.parse(String(init?.body))
          return Response.json({
            success: true,
            data: {
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: { ...settings, revision: 3, model: body.model },
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
      ).toMatchObject({
        provider: "openai_compatible",
        base_url: settings.base_url,
      })
      expect(
        JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
      ).not.toHaveProperty("api_key")
      const model = screen.getByRole("combobox", {
        name: formLabelPattern(i18n.t("admin.voiceTranscription.model")),
      })
      await user.clear(model)
      await user.type(model, "Speech model")
      await user.click(
        await screen.findByRole("option", {
          name: "Speech model (new-speech-model)",
        })
      )
      expect(model).toHaveValue("new-speech-model")
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("admin.voiceTranscription.save"),
        })
      )
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
      expect(
        JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
      ).toMatchObject({ model: "new-speech-model" })
    }
  )

  it("requires a new key when the service address changes", async () => {
    renderSettings()
    const user = userEvent.setup()
    const baseUrl = screen.getByRole("textbox", {
      name: formLabelPattern(i18n.t("admin.voiceTranscription.baseUrl")),
    })
    await user.clear(baseUrl)
    await user.type(baseUrl, "https://new-speech.example.test/v1")
    expect(
      screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
    ).toBeDisabled()
    expect(
      screen.getByText(i18n.t("modelSetup.discoveryCredentialsChanged"))
    ).toBeVisible()
  })

  it.each([
    "https://SPEECH.example.test:443/v1/",
    "https://speech.example.test/v1/",
  ])(
    "reuses saved credentials for the equivalent address %s",
    async (baseUrl) => {
      renderSettings({ ...settings, base_url: baseUrl })
      const user = userEvent.setup()
      const input = screen.getByRole("textbox", {
        name: formLabelPattern(i18n.t("admin.voiceTranscription.baseUrl")),
      })
      await user.clear(input)
      await user.type(input, settings.base_url ?? "")

      expect(
        screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
      ).toBeEnabled()
      expect(
        screen.queryByText(i18n.t("modelSetup.discoveryCredentialsChanged"))
      ).not.toBeInTheDocument()
    }
  )

  it("keeps invalid addresses disabled without throwing", async () => {
    renderSettings()
    const user = userEvent.setup()
    const input = screen.getByRole("textbox", {
      name: formLabelPattern(i18n.t("admin.voiceTranscription.baseUrl")),
    })
    await user.clear(input)
    await user.type(input, "not a URL")

    expect(
      screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
    ).toBeDisabled()
  })

  it("discards a pending catalog when the connection changes", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("discovery not started")
    }
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => pending)
    vi.stubGlobal("fetch", fetcher)
    renderSettings()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", { name: i18n.t("modelSetup.discover") })
    )
    const baseUrl = screen.getByRole("textbox", {
      name: formLabelPattern(i18n.t("admin.voiceTranscription.baseUrl")),
    })
    await user.clear(baseUrl)
    await user.type(baseUrl, "https://other.example.test/v1")
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await act(async () => {
      finish(
        Response.json({
          success: true,
          data: {
            status: "supported",
            truncated: false,
            models: [
              {
                id: "old-speech",
                display_name: "Old speech",
                context_window: null,
                supports_image_input: null,
              },
            ],
          },
        })
      )
      await pending
    })
    expect(
      screen.queryByRole("option", { name: "Old speech (old-speech)" })
    ).not.toBeInTheDocument()
  })

  it.each(["manual_required", "error"])(
    "preserves manual model entry when discovery returns %s",
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
        name: formLabelPattern(i18n.t("admin.voiceTranscription.model")),
      })
      await user.clear(model)
      await user.type(model, "custom-speech-model")
      await user.tab()
      expect(model).toHaveValue("custom-speech-model")
    }
  )
})
