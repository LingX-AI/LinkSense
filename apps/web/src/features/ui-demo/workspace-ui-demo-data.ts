import {
  applicationCenterReleaseSchema,
  applicationDetailsSchema,
  connectionListSchema,
} from "@linksense/shared"
import type { z } from "zod"
import { ApiError, type QueryValue } from "@/api/client"
import {
  applicationSchema,
  automationListSchema,
  capabilitySummarySchema,
  clawHubSkillCatalogItemSchema,
  marketplaceCatalogItemSchema,
  mcpServerSchema,
} from "@/api/contracts"
import {
  pluginUiDemoCapabilities,
  pluginUiDemoCatalog,
} from "@/features/capabilities/plugin-ui-demo"

const timestamp = "2026-11-06T02:00:00.000Z"
const demoId = (value: number) =>
  `d5e00000-0000-4000-8000-${String(value).padStart(12, "0")}`

export function rejectWorkspaceUiDemoWrite(): never {
  throw new ApiError({
    status: 403,
    errorCode: "WORKSPACE_UI_DEMO_READ_ONLY",
    messageKey: "workspaceUiDemo.readOnly",
  })
}

function notFound(): never {
  throw new ApiError({ status: 404, errorCode: "NOT_FOUND" })
}

export function workspaceDemoAutomations() {
  const seeds = [
    [
      "每日工作简报 · 示例",
      "整理今天的会议安排、待办事项与项目进展，生成简明工作简报。",
    ],
    [
      "每周项目回顾 · 示例",
      "汇总本周已完成的工作、风险和下周计划，形成项目周报。",
    ],
    [
      "客户问题与反馈跟进 · 示例",
      "归纳需要跟进的客户问题，列出负责人及建议处理时间。",
    ],
    [
      "Monthly Insights · Demo",
      "Prepare a monthly summary of project milestones and follow-up actions.",
    ],
    [
      "跨部门协作项目进展与交付风险检查（长标题测试）· 示例",
      "检查长标题在列表与操作菜单中的布局。此记录仅为暂停状态的展示数据。",
    ],
    [
      "知识资料整理提醒 · 示例",
      "提醒团队整理新增资料，检查文档归类与过期内容。",
    ],
  ] as const
  return automationListSchema.parse({
    items: seeds.map(([title, instruction], index) => ({
      id: demoId(index + 1),
      title,
      instruction,
      status: index === 2 || index === 4 ? "paused" : "active",
      conversation: { id: demoId(50 + index), title, pinned_at: timestamp },
      schedule:
        index === 1
          ? {
              frequency: "weekly",
              interval: 1,
              weekdays: [5],
              time: "16:00",
              time_zone: "Asia/Shanghai",
            }
          : index === 3
            ? {
                frequency: "monthly",
                interval: 1,
                day_of_month: 1,
                time: "10:00",
                time_zone: "Asia/Shanghai",
              }
            : {
                frequency: "daily",
                interval: 1,
                time: index === 5 ? "17:30" : "09:00",
                time_zone: "Asia/Shanghai",
              },
      next_run_at:
        index === 2 || index === 4
          ? null
          : index === 1
            ? "2026-11-13T08:00:00.000Z"
            : index === 3
              ? "2026-12-01T02:00:00.000Z"
              : index === 5
                ? "2026-11-07T09:30:00.000Z"
                : "2026-11-07T01:00:00.000Z",
      expires_on: null,
      last_run_at: index === 5 ? null : timestamp,
      last_run_status: index === 5 ? null : index === 2 ? "failed" : "started",
      last_error_code: index === 2 ? "CONNECTION_REQUIRED" : null,
      model_preference: null,
      created_at: "2026-11-01T02:00:00.000Z",
      updated_at: timestamp,
    })),
  }).items
}

const skillSeeds = [
  [
    "需求分析与任务拆解 · 示例",
    "requirements-review",
    "梳理需求背景、验收条件和待确认问题，将需求整理成可执行的任务清单。",
  ],
  [
    "内容写作与润色 · 示例",
    "writing-assistant",
    "整理文章结构与表达风格，检查标题、正文和摘要的展示效果。",
  ],
  [
    "Data Analysis · Demo",
    "data-analysis",
    "Summarize metrics and compare changes across reporting periods.",
  ],
  [
    "代码审查清单 · 示例",
    "code-review",
    "整理代码审查关注点、边界情况与测试建议。",
  ],
  [
    "团队知识整理与长文档摘要（长标题测试）· 示例",
    "knowledge-summary",
    "用于检查多行说明、较长技能名称与右侧操作的对齐。",
  ],
] as const

export function workspaceDemoCapabilities() {
  return [
    ...pluginUiDemoCapabilities(),
    ...skillSeeds.map(([name, slug, description], index) =>
      capabilityResponse({
        id: demoId(100 + index),
        name,
        slug,
        description,
        type: "skill",
        status: "active",
        source_type: "local",
        marketplace_listing_id: null,
        marketplace_release_id: null,
        logo_url: null,
        is_owner: true,
        can_manage: true,
        can_govern: false,
        has_logo: false,
        preference_status: index === 3 ? "disabled" : "enabled",
        manifest: { name: slug, version: "1.0.0", description },
        risk_summary: {},
        created_at: timestamp,
        updated_at: timestamp,
      })
    ),
  ]
}

