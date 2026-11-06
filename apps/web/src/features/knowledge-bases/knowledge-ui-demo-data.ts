import { ApiError, type QueryValue } from "@/api/client"
import {
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  type KnowledgeBase,
  type KnowledgeDocument,
} from "./knowledge-base-contracts"

const checkedAt = "2026-11-06T02:00:00.000Z"
const demoId = (value: number) =>
  `d3e00000-0000-4000-8000-${String(value).padStart(12, "0")}`

// These are fictional document contents, not application UI translations.
const baseSeeds = [
  {
    name: "产品与使用指南",
    description: "产品介绍、功能说明与上手指南，帮助团队快速了解 LinkSense。",
    owner: "林晓",
    count: 7,
    owned: true,
  },
  {
    name: "团队协作与员工手册",
    description: "团队日常协作、入职流程、假期制度与常见问题。",
    owner: "陈悦",
    count: 6,
    owned: false,
  },
  {
    name: "客户支持知识中心",
    description: "常见问题、服务流程和故障排查指南。",
    owner: "周宁",
    count: 6,
    owned: false,
  },
  {
    name: "品牌与设计规范",
    description: "品牌色彩、组件规范及设计交付说明。",
    owner: "林晓",
    count: 5,
    owned: true,
  },
  {
    name: "研发与技术文档",
    description: "开发环境配置、接口约定和发布检查清单。",
    owner: "许言",
    count: 6,
    owned: false,
  },
  {
    name: "待整理的资料",
    description: "用于查看知识库中尚未添加文档时的空状态。",
    owner: "林晓",
    count: 0,
    owned: true,
  },
  {
    name: "2026 Q3 项目归档",
    description: "第三季度项目复盘、会议纪要与交付资料。",
    owner: "林晓",
    count: 4,
    owned: true,
    archived: true,
  },
  {
    name: "历史市场活动资料",
    description: "用于查看知识库停用时的列表与权限提示。",
    owner: "陈悦",
    count: 3,
    owned: false,
    disabled: true,
  },
] satisfies Array<{
  name: string
  description: string
  owner: string
  count: number
  owned: boolean
  archived?: boolean
  disabled?: boolean
}>

const documentSeeds = [
  {
    name: "快速开始指南.pdf",
    extension: "pdf",
    mime: "application/pdf",
    size: 2_412_544,
  },
  {
    name: "操作手册与常见问题.docx",
    extension: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 845_312,
  },
  {
    name: "资料目录与检查清单.xlsx",
    extension: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 192_512,
  },
  {
    name: "项目介绍与方案演示.pptx",
    extension: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    size: 4_718_592,
  },
  {
    name: "团队协作说明.md",
    extension: "md",
    mime: "text/markdown",
    size: 12_864,
  },
  {
    name: "最新资料整理.pdf",
    extension: "pdf",
    mime: "application/pdf",
    size: 1_572_864,
  },
  {
    name: "待重新上传的扫描件.pdf",
    extension: "pdf",
    mime: "application/pdf",
    size: 3_145_728,
  },
]

function documentsForBase(index: number): KnowledgeDocument[] {
  const seed = baseSeeds[index]
  return documentSeeds.slice(0, seed.count).map((document, position) => {
    const status =
      position === 5 ? "processing" : position === 6 ? "failed" : "ready"
    return knowledgeDocumentSchema.parse({
      id: demoId(1_000 + index * 100 + position),
      knowledge_base_id: demoId(index + 1),
      display_name: document.name,
      canonical_extension: document.extension,
      mime_type: document.mime,
      size_bytes: document.size,
      status,
      current_version_id:
        status === "ready" ? demoId(5_000 + index * 100 + position) : null,
      searchable: status === "ready",
      rebuild_required: false,
      processing:
        status === "processing"
          ? {
              operation: "upload",
              processing_generation: demoId(8_000 + index),
              stage: "embedding",
              progress_percent: 68,
              revision: 1,
              stable_error_code: null,
              retry_at: null,
              retry_attempt: 0,
              cancellable: false,
            }
          : null,
      candidate_failure: null,
      preview: { parsed: true, original_supported: false, renderer: null },
      created_at: "2026-11-02T01:00:00.000Z",
      updated_at: checkedAt,
    })
  })
}

