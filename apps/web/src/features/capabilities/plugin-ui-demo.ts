import { z } from "zod"
import {
  isWorkspaceUiDemoEnabled,
  workspaceUiDemoQueryKey,
} from "@/features/ui-demo/workspace-ui-demo-mode"

import {
  ApiError,
  apiRequest as requestLiveData,
  apiUploadRequest as uploadLiveData,
  type ApiUploadRequestOptions,
  type QueryValue,
} from "@/api/client"
import {
  capabilitySummarySchema,
  marketplaceCatalogItemSchema,
} from "@/api/contracts"

export function isPluginUiDemoEnabled(): boolean {
  if (isWorkspaceUiDemoEnabled()) return false
  if (!import.meta.env.DEV || typeof window === "undefined") return false
  const parameters = new URLSearchParams(window.location.search)
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
    window.location.pathname === "/capabilities" &&
    parameters.get("section") === "plugin" &&
    parameters.get("pluginDemo") === "1"
  )
}

export function pluginUiDemoQueryKey(): readonly string[] {
  if (isWorkspaceUiDemoEnabled()) return workspaceUiDemoQueryKey()
  return isPluginUiDemoEnabled() ? ["plugin-ui-demo"] : []
}

const timestamp = "2026-11-06T02:00:00.000Z"
const demoId = (value: number) =>
  `d4e00000-0000-4000-8000-${String(value).padStart(12, "0")}`

// Fictional records for visual inspection; these are never installed or executed.
const seeds = [
  [
    "文档处理工具包 · 示例",
    "document-toolkit",
    "提取文档内容，整理重点与待办，适合检查中文标题和说明的排版。",
  ],
  [
    "Spreadsheet Insights · Demo",
    "spreadsheet-insights",
    "Summarize metrics, compare periods, and prepare chart recommendations.",
  ],
  [
    "会议纪要助手 · 示例",
    "meeting-notes",
    "整理会议记录、关键决策和行动项，用于查看停用状态。",
  ],
  [
    "Project Research Toolkit · Demo",
    "project-research",
    "Collect project references and organize findings into a concise research brief.",
  ],
  [
    "团队知识整理与跨部门项目资料归档工具包（长标题测试）· 示例",
    "team-archive",
    "这是一段较长的示例说明，用于检查窄屏、标题换行、内容截断以及右侧操作按钮是否保持整齐。",
  ],
  [
    "Quick Notes · Demo",
    "quick-notes",
    "Capture short notes and turn them into a clear task list.",
  ],
] as const

export function pluginUiDemoCapabilities() {
  return seeds.map(([name, slug, description], index) => {
    const record = {
      id: demoId(index + 1),
      name,
      slug,
      description,
      type: "plugin",
      status: "active",
      source_type: "local",
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      is_owner: true,
      can_manage: true,
      can_govern: false,
      has_logo: false,
      preference_status: index === 2 ? "disabled" : "enabled",
      manifest: { name: slug, version: "1.0.0", description },
      risk_summary: {},
      created_at: timestamp,
      updated_at: timestamp,
    } satisfies z.input<typeof capabilitySummarySchema>
    capabilitySummarySchema.parse(record)
    return record
  })
}

export function pluginUiDemoCatalog(search = "") {
  return [
    [
      "Customer Support Toolkit · Demo",
      "customer-support",
      "Organize customer questions, draft responses, and track follow-up items.",
    ],
    [
      "数据质量检查 · 示例",
      "data-quality",
      "检查缺失字段、重复记录和格式问题，生成简明的数据质量摘要。",
    ],
    [
      "Weekly Report Builder · Demo",
      "weekly-report",
      "Turn project updates into a concise weekly report with progress and next steps.",
    ],
    [
      "产品需求评审工具包 · 示例",
      "product-review",
      "梳理需求背景、验收条件与待确认问题，帮助团队准备评审材料。",
    ],
  ]
    .map(([name, slug, description], index) => {
      const listingId = demoId(100 + index)
      const releaseId = demoId(200 + index)
      return marketplaceCatalogItemSchema.parse({
        listing: {
          id: listingId,
          publisher_id: demoId(900),
          publisher_name: "Demo Studio",
          type: "plugin",
          slug,
          status: "published",
          current_release_id: releaseId,
          suspended_by: null,
          suspended_at: null,
          suspension_reason: null,
          created_at: timestamp,
          updated_at: timestamp,
        },
        release: {
          id: releaseId,
          listing_id: listingId,
          source_capability_id: demoId(300 + index),
          release_number: 1,
          status: "approved",
          name,
          description,
          release_notes:
            "Fictional UI sample. No executable package is included.",
          logo_url: null,
          content_sha256: "a".repeat(64),
          manifest: { name: slug, version: "1.0.0" },
          risk_summary: {},
          submitted_by: demoId(900),
          reviewer_id: null,
          review_comment: null,
          submitted_at: timestamp,
          reviewed_at: timestamp,
          published_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        },
        installed_capability_id: null,
        installed_release_id: null,
        update_available: false,
        install_count: (index + 1) * 28,
      })
    })
    .filter((item) =>
      `${item.release.name} ${item.release.description}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
    )
}

function readOnlyError() {
  return new ApiError({
    status: 403,
    errorCode: "PLUGIN_UI_DEMO_READ_ONLY",
    messageKey: "capability.uiDemo.readOnly",
  })
}

export function pluginUiDemoResponse(
  path: string,
  method = "GET",
  query?: Record<string, QueryValue>
): unknown {
  if (method !== "GET") throw readOnlyError()
  if (path === "/capabilities")
    return { items: pluginUiDemoCapabilities(), next_cursor: null }
  if (path === "/marketplace")
    return {
      items: pluginUiDemoCatalog(String(query?.search ?? "")),
      next_cursor: null,
    }
  if (["/marketplace/mine", "/marketplace/installations"].includes(path))
    return { items: [], next_cursor: null }
  // No demo request, including unknown endpoints, falls through to live data.
  throw readOnlyError()
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  options: Parameters<typeof requestLiveData<TSchema>>[1]
): Promise<z.output<TSchema>> {
  if (!isPluginUiDemoEnabled()) return requestLiveData(path, options)
  return options.schema.parse(
    pluginUiDemoResponse(path, options.method, options.query)
  )
}

export async function apiUploadRequest<TSchema extends z.ZodType>(
  path: string,
  options: ApiUploadRequestOptions<TSchema>
): Promise<z.output<TSchema>> {
  if (isPluginUiDemoEnabled()) throw readOnlyError()
  return uploadLiveData(path, options)
}