function capabilityResponse(record: z.input<typeof capabilitySummarySchema>) {
  // Return the wire shape: the API boundary adds personally_disabled once.
  capabilitySummarySchema.parse(record)
  return record
}

export function workspaceDemoMcpServers() {
  return [
    "项目资料检索 · 示例",
    "团队文档服务 · 示例",
    "Analytics Workspace · Demo",
  ].map((name, index) =>
    mcpServerSchema.parse({
      id: demoId(200 + index),
      name,
      status: index === 2 ? "disabled" : "active",
      transport: "streamable_http",
      url: `https://mcp-${index + 1}.example.invalid/mcp`,
      command: null,
      args: [],
      environment_keys: [],
      auth_type: "none",
      api_key_header: null,
      has_credential: false,
      insecure_http_acknowledged: false,
      startup_timeout_seconds: 60,
      tool_timeout_seconds: 600,
      last_test_status: index === 2 ? "failed" : "succeeded",
      last_test_error_code: index === 2 ? "MCP_CONNECTION_FAILED" : null,
      last_tested_at: timestamp,
      last_used_at: index === 2 ? null : timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    })
  )
}

export function workspaceDemoConnections() {
  return connectionListSchema.parse({
    items: [
      {
        provider: "google_docs",
        configured: true,
        status: "connected",
        access_mode: "read_write",
        account_name: "design-demo@example.invalid",
        connected_at: timestamp,
      },
      {
        provider: "gmail",
        configured: true,
        status: "connected",
        access_mode: "read",
        account_name: "team-demo@example.invalid",
        connected_at: timestamp,
      },
      {
        provider: "onedrive",
        configured: true,
        status: "reconnect_required",
        access_mode: "read",
        account_name: "research-demo@example.invalid",
        connected_at: timestamp,
      },
      {
        provider: "sharepoint",
        configured: true,
        status: "disconnected",
        access_mode: null,
        account_name: null,
        connected_at: null,
      },
      {
        provider: "outlook",
        configured: false,
        status: "disconnected",
        access_mode: null,
        account_name: null,
        connected_at: null,
      },
    ],
  })
}

export function workspaceDemoApplications(shared = false) {
  const names = shared
    ? ["团队知识问答 · 示例", "项目研究助手 · 示例", "Weekly Report · Demo"]
    : [
        "产品需求分析助手 · 示例",
        "会议纪要整理 · 示例",
        "数据报告助手 · 示例",
        "Customer Support · Demo",
        "跨部门协作项目知识整理与资料归档助手（长标题测试）· 示例",
      ]
  const capabilities = workspaceDemoCapabilities()
  return names.map((name, index) =>
    applicationSchema.parse({
      id: demoId((shared ? 350 : 300) + index),
      owner: {
        id: demoId(shared ? 901 : 900),
        name: shared ? "示例产品团队" : "示例用户",
      },
      name,
      icon: {
        type: "preset",
        preset: [
          "file-text",
          "book-open",
          "chart-column",
          "headset",
          "workflow",
        ][index],
      },
      description: [
        "梳理需求背景、关键场景和验收条件，生成结构清晰的需求说明。",
        "整理会议决策、行动项和负责人，帮助团队跟进后续工作。",
        "分析项目指标与阶段变化，生成可读的数据摘要与报告。",
        "Organize customer questions and prepare follow-up suggestions.",
        "用于检查长标题、说明换行、标签以及右侧操作按钮的对齐情况。",
      ][index],
      kind: index === 2 ? "interactive" : "standard",
      instructions: "此应用为只读 UI 示例，不包含可执行任务。",
      model: null,
      reasoning_effort: null,
      status: index === 3 ? "disabled" : "active",
      is_owner: !shared,
      can_manage: !shared,
      access_source: shared ? "user_group" : "owner",
      capability_count: 1,
      knowledge_base_count: 0,
      mcp_server_count: 0,
      share_targets: [],
      dependencies_available: true,
      capabilities: [
        {
          id: capabilities[index].id,
          name: capabilities[index].name,
          type: capabilities[index].type,
          description: capabilities[index].description,
          status: "active",
          available: true,
          updated_at: timestamp,
        },
      ],
      knowledge_bases: [],
      mcp_servers: [],
      created_at: timestamp,
      updated_at: timestamp,
    })
  )
}

function workspaceDemoCenter() {
  return workspaceDemoApplications(true).map((application, index) =>
    applicationCenterReleaseSchema.parse({
      id: demoId(400 + index),
      application_id: application.id,
      version_id: demoId(450 + index),
      version_number: "1.0.0",
      name: application.name,
      kind: application.kind,
      description: application.description,
      usage_instructions: "此为界面浏览示例。",
      publisher_name: "Demo Studio",
      usage_modes: ["install"],
      release_notes: "Fictional UI sample. No executable package is included.",
      status: "approved",
      listing_status: "published",
      review_comment: null,
      suspension_reason: null,
      submitted_at: timestamp,
      reviewed_at: timestamp,
      installed_application_id: null,
    })
  )
}