export const knowledgeUiDemoBases: KnowledgeBase[] = baseSeeds.map(
  (seed, index) => {
    const archived = "archived" in seed && seed.archived
    const disabled = "disabled" in seed && seed.disabled
    const documents = documentsForBase(index)
    return knowledgeBaseSchema.parse({
      id: demoId(index + 1),
      name: seed.name,
      description: seed.description,
      source_type: "local",
      source_sync: null,
      lifecycle_status: archived ? "archived" : "active",
      availability_status: disabled ? "disabled" : "enabled",
      owner: { id: demoId(seed.owned ? 900 : 901 + index), name: seed.owner },
      is_owner: seed.owned,
      access_sources: [
        {
          type: seed.owned ? "owner" : "user_group",
          ...(seed.owned ? {} : { id: demoId(950), name: "产品团队" }),
        },
      ],
      document_count: documents.length,
      ready_document_count: documents.filter(
        (document) => document.status === "ready"
      ).length,
      storage_used_bytes: documents.reduce(
        (sum, document) => sum + document.size_bytes,
        0
      ),
      storage_reserved_bytes: 0,
      storage_quota_bytes: 1024 * 1024 * 1024,
      permissions: {
        view_content: !disabled,
        update: false,
        manage_documents: false,
        manage_grants: false,
        create_grants: false,
        revoke_grants: false,
        archive: false,
        restore: false,
        delete: false,
        remove_direct_share: false,
      },
      archived_at: archived ? "2026-10-01T01:00:00.000Z" : null,
      disabled_reason: disabled ? "此条为停用状态的 UI 示例。" : null,
      created_at: "2026-09-01T01:00:00.000Z",
      updated_at: checkedAt,
    })
  }
)

function notFound(): never {
  throw new ApiError({ status: 404, errorCode: "NOT_FOUND" })
}

export function rejectKnowledgeUiDemoWrite(): never {
  throw new ApiError({
    status: 403,
    errorCode: "FORBIDDEN",
    messageKey: "knowledge.uiDemo.readOnly",
  })
}

function paginate<T extends { id: string }>(
  items: T[],
  query: Record<string, QueryValue>
) {
  const offset = query.cursor
    ? items.findIndex((item) => item.id === query.cursor) + 1
    : 0
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 50))
  const page = items.slice(offset, offset + limit)
  return {
    items: page,
    next_cursor:
      offset + page.length < items.length ? (page.at(-1)?.id ?? null) : null,
  }
}

export function resolveKnowledgeUiDemoRequest(
  path: string,
  options: { method?: string; query?: Record<string, QueryValue> } = {}
): unknown {
  if (options.method && options.method !== "GET") rejectKnowledgeUiDemoWrite()
  const query = options.query ?? {}
  if (path === "/knowledge-bases/search-capability") {
    return { status: "available", reason_code: null, checked_at: checkedAt }
  }
  if (path === "/knowledge-bases") {
    const search = String(query.search ?? "")
      .trim()
      .toLocaleLowerCase()
    return paginate(
      knowledgeUiDemoBases.filter(
        (base) =>
          (query.lifecycle_status === undefined ||
            query.lifecycle_status === "all" ||
            base.lifecycle_status === query.lifecycle_status) &&
          (query.scope === undefined ||
            query.scope === "all" ||
            base.is_owner === (query.scope === "owned")) &&
          (!search ||
            `${base.name} ${base.description}`
              .toLocaleLowerCase()
              .includes(search))
      ),
      query
    )
  }
  const [, , baseId, resource, documentId, subresource] = path.split("/")
  const index = knowledgeUiDemoBases.findIndex((base) => base.id === baseId)
  if (index < 0) notFound()
  const base = knowledgeUiDemoBases[index]
  if (!resource) return base
  const documents = documentsForBase(index)
  if (resource === "entries") {
    const entries = documents.map((document) => ({
      id: document.id,
      knowledge_base_id: base.id,
      parent_entry_id: null,
      entry_type: "document" as const,
      name: document.display_name,
      path: [document.display_name],
      updated_at: document.updated_at,
      document,
    }))
    return {
      ...paginate(query.parent_entry_id ? [] : entries, query),
      breadcrumbs: [],
    }
  }
  if (resource !== "documents") notFound()
  if (!documentId)
    return {
      ...paginate(documents, query),
      has_processing_documents: documents.some(
        (document) => document.status === "processing"
      ),
    }
  const document = documents.find((item) => item.id === documentId)
  if (!document) notFound()
  if (!subresource) return document
  if (subresource !== "content" || !document.current_version_id) notFound()
  return {
    document_id: document.id,
    document_version_id: document.current_version_id,
    markdown: `# ${document.display_name.replace(/\.[^.]+$/u, "")}\n\n> 本文为本地 UI 测试示例，不代表真实业务资料。\n\n## 概览\n\n这份文档归属于「${base.name}」，用于检查正文、标题、表格和列表的显示效果。\n\n## 使用步骤\n\n1. 选择适合当前工作的资料。\n2. 阅读相关说明，核对所需信息。\n3. 与团队确认后完成交付。\n\n## 检查清单\n\n- [x] 文档名称与分类清晰\n- [x] 标题、正文和列表可正常阅读\n- [ ] 根据团队需要补充更多资料\n\n| 项目 | 说明 | 负责人 |\n| --- | --- | --- |\n| 内容整理 | 维护目录与资料 | 产品团队 |\n| 内容审核 | 检查准确性与时效性 | ${base.owner.name} |\n| 定期更新 | 每月检查一次 | 协作团队 |\n\n## 常见问题\n\n### 这些是真实文件吗？\n\n这是用于验证界面布局的示例内容，未上传或解析任何业务文件。\n\n### 如何查找其他资料？\n\n返回知识库列表，可按名称搜索，或筛选当前、已归档及共享资料。`,
  }
}
