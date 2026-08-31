import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import { CredentialManagementPage } from "@/pages/credential-pages"

beforeEach(async () => {
  setAccessToken("credential-page-access-token")
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  setAccessToken(null)
  cleanup()
  vi.unstubAllGlobals()
})

describe("CredentialManagementPage", () => {
  it("blocks invalid provider types before submitting a credential", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/credentials" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/credentials/bindings" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/capabilities" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/credentials" && method === "POST") {
          return envelope(
            {
              id: "credential-1",
              name: "测试",
              provider_type: "test_api",
              status: "active",
              created_at: "2026-07-19T00:00:00.000Z",
              updated_at: "2026-07-19T00:00:00.000Z",
              last_used_at: null,
            },
            201
          )
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", { name: "新增凭据" })
    )
    expect(screen.getByLabelText("环境变量名")).toHaveValue("")
    await interaction.type(screen.getByLabelText("名称"), "测试")
    await interaction.type(screen.getByLabelText("提供方类型"), "测试")
    await interaction.type(screen.getByLabelText("环境变量名"), "API_KEY")
    await interaction.type(screen.getByLabelText("环境变量值"), "12345")

    expect(
      screen.getByText(
        "提供方类型只能使用小写字母、数字、下划线或连字符，例如 openai_api。"
      )
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "确认新增" })).toBeDisabled()
    expect(hasCredentialPost(requests)).toBe(false)

    await interaction.clear(screen.getByLabelText("提供方类型"))
    await interaction.type(screen.getByLabelText("提供方类型"), "test_api")
    await interaction.click(screen.getByRole("button", { name: "确认新增" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/credentials" && request.method === "POST"
        )?.body
      ).toEqual({
        name: "测试",
        provider_type: "test_api",
        secret_payload: { API_KEY: "12345" },
      })
    )
  })

  it("keeps saved environment variable values hidden without replacing them on edit", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/credentials" && method === "GET") {
          return envelope({
            items: [
              {
                id: "credential-1",
                name: "测试",
                provider_type: "test",
                secret_keys: ["API_KEY", "API_SECRET"],
                status: "active",
                created_at: "2026-07-19T00:00:00.000Z",
                updated_at: "2026-07-19T00:00:00.000Z",
                last_used_at: null,
              },
            ],
            next_cursor: null,
          })
        }
        if (path === "/api/v1/credentials/bindings" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/capabilities" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/credentials/credential-1" && method === "PATCH") {
          return envelope({
            id: "credential-1",
            name: body.name,
            provider_type: body.provider_type,
            secret_keys: ["API_KEY", "API_SECRET"],
            status: "active",
            created_at: "2026-07-19T00:00:00.000Z",
            updated_at: "2026-07-19T00:00:00.000Z",
            last_used_at: null,
          })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await screen.findByText("测试")
    await interaction.click(screen.getByRole("button", { name: "操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑" })
    )

    expect(
      await screen.findByText(
        "留空保留该环境变量的现有密文；输入新值只会替换该环境变量。"
      )
    ).toBeVisible()
    const keyInputs = screen.getAllByLabelText("环境变量名")
    expect(keyInputs.map((input) => (input as HTMLInputElement).value)).toEqual(
      ["API_KEY", "API_SECRET"]
    )
    const valueInputs = screen.getAllByLabelText("环境变量值")
    expect(valueInputs).toHaveLength(2)
    for (const input of valueInputs) {
      expect(input).toHaveValue("")
      expect(input).toHaveAttribute("placeholder", "••••••••")
    }

    await interaction.click(screen.getByRole("button", { name: "确认更新" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/credentials/credential-1" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({
        name: "测试",
        provider_type: "test",
      })
    )
  })

  it("submits previous keys for unchanged saved environment variables", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/credentials" && method === "GET") {
          return envelope({
            items: [
              {
                id: "credential-1",
                name: "测试",
                provider_type: "test",
                secret_keys: ["API_KEY", "API_SECRET"],
                status: "active",
                created_at: "2026-07-19T00:00:00.000Z",
                updated_at: "2026-07-19T00:00:00.000Z",
                last_used_at: null,
              },
            ],
            next_cursor: null,
          })
        }
        if (path === "/api/v1/credentials/bindings" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/capabilities" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/credentials/credential-1" && method === "PATCH") {
          return envelope({
            id: "credential-1",
            name: body.name,
            provider_type: body.provider_type,
            secret_keys: ["API_KEY", "API_SECRET"],
            status: "active",
            created_at: "2026-07-19T00:00:00.000Z",
            updated_at: "2026-07-19T00:00:00.000Z",
            last_used_at: null,
          })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await screen.findByText("测试")
    await interaction.click(screen.getByRole("button", { name: "操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑" })
    )
    const valueInputs = screen.getAllByLabelText("环境变量值")
    await interaction.type(valueInputs[1]!, "rotated-secret")
    await interaction.click(screen.getByRole("button", { name: "确认更新" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/credentials/credential-1" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({
        name: "测试",
        provider_type: "test",
        secret_fields: [
          { key: "API_KEY", previous_key: "API_KEY" },
          { key: "API_SECRET", value: "rotated-secret" },
        ],
      })
    )
  })

  it("maps every declared plugin environment variable in one background request", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let resolveBindingRequest: ((response: Response) => void) | undefined
    const bindingResponse = new Promise<Response>((resolve) => {
      resolveBindingRequest = resolve
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/credentials" && method === "GET") {
          return envelope({
            items: [
              {
                id: "credential-1",
                name: "ManageBac 凭据",
                provider_type: "managebac",
                secret_keys: ["MANAGEBAC_CLIENT_ID", "vault_secret"],
                status: "active",
                created_at: "2026-08-17T00:00:00.000Z",
                updated_at: "2026-08-17T00:00:00.000Z",
                last_used_at: null,
              },
            ],
            next_cursor: null,
          })
        }
        if (path === "/api/v1/credentials/bindings" && method === "GET") {
          return envelope({ items: [], next_cursor: null })
        }
        if (path === "/api/v1/capabilities" && method === "GET") {
          return envelope({
            items: [
              {
                id: "plugin-1",
                name: "ManageBac Connector",
                slug: "managebac-connector",
                type: "plugin",
                description: null,
                status: "active",
                source_type: "local",
                builtin_key: null,
                is_builtin: false,
                marketplace_listing_id: null,
                marketplace_release_id: null,
                logo_url: null,
                is_owner: true,
                can_manage: true,
                can_govern: false,
                can_select: true,
                can_delete: true,
                has_logo: false,
                preference_status: "enabled",
                manifest: {},
                risk_summary: {
                  declared_environment_keys: [
                    "MANAGEBAC_CLIENT_ID",
                    "MANAGEBAC_CLIENT_SECRET",
                  ],
                  mcp_environment_references: [
                    {
                      mcp_server: "managebac",
                      env_key: "MANAGEBAC_CLIENT_ID",
                      source: "local",
                      usage: "stdio_env_var",
                      http_header: null,
                    },
                    {
                      mcp_server: "managebac",
                      env_key: "MANAGEBAC_CLIENT_SECRET",
                      source: "local",
                      usage: "stdio_env_var",
                      http_header: null,
                    },
                  ],
                },
                created_at: "2026-08-17T00:00:00.000Z",
                updated_at: "2026-08-17T00:00:00.000Z",
              },
            ],
            next_cursor: null,
          })
        }
        if (path === "/api/v1/credentials/bindings" && method === "PUT") {
          return bindingResponse
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await screen.findByText("ManageBac 凭据")
    await interaction.click(screen.getByRole("button", { name: "绑定到插件" }))
    const bindingDialog = screen.getByRole("dialog", { name: "绑定到插件" })
    await interaction.click(within(bindingDialog).getByLabelText("插件"))
    await interaction.click(
      await screen.findByRole("option", { name: "ManageBac Connector" })
    )

    expect(screen.getByText("MANAGEBAC_CLIENT_SECRET")).toBeVisible()
    const credentialFieldSelectors =
      within(bindingDialog).getAllByLabelText("凭据字段")
    expect(credentialFieldSelectors[0]).toHaveTextContent("MANAGEBAC_CLIENT_ID")
    expect(credentialFieldSelectors[1]).toHaveTextContent("不绑定")

    await interaction.click(credentialFieldSelectors[1]!)
    await interaction.click(
      await screen.findByRole("option", { name: "vault_secret" })
    )
    await interaction.click(
      within(bindingDialog).getByRole("button", { name: "确认绑定" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/credentials/bindings" &&
            request.method === "PUT"
        )?.body
      ).toEqual({
        credential_id: "credential-1",
        capability_id: "plugin-1",
        mappings: [
          {
            env_key: "MANAGEBAC_CLIENT_ID",
            credential_key: "MANAGEBAC_CLIENT_ID",
          },
          {
            env_key: "MANAGEBAC_CLIENT_SECRET",
            credential_key: "vault_secret",
          },
        ],
      })
    )
    expect(
      screen.queryByRole("heading", { name: "绑定到插件" })
    ).not.toBeInTheDocument()

    resolveBindingRequest?.(
      envelope({
        items: [
          createBinding(
            "binding-1",
            "MANAGEBAC_CLIENT_ID",
            "MANAGEBAC_CLIENT_ID"
          ),
          createBinding("binding-2", "MANAGEBAC_CLIENT_SECRET", "vault_secret"),
        ],
      })
    )
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CredentialManagementPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function hasCredentialPost(
  requests: Array<{ path: string; method: string; body?: unknown }>
) {
  return requests.some(
    (request) =>
      request.path === "/api/v1/credentials" && request.method === "POST"
  )
}

function createBinding(id: string, envKey: string, credentialKey: string) {
  return {
    id,
    capability_id: "plugin-1",
    credential_id: "credential-1",
    env_key: envKey,
    credential_key: credentialKey,
    status: "active",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
  }
}
