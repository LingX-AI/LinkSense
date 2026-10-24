import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { updateModelProviderSettingsSchema } from "@linksense/shared"
import type { ModelProviderSettings } from "@/api/contracts"
import i18n from "@/i18n"
import { ModelProviderSettingsForm } from "./model-provider-settings-form"
import { newModel } from "./model-settings-draft"

const configuredModel = {
  ...newModel(),
  id: "model-a",
  display_name: "Model A",
}
const settings: ModelProviderSettings = {
  configured: true,
  revision: 1,
  providers: [
    {
      id: "primary",
      name: "Primary",
      provider: "openai_compatible",
      provider_project: null,
      provider_location: null,
      base_url: "https://models.example.test/v1",
      protocol_mode: "chat_completions_bridge",
      api_key_configured: true,
      models: [configuredModel],
    },
  ],
  default_model: configuredModel.id,
  title_model: configuredModel.id,
  memory_extraction_model: configuredModel.id,
}
const foundModel = {
  id: "remote-model",
  display_name: "Remote model",
  context_window: null,
  supports_image_input: null,
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  })
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("channel test model persistence", () => {
  it.each([
    { mode: "manual", expected: "test" },
    { mode: "discovered", expected: foundModel.id },
    { mode: "cleared", expected: "" },
  ])(
    "remembers the $mode test model after reopening a legacy channel without changing its configured models",
    async ({ mode, expected }) => {
      let saved = settings
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init?: RequestInit) => {
          if (String(url).endsWith("/discover")) {
            return response({
              status: "supported",
              models: [foundModel],
              truncated: false,
            })
          }
          const input = updateModelProviderSettingsSchema.parse(
            JSON.parse(String(init?.body))
          )
          saved = {
            ...saved,
            revision: saved.revision + 1,
            default_model: input.default_model,
            title_model: input.title_model ?? null,
            memory_extraction_model: input.memory_extraction_model ?? null,
            providers: input.providers.map((provider) => ({
              ...provider,
              name: provider.name ?? null,
              protocol_mode: provider.protocol_mode ?? "native_responses",
              api_key_configured: true,
            })),
          }
          return response({ code: "SYSTEM_SETTINGS_UPDATED", settings: saved })
        })
      )
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ModelProviderSettingsForm settings={saved} />
        </QueryClientProvider>
      )
      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "Channel actions" }))
      await user.click(
        await screen.findByRole("menuitem", { name: "Edit channel" })
      )
      const model = screen.getByRole("combobox", { name: "Model ID to test" })
      expect(model).toHaveValue(configuredModel.id)
      await user.clear(model)
      if (mode === "discovered") {
        await user.click(model)
        await user.click(
          await screen.findByRole("option", {
            name: "Remote model (remote-model)",
          })
        )
      } else if (expected) {
        await user.type(model, expected)
      }
      await user.tab()
      await user.click(
        screen.getByRole("button", { name: "Save model channel Primary" })
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(saved.providers[0]?.models).toEqual([configuredModel])
      expect(saved.default_model).toBe(configuredModel.id)
      expect(saved.title_model).toBe(configuredModel.id)
      expect(saved.memory_extraction_model).toBe(configuredModel.id)
      await user.click(screen.getByRole("button", { name: "Channel actions" }))
      await user.click(
        await screen.findByRole("menuitem", { name: "Edit channel" })
      )
      expect(
        screen.getByRole("combobox", { name: "Model ID to test" })
      ).toHaveValue(expected)
    }
  )
})
