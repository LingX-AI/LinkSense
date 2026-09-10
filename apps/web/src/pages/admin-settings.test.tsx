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
import { MemoryRouter } from "react-router-dom"
import {
  imageGenerationProviderDefinitions,
  voiceTranscriptionProviderDefinitions,
} from "@linksense/shared"

import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { AdminPages } from "@/pages/admin-pages"

const productSettings = {
  organization_display_name: "LinkSense",
  default_locale: "zh-CN",
  logo_url: null,
  logo_updated_at: null,
}

const authenticationSettings = {
  smtp: {
    mode: "inherit",
    status: "not_configured",
    source: "none",
    revision: 0,
    host: null,
    port: null,
    security: null,
    username: null,
    from: null,
    password_configured: false,
  },
  oidc: {
    mode: "managed",
    status: "configured",
    source: "system",
    revision: 3,
    issuer_url: "https://identity.example.com",
    client_id: "linksense-web",
    redirect_uri: "https://linksense.example.test/api/v1/auth/oidc/callback",
    client_secret_configured: true,
  },
  teams: {
    mode: "inherit",
    status: "configured",
    source: "environment",
    revision: 0,
    tenant_id: "00000000-0000-4000-8000-000000000111",
    client_id: "00000000-0000-4000-8000-000000000222",
  },
}

const executionConcurrencySettings = {
  max_concurrent_conversations: null,
  runner_app_server_process_limit: null,
  environment_defaults: {
    max_concurrent_conversations: 20,
    runner_app_server_process_limit: 20,
  },
  effective: {
    max_concurrent_conversations: 20,
    runner_app_server_process_limit: 20,
  },
}

function chatModel(
  id: string,
  displayName: string,
  supportedReasoningEfforts: string[] = ["medium"],
  defaultReasoningEffort = "medium",
  supportsImageInput = false
) {
  return {
    id,
    display_name: displayName,
    enabled: true,
    kind: "chat" as const,
    input_price_per_million: "0",
    cached_input_price_per_million: "0",
    output_price_per_million: "0",
    supports_image_input: supportsImageInput,
    context_window: null,
    supported_reasoning_efforts: supportedReasoningEfforts,
    default_reasoning_effort: defaultReasoningEffort,
  }
}

const embeddingModel = {
  id: "embedding-model",
  display_name: "Embedding Model",
  enabled: true,
  kind: "embedding" as const,
  input_price_per_million: "0.14",
}

const rerankerModel = {
  id: "reranker-model",
  display_name: "Ranker Model",
  enabled: true,
  kind: "reranker" as const,
  input_price_per_million: "0.28",
}

const modelProviderSettings = {
  configured: true,
  revision: 2,
  providers: [
    {
      id: "provider-a",
      name: "模型渠道 1",
      provider: "openai" as const,
      provider_project: null,
      provider_location: null,
      base_url: "https://models.example.test/v1",
      protocol_mode: "native_responses" as const,
      api_key_configured: true,
      models: [
        chatModel("model-a", "Model A", ["medium", "high"], "medium", true),
      ],
    },
  ],
  default_model: "model-a",
  title_model: "model-a",
}

const imageUnderstandingSettings = {
  configured: true,
  enabled: false,
  revision: 4,
  provider: "openai" as const,
  base_url: null,
  api_key_configured: true,
  model: "model-a",
  project: null,
  location: null,
  thinking_policy: "disabled_required" as const,
  thinking_strategy: "non_reasoning_model" as const,
}

const knowledgeModelSettings = {
  revision: 3,
  embedding: {
    configured: false,
    model: null,
    dimensions: 2560,
    maximum_input_tokens: 8192,
  },
  rerank: {
    enabled: false,
    model: "qwen3-rerank",
    maximum_input_tokens: 8192,
    timeout_ms: 60000,
  },
}

const imageGenerationSettings = {
  configured: true,
  revision: 5,
  enabled: true,
  provider: "alibaba_bailian" as const,
  provider_options: {
    workspace_id: "dashscope-workspace",
    region: "cn-beijing",
  },
  base_url:
    "https://dashscope-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  api_key_configured: true,
  model: "qwen-image-3.0",
  price_per_image: "0.12",
  currency: "CNY" as const,
  providers: imageGenerationProviderDefinitions,
}

const voiceTranscriptionSettings = {
  configured: true,
  revision: 3,
  enabled: true,
  provider: "openai" as const,
  provider_options: { api_version: null },
  base_url: "https://api.openai.com/v1",
  api_key_configured: true,
  model: "gpt-4o-mini-transcribe",
  providers: voiceTranscriptionProviderDefinitions,
}

const retrievalModelProviderSettings = {
  ...modelProviderSettings,
  providers: [
    {
      ...modelProviderSettings.providers[0],
      models: [
        ...modelProviderSettings.providers[0].models,
        embeddingModel,
        rerankerModel,
      ],
    },
  ],
}

const selectedKnowledgeModelSettings = {
  ...knowledgeModelSettings,
  embedding: {
    ...knowledgeModelSettings.embedding,
    configured: true,
    model: embeddingModel.id,
  },
  rerank: {
    ...knowledgeModelSettings.rerank,
    enabled: true,
    model: rerankerModel.id,
  },
}

function settingsPayload(path: string) {
  if (path.endsWith("/product-settings")) return productSettings
  if (path.endsWith("/execution-concurrency-settings")) {
    return executionConcurrencySettings
  }
  if (path.endsWith("/registration-settings")) {
    return { enabled: false }
  }
  if (path.endsWith("/maintenance-settings")) {
    return {
      enabled: false,
      active: false,
      reason: null,
      start_at: null,
      end_at: null,
    }
  }
  if (path.endsWith("/model-provider-settings")) {
    return modelProviderSettings
  }
  if (path.endsWith("/image-understanding-settings")) {
    return imageUnderstandingSettings
  }
  if (path.endsWith("/image-generation-settings")) {
    return imageGenerationSettings
  }
  if (path.endsWith("/voice-transcription-settings")) {
    return voiceTranscriptionSettings
  }
  if (path.endsWith("/knowledge-model-settings")) {
    return knowledgeModelSettings
  }
  return authenticationSettings
}

