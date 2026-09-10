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
  it("waits for links to load before reporting how many plugins use a credential", async () => {
    let finishBindings!: () => void
    const waiting = new Promise<void>((resolve) => {
      finishBindings = resolve
    })
    installLinkedCredentialMock(waiting)
    renderPage()
    await screen.findByRole("heading", { name: "插件凭据" })
    expect(screen.queryByText("用于 0 个插件")).not.toBeInTheDocument()
    expect(screen.queryByText(/尚未用于任何插件/)).not.toBeInTheDocument()
    finishBindings()
    expect(await screen.findByText("用于 1 个插件")).toBeVisible()
  })

  it("groups two linked fields under one plugin and opens its preselected configuration", async () => {
    installLinkedCredentialMock()
    const interaction = userEvent.setup()
    renderPage()
    expect(await screen.findByText("用于 1 个插件")).toBeVisible()
    expect(await screen.findByText("凭据已配置")).toBeVisible()
    expect(screen.getByText("已关联 2 项信息")).toBeVisible()
    expect(
      screen.getAllByRole("heading", { name: "ManageBac Connector" })
    ).toHaveLength(1)
    expect(screen.queryByText("MANAGEBAC_CLIENT_ID")).not.toBeInTheDocument()
    expect(screen.queryByText("managebac")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "管理关联" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "ManageBac Connector 的关联操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "管理关联" })
    )
    const dialog = screen.getByRole("dialog", { name: "管理关联" })
    expect(within(dialog).getByLabelText("插件")).toHaveTextContent(
      "ManageBac Connector"
    )
    expect(within(dialog).getByText("已选择 2 / 2 项信息")).toBeVisible()
    await interaction.click(
      within(dialog).getByRole("button", { name: "选择或调整对应信息" })
    )
    expect(
      within(dialog).getAllByLabelText("使用此凭据中的")[1]
    ).toHaveTextContent("vault_secret")
  })

  it("keeps credential details in its menu and groups linked plugins inside the credential", async () => {
    installLinkedCredentialMock()
    const interaction = userEvent.setup()
    renderPage()
    await screen.findByText("凭据已配置")
    const credential = screen.getByRole("article", { name: "ManageBac 凭据" })
    expect(
      within(credential).getByRole("heading", {
        name: "ManageBac Connector",
        level: 3,
      })
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "凭据详情" })
    ).not.toBeInTheDocument()
    await interaction.click(
      within(credential).getByRole("button", { name: "操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "凭据详情" })
    )
    const dialog = screen.getByRole("dialog", { name: "凭据详情" })
    expect(within(dialog).getByText("managebac")).toBeVisible()
    expect(within(dialog).getByText("服务标识")).toBeVisible()
  })

  it("confirms and removes a whole plugin link with one request while keeping the credential", async () => {
    const requests = installLinkedCredentialMock()
    const interaction = userEvent.setup()
    renderPage()
    await screen.findByText("凭据已配置")
    expect(
      screen.queryByRole("button", { name: "解除关联" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "ManageBac Connector 的关联操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "解除关联" })
    )
    const dialog = screen.getByRole("dialog", { name: "解除插件关联？" })
    expect(within(dialog).getByText(/ManageBac Connector/)).toBeVisible()
    expect(
      requests.filter((request) => request.method === "DELETE")
    ).toHaveLength(0)
    await interaction.click(
      within(dialog).getByRole("button", { name: "解除关联" })
    )
    await screen.findByText("用于 0 个插件")
    const deletes = requests.filter((request) => request.method === "DELETE")
    expect(deletes).toHaveLength(1)
    expect(deletes[0]?.path).toBe("/api/v1/credentials/bindings")
    expect(deletes[0]?.query.get("credential_id")).toBe("credential-1")
    expect(deletes[0]?.query.get("capability_id")).toBe("plugin-1")
    expect(screen.getByText("ManageBac 凭据")).toBeVisible()
    expect(screen.getByText(/尚未用于任何插件/)).toBeVisible()
  })

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
        if (
          path === "/api/v1/credentials/plugin-configurations" &&
          method === "GET"
        )
          return envelope({ items: [] })
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
    expect(screen.getByLabelText("配置项名称")).toHaveValue("")
    await interaction.type(screen.getByLabelText("名称"), "测试")
    await interaction.type(screen.getByLabelText("服务标识"), "测试")
    await interaction.type(screen.getByLabelText("配置项名称"), "API_KEY")
    await interaction.type(screen.getByLabelText("授权信息"), "12345")

    expect(
      screen.getByText(
        "服务标识只能使用小写字母、数字、下划线或连字符，例如 openai_api。"
      )
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "确认新增" })).toBeDisabled()
    expect(hasCredentialPost(requests)).toBe(false)

    await interaction.clear(screen.getByLabelText("服务标识"))
    await interaction.type(screen.getByLabelText("服务标识"), "test_api")
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
        if (
          path === "/api/v1/credentials/plugin-configurations" &&
          method === "GET"
        )
          return envelope({ items: [] })
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
      await screen.findByText("留空保留原有信息；填写新值后会替换原有信息。")
    ).toBeVisible()
    const keyInputs = screen.getAllByLabelText("配置项名称")
    expect(keyInputs.map((input) => (input as HTMLInputElement).value)).toEqual(
      ["API_KEY", "API_SECRET"]
    )
    const valueInputs = screen.getAllByLabelText("授权信息")
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
        if (
          path === "/api/v1/credentials/plugin-configurations" &&
          method === "GET"
        )
          return envelope({ items: [] })
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
    const valueInputs = screen.getAllByLabelText("授权信息")
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
        if (
          path === "/api/v1/credentials/plugin-configurations" &&
          method === "GET"
        )
          return envelope({ items: [] })
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
    await interaction.click(screen.getByRole("button", { name: "关联插件" }))
    const bindingDialog = screen.getByRole("dialog", { name: "关联插件" })
    await interaction.click(within(bindingDialog).getByLabelText("插件"))
    await interaction.click(
      await screen.findByRole("option", { name: "ManageBac Connector" })
    )

    expect(screen.getByText("已选择 1 / 2 项信息")).toBeVisible()
    await interaction.click(
      screen.getByRole("button", { name: "选择或调整对应信息" })
    )
    expect(
      screen.getAllByText("MANAGEBAC_CLIENT_SECRET").length
    ).toBeGreaterThan(0)
    const credentialFieldSelectors =
      within(bindingDialog).getAllByLabelText("使用此凭据中的")
    expect(credentialFieldSelectors[0]).toHaveTextContent("MANAGEBAC_CLIENT_ID")
    expect(credentialFieldSelectors[1]).toHaveTextContent("尚未选择")

    await interaction.click(credentialFieldSelectors[1]!)
    await interaction.click(
      await screen.findByRole("option", { name: "vault_secret" })
    )
    await interaction.click(
      within(bindingDialog).getByRole("button", { name: "保存关联" })
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
      screen.queryByRole("heading", { name: "关联插件" })
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

function installLinkedCredentialMock(bindingsWait?: Promise<void>) {
  let linked = true
  const requests: Array<{
    path: string
    method: string
    query: URLSearchParams
  }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const path = url.pathname
      const method = init?.method ?? "GET"
      requests.push({ path, method, query: url.searchParams })
      if (path === "/api/v1/credentials")
        return envelope({
          items: [
            {
              id: "credential-1",
              name: "ManageBac 凭据",
              provider_type: "managebac",
              secret_keys: ["MANAGEBAC_CLIENT_ID", "vault_secret"],
              status: "active",
              last_used_at: null,
              created_at: "2026-09-10T00:00:00Z",
              updated_at: "2026-09-10T00:00:00Z",
            },
          ],
        })
      if (path === "/api/v1/credentials/bindings") {
        if (method === "GET") await bindingsWait
        if (method === "DELETE") {
          linked = false
          return new Response(null, { status: 204 })
        }
        return envelope({
          items: linked
            ? [
                createBinding(
                  "b1",
                  "MANAGEBAC_CLIENT_ID",
                  "MANAGEBAC_CLIENT_ID"
                ),
                createBinding("b2", "MANAGEBAC_CLIENT_SECRET", "vault_secret"),
              ]
            : [],
        })
      }
      if (path === "/api/v1/credentials/plugin-configurations")
        return envelope({
          items: linked
            ? [
                {
                  capability_id: "plugin-1",
                  available: true,
                  fields: [
                    { env_key: "MANAGEBAC_CLIENT_ID", status: "configured" },
                    {
                      env_key: "MANAGEBAC_CLIENT_SECRET",
                      status: "configured",
                    },
                  ],
                },
              ]
            : [],
        })
      if (path === "/api/v1/capabilities")
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
              marketplace_listing_id: null,
              marketplace_release_id: null,
              logo_url: null,
              is_owner: true,
              can_manage: true,
              can_govern: false,
              can_select: true,
              has_logo: false,
              preference_status: "enabled",
              manifest: {},
              risk_summary: {
                declared_environment_keys: [
                  "MANAGEBAC_CLIENT_ID",
                  "MANAGEBAC_CLIENT_SECRET",
                ],
              },
              created_at: null,
              updated_at: null,
            },
          ],
        })
      throw new Error(`Unexpected request: ${method} ${path}`)
    })
  )
  return requests
}