function workspaceDemoClawHub() {
  return skillSeeds.map(([display_name, slug, summary], index) =>
    clawHubSkillCatalogItemSchema.parse({
      id: demoId(500 + index),
      slug: `demo-${slug}`,
      display_name,
      summary,
      topics: [],
      tags: { latest: "1.0.0" },
      latest_version: "1.0.0",
      latest_version_created_at: timestamp,
      latest_version_changelog: null,
      latest_version_license: null,
      owner_handle: "ui-demo",
      owner_display_name: "Demo Studio",
      metadata: null,
      stats: {
        downloads: 128 * (index + 1),
        installs: 24 * (index + 1),
        stars: 12 + index,
        comments: 0,
        versions: 1,
      },
      security_status: "unverified",
      security_has_warnings: false,
      is_suspicious: false,
      is_malware_blocked: false,
      source_created_at: timestamp,
      source_updated_at: timestamp,
      synced_at: timestamp,
      canonical_url: null,
      available: true,
      installable: false,
      installability_reason: "unavailable",
      installed_capability_id: null,
      installed_version: null,
      update_available: false,
    })
  )
}

function matchesSearch(value: unknown, search: QueryValue): boolean {
  const term = String(search ?? "")
    .trim()
    .toLocaleLowerCase()
  return !term || JSON.stringify(value).toLocaleLowerCase().includes(term)
}

export function resolveWorkspaceUiDemoRequest(
  path: string,
  options: { method?: string; query?: Record<string, QueryValue> } = {}
): unknown {
  if (options.method && options.method !== "GET") rejectWorkspaceUiDemoWrite()
  const query = options.query ?? {}
  if (path === "/automations") return { items: workspaceDemoAutomations() }
  if (path === "/automations/pinned-tasks")
    return {
      items: workspaceDemoAutomations().map((item) => item.conversation),
    }
  if (path === "/capabilities")
    return { items: workspaceDemoCapabilities(), next_cursor: null }
  if (path === "/mcp-servers") return { items: workspaceDemoMcpServers() }
  if (path === "/connections") return workspaceDemoConnections()
  if (path === "/marketplace") {
    const items =
      query.type === "skill"
        ? pluginUiDemoCatalog().map((item, index) =>
            marketplaceCatalogItemSchema.parse({
              ...item,
              listing: {
                ...item.listing,
                id: demoId(600 + index),
                current_release_id: demoId(650 + index),
                type: "skill",
                slug: skillSeeds[index][1],
              },
              release: {
                ...item.release,
                id: demoId(650 + index),
                listing_id: demoId(600 + index),
                name: skillSeeds[index][0],
                description: skillSeeds[index][2],
              },
            })
          )
        : pluginUiDemoCatalog()
    return {
      items: items.filter((item) => matchesSearch(item.release, query.search)),
      next_cursor: null,
    }
  }
  if (
    [
      "/marketplace/mine",
      "/marketplace/installations",
      "/application-center/mine",
    ].includes(path)
  )
    return { items: [], next_cursor: null }
  if (path === "/clawhub/skills") {
    const items = workspaceDemoClawHub().filter((item) =>
      matchesSearch(item, query.search)
    )
    return { items, next_cursor: null, total_count: items.length }
  }
  if (path === "/applications/catalog" || path === "/applications") {
    const items = workspaceDemoApplications(query.scope === "shared")
      .filter((item) =>
        matchesSearch(
          { name: item.name, description: item.description },
          query.search
        )
      )
      .filter(
        (item) =>
          !query.state || query.state === "all" || item.kind === query.state
      )
    return {
      items:
        path === "/applications/catalog"
          ? items.map((application) => ({
              type: "application",
              application,
              development: null,
            }))
          : items,
      next_cursor: null,
    }
  }
  if (path === "/applications/distribution") return { items: [] }
  if (path === "/application-center")
    return {
      items: workspaceDemoCenter().filter((item) =>
        matchesSearch(item, query.search)
      ),
      next_cursor: null,
    }
  const detailsMatch = /^\/applications\/([^/]+)(?:\/(details))?$/u.exec(path)
  if (detailsMatch) {
    const app = [
      ...workspaceDemoApplications(),
      ...workspaceDemoApplications(true),
    ].find((item) => item.id === detailsMatch[1])
    if (!app) notFound()
    if (!detailsMatch[2]) return app
    return applicationDetailsSchema.parse({
      id: app.id,
      name: app.name,
      icon: app.icon,
      description: app.description,
      kind: app.kind,
      model: app.model,
      status: app.status,
      created_at: app.created_at,
      updated_at: app.updated_at,
      creator_name: app.owner.name,
      view: app.is_owner ? "configuration" : "published",
      version_number: app.is_owner ? null : "1.0.0",
      resources: app.capabilities.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        configured_name: null,
        status: "configured",
      })),
    })
  }
  // Unknown reads and all writes stay isolated from the live API.
  rejectWorkspaceUiDemoWrite()
}
