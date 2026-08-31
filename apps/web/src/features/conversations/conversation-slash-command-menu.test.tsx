import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Application, CapabilitySummary } from "@/api/contracts"
import {
  ConversationSlashCommandMenu,
  type ConversationSlashCommandPanel,
} from "@/features/conversations/conversation-slash-command-menu"
import type { KnowledgeBase } from "@/features/knowledge-bases/knowledge-base-contracts"
import i18n from "@/i18n"

const applicationFixture: Application = {
  id: "10000000-0000-4000-8000-000000000001",
  owner: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "应用管理员",
  },
  name: "数据分析助手",
  icon: { type: "preset", preset: "sparkles" },
  description: "分析业务数据并生成结论",
  kind: "standard",
  instructions: "分析数据",
  model: null,
  reasoning_effort: null,
  status: "active",
  is_owner: false,
  can_manage: false,
  access_source: "direct",
  capability_count: 1,
  knowledge_base_count: 1,
  mcp_server_count: 0,
  share_targets: [],
  dependencies_available: true,
  capabilities: [],
  knowledge_bases: [],
  mcp_servers: [],
  interactive_package: null,
  created_at: "2026-07-30T00:00:00.000Z",
  updated_at: "2026-07-30T00:00:00.000Z",
}

const builtInSkillFixture: CapabilitySummary = {
  id: "builtin:capability:linksense-file-service",
  name: "linksense-file-service",
  slug: "linksense-file-service",
  type: "skill",
  description: null,
  status: "active",
  source_type: "builtin",
  builtin_key: "linksense-file-service",
  is_builtin: true,
  marketplace_listing_id: null,
  marketplace_release_id: null,
  logo_url: null,
  is_owner: false,
  can_manage: false,
  can_govern: false,
  can_select: false,
  can_delete: false,
  has_logo: false,
  preference_status: "enabled",
  manifest: null,
  risk_summary: null,
  created_at: null,
  updated_at: null,
  personally_disabled: false,
}

function personalSkillFixture(
  overrides: Partial<CapabilitySummary> = {}
): CapabilitySummary {
  return {
    ...builtInSkillFixture,
    id: "skill-1",
    name: "个人 Skill",
    slug: "personal-skill",
    source_type: "local",
    builtin_key: null,
    is_builtin: false,
    is_owner: true,
    can_manage: true,
    can_select: true,
    can_delete: true,
    ...overrides,
  }
}

function knowledgeBaseFixture(
  overrides: Partial<KnowledgeBase> = {}
): KnowledgeBase {
  return {
    id: "knowledge-1",
    name: "Web 项目知识库",
    description: "Web 前端资料",
    source_type: "local",
    source_sync: null,
    lifecycle_status: "active",
    availability_status: "enabled",
    owner: { id: "owner-1", name: "管理员" },
    is_owner: true,
    access_sources: [{ type: "owner" }],
    document_count: 3,
    ready_document_count: 3,
    storage_used_bytes: 100,
    storage_reserved_bytes: 0,
    storage_quota_bytes: 1_000,
    permissions: {
      view_content: true,
      update: true,
      manage_documents: true,
      manage_grants: true,
      create_grants: true,
      revoke_grants: true,
      archive: true,
      restore: false,
      delete: false,
      remove_direct_share: false,
    },
    archived_at: null,
    disabled_reason: null,
    created_at: "2026-07-22T00:00:00.000Z",
    updated_at: "2026-07-22T00:00:00.000Z",
    ...overrides,
  }
}

function json(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderMenu(
  panel: "root" | ConversationSlashCommandPanel,
  overrides: Partial<
    React.ComponentProps<typeof ConversationSlashCommandMenu>
  > = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const props: React.ComponentProps<typeof ConversationSlashCommandMenu> = {
    panel,
    query: "",
    capabilities: [],
    selectedCapabilityIds: [],
    onSelectCapability: vi.fn(),
    knowledgeBases: [],
    selectedKnowledgeBaseIds: [],
    onSelectKnowledgeBase: vi.fn(),
    onStartApplication: vi.fn(),
    onSelectPanel: vi.fn(),
    onStartNewTask: vi.fn(),
    ...overrides,
  }
  return {
    props,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ConversationSlashCommandMenu {...props} />
      </QueryClientProvider>
    ),
  }
}

