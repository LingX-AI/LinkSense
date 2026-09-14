import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  mcpDefaultStartupTimeoutSeconds,
  mcpDefaultToolTimeoutSeconds,
} from "@linksense/shared"
import {
  cleanup,
  fireEvent,
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
import { McpManagementPage } from "@/pages/mcp-pages"

const SERVER_ID = "01900000-0000-7000-8000-000000000088"
const NOW = "2026-07-29T08:00:00.000Z"

beforeEach(async () => {
  setAccessToken("mcp-page-access-token")
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("McpManagementPage", () => {
  it.each([0, 1, 3])(
    "groups %i MCP servers in one rounded card with separators only between rows",
    async (count) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          envelope({
            items: Array.from({ length: count }, (_, index) =>
              serverFixture({
                id: `01900000-0000-7000-8000-00000000009${index}`,
                name: `Server ${index + 1}`,
              })
            ),
          })
        )
      )
      renderPage()

      if (count === 0) {
        await screen.findByText(i18n.t("mcp.empty"))
        expect(
          screen.queryByRole("region", { name: "MCP 服务器" })
        ).not.toBeInTheDocument()
        return
      }

      await screen.findByText("Server 1")
      const card = screen.getByRole("region", { name: "MCP 服务器" })
      expect(card).toHaveAttribute("data-slot", "card")
      expect(card).toHaveClass(
        "rounded-card",
        "border",
        "gap-0",
        "px-4",
        "py-0"
      )
      expect(within(card).getAllByRole("article")).toHaveLength(count)
      expect(card.querySelectorAll('[data-slot="separator"]')).toHaveLength(
        count - 1
      )
      expect(
        Array.from(card.children, (child) =>
          child.matches("article") ? "row" : child.getAttribute("data-slot")
        )
      ).toEqual(
        Array.from({ length: count * 2 - 1 }, (_, index) =>
          index % 2 === 0 ? "row" : "separator"
        )
      )
    }
  )

  it("shows personal MCP servers with management controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({
            items: [serverFixture()],
          })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    renderPage()

    const name = await screen.findByText("Issue tracker")
    const row = name.closest("article")
    if (!(row instanceof HTMLElement)) throw new Error("Expected MCP row")
    expect(row.parentElement).toHaveClass("mcp-server-list")
    expect(
      row.querySelector('img[data-default-capability-icon="mcp"]')
    ).toBeVisible()
    expect(within(row).getByRole("switch")).toBeChecked()
    expect(within(row).getByRole("button", { name: "更多操作" })).toBeVisible()
    expect(screen.queryByText("内置")).not.toBeInTheDocument()
  })

  it("requires HTTP risk acknowledgement before saving a Bearer server", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let servers: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({ items: servers })
        }
        if (path === "/api/v1/mcp-servers" && method === "POST") {
          servers = [serverFixture({ auth_type: "bearer" })]
          return envelope(servers[0], 201)
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      (await screen.findAllByRole("button", { name: "添加服务器" }))[0]!
    )
    expect(screen.queryByText("必须连接")).not.toBeInTheDocument()
    await interaction.type(screen.getByLabelText("名称"), "Issue tracker")
    await interaction.type(
      screen.getByLabelText("服务器地址"),
      "http://mcp.example.test:8080/mcp"
    )
    await interaction.click(screen.getByRole("combobox", { name: "认证方式" }))
    await interaction.click(
      await screen.findByRole("option", { name: "Bearer Token" })
    )
    await interaction.type(
      screen.getByLabelText("认证凭据"),
      "  bearer-page-secret  "
    )

    expect(screen.getByText("HTTP 连接不安全")).toBeVisible()
    expect(screen.getByText(/Bearer、API Key、工具参数和结果/)).toBeVisible()
    const save = screen.getByRole("button", { name: "保存" })
    expect(save).toBeDisabled()

    await interaction.click(
      screen.getByRole("checkbox", {
        name: "我理解并接受使用未加密 HTTP 的风险。",
      })
    )
    expect(save).toBeEnabled()
    await interaction.click(save)

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/mcp-servers" && request.method === "POST"
        )?.body
      ).toEqual({
        transport: "streamable_http",
        name: "Issue tracker",
        url: "http://mcp.example.test:8080/mcp",
        auth_type: "bearer",
        credential: "bearer-page-secret",
        startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
        tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
        insecure_http_acknowledged: true,
      })
    )
    expect(await screen.findByText("MCP 服务器已保存。")).toBeVisible()
  }, 10_000)

  it("tests an existing API Key server and never renders its stored secret", async () => {
    const requests: Array<{ path: string; method: string }> = []
    let resolveTestRequest: (response: Response) => void = () => undefined
    const testResponse = new Promise<Response>((resolve) => {
      resolveTestRequest = resolve
    })
    const server = serverFixture({
      auth_type: "api_key",
      api_key_header: "X-Issue-Key",
      has_credential: true,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        requests.push({ path, method })
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({ items: [server] })
        }
        if (
          path === `/api/v1/mcp-servers/${SERVER_ID}/test` &&
          method === "POST"
        ) {
          return testResponse
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByText("Issue tracker")).toBeVisible()
    expect(screen.getByText("API Key")).toBeVisible()
    expect(document.body).not.toHaveTextContent("stored-api-key-secret")
    await interaction.click(screen.getByRole("button", { name: "更多操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "测试连接" })
    )
    expect(await screen.findByLabelText("正在测试 Issue tracker")).toBeVisible()

    await waitFor(() =>
      expect(requests).toContainEqual({
        path: `/api/v1/mcp-servers/${SERVER_ID}/test`,
        method: "POST",
      })
    )
    resolveTestRequest(
      envelope({
        status: "succeeded",
        server_name: "issue-mcp",
        protocol_version: "2025-06-18",
        tool_count: 3,
        tested_at: NOW,
      })
    )
    expect(
      await screen.findByText("已连接 issue-mcp，发现 3 个工具。")
    ).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "更多操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑" })
    )
    expect(screen.getByLabelText("认证凭据")).toHaveValue("")
    expect(screen.getByText("留空以保留当前凭据。")).toBeVisible()
  })

  it("shows green, red, and neutral dots for MCP test status", async () => {
    const servers = [
      serverFixture({
        name: "可用服务器",
        last_test_status: "succeeded",
        last_tested_at: NOW,
      }),
      serverFixture({
        id: "01900000-0000-7000-8000-000000000089",
        name: "不可用服务器",
        last_test_status: "failed",
        last_test_error_code: "MCP_CONNECTION_FAILED",
        last_tested_at: NOW,
      }),
      serverFixture({
        id: "01900000-0000-7000-8000-000000000090",
        name: "未测试服务器",
      }),
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({ items: servers })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    renderPage()

    const succeeded = await screen.findByLabelText("可用服务器：测试通过")
    const failed = screen.getByLabelText("不可用服务器：测试失败")
    const untested = screen.getByLabelText("未测试服务器：尚未测试")

    expect(statusDot(succeeded)).toHaveClass("size-2.5", "bg-success/20")
    expect(statusCore(succeeded)).toHaveClass("size-1.5", "bg-success")
    expect(statusDot(failed)).toHaveClass("size-2.5", "bg-destructive/20")
    expect(statusCore(failed)).toHaveClass("size-1.5", "bg-destructive")
    expect(statusDot(untested)).toHaveClass(
      "size-2.5",
      "bg-muted-foreground/15"
    )
    expect(statusCore(untested)).toHaveClass(
      "size-1.5",
      "bg-muted-foreground/55"
    )
    expect(screen.queryByText("测试通过")).not.toBeInTheDocument()
    expect(screen.queryByText("测试失败")).not.toBeInTheDocument()

    await i18n.changeLanguage("en-US")
    expect(
      await screen.findByLabelText("可用服务器: Test passed")
    ).toBeVisible()
    expect(screen.getByLabelText("不可用服务器: Test failed")).toBeVisible()
    expect(screen.getByLabelText("未测试服务器: Not tested")).toBeVisible()
  })

  it("saves a pasted single-server STDIO JSON configuration from the add dialog", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let servers: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({ items: servers })
        }
        if (path === "/api/v1/mcp-servers" && method === "POST") {
          servers = [stdioServerFixture()]
          return envelope(servers[0], 201)
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()
    await screen.findByText("尚未配置个人 MCP 服务器")

    expect(
      screen.queryByRole("button", { name: "导入 JSON" })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "添加服务器" })).toHaveLength(
      1
    )
    await interaction.click(screen.getByRole("button", { name: "添加服务器" }))
    await interaction.click(screen.getByRole("combobox", { name: "连接类型" }))
    await interaction.click(
      await screen.findByRole("option", { name: "STDIO" })
    )

    const dialog = screen.getByRole("dialog", { name: "连接自定义 MCP" })
    expect(dialog).toHaveClass("min-w-0", "overflow-x-hidden")
    expect(dialog.querySelector("form")).toHaveClass(
      "min-w-0",
      "overflow-x-hidden",
      "overflow-y-auto"
    )
    const configuration = screen.getByLabelText("STDIO 配置（JSON）")
    expect(configuration).toHaveClass("min-w-0")
    fireEvent.change(configuration, {
      target: {
        value: JSON.stringify({
          mcpServers: {
            first: { command: "npx" },
            second: { command: "node" },
          },
        }),
      },
    })
    expect(screen.getByText(/请输入有效的单服务器 STDIO JSON/)).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()

    const json = JSON.stringify({
      mcpServers: {
        "mcp-server-weread": {
          command: "npx",
          args: ["-y", "mcp-server-weread"],
          env: {
            CC_ID: "reader-id",
            CC_PASSWORD: "ui-json-secret",
            CC_URL: "https://cc.chenge.ink",
          },
        },
      },
    })
    fireEvent.change(configuration, {
      target: { value: json },
    })
    expect(screen.getByLabelText("名称")).toHaveValue("mcp-server-weread")
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        path: "/api/v1/mcp-servers",
        method: "POST",
        body: {
          transport: "stdio",
          name: "mcp-server-weread",
          command: "npx",
          args: ["-y", "mcp-server-weread"],
          environment: {
            CC_ID: "reader-id",
            CC_PASSWORD: "ui-json-secret",
            CC_URL: "https://cc.chenge.ink",
          },
          startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
          tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
        },
      })
    )
    expect(
      requests.some((request) => request.path === "/api/v1/mcp-servers/import")
    ).toBe(false)
    expect(await screen.findByText("mcp-server-weread")).toBeVisible()
    expect(screen.getByText("STDIO")).toBeVisible()
    expect(screen.getByText("3 个环境变量")).toBeVisible()
    expect(document.body).not.toHaveTextContent("ui-json-secret")
  })

  it("preserves or explicitly clears saved STDIO environment values through JSON", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    const server = stdioServerFixture()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({ items: [server] })
        }
        if (path === `/api/v1/mcp-servers/${SERVER_ID}` && method === "PATCH") {
          return envelope(server)
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByText("mcp-server-weread")).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "更多操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑" })
    )

    const configuration = screen.getByLabelText("STDIO 配置（JSON）")
    expect(configuration).toHaveValue(
      JSON.stringify(
        {
          command: "npx",
          args: ["-y", "mcp-server-weread"],
        },
        null,
        2
      )
    )
    expect(
      screen.getByText(/当前变量：CC_ID, CC_PASSWORD, CC_URL/)
    ).toBeVisible()
    expect(document.body).not.toHaveTextContent("stored-reader-password")
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => {
      const firstPatch = requests.find(
        (request) =>
          request.path === `/api/v1/mcp-servers/${SERVER_ID}` &&
          request.method === "PATCH"
      )
      expect(firstPatch?.body).toEqual({
        name: "mcp-server-weread",
        command: "npx",
        args: ["-y", "mcp-server-weread"],
        startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
        tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
      })
    })

    await interaction.click(screen.getByRole("button", { name: "更多操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑" })
    )
    fireEvent.change(screen.getByLabelText("STDIO 配置（JSON）"), {
      target: {
        value: JSON.stringify({
          command: "npx",
          args: ["-y", "mcp-server-weread"],
          env: {},
        }),
      },
    })
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => {
      const patches = requests.filter(
        (request) =>
          request.path === `/api/v1/mcp-servers/${SERVER_ID}` &&
          request.method === "PATCH"
      )
      expect(patches).toHaveLength(2)
      expect(patches[1]?.body).toEqual({
        name: "mcp-server-weread",
        command: "npx",
        args: ["-y", "mcp-server-weread"],
        clear_environment: true,
        startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
        tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
      })
    })
  })

  it("disables and deletes an owned MCP server", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let servers = [serverFixture()]
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })
        if (path === "/api/v1/mcp-servers" && method === "GET") {
          return envelope({ items: servers })
        }
        if (path === `/api/v1/mcp-servers/${SERVER_ID}` && method === "PATCH") {
          servers = [serverFixture({ status: "disabled" })]
          return envelope(servers[0])
        }
        if (
          path === `/api/v1/mcp-servers/${SERVER_ID}` &&
          method === "DELETE"
        ) {
          servers = []
          return new Response(null, { status: 204 })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    const toggle = await screen.findByRole("switch", {
      name: "启用或停用 Issue tracker",
    })
    expect(toggle).toBeChecked()
    await interaction.click(toggle)
    await waitFor(() =>
      expect(requests).toContainEqual({
        path: `/api/v1/mcp-servers/${SERVER_ID}`,
        method: "PATCH",
        body: { status: "disabled" },
      })
    )
    expect(
      await screen.findByRole("switch", {
        name: "启用或停用 Issue tracker",
      })
    ).not.toBeChecked()

    await interaction.click(screen.getByRole("button", { name: "更多操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "删除" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "删除此 MCP 服务器？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    await waitFor(() =>
      expect(requests).toContainEqual({
        path: `/api/v1/mcp-servers/${SERVER_ID}`,
        method: "DELETE",
        body: undefined,
      })
    )
    expect(await screen.findByText("MCP 服务器已删除。")).toBeVisible()
    expect(screen.queryByText("Issue tracker")).not.toBeInTheDocument()
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <McpManagementPage />
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

function statusDot(indicator: HTMLElement) {
  const dot = indicator.querySelector('[data-slot="mcp-test-status-dot"]')
  if (!(dot instanceof HTMLElement)) {
    throw new Error("MCP test status dot was not rendered")
  }
  return dot
}

function statusCore(indicator: HTMLElement) {
  const core = indicator.querySelector('[data-slot="mcp-test-status-core"]')
  if (!(core instanceof HTMLElement)) {
    throw new Error("MCP test status core was not rendered")
  }
  return core
}

function serverFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVER_ID,
    name: "Issue tracker",
    transport: "streamable_http",
    url: "https://mcp.example.test/mcp",
    command: null,
    args: [],
    environment_keys: [],
    auth_type: "none",
    api_key_header: null,
    has_credential: false,
    status: "active",
    startup_timeout_seconds: mcpDefaultStartupTimeoutSeconds,
    tool_timeout_seconds: mcpDefaultToolTimeoutSeconds,
    insecure_http_acknowledged: false,
    last_test_status: null,
    last_test_error_code: null,
    last_tested_at: null,
    last_used_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function stdioServerFixture() {
  return serverFixture({
    name: "mcp-server-weread",
    transport: "stdio",
    url: null,
    command: "npx",
    args: ["-y", "mcp-server-weread"],
    environment_keys: ["CC_ID", "CC_PASSWORD", "CC_URL"],
    auth_type: "none",
    api_key_header: null,
    has_credential: false,
    insecure_http_acknowledged: false,
  })
}
