import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { createInstance } from "i18next"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationInstallationSetupSchema,
  applicationSchema,
  supportedLocales,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationSetupDialog } from "./application-setup-dialog"
import { applicationSetupMessages } from "./application-setup-messages"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

const APP = "10000000-0000-4000-8000-000000000001"
const VERSION = "10000000-0000-4000-8000-000000000002"
const KNOWLEDGE = "20000000-0000-4000-8000-000000000001"
const PERSONAL = "20000000-0000-4000-8000-000000000002"
const PLUGIN = "20000000-0000-4000-8000-000000000003"
const SETUP = `/applications/${APP}/installation/setup`
const guide = () =>
  applicationInstallationSetupSchema.parse({
    application_id: APP,
    installed_version_id: VERSION,
    installed_version_number: "1.0.0",
    updated_at: "2026-10-22T00:00:00.000Z",
    usage_instructions: "Use your own reporting account.",
    model: null,
    reasoning_effort: null,
    can_complete: false,
    can_use: false,
    items: [
      {
        id: KNOWLEDGE,
        type: "knowledge_base",
        position: 0,
        name: "Required handbook",
        description: null,
        resource_id: null,
        resource_name: null,
        status: "unconfigured",
      },
    ],
  })
const application = applicationSchema.parse({
  id: APP,
  owner: { id: APP, name: "Installer" },
  name: "Reports",
  icon: { type: "preset", preset: "bot" },
  description: null,
  instructions: "Reports",
  model: null,
  reasoning_effort: null,
  status: "active",
  is_owner: true,
  can_manage: true,
  access_source: "owner",
  capability_count: 0,
  knowledge_base_count: 1,
  mcp_server_count: 0,
  dependencies_available: true,
  capabilities: [],
  knowledge_bases: [],
  mcp_servers: [],
  created_at: "2026-10-22T00:00:00.000Z",
  updated_at: "2026-10-22T00:00:00.000Z",
})

function show() {
  const onClose = vi.fn(),
    onUse = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ApplicationSetupDialog
          application={application}
          onClose={onClose}
          onUse={onUse}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...view, client, onClose, onUse }
}
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  focusManager.setFocused(undefined)
})