describe("conversation slash command resource panels", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("runs context compaction from the root menu only when it is available", async () => {
    const interaction = userEvent.setup()
    const onCompact = vi.fn()
    const { rerender, props } = renderMenu("root", {
      query: "压缩",
      compactAvailable: true,
      onCompact,
    })

    await interaction.click(screen.getByRole("option", { name: /压缩上下文/ }))
    expect(onCompact).toHaveBeenCalledOnce()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ConversationSlashCommandMenu {...props} compactAvailable={false} />
      </QueryClientProvider>
    )
    expect(screen.getByRole("option", { name: /压缩上下文/ })).toHaveAttribute(
      "data-disabled",
      "true"
    )
  })

  it("uses the generic MCP icon for the root MCP command", () => {
    renderMenu("root")

    const mcpCommand = screen.getByRole("option", { name: /MCP 状态/ })
    expect(
      mcpCommand.querySelector('img[data-default-capability-icon="mcp"]')
    ).toBeNull()
    expect(mcpCommand.querySelector("svg.lucide-server-cog")).toBeVisible()
  })

  it("loads accessible applications and starts the selected application task", async () => {
    const interaction = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        expect(String(request)).toContain("/api/v1/applications?scope=all")
        return json({ items: [applicationFixture], next_cursor: null })
      })
    )
    const onStartApplication = vi.fn()
    renderMenu("applications", { onStartApplication })

    const application = await screen.findByRole("option", {
      name: /数据分析助手/,
    })
    expect(application).toHaveTextContent("分析业务数据并生成结论")
    expect(application).toHaveTextContent("共享")
    expect(application.querySelector(".composer-slash-item-icon")).toBeNull()

    await interaction.click(application)
    expect(onStartApplication).toHaveBeenCalledWith(applicationFixture)
  })

  it("allows built-in Skills to be selected from the inline list", async () => {
    const interaction = userEvent.setup()
    const onSelectCapability = vi.fn()
    renderMenu("skills", {
      capabilities: [builtInSkillFixture],
      onSelectCapability,
    })

    const option = screen.getByRole("option", {
      name: /LinkSense 文件服务/,
    })
    expect(option).not.toHaveAttribute("data-disabled", "true")
    expect(option).toHaveTextContent("内置")
    await interaction.click(option)
    expect(onSelectCapability).toHaveBeenCalledWith(builtInSkillFixture.id)
  })

  it("marks a selected built-in Skill and allows it to be toggled", async () => {
    const interaction = userEvent.setup()
    const onSelectCapability = vi.fn()
    renderMenu("skills", {
      capabilities: [builtInSkillFixture],
      selectedCapabilityIds: [builtInSkillFixture.id],
      onSelectCapability,
    })

    const option = screen.getByRole("option", {
      name: /LinkSense 文件服务/,
    })
    expect(option).toHaveAttribute("data-checked", "true")
    expect(option).toHaveTextContent("已选择")
    await interaction.click(option)
    expect(onSelectCapability).toHaveBeenCalledWith(builtInSkillFixture.id)
  })

  it("searches concrete plugins, Skills, and knowledge bases from the root slash query", async () => {
    const interaction = userEvent.setup()
    const onSelectCapability = vi.fn()
    const onSelectKnowledgeBase = vi.fn()

    renderMenu("root", {
      query: "web",
      capabilities: [
        personalSkillFixture({
          id: "plugin-web",
          name: "网页抓取插件",
          slug: "web-fetch-plugin",
          type: "plugin",
          description: "抓取网页内容并整理摘要",
        }),
        personalSkillFixture({
          id: "skill-web",
          name: "Web 研究 Skill",
          slug: "web-research",
          type: "skill",
          description: "生成 Web 调研报告",
        }),
      ],
      knowledgeBases: [knowledgeBaseFixture()],
      onSelectCapability,
      onSelectKnowledgeBase,
    })

    expect(screen.queryByText("没有匹配的功能")).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /插件列表/ })).toBeNull()
    expect(screen.getByRole("option", { name: /网页抓取插件/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /Web 研究 Skill/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /Web 项目知识库/ })).toBeVisible()

    await interaction.click(
      screen.getByRole("option", { name: /网页抓取插件/ })
    )
    expect(onSelectCapability).toHaveBeenCalledWith("plugin-web")

    await interaction.click(
      screen.getByRole("option", { name: /Web 项目知识库/ })
    )
    expect(onSelectKnowledgeBase).toHaveBeenCalledWith("knowledge-1")
  })

  it("sorts non-built-in Skills alphabetically and places built-in Skills last", () => {
    renderMenu("skills", {
      capabilities: [
        {
          ...builtInSkillFixture,
          id: "builtin:capability:linksense-browser",
          name: "linksense-browser",
          slug: "linksense-browser",
          builtin_key: "linksense-browser",
        },
        personalSkillFixture({ id: "skill-b", name: "Zulu Skill" }),
        builtInSkillFixture,
        personalSkillFixture({ id: "skill-a", name: "alpha Skill" }),
      ],
    })

    expect(
      screen
        .getAllByRole("option")
        .map(
          (option) =>
            option.querySelector(".composer-slash-item-title")?.textContent
        )
        .filter((name): name is string => name !== undefined)
    ).toEqual([
      "alpha Skill",
      "Zulu Skill",
      "LinkSense 浏览器",
      "LinkSense 文件服务",
    ])
  })

  it("shows MCP enablement, authentication, and connection-test status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        expect(String(request)).toContain("/api/v1/mcp-servers")
        return json({
          items: [
            {
              id: "20000000-0000-4000-8000-000000000001",
              name: "内部工具",
              transport: "streamable_http",
              url: "https://mcp.example.com/mcp",
              command: null,
              args: [],
              environment_keys: [],
              auth_type: "api_key",
              api_key_header: "X-API-Key",
              has_credential: true,
              status: "active",
              startup_timeout_seconds: 60,
              tool_timeout_seconds: 600,
              insecure_http_acknowledged: false,
              last_test_status: "succeeded",
              last_test_error_code: null,
              last_tested_at: "2026-07-30T00:00:00.000Z",
              last_used_at: null,
              created_at: "2026-07-30T00:00:00.000Z",
              updated_at: "2026-07-30T00:00:00.000Z",
            },
          ],
        })
      })
    )
    renderMenu("mcp")

    expect(await screen.findByText("内部工具")).toBeVisible()
    expect(screen.queryByText("LinkSense 知识库 MCP")).not.toBeInTheDocument()
    expect(screen.queryByText("内置")).not.toBeInTheDocument()
    expect(screen.getByText("已配置 API Key 认证")).toBeVisible()
    expect(screen.getByRole("img", { name: "测试通过" })).toHaveClass(
      "composer-slash-mcp-status-dot"
    )
    expect(screen.queryByText("测试通过")).not.toBeInTheDocument()
    expect(screen.getByText("已启用")).toBeVisible()
    expect(
      screen.queryByRole("option", { name: /管理 MCP 服务器/ })
    ).not.toBeInTheDocument()
  })

  it("keeps application-managed resource commands visible but unavailable", () => {
    renderMenu("root", { managedApplicationName: "财务助手" })

    expect(screen.getByRole("option", { name: /插件列表/ })).toHaveAttribute(
      "data-disabled",
      "true"
    )
    expect(screen.getByRole("option", { name: /Skill 列表/ })).toHaveAttribute(
      "data-disabled",
      "true"
    )
    expect(screen.getByRole("option", { name: /知识库列表/ })).toHaveAttribute(
      "data-disabled",
      "true"
    )
    expect(screen.getAllByText("当前资源由应用统一管理")).toHaveLength(3)
  })
})
