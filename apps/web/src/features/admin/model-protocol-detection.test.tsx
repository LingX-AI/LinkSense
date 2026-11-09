import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { detectModelProviderProtocolInputSchema } from "@linksense/shared"

import type { ModelProviderSettings } from "@/api/contracts"
import i18n, { supportedLanguages } from "@/i18n"
import { ChannelEditor } from "./model-channel-editors"
import { formLabelPattern } from "./required-field-label.test-helper"

const settings: ModelProviderSettings = {
  configured: false,
  revision: 0,
  providers: [],
  default_model: null,
  title_model: null,
  memory_extraction_model: null,
}
const detected = (
  protocol_mode = "responses_tool_compat",
  model_id = "chat-model"
) =>
  Response.json({
    success: true,
    data: {
      status: "detected",
      protocol_mode,
      model_id,
      probes: [
        { protocol_mode, status: "success", latency_ms: 1_600 },
        {
          protocol_mode:
            protocol_mode === "native_responses"
              ? "responses_tool_compat"
              : "native_responses",
          status: "failed",
          latency_ms: 2_000,
        },
      ],
    },
  })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(
  detect: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response> = async () => detected()
) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) =>
      String(input).endsWith("/detect-protocol")
        ? detect(input, init)
        : Response.json({
            success: true,
            data: { status: "supported", models: [], truncated: false },
          })
    )
  vi.stubGlobal("fetch", fetcher)
  const onSave = vi.fn()
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <ChannelEditor
        channel={null}
        settings={settings}
        pending={false}
        error={null}
        onSave={onSave}
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  )
  return { user: userEvent.setup(), fetcher, onSave }
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText(
      formLabelPattern(i18n.t("admin.modelProvider.providerName"))
    ),
    "New channel"
  )
  await user.type(
    screen.getByLabelText(
      formLabelPattern(i18n.t("admin.modelProvider.baseUrl"))
    ),
    "https://models.example.test"
  )
  await user.type(
    screen.getByLabelText(
      formLabelPattern(i18n.t("admin.modelProvider.apiKey"))
    ),
    "synthetic-test-key"
  )
  await user.tab()
}