describe("application setup guide", () => {
  it("explains missing package requirements and prevents completion before configuration", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue(guide())
    const { onClose } = show()
    expect(await screen.findByText("Required handbook")).toBeVisible()
    expect(screen.getByText("Use your own reporting account.")).toBeVisible()
    expect(
      screen.getByRole("button", { name: "保存并完成配置" })
    ).toBeDisabled()
    expect(
      screen.getByRole("link", { name: "创建或管理资源" })
    ).toHaveAttribute("href", "/knowledge-bases")
    await userEvent.click(screen.getByRole("button", { name: "稍后继续" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("saves each personal resource selection with the installed version and current revision", async () => {
    await i18n.changeLanguage("zh-CN")
    let current = guide()
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/applications/interactive-dependency-options")
        return {
          items: [{ id: PERSONAL, name: "My handbook" }],
          next_cursor: null,
        }
      if (path === SETUP && options?.method === "PATCH") {
        current = {
          ...current,
          updated_at: "2026-10-22T00:01:00.000Z",
          can_complete: true,
          items: [
            {
              ...current.items[0]!,
              resource_id: PERSONAL,
              resource_name: "My handbook",
              status: "configured",
            },
          ],
        }
      }
      return current
    })
    show()
    const picker = await screen.findByRole("combobox", {
      name: "为 Required handbook 选择你自己的资源",
    })
    await userEvent.click(picker)
    await userEvent.click(
      await screen.findByRole("option", { name: "My handbook" })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        SETUP,
        expect.objectContaining({
          method: "PATCH",
          body: {
            installed_version_id: VERSION,
            updated_at: "2026-10-22T00:00:00.000Z",
            type: "knowledge_base",
            position: 0,
            resource_id: PERSONAL,
          },
        })
      )
    )
    expect(await screen.findByText("当前使用：My handbook")).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "保存并完成配置" })
      ).toBeEnabled()
    )
    cleanup()
    show()
    expect(await screen.findByText("当前使用：My handbook")).toBeVisible()
  })

  it("rechecks credentials after returning from their configuration page", async () => {
    await i18n.changeLanguage("zh-CN")
    let current = guide()
    current.items = [
      {
        ...current.items[0]!,
        id: PLUGIN,
        type: "plugin",
        name: "Reports plugin",
        status: "credentials_required",
        resource_id: PERSONAL,
        resource_name: "Reports plugin",
      },
    ]
    vi.mocked(apiRequest).mockImplementation(async () => current)
    show()
    const link = await screen.findByRole("link", { name: "配置个人凭据" })
    expect(link).toHaveAttribute("href", "/settings/credentials")
    expect(link).toHaveAttribute("target", "_blank")
    act(() => focusManager.setFocused(false))
    current = {
      ...current,
      can_complete: true,
      items: [{ ...current.items[0]!, status: "configured" }],
    }
    act(() => focusManager.setFocused(true))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "保存并完成配置" })
      ).toBeEnabled()
    )
  })

  it("configures the model inside the guide while other capability steps are unfinished", async () => {
    await i18n.changeLanguage("zh-CN")
    let current = guide()
    current.items.push({
      id: APP,
      type: "model",
      position: 0,
      name: null,
      description: null,
      resource_id: null,
      resource_name: null,
      status: "configured",
    })
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/me/model-preference")
        return {
          configured: true,
          default_model: "report-model",
          selected_model: "report-model",
          selected_reasoning_effort: "medium",
          models: [
            {
              id: "report-model",
              display_name: "Report Model",
              enabled: true,
              supported_reasoning_efforts: ["medium", "high"],
              default_reasoning_effort: "medium",
            },
          ],
        }
      if (path === `${SETUP}/model` && options?.method === "PATCH")
        current = {
          ...current,
          model: "report-model",
          reasoning_effort: "medium",
          updated_at: "2026-10-22T00:01:00.000Z",
        }
      return current
    })
    show()
    const picker = await screen.findByRole("combobox", {
      name: i18n.t("applications.model"),
    })
    await waitFor(() => expect(picker).toBeEnabled())
    await userEvent.click(picker)
    await userEvent.click(
      await screen.findByRole("option", { name: "Report Model" })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `${SETUP}/model`,
        expect.objectContaining({
          method: "PATCH",
          body: {
            installed_version_id: VERSION,
            updated_at: "2026-10-22T00:00:00.000Z",
            model: "report-model",
            reasoning_effort: "medium",
          },
        })
      )
    )
    expect(
      await screen.findByRole("combobox", {
        name: i18n.t("applications.reasoningEffort"),
      })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "保存并完成配置" })
    ).toBeDisabled()
    expect(screen.getByText("待配置")).toBeVisible()
  })

  it("finishes setup once, refreshes readiness, and offers to start using the application", async () => {
    await i18n.changeLanguage("zh-CN")
    let current = { ...guide(), can_complete: true, items: [] }
    let finish: (value: typeof application) => void = () => {}
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === `${SETUP}/complete` && options?.method === "POST")
        return new Promise<typeof application>((resolve) => {
          finish = resolve
        })
      return current
    })
    const { onUse } = show()
    const button = await screen.findByRole("button", { name: "保存并完成配置" })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.filter(([path]) => path === `${SETUP}/complete`)
    ).toHaveLength(1)
    current = { ...current, can_use: true }
    await act(async () => finish(application))
    const use = await screen.findByRole("button", { name: "开始使用" })
    await waitFor(() => expect(use).toBeEnabled())
    await userEvent.click(use)
    expect(onUse).toHaveBeenCalledOnce()
  })

  it("shows request errors and retries without offering use from stale readiness", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Request failed"))
    vi.mocked(apiRequest).mockResolvedValue({
      ...guide(),
      can_complete: true,
      can_use: true,
      items: [],
    })
    show()
    await userEvent.click(await screen.findByRole("button", { name: "重试" }))
    expect(
      await screen.findByRole("button", { name: "开始使用" })
    ).toBeVisible()
  })

  it.each(supportedLocales)("renders the guide in %s", async (locale) => {
    await i18n.changeLanguage(locale)
    vi.mocked(apiRequest).mockResolvedValue(guide())
    show()
    expect(
      await screen.findByRole("dialog", {
        name: applicationSetupMessages[locale].title,
      })
    ).toBeVisible()
    expect(
      await screen.findByText(
        applicationSetupMessages[locale].statuses.unconfigured
      )
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: applicationSetupMessages[locale].complete,
      })
    ).toBeDisabled()
  })
})

describe("application setup translations", () => {
  function flatten(value: object, prefix = ""): Record<string, string> {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        typeof entry === "string"
          ? [[`${prefix}${key}`, entry]]
          : Object.entries(flatten(entry, `${prefix}${key}.`))
      )
    )
  }
  it.each(supportedLocales)(
    "keeps complete keys and interpolation parameters for %s",
    (locale) => {
      const source = flatten(applicationSetupMessages["zh-CN"])
      const translated = flatten(applicationSetupMessages[locale])
      expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort())
      for (const [key, value] of Object.entries(translated)) {
        expect(value.trim(), key).not.toBe("")
        expect(value.match(/\{\{\w+\}\}/g)?.sort() ?? [], key).toEqual(
          source[key]?.match(/\{\{\w+\}\}/g)?.sort() ?? []
        )
      }
    }
  )
  it("falls back to Simplified Chinese when a translation is missing", async () => {
    const instance = createInstance()
    await instance.init({
      lng: "en-US",
      fallbackLng: "zh-CN",
      resources: {
        "en-US": { translation: {} },
        "zh-CN": {
          translation: { applicationSetup: applicationSetupMessages["zh-CN"] },
        },
      },
    })
    expect(instance.t("applicationSetup.title")).toBe(
      applicationSetupMessages["zh-CN"].title
    )
  })
})