function renderSettings(
  page: "settings" | "models" = "settings",
  initialPath = "/"
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <QueryClientProvider client={queryClient}>
          <AdminPages page={page} />
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
  return { ...view, queryClient }
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

type RecordedRequest = { path: string; init?: RequestInit }

async function waitForModelProviderSettingsPut(requests: RecordedRequest[]) {
  await waitFor(() =>
    expect(
      requests.some(
        (request) =>
          request.path.endsWith("/model-provider-settings") &&
          request.init?.method === "PUT"
      )
    ).toBe(true)
  )
  const request = requests.find(
    (candidate) =>
      candidate.path.endsWith("/model-provider-settings") &&
      candidate.init?.method === "PUT"
  )
  if (!request) throw new Error("Expected model provider settings PUT request")
  return request
}

describe("administrator authentication settings", () => {
  beforeEach(async () => {
    setAccessToken("settings-access-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("opens maintenance configuration directly from the indicator destination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return envelope(settingsPayload(path))
      })
    )
    renderSettings("settings", "/admin/settings?section=maintenance")
    expect(
      await screen.findByRole("tab", { name: "系统维护" })
    ).toHaveAttribute("aria-selected", "true")
    expect(
      await screen.findByRole("heading", { name: "系统维护" })
    ).toBeVisible()
    expect(screen.getByRole("switch", { name: "开启计划维护" })).toBeVisible()
  })

  it("enables open registration from its dedicated settings tab", async () => {
    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, init })
        if (path.endsWith("/registration-settings") && init?.method === "PUT") {
          return envelope({
            code: "SYSTEM_SETTINGS_UPDATED",
            settings: { enabled: true },
          })
        }
        return envelope(settingsPayload(path))
      })
    )
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      await screen.findByRole("tab", { name: "开放注册" })
    )
    const toggle = screen.getByRole("switch", {
      name: "允许用户自行注册",
    })
    expect(
      screen.queryByText("允许访客通过邮箱激活链接自行创建普通用户账号。")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText("每位注册用户的总 Token 额度")
    ).not.toBeInTheDocument()
    expect(toggle).not.toBeChecked()
    await interaction.click(toggle)
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path.endsWith("/registration-settings") &&
            request.init?.method === "PUT"
        )
      ).toMatchObject({
        init: {
          body: JSON.stringify({
            enabled: true,
          }),
        },
      })
    )
    expect(await screen.findByText("开放注册设置已更新")).toBeVisible()
  })

  it("saves task concurrency overrides and leaves blank fields on deployment defaults", async () => {
    const requests: RecordedRequest[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, init })
        if (
          path.endsWith("/execution-concurrency-settings") &&
          init?.method === "PUT"
        ) {
          return envelope({
            code: "SYSTEM_SETTINGS_UPDATED",
            settings: {
              ...executionConcurrencySettings,
              max_concurrent_conversations: 8,
              effective: {
                max_concurrent_conversations: 8,
                runner_app_server_process_limit: 20,
              },
            },
          })
        }
        return envelope(settingsPayload(path))
      })
    )
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      await screen.findByRole("tab", { name: "任务并发" })
    )
    const globalLimit = screen.getByLabelText("系统同时运行任务数上限")
    const processLimit = screen.getByLabelText("单用户任务进程数上限")
    expect(globalLimit).toHaveValue(null)
    expect(processLimit).toHaveValue(null)
    expect(
      screen.getByText(
        "调低上限不会中断正在运行的任务；新任务会在当前用量低于新上限后恢复启动。"
      )
    ).toBeVisible()

    await interaction.type(globalLimit, "8")
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path.endsWith("/execution-concurrency-settings") &&
            request.init?.method === "PUT"
        )
      ).toMatchObject({
        init: {
          body: JSON.stringify({
            max_concurrent_conversations: 8,
            runner_app_server_process_limit: null,
          }),
        },
      })
    )
    expect(await screen.findByText("任务并发设置已更新")).toBeVisible()
  })

  it("switches between setting categories without ever filling stored secrets", async () => {
    const requests: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push(path)
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings()

    expect(await screen.findByRole("heading", { name: "管理" })).toBeVisible()
    const productTab = await screen.findByRole("tab", { name: "产品设置" })
    expect(productTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "产品设置",
      "认证邮件",
      "开放注册",
      "单点登录",
      "任务并发",
      "系统维护",
    ])
    expect(productTab.closest('[data-slot="tabs-list"]')).toHaveClass(
      "rounded-none",
      "bg-transparent"
    )
    expect(productTab).toHaveClass(
      "rounded-xl",
      "font-medium",
      "data-active:bg-muted"
    )
    expect(productTab).not.toHaveClass("rounded-2xl")
    expect(
      screen.getByRole("heading", { name: "可编辑产品设置" })
    ).toBeVisible()
    expect(screen.getByLabelText("系统 Logo")).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp,image/gif"
    )
    expect(screen.getByRole("button", { name: "上传 Logo" })).toBeVisible()
    expect(
      screen.getByText("用于登录页、侧边栏和系统维护页的品牌标识。")
    ).toBeVisible()
    expect(screen.queryByLabelText("系统默认语言")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("tab", { name: "模型设置" })
    ).not.toBeInTheDocument()
    expect(requests).not.toContain("/api/v1/admin/model-provider-settings")

    await interaction.click(screen.getByRole("tab", { name: "认证邮件" }))
    expect(screen.getByRole("heading", { name: "认证邮件功能" })).toBeVisible()

    await interaction.click(screen.getByRole("tab", { name: "单点登录" }))
    const oidcHeading = screen.getByRole("heading", { name: "OIDC 登录" })
    const teamsHeading = screen.getByRole("heading", { name: "Teams 登录" })
    expect(oidcHeading).toBeVisible()
    expect(teamsHeading).toBeVisible()
    expect(
      oidcHeading.compareDocumentPosition(teamsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)
    expect(
      screen.queryByRole("tab", { name: "OIDC 登录" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("tab", { name: "Teams 登录" })
    ).not.toBeInTheDocument()
    const oidcTitleRow = oidcHeading.closest<HTMLElement>(
      '[data-slot="settings-section-title-row"]'
    )
    expect(oidcTitleRow).not.toBeNull()
    expect(within(oidcTitleRow!).getByText("已配置")).toBeVisible()
    expect(
      within(oidcTitleRow!)
        .getByText("已配置")
        .closest('[data-slot="settings-section-status"]')
    ).not.toBeNull()
    const oidcSection = oidcHeading.closest("section")
    expect(oidcSection).not.toBeNull()
    const oidcClientSecretInput = within(oidcSection!).getByLabelText(
      "Client secret"
    )
    expect(oidcClientSecretInput).toHaveValue("")
    expect(oidcClientSecretInput).toHaveAttribute("placeholder", "••••••••••••")
    expect(oidcClientSecretInput).toHaveAttribute("type", "password")
    expect(
      within(oidcSection!).queryByRole("button", { name: "显示密码" })
    ).not.toBeInTheDocument()
    expect(oidcSection).toHaveTextContent("已保存密钥；留空会保留当前值。")
    expect(oidcSection).not.toHaveTextContent("first-secret")

    await interaction.click(screen.getByRole("tab", { name: "系统维护" }))
    expect(
      await screen.findByRole("heading", { name: "系统维护" })
    ).toBeVisible()

    expect(
      screen.queryByRole("tab", { name: "健康状态" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "认证功能状态" })
    ).not.toBeInTheDocument()
    expect(screen.getAllByText("已配置").length).toBeGreaterThanOrEqual(2)
  })

  it("keeps a saved SMTP password empty and explains that blank preserves it", async () => {
    const configuredAuthenticationSettings = {
      ...authenticationSettings,
      smtp: {
        mode: "managed",
        status: "configured",
        source: "system",
        revision: 1,
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        username: "mailer@example.com",
        from: "LinkSense <no-reply@example.com>",
        password_configured: true,
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(
          envelope(
            path.endsWith("/authentication-settings")
              ? configuredAuthenticationSettings
              : settingsPayload(path)
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      await screen.findByRole("tab", { name: "认证邮件" })
    )
    const smtpSection = screen
      .getByRole("heading", { name: "认证邮件功能" })
      .closest("section")
    expect(smtpSection).not.toBeNull()
    const passwordInput = within(smtpSection!).getByLabelText("密码")
    expect(passwordInput).toHaveValue("")
    expect(passwordInput).toHaveAttribute("placeholder", "••••••••••••")
    expect(passwordInput).toHaveAttribute("type", "password")
    expect(smtpSection).toHaveTextContent("已保存密钥；留空会保留当前值。")
    expect(
      within(smtpSection!).queryByRole("button", { name: "显示密码" })
    ).not.toBeInTheDocument()

    await interaction.type(passwordInput, "replacement-secret")
    expect(passwordInput).toHaveValue("replacement-secret")
    expect(passwordInput).toHaveAttribute("type", "password")
  })

  it("updates the shared bootstrap cache immediately after saving the product name", async () => {
    let currentProductSettings: Record<string, unknown> = productSettings
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path.endsWith("/product-settings")) {
          if (init?.method === "PATCH") {
            currentProductSettings = {
              organization_display_name: "MOSS 工作台",
              default_locale: "zh-CN",
              logo_url: null,
              logo_updated_at: null,
            }
          }
          return Promise.resolve(envelope(currentProductSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    const { queryClient } = renderSettings()
    queryClient.setQueryData(["system", "bootstrap"], {
      initialized: true,
      system_name: "LinkSense",
      default_language: "zh-CN",
    })

    const nameInput = await screen.findByLabelText("系统显示名称")
    await interaction.clear(nameInput)
    await interaction.type(nameInput, "MOSS 工作台")
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    await screen.findByText("系统设置已更新")
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ system_name: string }>([
          "system",
          "bootstrap",
        ])?.system_name
      ).toBe("MOSS 工作台")
    )
  })

  it("uploads a custom system logo and updates the shared bootstrap cache", async () => {
    const logoUrl = "/api/v1/system/logo?v=2026-08-05T00%3A00%3A00.000Z"
    let uploadBodyWasFormData = false
    let currentProductSettings: Record<string, unknown> = productSettings
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (
          path.endsWith("/product-settings/logo") &&
          init?.method === "POST"
        ) {
          uploadBodyWasFormData = init.body instanceof FormData
          currentProductSettings = {
            ...productSettings,
            logo_url: logoUrl,
            logo_updated_at: "2026-08-05T00:00:00.000Z",
          }
          return Promise.resolve(envelope(currentProductSettings))
        }
        if (path.endsWith("/product-settings")) {
          return Promise.resolve(envelope(currentProductSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    const { queryClient } = renderSettings()
    queryClient.setQueryData(["system", "bootstrap"], {
      initialized: true,
      system_name: "LinkSense",
      default_language: "zh-CN",
      logo_url: null,
      logo_updated_at: null,
    })

    const logoInput = await screen.findByLabelText("系统 Logo")
    await interaction.upload(
      logoInput,
      new File(["logo"], "logo.png", { type: "image/png" })
    )

    await screen.findByText("系统 Logo 已更新")
    expect(uploadBodyWasFormData).toBe(true)
    expect(
      queryClient.getQueryData<{ logo_url: string | null }>([
        "system",
        "bootstrap",
      ])?.logo_url
    ).toBe(logoUrl)
    expect(
      document.querySelector<HTMLImageElement>(".product-settings-logo-preview")
    ).toHaveAttribute("src", logoUrl)
    expect(screen.getByRole("button", { name: "恢复默认 Logo" })).toBeVisible()
  })

  it("renders model settings with aligned fields and an isolated request", async () => {
    const requests: string[] = []
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push(path)
        return Promise.resolve(
          envelope(
            path.endsWith("/knowledge-model-settings")
              ? {
                  ...knowledgeModelSettings,
                  revision: imageUnderstandingSettings.revision,
                }
              : settingsPayload(path)
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    expect(
      await screen.findByRole("heading", { name: "模型设置" })
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "模型服务" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/配置多个模型渠道/u)).not.toBeInTheDocument()
    const modelChannelHeading = await screen.findByRole("heading", {
      level: 2,
      name: "模型渠道列表",
    })
    expect(modelChannelHeading).toBeVisible()
    expect(modelChannelHeading).toHaveClass(
      "text-sm",
      "leading-5",
      "font-semibold"
    )
    const catalog = screen.getByRole("table", { name: "模型列表" })
    expect(within(catalog).getByRole("row", { name: "Model A" })).toBeVisible()
    expect(within(catalog).queryByRole("textbox")).not.toBeInTheDocument()
    const connection = await openChannelEditor(interaction)
    const apiKeyInput = within(connection).getByLabelText("API_KEY")
    expect(apiKeyInput).toHaveValue("")
    expect(apiKeyInput).toHaveAttribute("placeholder", "••••••••••••")
    expect(apiKeyInput).toHaveAttribute("type", "password")
    expect(within(connection).getByLabelText("Base URL")).toHaveValue(
      "https://models.example.test/v1"
    )
    expect(
      within(connection).getByRole("combobox", { name: "协议兼容模式" })
    ).toHaveTextContent("原生 Responses")
    expect(
      within(connection)
        .getByRole("combobox", { name: "模型服务商" })
        .querySelector('[data-service-provider-logo="openai"]')
    ).toHaveClass("text-provider-openai")
    await closeModelEditor(interaction)
    const model = await openModelEditor(interaction, "Model A")
    expect(model).toHaveAttribute("data-slot", "dialog-content")
    expect(model).toHaveClass("top-1/2", "left-1/2", "sm:max-w-2xl")
    const modelIdField = within(model)
      .getByLabelText("模型 ID")
      .closest('[data-slot="field"]')
    expect(modelIdField?.parentElement).toHaveClass("grid", "sm:grid-cols-2")
    expect(
      within(model).getByLabelText("显示名称").closest('[data-slot="field"]')
        ?.parentElement
    ).toBe(modelIdField?.parentElement)
    expect(
      within(model).getByRole("switch", { name: "支持图片理解" })
    ).toBeVisible()
    await closeModelEditor(interaction)
    expect(
      within(
        screen.getByRole("form", { name: "对话与系统模型选择" })
      ).getByRole("button", { name: "保存任务与系统模型选择" })
    ).toBeVisible()
    expect(screen.getByRole("tab", { name: "模型渠道" })).toHaveAttribute(
      "data-active"
    )
    expect(
      screen
        .getByRole("tab", { name: "模型渠道" })
        .closest('[data-slot="tabs"]')
    ).toHaveClass("gap-4")
    const knowledgeTab = screen.getByRole("tab", { name: "知识检索模型" })
    const imageGenerationTab = screen.getByRole("tab", {
      name: "图片生成模型",
    })
    expect(
      screen.queryByRole("tab", { name: "用户初始 Token 用量" })
    ).not.toBeInTheDocument()
    expect(
      knowledgeTab.compareDocumentPosition(imageGenerationTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await interaction.click(knowledgeTab)
    expect(screen.getByRole("heading", { name: "文档图片理解" })).toBeVisible()
    const knowledgeHeadings = screen.getAllByRole("heading", {
      name: "知识库检索模型",
    })
    expect(knowledgeHeadings).toHaveLength(1)
    const knowledgeSection = knowledgeHeadings[0]?.closest("section")
    expect(knowledgeSection).not.toBeNull()
    expect(knowledgeHeadings[0]).toHaveClass(
      "text-sm",
      "leading-5",
      "font-semibold"
    )
    expect(screen.getByRole("group", { name: "Rank 模型" })).toBeVisible()
    const embeddingModelGroup = screen.getByRole("group", {
      name: "嵌入模型",
    })
    const rankModelGroup = screen.getByRole("group", { name: "Rank 模型" })
    const embeddingModelCard = embeddingModelGroup.closest(
      '[data-slot="model-settings-card"]'
    )
    const rankModelCard = rankModelGroup.closest(
      '[data-slot="model-settings-card"]'
    )
    expect(embeddingModelCard).not.toBeNull()
    expect(rankModelCard).not.toBeNull()
    expect(embeddingModelCard).toBe(rankModelCard)
    expect(embeddingModelGroup.closest("form")).toHaveClass("w-full")
    expect(embeddingModelGroup.closest("form")).not.toHaveClass("max-w-[720px]")
    expect(embeddingModelGroup.closest("form")).not.toHaveClass("max-w-none")
    expect(embeddingModelCard).toHaveClass(
      "grid",
      "grid-cols-1",
      "gap-4",
      "rounded-2xl",
      "border",
      "border-[color:var(--app-border)]",
      "bg-card",
      "p-4"
    )
    expect(embeddingModelCard).not.toHaveClass("xl:grid-cols-2")
    const modelSeparator = embeddingModelCard?.querySelector(
      '[data-slot="knowledge-model-settings-separator"]'
    )
    expect(modelSeparator).not.toBeNull()
    expect(embeddingModelGroup.nextElementSibling).toBe(modelSeparator)
    expect(modelSeparator?.nextElementSibling).toBe(rankModelGroup)
    expect(embeddingModelGroup).toHaveClass(
      "m-0",
      "flex",
      "gap-4",
      "border-0",
      "p-0"
    )
    expect(embeddingModelGroup).not.toHaveClass("p-4")
    expect(rankModelGroup).toHaveClass(
      "m-0",
      "flex",
      "gap-4",
      "border-0",
      "p-0"
    )
    for (const legend of [
      within(embeddingModelGroup).getByText("嵌入模型"),
      within(rankModelGroup).getByText("Rank 模型"),
    ]) {
      expect(legend).toHaveClass("p-0")
      expect(legend).not.toHaveClass("px-1")
    }
    expect(rankModelGroup).toHaveClass("flex", "gap-4")
    expect(screen.queryByLabelText("嵌入 API Key")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("重排 API Key")).not.toBeInTheDocument()
    expect(
      within(knowledgeSection!).queryByLabelText("API Key")
    ).not.toBeInTheDocument()
    expect(
      within(knowledgeSection!).queryByLabelText("Base URL")
    ).not.toBeInTheDocument()
    expect(screen.getByText(/还没有可供知识库使用的嵌入模型/u)).toBeVisible()
    expect(
      screen.getByText(/选择知识库处理文档和优化搜索结果时使用的模型/u)
    ).toHaveClass("form-hint")
    expect(screen.getByText(/用于理解文档内容和用户问题/u)).toHaveClass(
      "form-hint"
    )
    expect(screen.getByText(/用于把更相关的搜索结果排在前面/u)).toHaveClass(
      "form-hint"
    )
    expect(screen.getByText(/启用后，系统会理解文档中的图片/u)).toHaveClass(
      "form-hint"
    )
    expect(screen.getByText("当前模型已通过图片理解能力检查。")).toHaveClass(
      "form-hint"
    )
    expect(screen.getByRole("switch", { name: "解析时启用" })).not.toBeChecked()
    expect(
      screen.queryByText(/LinkSense 会强制关闭模型思考/u)
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "选择图片理解模型" })
    ).toHaveTextContent("Model A")
    expect(
      screen.queryByRole("heading", { name: "图片生成模型" })
    ).not.toBeInTheDocument()

    for (let index = 0; index < 3; index += 1) {
      await interaction.click(screen.getByRole("tab", { name: "模型渠道" }))
      expect(
        screen.queryByRole("heading", { name: "知识库检索模型" })
      ).not.toBeInTheDocument()
      await interaction.click(screen.getByRole("tab", { name: "知识检索模型" }))
      expect(
        screen.getAllByRole("heading", { name: "知识库检索模型" })
      ).toHaveLength(1)
    }

    expect(screen.queryByText("速度")).not.toBeInTheDocument()
    expect(requests).toEqual(
      expect.arrayContaining([
        "/api/v1/admin/model-provider-settings",
        "/api/v1/admin/knowledge-model-settings",
        "/api/v1/admin/image-generation-settings",
        "/api/v1/admin/voice-transcription-settings",
        "/api/v1/admin/image-understanding-settings",
      ])
    )
    expect(
      requests.filter((path) => path.endsWith("/model-provider-settings"))
    ).toHaveLength(8)
    expect(
      requests.filter((path) => path.endsWith("/knowledge-model-settings"))
    ).toHaveLength(5)
    expect(
      requests.filter((path) => path.endsWith("/image-understanding-settings"))
    ).toHaveLength(5)
    expect(
      requests.filter((path) => path.endsWith("/image-generation-settings"))
    ).toHaveLength(1)
    expect(
      requests.filter((path) => path.endsWith("/voice-transcription-settings"))
    ).toHaveLength(1)
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((argument) =>
          String(argument).includes("children with the same key")
        )
      )
    ).toBe(false)
  })

  it("refetches each model tab and remounts its form with the latest data", async () => {
    const requestCounts = new Map<string, number>()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        const requestCount = (requestCounts.get(path) ?? 0) + 1
        requestCounts.set(path, requestCount)

        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(
            envelope({
              ...retrievalModelProviderSettings,
              providers: retrievalModelProviderSettings.providers.map(
                (provider) => ({
                  ...provider,
                  base_url: `https://models.example.test/v${requestCount}`,
                })
              ),
            })
          )
        }
        if (path.endsWith("/knowledge-model-settings")) {
          return Promise.resolve(envelope(selectedKnowledgeModelSettings))
        }
        if (path.endsWith("/image-understanding-settings")) {
          return Promise.resolve(envelope(imageUnderstandingSettings))
        }
        if (path.endsWith("/image-generation-settings")) {
          return Promise.resolve(
            envelope({
              ...imageGenerationSettings,
              model: `image-model-${requestCount}`,
            })
          )
        }
        if (path.endsWith("/voice-transcription-settings")) {
          return Promise.resolve(envelope(voiceTranscriptionSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    await openChannelEditor(interaction)
    expect(
      await screen.findByDisplayValue("https://models.example.test/v1")
    ).toBeVisible()
    await waitFor(() => {
      expect(requestCounts.get("/api/v1/admin/knowledge-model-settings")).toBe(
        1
      )
      expect(
        requestCounts.get("/api/v1/admin/image-understanding-settings")
      ).toBe(1)
      expect(requestCounts.get("/api/v1/admin/image-generation-settings")).toBe(
        1
      )
      expect(
        requestCounts.get("/api/v1/admin/voice-transcription-settings")
      ).toBe(1)
    })

    await closeModelEditor(interaction)
    await interaction.click(screen.getByRole("tab", { name: "知识检索模型" }))
    await waitFor(() => {
      expect(requestCounts.get("/api/v1/admin/model-provider-settings")).toBe(2)
      expect(requestCounts.get("/api/v1/admin/knowledge-model-settings")).toBe(
        2
      )
      expect(
        requestCounts.get("/api/v1/admin/image-understanding-settings")
      ).toBe(2)
    })

    await interaction.click(screen.getByRole("tab", { name: "语音转文字模型" }))
    expect(
      await screen.findByDisplayValue("gpt-4o-mini-transcribe")
    ).toBeVisible()
    expect(requestCounts.get("/api/v1/admin/model-provider-settings")).toBe(3)
    expect(
      requestCounts.get("/api/v1/admin/voice-transcription-settings")
    ).toBe(2)

    await interaction.click(screen.getByRole("tab", { name: "图片生成模型" }))
    expect(await screen.findByDisplayValue("image-model-2")).toBeVisible()
    expect(requestCounts.get("/api/v1/admin/model-provider-settings")).toBe(4)

    await interaction.click(screen.getByRole("tab", { name: "模型渠道" }))
    await openChannelEditor(interaction)
    expect(
      await screen.findByDisplayValue("https://models.example.test/v5")
    ).toBeVisible()
  })

  it("renders deployment-locked model settings as fully read-only", async () => {
    const requests: Array<{ path: string; method: string }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, method: init?.method ?? "GET" })
        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(
            envelope({
              ...retrievalModelProviderSettings,
              management_enabled: false,
            })
          )
        }
        if (path.endsWith("/knowledge-model-settings")) {
          return Promise.resolve(envelope(selectedKnowledgeModelSettings))
        }
        if (path.endsWith("/image-understanding-settings")) {
          return Promise.resolve(envelope(imageUnderstandingSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    expect(
      await screen.findByText(
        "模型设置当前为只读。你可以查看现有内容，但不能新增、编辑、删除模型或调整“对话可选”状态。"
      )
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "添加模型渠道" })).toBeDisabled()
    for (const name of ["添加模型", "编辑模型 Model A", "渠道操作"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled()
    }
    expect(
      within(
        screen.getByRole("group", { name: "模型渠道 1" })
      ).queryByLabelText("Base URL")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("switch", { name: "对话可选：Model A" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("button", { name: "保存任务与系统模型选择" })
    ).toBeDisabled()

    await interaction.click(screen.getByRole("tab", { name: "知识检索模型" }))
    expect(
      screen.getByRole("combobox", { name: "选择 Embedding 模型" })
    ).toBeDisabled()
    expect(screen.getByRole("switch", { name: "检索时启用" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(
      screen.getByRole("button", { name: "保存知识库检索模型" })
    ).toBeDisabled()
    expect(screen.getByRole("switch", { name: "解析时启用" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(
      screen.getByRole("combobox", { name: "选择图片理解模型" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "保存图片理解设置" })
    ).toBeDisabled()
    expect(requests.every((request) => request.method === "GET")).toBe(true)
  })

  it("keeps hidden conversation models available to system model settings", async () => {
    const systemModelSettings = {
      ...retrievalModelProviderSettings,
      providers: [
        {
          ...retrievalModelProviderSettings.providers[0],
          models: [
            retrievalModelProviderSettings.providers[0].models[0],
            {
              ...chatModel("model-b", "Model B", ["medium"], "medium", true),
              enabled: false,
            },
            { ...embeddingModel, enabled: false },
            { ...rerankerModel, enabled: false },
          ],
        },
      ],
      default_model: "model-a",
      title_model: "model-b",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(envelope(systemModelSettings))
        }
        if (path.endsWith("/knowledge-model-settings")) {
          return Promise.resolve(envelope(selectedKnowledgeModelSettings))
        }
        if (path.endsWith("/image-understanding-settings")) {
          return Promise.resolve(
            envelope({ ...imageUnderstandingSettings, model: "model-b" })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    expect(
      await screen.findByRole("combobox", { name: "任务自动命名模型" })
    ).toHaveTextContent("Model B")
    expect(
      within(screen.getByRole("row", { name: "Model B" })).getByRole("switch", {
        name: /对话可选/u,
      })
    ).not.toBeChecked()
    expect(
      within(screen.getByRole("row", { name: "Embedding Model" })).queryByRole(
        "switch",
        { name: /对话可选/u }
      )
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("row", { name: "Ranker Model" })).queryByRole(
        "switch",
        { name: /对话可选/u }
      )
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("tab", { name: "知识检索模型" }))
    expect(
      screen.getByRole("combobox", { name: "选择 Embedding 模型" })
    ).toHaveTextContent("Embedding Model")
    expect(
      screen.getByRole("combobox", { name: "选择 Ranker 模型" })
    ).toHaveTextContent("Ranker Model")
    expect(
      screen.getByRole("combobox", { name: "选择图片理解模型" })
    ).toHaveTextContent("Model B")
  })

  it("renders the localized label for a model service provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(
          envelope(
            path.endsWith("/model-provider-settings")
              ? {
                  ...modelProviderSettings,
                  providers: [
                    {
                      ...modelProviderSettings.providers[0],
                      provider: "alibaba",
                    },
                  ],
                }
              : settingsPayload(path)
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    await openChannelEditor(interaction)
    const provider = await screen.findByRole("combobox", {
      name: "模型服务商",
    })
    expect(provider).toHaveTextContent("阿里云 / Qwen")
    expect(provider).not.toHaveTextContent(/^alibaba$/u)
    const alibabaLogo = provider.querySelector(
      '[data-service-provider-logo="alibaba"]'
    )
    expect(alibabaLogo).toBeInTheDocument()
    expect(alibabaLogo).toHaveClass("text-provider-alibaba")

    await interaction.click(provider)
    const serviceProviderOptions = await screen.findAllByRole("option")
    expect(serviceProviderOptions).toHaveLength(9)
    expect(
      serviceProviderOptions.map((option) =>
        option
          .querySelector("[data-service-provider-logo]")
          ?.getAttribute("data-service-provider-logo")
      )
    ).toEqual([
      "openai",
      "azure_openai",
      "anthropic",
      "google",
      "google_vertex",
      "alibaba",
      "deepseek",
      "openrouter",
      "openai_compatible",
    ])
    expect(
      serviceProviderOptions.map(
        (option) =>
          option.querySelector("[data-service-provider-logo]")?.classList[0]
      )
    ).toEqual([
      "text-provider-openai",
      "text-provider-azure-openai",
      "text-provider-anthropic",
      "text-provider-google-gemini",
      "text-provider-google-vertex",
      "text-provider-alibaba",
      "text-provider-deepseek",
      "text-provider-openrouter",
      "text-provider-vllm",
    ])
    await interaction.keyboard("{Escape}")

    await i18n.changeLanguage("en-US")
    await waitFor(() => expect(provider).toHaveTextContent("Alibaba / Qwen"))
  })

  it("shows models in a compact table in their saved order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(
          envelope(
            path.endsWith("/model-provider-settings")
              ? retrievalModelProviderSettings
              : settingsPayload(path)
          )
        )
      })
    )

    renderSettings("models")

    const catalog = await screen.findByRole("table", { name: "模型列表" })
    const rows = within(catalog).getAllByRole("row").slice(1)
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Model A",
      "Embedding Model",
      "Ranker Model",
    ])
    expect(
      rows.every((row) => row.parentElement === rows[0]?.parentElement)
    ).toBe(true)
    expect(within(catalog).getAllByRole("columnheader")).toHaveLength(6)
    for (const [model, price] of [
      ["Embedding Model", "0.14 / - / -"],
      ["Ranker Model", "0.28 / - / -"],
    ]) {
      const row = within(catalog).getByRole("row", { name: model })
      expect(within(row).getByRole("cell", { name: price })).toBeVisible()
      expect(within(row).getByRole("cell", { name: "-" })).toBeVisible()
    }
    expect(within(catalog).queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "添加模型" })).toBeVisible()
  })

  it("opens the shared centered dialog to add a model without changing the catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    await interaction.click(
      await screen.findByRole("button", { name: "添加模型" })
    )
    const dialog = await screen.findByRole("dialog", { name: "添加模型" })
    expect(dialog).toHaveAttribute("data-slot", "dialog-content")
    expect(within(dialog).getByLabelText("模型 ID")).toHaveValue("")
    expect(within(dialog).getByLabelText("显示名称")).toHaveValue("")
    expect(
      within(dialog).getByRole("button", { name: /保存模型/u })
    ).toBeDisabled()
    await closeModelEditor(interaction)
    expect(screen.getAllByRole("row")).toHaveLength(2)
  })

  it("saves knowledge retrieval selections without duplicating channel connection fields", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/knowledge-model-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...selectedKnowledgeModelSettings,
                revision: 4,
              },
            })
          )
        }
        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(envelope(retrievalModelProviderSettings))
        }
        if (path.endsWith("/knowledge-model-settings")) {
          return Promise.resolve(envelope(selectedKnowledgeModelSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")
    await interaction.click(
      await screen.findByRole("tab", { name: "知识检索模型" })
    )

    const knowledgeSection = (
      await screen.findByRole("heading", {
        name: "知识库检索模型",
      })
    ).closest("section")
    expect(knowledgeSection).not.toBeNull()
    expect(
      within(knowledgeSection!).getByRole("combobox", {
        name: "选择 Embedding 模型",
      })
    ).toHaveTextContent("Embedding Model")
    expect(
      within(knowledgeSection!).getByRole("combobox", {
        name: "选择 Ranker 模型",
      })
    ).toHaveTextContent("Ranker Model")
    expect(
      within(knowledgeSection!).queryByLabelText("输入单价")
    ).not.toBeInTheDocument()
    expect(
      within(knowledgeSection!).queryByLabelText("API Key")
    ).not.toBeInTheDocument()
    expect(
      within(knowledgeSection!).queryByLabelText("Base URL")
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "保存知识库检索模型" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith("/knowledge-model-settings") &&
            request.init?.method === "PUT"
        )
      ).toBe(true)
    )
    const update = requests.find(
      (request) =>
        request.path.endsWith("/knowledge-model-settings") &&
        request.init?.method === "PUT"
    )
    expect(JSON.parse(String(update?.init?.body))).toEqual({
      expected_revision: 3,
      embedding: { model: "embedding-model" },
      rerank: {
        enabled: true,
        model: "reranker-model",
      },
    })
    expect(await screen.findByText("知识库检索模型设置已更新")).toBeVisible()
  })

  it("requires explicit confirmation before switching embedding models and points to index rebuild", async () => {
    const nextEmbeddingModel = {
      ...embeddingModel,
      id: "embedding-model-v2",
      display_name: "Embedding Model V2",
    }
    const providerSettings = {
      ...retrievalModelProviderSettings,
      providers: retrievalModelProviderSettings.providers.map((provider) => ({
        ...provider,
        models: [...provider.models, nextEmbeddingModel],
      })),
    }
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/knowledge-model-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...selectedKnowledgeModelSettings,
                revision: 4,
                embedding: {
                  ...selectedKnowledgeModelSettings.embedding,
                  model: nextEmbeddingModel.id,
                },
              },
            })
          )
        }
        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(envelope(providerSettings))
        }
        if (path.endsWith("/knowledge-model-settings")) {
          return Promise.resolve(envelope(selectedKnowledgeModelSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")
    await interaction.click(
      await screen.findByRole("tab", { name: "知识检索模型" })
    )

    await interaction.click(
      screen.getByRole("combobox", { name: "选择 Embedding 模型" })
    )
    await interaction.click(
      await screen.findByRole("option", { name: "Embedding Model V2" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "保存知识库检索模型" })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "危险操作：确认修改嵌入模型？",
    })
    expect(dialog).toHaveTextContent("现有索引将全部失效")
    expect(dialog).toHaveTextContent("必须前往“系统健康”全量重建所有知识库索引")
    expect(dialog).toHaveTextContent("所有知识库检索都不可用")
    expect(dialog).toHaveTextContent("系统不会自动开始重建")
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "修改嵌入模型属于危险操作，不能只重建部分知识库"
    )
    expect(
      requests.some(
        (request) =>
          request.path.endsWith("/knowledge-model-settings") &&
          request.init?.method === "PUT"
      )
    ).toBe(false)

    await interaction.click(
      within(dialog).getByRole("button", { name: "确认修改并保存" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith("/knowledge-model-settings") &&
            request.init?.method === "PUT"
        )
      ).toBe(true)
    )
    const update = requests.find(
      (request) =>
        request.path.endsWith("/knowledge-model-settings") &&
        request.init?.method === "PUT"
    )
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      embedding: { model: "embedding-model-v2" },
    })
    const rebuildBannerTitle =
      await screen.findByText("嵌入模型已切换，知识库索引需要重建")
    expect(rebuildBannerTitle).toBeVisible()
    expect(screen.getByText(/模型设置已保存。请前往“系统健康”/u)).toBeVisible()
    expect(rebuildBannerTitle.closest('[role="status"]')).toHaveTextContent(
      "请前往“系统健康”重新生成全部知识库索引"
    )
    expect(screen.getByRole("link", { name: "前往系统健康" })).toHaveAttribute(
      "href",
      "/admin/health"
    )
  })

  it("can disable reranking while retaining the selected catalog model", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/knowledge-model-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...selectedKnowledgeModelSettings,
                revision: 4,
                rerank: {
                  ...selectedKnowledgeModelSettings.rerank,
                  enabled: false,
                },
              },
            })
          )
        }
        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(envelope(retrievalModelProviderSettings))
        }
        if (path.endsWith("/knowledge-model-settings")) {
          return Promise.resolve(envelope(selectedKnowledgeModelSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")
    await interaction.click(
      await screen.findByRole("tab", { name: "知识检索模型" })
    )

    const rankSection = await screen.findByRole("group", { name: "Rank 模型" })
    await interaction.click(
      within(rankSection).getByRole("switch", { name: "检索时启用" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "保存知识库检索模型" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith("/knowledge-model-settings") &&
            request.init?.method === "PUT"
        )
      ).toBe(true)
    )
    const update = requests.find(
      (request) =>
        request.path.endsWith("/knowledge-model-settings") &&
        request.init?.method === "PUT"
    )
    expect(JSON.parse(String(update?.init?.body))).toEqual({
      expected_revision: 3,
      embedding: { model: "embedding-model" },
      rerank: {
        enabled: false,
        model: "reranker-model",
      },
    })
  })

  it("enables image understanding and submits the pinned no-thinking model configuration", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/image-understanding-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...imageUnderstandingSettings,
                enabled: true,
                revision: 5,
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")
    await interaction.click(
      await screen.findByRole("tab", { name: "知识检索模型" })
    )

    await interaction.click(
      await screen.findByRole("switch", { name: "解析时启用" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "保存图片理解设置" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith("/image-understanding-settings") &&
            request.init?.method === "PUT"
        )
      ).toBe(true)
    )
    const update = requests.find(
      (request) =>
        request.path.endsWith("/image-understanding-settings") &&
        request.init?.method === "PUT"
    )
    expect(JSON.parse(String(update?.init?.body))).toEqual({
      expected_revision: 4,
      enabled: true,
      model: "model-a",
    })
  })

  it("saves the selected model protocol compatibility mode", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (init?.method === "PUT") {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...modelProviderSettings,
                revision: 3,
                providers: [
                  {
                    ...modelProviderSettings.providers[0],
                    protocol_mode: "chat_completions_bridge",
                  },
                ],
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )
    const interaction = userEvent.setup()
    renderSettings("models")

    await openChannelEditor(interaction)
    await interaction.click(
      await screen.findByRole("combobox", { name: "协议兼容模式" })
    )
    await interaction.click(
      await screen.findByRole("option", {
        name: "Chat Completions 转换",
      })
    )
    await interaction.click(
      within(screen.getByRole("dialog", { name: "编辑渠道" })).getByRole(
        "button",
        { name: "保存模型渠道 模型渠道 1" }
      )
    )
    const update = await waitForModelProviderSettingsPut(requests)
    const updateBody = JSON.parse(String(update?.init?.body))
    expect(updateBody).toMatchObject({
      expected_revision: 2,
      providers: [
        {
          id: "provider-a",
          base_url: "https://models.example.test/v1",
          protocol_mode: "chat_completions_bridge",
        },
      ],
      default_model: "model-a",
    })
    expect(updateBody.providers[0]).not.toHaveProperty("api_key")
    expect(await screen.findByText("模型渠道设置已更新")).toBeVisible()
  })

  it("saves the system default and task auto-naming models together", async () => {
    const settingsWithTwoModels = {
      ...modelProviderSettings,
      providers: [
        {
          ...modelProviderSettings.providers[0],
          models: [
            ...modelProviderSettings.providers[0].models,
            chatModel("model-b", "Model B"),
          ],
        },
      ],
    }
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          const body = JSON.parse(String(init.body)) as {
            default_model: string
            title_model: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...settingsWithTwoModels,
                revision: 3,
                default_model: body.default_model,
                title_model: body.title_model,
              },
            })
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/image-understanding-settings")
              ? imageUnderstandingSettings
              : settingsWithTwoModels
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const modelSelections = await screen.findByRole("form", {
      name: "对话与系统模型选择",
    })
    const defaultModelSelect = within(modelSelections).getByRole("combobox", {
      name: "对话默认模型",
    })
    await interaction.click(defaultModelSelect)
    await interaction.click(
      await screen.findByRole("option", { name: "Model B" })
    )
    const titleModelSelect = within(modelSelections).getByRole("combobox", {
      name: "任务自动命名模型",
    })
    await interaction.click(titleModelSelect)
    await interaction.click(
      await screen.findByRole("option", { name: "Model B" })
    )
    await interaction.click(
      within(modelSelections).getByRole("button", {
        name: "保存任务与系统模型选择",
      })
    )
    const update = await waitForModelProviderSettingsPut(requests)
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      expected_revision: 2,
      default_model: "model-b",
      title_model: "model-b",
    })
  })

  it("shows voice transcription before image generation and saves its service settings", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/voice-transcription-settings") &&
          init?.method === "PUT"
        ) {
          const body = JSON.parse(String(init.body)) as {
            enabled: boolean
            provider: "openai"
            provider_options: { api_version: null }
            base_url: string
            api_key?: string
            model: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...voiceTranscriptionSettings,
                revision: 4,
                enabled: body.enabled,
                provider: body.provider,
                provider_options: body.provider_options,
                base_url: body.base_url,
                api_key_configured:
                  voiceTranscriptionSettings.api_key_configured ||
                  Boolean(body.api_key),
                model: body.model,
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const knowledgeTab = await screen.findByRole("tab", {
      name: "知识检索模型",
    })
    const voiceTranscriptionTab = screen.getByRole("tab", {
      name: "语音转文字模型",
    })
    const imageGenerationTab = screen.getByRole("tab", {
      name: "图片生成模型",
    })
    expect(
      knowledgeTab.compareDocumentPosition(voiceTranscriptionTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      voiceTranscriptionTab.compareDocumentPosition(imageGenerationTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await interaction.click(voiceTranscriptionTab)
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "语音转文字模型",
    })
    const section = heading.closest("section")
    expect(section).not.toBeNull()
    expect(
      within(section!).getByRole("combobox", { name: "模型服务商" })
    ).toHaveTextContent("OpenAI")
    expect(within(section!).getByLabelText("Base URL")).toHaveValue(
      "https://api.openai.com/v1"
    )
    expect(within(section!).getByLabelText("语音转文字模型名称")).toHaveValue(
      "gpt-4o-mini-transcribe"
    )

    await interaction.clear(
      within(section!).getByLabelText("语音转文字模型名称")
    )
    await interaction.type(
      within(section!).getByLabelText("语音转文字模型名称"),
      "gpt-4o-transcribe"
    )
    await interaction.click(
      within(section!).getByRole("button", {
        name: "保存语音转文字模型",
      })
    )

    const update = await waitFor(() => {
      const matched = requests.find(
        (request) =>
          request.path.endsWith("/voice-transcription-settings") &&
          request.init?.method === "PUT"
      )
      expect(matched).toBeDefined()
      return matched
    })
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      expected_revision: 3,
      enabled: true,
      provider: "openai",
      provider_options: { api_version: null },
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-transcribe",
    })
    expect(JSON.parse(String(update?.init?.body))).not.toHaveProperty("api_key")
  })

  it("shows image generation settings in its own tab after knowledge retrieval models and saves them", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/image-generation-settings") &&
          init?.method === "PUT"
        ) {
          const body = JSON.parse(String(init.body)) as {
            enabled: boolean
            provider: "alibaba_bailian"
            provider_options: {
              workspace_id: string
              region: string
            }
            api_key?: string
            model: string
            price_per_image: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...imageGenerationSettings,
                revision: 6,
                enabled: body.enabled,
                provider: body.provider,
                provider_options: body.provider_options,
                api_key_configured:
                  imageGenerationSettings.api_key_configured ||
                  Boolean(body.api_key),
                model: body.model,
                price_per_image: body.price_per_image,
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const knowledgeTab = await screen.findByRole("tab", {
      name: "知识检索模型",
    })
    const imageGenerationTab = screen.getByRole("tab", {
      name: "图片生成模型",
    })
    expect(
      knowledgeTab.compareDocumentPosition(imageGenerationTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await interaction.click(imageGenerationTab)

    const imageGenerationHeading = await screen.findByRole("heading", {
      level: 2,
      name: "图片生成模型",
    })
    expect(imageGenerationHeading).toHaveClass(
      "text-sm",
      "leading-5",
      "font-semibold"
    )
    const imageGenerationSection = imageGenerationHeading.closest("section")
    expect(imageGenerationSection).not.toBeNull()
    for (const description of [
      within(imageGenerationSection!).getByText(
        /配置用户生成图片时使用的模型服务/u
      ),
      within(imageGenerationSection!).getByText(
        /选择你已开通并准备使用的图片生成服务/u
      ),
      within(imageGenerationSection!).getByText(
        /系统会根据所选服务商自动填写/u
      ),
      within(imageGenerationSection!).getByText(/用于统计图片生成费用/u),
    ]) {
      expect(description).toHaveClass("form-hint")
    }
    expect(
      screen.queryByRole("heading", { name: "知识库检索模型" })
    ).not.toBeInTheDocument()
    const imageGenerationProvider = within(imageGenerationSection!).getByRole(
      "combobox",
      {
        name: "模型服务商",
      }
    )
    expect(imageGenerationProvider).toHaveTextContent("阿里云百炼")
    expect(
      imageGenerationProvider.querySelector(
        '[data-image-generation-provider-logo="alibaba_bailian"]'
      )
    ).toBeInTheDocument()
    await interaction.click(imageGenerationProvider)
    const imageGenerationProviderOptions = await screen.findAllByRole("option")
    expect(
      imageGenerationProviderOptions.map((option) =>
        option
          .querySelector("[data-image-generation-provider-logo]")
          ?.getAttribute("data-image-generation-provider-logo")
      )
    ).toEqual([
      "alibaba_bailian",
      "openai",
      "google_gemini",
      "stability",
      "fal",
      "replicate",
      "together",
    ])
    await interaction.keyboard("{Escape}")
    expect(
      within(imageGenerationSection!).getByLabelText("Base URL")
    ).toHaveValue(imageGenerationSettings.base_url)
    expect(
      within(imageGenerationSection!).getByLabelText("百炼 Workspace ID")
    ).toHaveValue("dashscope-workspace")

    await interaction.clear(
      within(imageGenerationSection!).getByLabelText("单张图片价格")
    )
    await interaction.type(
      within(imageGenerationSection!).getByLabelText("单张图片价格"),
      "0.18"
    )
    await interaction.click(
      within(imageGenerationSection!).getByRole("button", {
        name: "保存图片生成模型",
      })
    )
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith("/image-generation-settings") &&
            request.init?.method === "PUT"
        )
      ).toBe(true)
    )
    const update = requests.find(
      (request) =>
        request.path.endsWith("/image-generation-settings") &&
        request.init?.method === "PUT"
    )
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      expected_revision: 5,
      enabled: true,
      provider: "alibaba_bailian",
      provider_options: {
        workspace_id: "dashscope-workspace",
        region: "cn-beijing",
      },
      model: "qwen-image-3.0",
      price_per_image: "0.18",
    })
    expect(JSON.parse(String(update?.init?.body))).not.toHaveProperty("api_key")
  })

  it("requires channel credentials for a disabled task auto-naming model", async () => {
    const settingsWithDisabledTitleModel = {
      ...modelProviderSettings,
      providers: [
        modelProviderSettings.providers[0],
        {
          ...modelProviderSettings.providers[0],
          id: "provider-title",
          name: "任务命名渠道",
          base_url: "https://titles.example.test/v1",
          api_key_configured: false,
          models: [
            {
              ...chatModel("model-title", "Title Model"),
              enabled: false,
            },
          ],
        },
      ],
      title_model: "model-title",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(
          envelope(
            path.endsWith("/model-provider-settings")
              ? settingsWithDisabledTitleModel
              : settingsPayload(path)
          )
        )
      })
    )

    renderSettings("models")

    const interaction = userEvent.setup()
    await selectChannel(interaction, "任务命名渠道")
    const titleProvider = await openChannelEditor(interaction)
    expect(within(titleProvider).getByLabelText("API_KEY")).toBeRequired()
    expect(
      within(titleProvider).getByRole("button", {
        name: "保存模型渠道 任务命名渠道",
      })
    ).toBeDisabled()
    expect(titleProvider).toHaveTextContent(
      "首次保存前请填写密钥；保存后将不再显示。"
    )
  })

  it("keeps model setting save failures inline without a success toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: false,
                error_code: "SYSTEM_SETTINGS_INVALID",
              }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              }
            )
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )
    const interaction = userEvent.setup()
    renderSettings("models")

    await openChannelEditor(interaction)
    await interaction.type(
      within(
        await screen.findByRole("dialog", { name: "编辑渠道" })
      ).getByLabelText("API_KEY"),
      "replacement-secret"
    )
    await interaction.click(
      within(screen.getByRole("dialog", { name: "编辑渠道" })).getByRole(
        "button",
        { name: "保存模型渠道 模型渠道 1" }
      )
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "系统设置无效或不允许在此修改。"
    )
    expect(document.querySelector("[data-sonner-toast]")).toBeNull()
  })

  it("renames a model channel and includes the normalized name in the next save", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...modelProviderSettings,
                revision: 3,
                providers: [
                  {
                    ...modelProviderSettings.providers[0],
                    name: "生产模型渠道",
                  },
                ],
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )
    const interaction = userEvent.setup()
    renderSettings("models")

    const dialog = await openChannelEditor(interaction)
    const nameInput = within(dialog).getByLabelText("渠道名称")
    await interaction.clear(nameInput)
    await interaction.type(nameInput, "  生产模型渠道  ")
    await interaction.click(
      within(dialog).getByRole("button", { name: /保存模型渠道/u })
    )
    expect(
      await screen.findByRole("group", { name: "生产模型渠道" })
    ).toBeVisible()
    const update = await waitForModelProviderSettingsPut(requests)
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      providers: [{ id: "provider-a", name: "生产模型渠道" }],
    })
  })

  it("adds a second model channel with its own Base URL, key, protocol mode, without requiring a model", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          const body = JSON.parse(String(init.body)) as {
            providers: Array<{
              api_key?: string
              id: string
              name: string
              base_url: string
              protocol_mode: "native_responses"
              models: (typeof modelProviderSettings.providers)[0]["models"]
            }>
            default_model: string
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                configured: true,
                revision: 3,
                providers: body.providers.map((provider) => ({
                  id: provider.id,
                  name: provider.name,
                  base_url: provider.base_url,
                  protocol_mode: provider.protocol_mode,
                  models: provider.models,
                  api_key_configured: true,
                })),
                default_model: body.default_model,
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )
    const interaction = userEvent.setup()
    renderSettings("models")
    await interaction.click(
      await screen.findByRole("button", { name: "添加模型渠道" })
    )
    const secondProvider = screen.getByRole("dialog", { name: "添加模型渠道" })
    await interaction.type(
      within(secondProvider).getByLabelText("渠道名称"),
      "模型渠道 2"
    )
    expect(
      within(secondProvider).queryByLabelText("模型 ID")
    ).not.toBeInTheDocument()
    expect(
      within(secondProvider).queryByText("添加第一个模型")
    ).not.toBeInTheDocument()
    await interaction.type(
      within(secondProvider).getByLabelText("Base URL"),
      "https://models-2.example.test/v1"
    )
    await interaction.type(
      within(secondProvider).getByLabelText("API_KEY"),
      "provider-2-secret"
    )
    await interaction.click(
      within(secondProvider).getByRole("combobox", {
        name: "协议兼容模式",
      })
    )
    await interaction.click(
      await screen.findByRole("option", {
        name: "Chat Completions 转换",
      })
    )
    await interaction.click(
      within(secondProvider).getByRole("button", {
        name: "保存模型渠道 模型渠道 2",
      })
    )
    const update = await waitForModelProviderSettingsPut(requests)
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      expected_revision: 2,
      providers: [
        {
          id: "provider-a",
          base_url: "https://models.example.test/v1",
          protocol_mode: "native_responses",
          models: [{ id: "model-a" }],
        },
        {
          id: expect.stringMatching(/^provider-/u),
          name: "模型渠道 2",
          base_url: "https://models-2.example.test/v1",
          protocol_mode: "chat_completions_bridge",
          api_key: "provider-2-secret",
          models: [],
        },
      ],
      default_model: "model-a",
    })
  })

  it("confirms before removing a model channel and falls back to an available default model", async () => {
    let currentSettings = {
      ...modelProviderSettings,
      providers: [
        modelProviderSettings.providers[0],
        {
          id: "provider-b",
          name: "备用模型渠道",
          provider: "openai_compatible" as const,
          provider_project: null,
          provider_location: null,
          base_url: "https://models-b.example.test/v1",
          protocol_mode: "responses_tool_compat" as const,
          api_key_configured: true,
          models: [chatModel("model-b", "Model B")],
        },
      ],
      default_model: "model-b",
    }
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings/providers") &&
          init?.method === "DELETE"
        ) {
          currentSettings = {
            ...currentSettings,
            revision: 3,
            providers: currentSettings.providers.filter(
              (provider) => provider.id !== "provider-b"
            ),
            default_model: "model-a",
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: currentSettings,
            })
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/image-understanding-settings")
              ? imageUnderstandingSettings
              : currentSettings
          )
        )
      })
    )
    const interaction = userEvent.setup()
    renderSettings("models")

    await selectChannel(interaction, "备用模型渠道")
    await deleteChannel(interaction, "备用模型渠道")
    let dialog = await screen.findByRole("dialog", {
      name: "删除模型渠道“备用模型渠道”？",
    })
    expect(dialog).toHaveTextContent(
      "确认后该模型渠道及其全部模型将立即删除；历史任务和用量记录不会受影响。"
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "取消" })
    )
    expect(
      await screen.findByRole("group", { name: "备用模型渠道" })
    ).toBeVisible()

    await deleteChannel(interaction, "备用模型渠道")
    dialog = await screen.findByRole("dialog", {
      name: "删除模型渠道“备用模型渠道”？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "备用模型渠道" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("combobox", { name: "对话默认模型" })
    ).toHaveTextContent("Model A")
    const deletion = requests.find(
      (request) =>
        request.path.endsWith("/model-provider-settings/providers") &&
        request.init?.method === "DELETE"
    )
    expect(deletion?.path).toBe(
      "/api/v1/admin/model-provider-settings/providers"
    )
    expect(JSON.parse(String(deletion?.init?.body))).toEqual({
      expected_revision: 2,
      provider_id: "provider-b",
    })
    expect(requests.some((request) => request.init?.method === "PUT")).toBe(
      false
    )
    expect(await screen.findByText("模型渠道已删除")).toBeVisible()
  })

  it("keeps a selected model channel and explains how to release it", async () => {
    const settings = {
      ...modelProviderSettings,
      providers: [
        modelProviderSettings.providers[0],
        {
          id: "provider-b",
          name: "备用模型渠道",
          provider: "openai_compatible" as const,
          provider_project: null,
          provider_location: null,
          base_url: "https://models-b.example.test/v1",
          protocol_mode: "responses_tool_compat" as const,
          api_key_configured: true,
          models: [chatModel("model-b", "Model B")],
        },
      ],
      default_model: "model-a",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (
          path.endsWith("/model-provider-settings/providers") &&
          init?.method === "DELETE"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: false,
                error_code: "MODEL_IN_USE_BY_SYSTEM_SETTING",
              }),
              {
                status: 409,
                headers: { "content-type": "application/json" },
              }
            )
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/image-understanding-settings")
              ? imageUnderstandingSettings
              : settings
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    await selectChannel(interaction, "备用模型渠道")
    const provider = screen.getByRole("group", { name: "备用模型渠道" })
    await deleteChannel(interaction, "备用模型渠道")
    const dialog = await screen.findByRole("dialog", {
      name: "删除模型渠道“备用模型渠道”？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    expect(
      await screen.findAllByText(
        "该模型正在被系统设置使用，请先切换或取消相关选择后再删除。"
      )
    ).not.toHaveLength(0)
    expect(dialog).toBeInTheDocument()
    expect(provider).toBeInTheDocument()
  })

  it("offers every reasoning effort and saves the configured subset", async () => {
    const gptSettings = {
      ...modelProviderSettings,
      providers: [
        {
          ...modelProviderSettings.providers[0],
          models: [
            chatModel(
              "gpt-5.6-sol",
              "GPT-5.6-Sol",
              ["low", "medium", "high", "xhigh", "max", "ultra"],
              "low"
            ),
          ],
        },
      ],
      default_model: "gpt-5.6-sol",
      title_model: "gpt-5.6-sol",
    }
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (init?.method === "PUT") {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...gptSettings,
                revision: 3,
                providers: [
                  {
                    ...gptSettings.providers[0],
                    models: [
                      {
                        ...gptSettings.providers[0].models[0],
                        default_reasoning_effort: "high",
                      },
                    ],
                  },
                ],
              },
            })
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/image-understanding-settings")
              ? imageUnderstandingSettings
              : gptSettings
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const model = await openModelEditor(interaction, "GPT-5.6-Sol")
    expect(within(model).queryByText(/可选档位由/u)).not.toBeInTheDocument()
    const supportedEfforts = within(model).getByRole("button", {
      name: "支持的推理强度",
    })
    expect(supportedEfforts).toHaveTextContent("已选择 6 项")
    await interaction.click(supportedEfforts)
    const ultra = await screen.findByRole("menuitemcheckbox", { name: "极致" })
    expect(ultra).toBeChecked()
    expect(ultra).not.toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "最小" })
    ).not.toBeInTheDocument()
    await interaction.click(ultra)
    expect(supportedEfforts).toHaveTextContent("已选择 5 项")
    await interaction.keyboard("{Escape}")
    expect(within(model).getByLabelText("模型 ID")).toHaveValue("gpt-5.6-sol")
    const defaultEffort = within(model).getByRole("combobox", {
      name: "默认推理强度",
    })
    expect(defaultEffort).toHaveTextContent("轻量")

    await interaction.click(defaultEffort)
    await interaction.click(await screen.findByRole("option", { name: "高" }))
    await interaction.click(
      within(model).getByRole("button", { name: "保存模型 GPT-5.6-Sol" })
    )
    const update = await waitForModelProviderSettingsPut(requests)
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      providers: [
        {
          models: [
            {
              id: "gpt-5.6-sol",
              supported_reasoning_efforts: [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              default_reasoning_effort: "high",
            },
          ],
        },
      ],
    })
  })

  it("updates the supported efforts and keeps at least one selected", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: {
                ...modelProviderSettings,
                revision: 3,
                providers: [
                  {
                    ...modelProviderSettings.providers[0],
                    models: [
                      {
                        ...modelProviderSettings.providers[0].models[0],
                        supported_reasoning_efforts: ["low", "high"],
                        default_reasoning_effort: "high",
                      },
                    ],
                  },
                ],
              },
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const model = await openModelEditor(interaction, "Model A")
    const supportedEfforts = within(model).getByRole("button", {
      name: "支持的推理强度",
    })
    expect(supportedEfforts).toHaveTextContent("已选择 2 项")
    await interaction.click(supportedEfforts)

    const medium = await screen.findByRole("menuitemcheckbox", { name: "中" })
    expect(medium).toBeChecked()
    expect(medium).not.toHaveAttribute("aria-disabled", "true")
    const high = screen.getByRole("menuitemcheckbox", { name: "高" })
    expect(high).toBeChecked()
    expect(high).not.toHaveAttribute("aria-disabled", "true")
    const low = screen.getByRole("menuitemcheckbox", { name: "轻量" })
    expect(low).not.toBeChecked()

    await interaction.click(medium)
    expect(supportedEfforts).toHaveTextContent("高")
    expect(high).toHaveAttribute("aria-disabled", "true")
    await interaction.click(low)
    expect(supportedEfforts).toHaveTextContent("已选择 2 项")

    await interaction.keyboard("{Escape}")
    const defaultEffort = within(model).getByRole("combobox", {
      name: "默认推理强度",
    })
    expect(defaultEffort).toHaveTextContent("高")

    await interaction.click(
      within(model).getByRole("button", { name: "保存模型 Model A" })
    )
    const update = await waitForModelProviderSettingsPut(requests)
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      providers: [
        {
          models: [
            {
              id: "model-a",
              supported_reasoning_efforts: ["low", "high"],
              default_reasoning_effort: "high",
            },
          ],
        },
      ],
    })
  })

  it("prevents duplicate saves and uses the returned revision in the next editor", async () => {
    const settings = {
      ...modelProviderSettings,
      providers: [
        {
          ...modelProviderSettings.providers[0],
          models: [
            modelProviderSettings.providers[0].models[0],
            chatModel("model-b", "Model B"),
          ],
        },
      ],
    }
    let resolveSave!: (response: Response) => void
    const pendingSave = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    const saveRequests: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          saveRequests.push(JSON.parse(String(init.body)))
          if (saveRequests.length === 1) return pendingSave
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: { ...settings, revision: 4 },
            })
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/model-provider-settings")
              ? settings
              : settingsPayload(path)
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const modelA = await openModelEditor(interaction, "Model A")
    const save = within(modelA).getByRole("button", {
      name: "保存模型 Model A",
    })
    await interaction.click(save)
    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"))
    expect(save).toBeDisabled()
    expect(within(modelA).getByRole("button", { name: "取消" })).toBeDisabled()
    expect(within(modelA).getByLabelText("显示名称")).toBeDisabled()
    await interaction.click(save)
    expect(saveRequests).toHaveLength(1)
    resolveSave(
      envelope({
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: { ...settings, revision: 3 },
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    const modelB = await openModelEditor(interaction, "Model B")
    await interaction.click(
      within(modelB).getByRole("button", { name: "保存模型 Model B" })
    )
    await waitFor(() => expect(saveRequests).toHaveLength(2))
    expect(saveRequests[1]).toMatchObject({ expected_revision: 3 })
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })

  it("updates model availability and deletes a persisted model immediately", async () => {
    let currentSettings = {
      ...modelProviderSettings,
      providers: [
        {
          ...modelProviderSettings.providers[0],
          models: [
            modelProviderSettings.providers[0].models[0],
            chatModel("model-b", "Model B"),
          ],
        },
      ],
      default_model: "model-b",
    }
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings/models/availability") &&
          init?.method === "PATCH"
        ) {
          currentSettings = {
            ...currentSettings,
            revision: 3,
            providers: [
              {
                ...currentSettings.providers[0],
                models: currentSettings.providers[0].models.map((model) =>
                  model.id === "model-a" ? { ...model, enabled: false } : model
                ),
              },
            ],
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: currentSettings,
            })
          )
        }
        if (
          path.endsWith("/model-provider-settings/models") &&
          init?.method === "DELETE"
        ) {
          currentSettings = {
            ...currentSettings,
            revision: 4,
            providers: [
              {
                ...currentSettings.providers[0],
                models: currentSettings.providers[0].models.filter(
                  (model) => model.id !== "model-a"
                ),
              },
            ],
            default_model: "model-b",
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: currentSettings,
            })
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/image-understanding-settings")
              ? imageUnderstandingSettings
              : currentSettings
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const model = await screen.findByRole("row", { name: "Model A" })
    const availability = within(model).getByRole("switch", {
      name: "对话可选：Model A",
    })
    expect(availability).toBeChecked()
    expect(
      within(model).queryByRole("checkbox", { name: "对话可选：Model A" })
    ).not.toBeInTheDocument()

    await interaction.click(availability)
    await waitFor(() => expect(availability).not.toBeChecked())
    const availabilityUpdate = requests.find(
      (request) => request.init?.method === "PATCH"
    )
    expect(availabilityUpdate?.path).toBe(
      "/api/v1/admin/model-provider-settings/models/availability"
    )
    expect(JSON.parse(String(availabilityUpdate?.init?.body))).toEqual({
      expected_revision: 2,
      model_id: "model-a",
      enabled: false,
    })
    expect(requests.some((request) => request.init?.method === "PUT")).toBe(
      false
    )

    await openModelEditor(interaction, "Model B")
    await interaction.type(screen.getByLabelText("显示名称"), "未保存")
    await interaction.click(screen.getByRole("button", { name: "取消" }))
    await interaction.click(screen.getByRole("button", { name: "放弃修改" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await deleteModel(interaction, "Model A")

    let dialog = await screen.findByRole("dialog", {
      name: "删除模型“Model A”？",
    })
    expect(model).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      "确认后模型将立即删除；历史任务和用量记录不会受影响。"
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "取消" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("row", { name: "Model A" })).toBeInTheDocument()

    await deleteModel(interaction, "Model A")
    dialog = await screen.findByRole("dialog", {
      name: "删除模型“Model A”？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("row", { name: "Model A" })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByRole("row", { name: "Model B" })).toBeInTheDocument()
    const deletion = requests.find(
      (request) => request.init?.method === "DELETE"
    )
    expect(deletion?.path).toBe("/api/v1/admin/model-provider-settings/models")
    expect(JSON.parse(String(deletion?.init?.body))).toEqual({
      expected_revision: 3,
      model_id: "model-a",
    })
    expect(requests.some((request) => request.init?.method === "PUT")).toBe(
      false
    )
    expect(await screen.findByText("模型已删除")).toBeVisible()
  })

  it("keeps a persisted model when its immediate deletion fails", async () => {
    const settings = {
      ...modelProviderSettings,
      providers: [
        {
          ...modelProviderSettings.providers[0],
          models: [
            modelProviderSettings.providers[0].models[0],
            chatModel("model-b", "Model B"),
          ],
        },
      ],
      default_model: "model-b",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (
          path.endsWith("/model-provider-settings/models") &&
          init?.method === "DELETE"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ success: false, error_code: "CONFLICT" }),
              {
                status: 409,
                headers: { "content-type": "application/json" },
              }
            )
          )
        }
        return Promise.resolve(
          envelope(
            path.endsWith("/image-understanding-settings")
              ? imageUnderstandingSettings
              : settings
          )
        )
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const model = await screen.findByRole("row", { name: "Model A" })
    await deleteModel(interaction, "Model A")
    const dialog = await screen.findByRole("dialog", {
      name: "删除模型“Model A”？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    expect(
      await screen.findAllByText("当前状态与此操作冲突，请刷新后重试。")
    ).not.toHaveLength(0)
    expect(dialog).toBeInTheDocument()
    expect(model).toBeInTheDocument()
  })

  it("rolls back a model availability switch when its immediate update fails", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings/models/availability") &&
          init?.method === "PATCH"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: false,
                error_code: "LAST_ENABLED_MODEL_REQUIRED",
              }),
              {
                status: 409,
                headers: { "content-type": "application/json" },
              }
            )
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const availability = await screen.findByRole("switch", {
      name: "对话可选：Model A",
    })
    expect(availability).toBeChecked()
    await interaction.click(availability)

    await waitFor(() => expect(availability).toBeChecked())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "至少需要保留一个“对话可选”的对话模型。"
    )
    expect(
      requests.filter((request) => request.init?.method === "PATCH")
    ).toHaveLength(1)
    expect(requests.some((request) => request.init?.method === "PUT")).toBe(
      false
    )
  })

  it("uses the revision returned by an availability update for the next full save", async () => {
    let currentSettings = {
      ...modelProviderSettings,
      providers: [
        {
          ...modelProviderSettings.providers[0],
          models: [
            modelProviderSettings.providers[0].models[0],
            chatModel("model-b", "Model B"),
          ],
        },
      ],
      title_model: "model-b",
    }
    const requests: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/model-provider-settings/models/availability") &&
          init?.method === "PATCH"
        ) {
          currentSettings = {
            ...currentSettings,
            revision: 3,
            providers: [
              {
                ...currentSettings.providers[0],
                models: currentSettings.providers[0].models.map((model) =>
                  model.id === "model-a" ? { ...model, enabled: false } : model
                ),
              },
            ],
            default_model: "model-b",
          }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: currentSettings,
            })
          )
        }
        if (
          path.endsWith("/model-provider-settings") &&
          init?.method === "PUT"
        ) {
          currentSettings = { ...currentSettings, revision: 4 }
          return Promise.resolve(
            envelope({
              code: "SYSTEM_SETTINGS_UPDATED",
              settings: currentSettings,
            })
          )
        }
        if (path.endsWith("/model-provider-settings")) {
          return Promise.resolve(envelope(currentSettings))
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings("models")

    const model = await screen.findByRole("row", { name: "Model A" })
    await interaction.click(
      within(model).getByRole("switch", { name: "对话可选：Model A" })
    )
    await waitFor(() =>
      expect(requests.some((request) => request.init?.method === "PATCH")).toBe(
        true
      )
    )
    const editor = await openModelEditor(interaction, "Model B")
    await interaction.type(within(editor).getByLabelText("显示名称"), " Stable")
    await interaction.click(
      within(editor).getByRole("button", { name: "保存模型 Model B Stable" })
    )
    await waitForModelProviderSettingsPut(requests)

    const saveRequest = requests.find(
      (request) => request.init?.method === "PUT"
    )
    expect(JSON.parse(String(saveRequest?.init?.body))).toMatchObject({
      expected_revision: 3,
      default_model: "model-b",
      providers: [
        {
          models: [
            { id: "model-a", enabled: false },
            { id: "model-b", enabled: true },
          ],
        },
      ],
    })
  })

  it("preserves unsaved provider fields while switching tabs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )

    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      await screen.findByRole("tab", { name: "认证邮件" })
    )
    const smtpSection = screen
      .getByRole("heading", { name: "认证邮件功能" })
      .closest("section")
    expect(smtpSection).not.toBeNull()
    await interaction.click(
      within(smtpSection!).getByRole("combobox", { name: "配置来源" })
    )
    await interaction.click(
      await screen.findByRole("option", { name: "由系统设置管理" })
    )
    await interaction.type(
      within(smtpSection!).getByLabelText("SMTP 主机"),
      "draft.smtp.example.com"
    )

    await interaction.click(screen.getByRole("tab", { name: "单点登录" }))
    await interaction.click(screen.getByRole("tab", { name: "认证邮件" }))

    expect(within(smtpSection!).getByLabelText("SMTP 主机")).toHaveValue(
      "draft.smtp.example.com"
    )
  })

  it("trims and clears an OIDC client secret replacement after saving", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    const updated = {
      ...authenticationSettings,
      oidc: { ...authenticationSettings.oidc, revision: 4 },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (
          path.endsWith("/authentication-settings/oidc") &&
          init?.method === "PUT"
        ) {
          return Promise.resolve(
            envelope({
              code: "AUTHENTICATION_SETTINGS_UPDATED",
              settings: updated,
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      await screen.findByRole("tab", { name: "单点登录" })
    )
    const oidcSection = screen
      .getByRole("heading", { name: "OIDC 登录" })
      .closest("section")
    expect(oidcSection).not.toBeNull()
    const secretInput = within(oidcSection!).getByLabelText("Client secret")
    await interaction.type(secretInput, "  replacement~secret+value=  ")
    await interaction.click(
      within(oidcSection!).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path.endsWith("/authentication-settings/oidc") &&
            request.init?.method === "PUT"
        )
      ).toBeDefined()
    )
    const request = requests.find(
      (item) =>
        item.path.endsWith("/authentication-settings/oidc") &&
        item.init?.method === "PUT"
    )
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      mode: "managed",
      expected_revision: 3,
      issuer_url: "https://identity.example.com",
      client_id: "linksense-web",
      client_secret: "replacement~secret+value=",
    })
    expect(secretInput).toHaveValue("")
    expect(secretInput).toHaveAttribute("placeholder", "••••••••••••")
    expect(await screen.findByText("认证配置已更新并立即生效")).toBeVisible()
  })

  it("saves only the SMTP namespace and applies the returned revision", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = []
    const updated = {
      ...authenticationSettings,
      smtp: {
        mode: "managed",
        status: "configured",
        source: "system",
        revision: 1,
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        username: "mailer@example.com",
        from: "LinkSense <no-reply@example.com>",
        password_configured: true,
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        requests.push({ path, ...(init ? { init } : {}) })
        if (init?.method === "PUT") {
          return Promise.resolve(
            envelope({
              code: "AUTHENTICATION_SETTINGS_UPDATED",
              settings: updated,
            })
          )
        }
        return Promise.resolve(envelope(settingsPayload(path)))
      })
    )
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      await screen.findByRole("tab", { name: "认证邮件" })
    )
    const smtpSection = screen
      .getByRole("heading", {
        name: "认证邮件功能",
      })
      .closest("section")
    expect(smtpSection).not.toBeNull()
    await interaction.click(
      within(smtpSection!).getByRole("combobox", { name: "配置来源" })
    )
    await interaction.click(
      await screen.findByRole("option", { name: "由系统设置管理" })
    )
    await interaction.type(
      within(smtpSection!).getByLabelText("SMTP 主机"),
      "smtp.example.com"
    )
    await interaction.type(
      within(smtpSection!).getByLabelText("发件人"),
      "LinkSense <no-reply@example.com>"
    )
    await interaction.type(
      within(smtpSection!).getByLabelText("用户名"),
      "mailer@example.com"
    )
    const passwordInput = within(smtpSection!).getByLabelText("密码")
    await interaction.type(passwordInput, "smtp-secret")
    await interaction.click(
      within(smtpSection!).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path.endsWith("/authentication-settings/smtp") &&
            request.init?.method === "PUT"
        )
      ).toBe(true)
    )
    const request = requests.find((item) =>
      item.path.endsWith("/authentication-settings/smtp")
    )
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      mode: "managed",
      expected_revision: 0,
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "mailer@example.com",
      password: "smtp-secret",
      from: "LinkSense <no-reply@example.com>",
    })
    expect(passwordInput).toHaveValue("")
    expect(passwordInput).toHaveAttribute("placeholder", "••••••••••••")
    expect(await screen.findByText("认证配置已更新并立即生效")).toBeVisible()
  })
})

