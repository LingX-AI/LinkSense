import type { CapabilitySummary } from "@/api/contracts"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"
import { createInstance } from "i18next"
import { beforeAll, describe, expect, it } from "vitest"

const docsCapability: CapabilitySummary = {
  id: "builtin:capability:linksense-docs",
  name: "linksense-docs",
  slug: "linksense-docs",
  type: "skill",
  description: null,
  status: "active",
  source_type: "builtin",
  builtin_key: "linksense-docs",
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

const documentReaderCapability: CapabilitySummary = {
  ...docsCapability,
  id: "builtin:capability:linksense-document-reader",
  name: "linksense-document-reader",
  slug: "linksense-document-reader",
  builtin_key: "linksense-document-reader",
}

const translations = createInstance()

beforeAll(async () => {
  await translations.init({
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
    },
    fallbackLng: "zh-CN",
  })
})

describe("built-in capability presentation", () => {
  it("localizes the LinkSense document reader Skill in both languages", () => {
    expect(
      capabilityPresentation(
        documentReaderCapability,
        translations.getFixedT("zh-CN"),
        "LinkSense",
      ),
    ).toEqual({
      name: "LinkSense 文档读取",
      description:
        "将任务中的常见办公文档、电子书、CSV 和文本型 PDF 转换为 Markdown，供 AI 安全读取。",
    })
    expect(
      capabilityPresentation(
        documentReaderCapability,
        translations.getFixedT("en-US"),
        "LinkSense",
      ),
    ).toEqual({
      name: "LinkSense Document Reader",
      description:
        "Converts common office documents, ebooks, CSV files, and text-based PDFs in the task to Markdown for safe AI reading.",
    })
  })

  it("localizes the LinkSense documentation Skill in both languages", () => {
    expect(
      capabilityPresentation(
        docsCapability,
        translations.getFixedT("zh-CN"),
        "LinkSense",
      ),
    ).toEqual({
      name: "LinkSense 帮助文档",
      description: "根据官方中英文帮助文档解答产品使用与管理问题。",
    })
    expect(
      capabilityPresentation(
        docsCapability,
        translations.getFixedT("en-US"),
        "LinkSense",
      ),
    ).toEqual({
      name: "LinkSense Docs",
      description:
        "Answers product usage and administration questions from the official bilingual help documentation.",
    })
  })
})