describe("automatic channel protocol selection", () => {
  it("does not start another paid detection when only the trial model changes", async () => {
    await i18n.changeLanguage("en-US")
    const { user, fetcher } = setup(async (_input, init) => {
      const input = detectModelProviderProtocolInputSchema.parse(
        JSON.parse(String(init?.body))
      )
      return detected("chat_completions_bridge", input.model_id ?? "chat-model")
    })
    await fillCredentials(user)
    const model = screen.getByRole("combobox", { name: "Model ID to test" })
    await waitFor(() => expect(model).toHaveValue("chat-model"))
    await user.clear(model)
    await user.type(model, "custom-model")
    await user.tab()

    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/detect-protocol")
      )
    ).toHaveLength(1)
    expect(model).toHaveValue("custom-model")
  })

  it.each(supportedLanguages)(
    "detects after completing credentials and saves the resolved mode in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { user, fetcher, onSave } = setup()
      expect(
        screen.getByRole("button", {
          name: i18n.t("modelSetup.detectProtocol"),
        })
      ).toBeDisabled()

      await fillCredentials(user)

      await waitFor(() =>
        expect(
          screen.getByRole("combobox", {
            name: i18n.t("admin.modelProvider.protocolMode"),
          })
        ).toHaveTextContent(
          i18n.t("admin.modelProvider.protocolModes.responses_tool_compat")
        )
      )
      expect(
        screen.getByRole("combobox", { name: i18n.t("modelSetup.testModel") })
      ).toHaveValue("chat-model")
      expect(
        screen.getByText(
          i18n.t("modelSetup.protocolDetected", {
            protocol: i18n.t(
              "admin.modelProvider.protocolModes.responses_tool_compat"
            ),
            model: "chat-model",
          })
        )
      ).toBeVisible()
      const probeResults = screen.getByRole("list", {
        name: i18n.t("modelSetup.protocolProbeResults"),
      })
      expect(probeResults).toHaveTextContent(
        i18n.t("admin.modelProvider.protocolModes.responses_tool_compat")
      )
      expect(probeResults).toHaveTextContent(
        i18n.t("modelSetup.protocolProbeSuccess", {
          seconds: ["es-ES", "pt-BR", "fr-FR"].includes(locale) ? "1,6" : "1.6",
        })
      )
      expect(probeResults).toHaveTextContent(
        i18n.t("modelSetup.protocolProbeFailed")
      )
      expect(
        fetcher.mock.calls.filter(([url]) =>
          String(url).endsWith("/detect-protocol")
        )
      ).toHaveLength(1)
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("admin.modelProvider.saveProvider", {
            name: "New channel",
          }),
        })
      )
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: [
            expect.objectContaining({
              protocol_mode: "responses_tool_compat",
              test_model_id: "chat-model",
            }),
          ],
        })
      )
    }
  )

  it("keeps a manual selection when an older detection response arrives", async () => {
    await i18n.changeLanguage("en-US")
    let finish: (response: Response) => void = () => {
      throw new Error("detection not started")
    }
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const { user } = setup(async () => pending)
    await user.type(
      screen.getByRole("combobox", { name: "Model ID to test" }),
      "custom-model"
    )
    await fillCredentials(user)
    expect(
      screen.getByRole("button", { name: "Save model channel New channel" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Test model connection" })
    ).toBeDisabled()
    await user.click(
      screen.getByRole("combobox", { name: "Protocol compatibility mode" })
    )
    await user.click(
      await screen.findByRole("option", { name: "Native Responses" })
    )

    await act(async () => {
      finish(detected())
      await pending
    })

    expect(
      screen.getByRole("combobox", { name: "Protocol compatibility mode" })
    ).toHaveTextContent("Native Responses")
    expect(screen.queryByText(/Selected Responses/)).not.toBeInTheDocument()
  })

  it("aborts outdated credentials and ignores their late result", async () => {
    await i18n.changeLanguage("en-US")
    let finish: (response: Response) => void = () => {
      throw new Error("detection not started")
    }
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const { user, fetcher } = setup(async (_input, init) => {
      const input = detectModelProviderProtocolInputSchema.parse(
        JSON.parse(String(init?.body))
      )
      return input.base_url === "https://models.example.test"
        ? pending
        : detected("chat_completions_bridge", "new-model")
    })
    await fillCredentials(user)
    const url = screen.getByRole("textbox", {
      name: formLabelPattern("Base URL"),
    })
    await user.clear(url)
    await user.type(url, "https://new.example.test")
    await user.tab()
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Model ID to test" })
      ).toHaveValue("new-model")
    )
    expect(
      fetcher.mock.calls.find(([url]) =>
        String(url).endsWith("/detect-protocol")
      )?.[1]?.signal?.aborted
    ).toBe(true)

    await act(async () => {
      finish(detected())
      await pending
    })

    expect(
      screen.getByRole("combobox", { name: "Model ID to test" })
    ).toHaveValue("new-model")
    expect(
      screen.getByRole("combobox", { name: "Protocol compatibility mode" })
    ).toHaveTextContent("Chat Completions bridge")
  })

  it("allows a manual test model when the provider has no model list", async () => {
    await i18n.changeLanguage("en-US")
    const { user, fetcher } = setup(async (_input, init) => {
      const input = detectModelProviderProtocolInputSchema.parse(
        JSON.parse(String(init?.body))
      )
      return input.model_id
        ? detected("native_responses", input.model_id)
        : Response.json({ success: true, data: { status: "model_required" } })
    })
    await fillCredentials(user)
    expect(
      await screen.findByText(i18n.t("modelSetup.protocolModelRequired"))
    ).toBeVisible()
    await user.type(
      screen.getByRole("combobox", { name: "Model ID to test" }),
      "private-chat-model"
    )
    await user.click(screen.getByRole("button", { name: "Detect protocol" }))

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Protocol compatibility mode" })
      ).toHaveTextContent("Native Responses")
    )
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/detect-protocol")
      )
    ).toHaveLength(2)
  })
})