async function openChannelEditor(
  interaction: ReturnType<typeof userEvent.setup>
) {
  await interaction.click(
    await screen.findByRole("button", { name: "渠道操作" })
  )
  await interaction.click(
    await screen.findByRole("menuitem", { name: "编辑渠道" })
  )
  return screen.findByRole("dialog", { name: "编辑渠道" })
}

async function openModelEditor(
  interaction: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await interaction.click(
    await screen.findByRole("button", { name: `编辑模型 ${name}` })
  )
  return screen.findByRole("dialog", { name: `编辑模型 ${name}` })
}

async function closeModelEditor(
  interaction: ReturnType<typeof userEvent.setup>
) {
  await interaction.click(screen.getByRole("button", { name: "取消" }))
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  )
}

async function selectChannel(
  interaction: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await interaction.click(
    await screen.findByRole("combobox", { name: "当前渠道" })
  )
  await interaction.click(await screen.findByRole("option", { name }))
}

async function deleteChannel(
  interaction: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await interaction.click(
    await screen.findByRole("button", { name: "渠道操作" })
  )
  await interaction.click(
    await screen.findByRole("menuitem", { name: "删除渠道" })
  )
  await screen.findByRole("dialog", { name: `删除模型渠道“${name}”？` })
}

async function deleteModel(
  interaction: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await interaction.click(
    await screen.findByRole("button", { name: `模型 ${name} 的操作` })
  )
  await interaction.click(
    await screen.findByRole("menuitem", { name: "删除模型" })
  )
}
