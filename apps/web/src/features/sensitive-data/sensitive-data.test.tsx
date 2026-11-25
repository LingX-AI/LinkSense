import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH,
  supportedLocales,
  updateSensitiveDataSettingsSchema,
  type SensitiveDataSettings,
  type UpdateSensitiveDataSettings,
} from "@linksense/shared"

import i18n from "@/i18n"
import { sensitiveDataMessages } from "./messages"
import {
  AdminSensitiveDataPage,
  PersonalSensitiveDataPage,
} from "./settings-pages"
import { TaskLocalModel } from "./task-local-model"
import { useTaskLocalModelStatus } from "./use-task-local-model-status"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))

const ownerId = "10000000-0000-4000-8000-000000000001"
const conversationId = "10000000-0000-4000-8000-000000000002"
const turnId = "10000000-0000-4000-8000-000000000003"
const models = [
  { id: "local-a", name: "Local A" },
  { id: "local-b", name: "Local B" },
]
const disabledSettings: SensitiveDataSettings = {
  enabled: false,
  revision: 0,
  inspection: "turn_start",
  local_model_ids: [],
  default_model_id: null,
  decision_endpoint: null,
  decision_model_id: null,
  detection_prompt: null,
  decision_key_configured: false,
}
const enabledSettings: SensitiveDataSettings = {
  ...disabledSettings,
  enabled: true,
  revision: 1,
  local_model_ids: ["local-a"],
  default_model_id: "local-a",
  decision_endpoint: "http://decision.example.test/v1/systemone",
  decision_model_id: "classifier",
  detection_prompt: "Protect confidential purchase prices.",
  decision_key_configured: true,
}
const providers = {
  configured: true,
  revision: 1,
  default_model: "local-a",
  providers: [
    {
      id: "local-channel",
      provider: "openai_compatible",
      base_url: "http://local.example.test/v1",
      protocol_mode: "chat_completions_bridge",
      api_key_configured: true,
      models: models.map(({ id, name }) => ({
        id,
        display_name: name,
        kind: "chat",
        enabled: true,
        supported_reasoning_efforts: ["medium"],
        default_reasoning_effort: "medium",
      })),
    },
  ],
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("sensitive data settings and selection", () => {
  it("enables protection for multiple local models with the per-request inspection mode", async () => {
    const save = mockAdminSettings(disabledSettings)
    const user = userEvent.setup()
    renderWithClient(<AdminSensitiveDataPage />)
    const toggle = await screen.findByRole("switch", {
      name: i18n.t("sensitiveData.enabled"),
    })
    const saveName = i18n.t("common.save")
    expect(
      screen.queryByRole("button", { name: saveName })
    ).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByRole("button", { name: saveName })).toBeEnabled()
    await user.click(toggle)
    expect(
      screen.queryByRole("button", { name: saveName })
    ).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    await user.click(toggle)
    await user.click(screen.getByRole("checkbox", { name: "Local A" }))
    await user.click(screen.getByRole("checkbox", { name: "Local B" }))
    await user.click(screen.getByText(i18n.t("sensitiveData.everyRequest")))
    const endpoint = screen.getByLabelText("决策模型服务地址")
    expect(endpoint).toHaveAccessibleDescription("仅支持 System One 兼容接口。")
    expect(screen.getByLabelText("API_KEY")).toHaveAttribute("type", "password")
    await user.type(endpoint, "http://decision.example.test/v1/systemone")
    await user.type(screen.getByLabelText("决策模型ID"), "classifier")
    const prompt = screen.getByLabelText("自定义检测提示词")
    expect(prompt).toHaveAccessibleDescription(
      "补充组织内所有用户都需要保护的数据。此项可留空。"
    )
    expect(prompt).toHaveClass("field-sizing-fixed", "resize-y")
    expect(prompt).toHaveAttribute(
      "maxlength",
      String(MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH)
    )
    await user.type(prompt, "  Protect draft prices.{Enter}Include quotes.  ")
    await user.click(screen.getByRole("button", { name: saveName }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          inspection: "every_request",
          local_model_ids: ["local-a", "local-b"],
          default_model_id: "local-a",
          decision_model_id: "classifier",
          detection_prompt: "Protect draft prices.\nInclude quotes.",
        })
      )
    )
  })

  it("saves disabling protection without applying unsaved form edits", async () => {
    const save = mockAdminSettings(enabledSettings)
    const user = userEvent.setup()
    renderWithClient(<AdminSensitiveDataPage />)
    const toggleName = i18n.t("sensitiveData.enabled")
    const toggle = await screen.findByRole("switch", {
      name: toggleName,
      checked: true,
    })
    await user.click(screen.getByText(i18n.t("sensitiveData.everyRequest")))
    await user.clear(screen.getByLabelText("自定义检测提示词"))
    await user.click(toggle)
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({
        expected_revision: enabledSettings.revision,
        enabled: false,
        inspection: enabledSettings.inspection,
        local_model_ids: enabledSettings.local_model_ids,
        default_model_id: enabledSettings.default_model_id,
        decision_endpoint: enabledSettings.decision_endpoint,
        decision_model_id: enabledSettings.decision_model_id,
        detection_prompt: enabledSettings.detection_prompt,
      })
    )
    await waitFor(() => expect(toggle).not.toBeInTheDocument())
    expect(screen.getByRole("switch", { name: toggleName })).not.toBeChecked()
    expect(
      screen.queryByRole("button", { name: i18n.t("common.save") })
    ).not.toBeInTheDocument()
  })

  it("keeps protection enabled and displays the error when disabling fails", async () => {
    const save = mockAdminSettings(enabledSettings)
    save.mockReturnValueOnce(
      Response.json({ success: false, error_code: "CONFLICT" }, { status: 409 })
    )
    const user = userEvent.setup()
    renderWithClient(<AdminSensitiveDataPage />)
    const toggle = await screen.findByRole("switch", {
      name: i18n.t("sensitiveData.enabled"),
      checked: true,
    })
    await user.click(toggle)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.conflict")
    )
    expect(toggle).toBeChecked()
    expect(
      screen.getByRole("button", { name: i18n.t("common.save") })
    ).toBeEnabled()
  })

  it("chooses a permitted model for this task and remembers the choice", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? envelope({ status: "local", model: models[1], local_models: models })
        : envelope({
            status: "waiting",
            turn_id: turnId,
            local_models: models,
            default_model_id: "local-a",
          })
    )
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithClient(<TaskLocalModelHarness active />)
    const dialog = await screen.findByRole("dialog", {
      name: i18n.t("sensitiveData.dialogTitle"),
    })
    await user.click(within(dialog).getByRole("radio", { name: "Local B" }))
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: i18n.t("sensitiveData.remember"),
      })
    )
    await user.click(
      within(dialog).getByRole("button", {
        name: i18n.t("sensitiveData.choose"),
      })
    )
    await screen.findByText(
      i18n.t("sensitiveData.processingLocally", { model: "Local B" })
    )
    expect(
      JSON.parse(
        String(
          fetch.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body
        )
      )
    ).toEqual({ turn_id: turnId, model_id: "local-b", remember: true })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("refreshes the routing status when a turn finishes before the next poll", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(envelope({ status: "idle" }))
      .mockResolvedValueOnce(
        envelope({ status: "local", model: models[0], local_models: [models[0]] })
      )
    vi.stubGlobal("fetch", fetch)
    const { rerender } = renderWithClient(<TaskLocalModelHarness active />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    rerender(<TaskLocalModelHarness active={false} />)

    expect(await screen.findByRole("status")).toHaveTextContent(
      "敏感 · Local A"
    )
    expect(
      screen.queryByRole("button", { name: /切换本地模型/ })
    ).not.toBeInTheDocument()
  })

  it("lists only the local choices and displays the pending model until the active turn ends", async () => {
    const initial = { status: "local", model: models[0], local_models: models }
    let current: typeof initial & { next_model?: (typeof models)[number] } = initial
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        current = { ...initial, next_model: models[1] }
      }
      return envelope(current)
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    const { rerender } = renderWithClient(<TaskLocalModelHarness active />)
    const trigger = await screen.findByRole("button", {
      name: "切换本地模型，当前使用 Local A",
    })
    expect(trigger).toHaveTextContent("敏感 · Local A")
    await user.click(trigger)
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2)
    expect(
      within(menu).getByRole("menuitemradio", { name: "Local A", checked: true })
    ).toBeVisible()
    await user.click(within(menu).getByRole("menuitemradio", { name: "Local B" }))

    await waitFor(() => expect(trigger).toHaveAccessibleDescription("下一轮使用 Local B"))
    const [, request] = fetch.mock.calls.find(([, init]) => init?.method === "PATCH") ?? []
    expect(JSON.parse(String(request?.body))).toEqual({
      expected_model_id: "local-a",
      model_id: "local-b",
    })
    expect(trigger).toHaveTextContent("敏感 · Local A")

    current = { ...initial, model: models[1] }
    rerender(<TaskLocalModelHarness active={false} />)
    expect(
      await screen.findByRole("button", { name: "切换本地模型，当前使用 Local B" })
    ).toHaveTextContent("敏感 · Local B")
  })

  it("saves and clears a personal detection prompt alongside the local model preference", async () => {
    const payload = {
      enabled: true,
      local_models: models,
      system_default_model_id: "local-a",
      preference: { selection: "ask", default_model_id: "local-b" },
    }
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? envelope({ ...payload, preference: JSON.parse(String(init.body)) })
        : envelope(payload)
    )
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithClient(<PersonalSensitiveDataPage />)
    const useDefault = await screen.findByText(
      i18n.t("sensitiveData.useDefault")
    )
    await user.click(useDefault)
    const prompt = screen.getByLabelText("自定义检测提示词")
    expect(prompt).toHaveValue("")
    expect(prompt).toHaveAccessibleDescription(
      i18n.t("sensitiveData.personalPromptHelp")
    )
    expect(prompt).toHaveClass("field-sizing-fixed", "resize-y")
    await user.type(prompt, "  Protect internal project names.  ")
    const save = screen.getByRole("button", { name: i18n.t("common.save") })
    await user.click(save)
    await waitFor(() => expect(prompt).toHaveValue("Protect internal project names."))
    await user.clear(prompt)
    await user.click(save)
    await waitFor(() =>
      expect(
        fetch.mock.calls
          .filter(([, init]) => init?.method === "PUT")
          .map(([, init]) => JSON.parse(String(init?.body)))
      ).toEqual([
        {
          selection: "default",
          default_model_id: "local-b",
          detection_prompt: "Protect internal project names.",
        },
        {
          selection: "default",
          default_model_id: "local-b",
          detection_prompt: null,
        },
      ])
    )
  })

  it.each(supportedLocales)(
    "registers help and task strings in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const messages = sensitiveDataMessages[locale]
      for (const [key, value] of Object.entries(messages)) {
        expect(
          i18n.getResource(locale, "translation", `sensitiveData.${key}`)
        ).toBe(value)
        expect(value.trim()).not.toBe("")
      }
      expect(
        i18n.t("sensitiveData.processingLocally", { model: "Local A" })
      ).toContain("Local A")
      expect(
        i18n.t("sensitiveData.switchedToLocalModel", { model: "Local A" })
      ).toContain("Local A")
      for (const key of ["switchLocalModel", "nextTurnLocalModel"]) {
        expect(i18n.t(`sensitiveData.${key}`, { model: "Local A" })).toContain("Local A")
      }
    }
  )

  it("uses Simplified Chinese for detection prompt copy in an unsupported locale", async () => {
    await i18n.changeLanguage("nl-NL")
    expect(i18n.t("sensitiveData.detectionPrompt")).toBe("自定义检测提示词")
    expect(i18n.t("sensitiveData.personalPromptHelp")).toBe(
      sensitiveDataMessages["zh-CN"].personalPromptHelp
    )
  })
})

function envelope(data: unknown): Response {
  return Response.json({ success: true, data })
}

function TaskLocalModelHarness({ active }: { active: boolean }) {
  const status = useTaskLocalModelStatus(ownerId, conversationId, active)
  return (
    <TaskLocalModel
      ownerId={ownerId}
      conversationId={conversationId}
      status={status}
      active={active}
      showBadge
    />
  )
}

function mockAdminSettings(settings: SensitiveDataSettings) {
  const save = vi.fn((body: UpdateSensitiveDataSettings) => {
    const { expected_revision, decision_api_key, ...fields } = body
    return envelope({
      ...fields,
      revision: expected_revision + 1,
      decision_key_configured:
        Boolean(decision_api_key) || settings.decision_key_configured,
    })
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/admin/model-provider-settings")) {
        return envelope(providers)
      }
      if (init?.method === "PUT") {
        return save(
          updateSensitiveDataSettingsSchema.parse(JSON.parse(String(init.body)))
        )
      }
      return envelope(settings)
    })
  )
  return save
}

function renderWithClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(children, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    ),
  })
}
