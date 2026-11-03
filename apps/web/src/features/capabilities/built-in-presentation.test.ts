import type { CapabilitySummary } from "@/api/contracts"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import { computerUseMessages } from "@/features/computer-use/messages"
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
      "zh-CN": {
        translation: { ...zhCN, computerUse: computerUseMessages["zh-CN"] },
      },
      "en-US": {
        translation: { ...enUS, computerUse: computerUseMessages["en-US"] },
      },
    },
    fallbackLng: "zh-CN",
  })
})

describe("built-in capability presentation", () => {
  it.each(["linksense-browser-use", "linksense-computer-use"])(
    "does not relabel an existing custom %s package as a built-in",
    (name) => {
      expect(
        capabilityPresentation(
          {
            ...docsCapability,
            id: "60000000-0000-4000-8000-000000000001",
            name,
            display_name: "Existing custom workflow",
            builtin_key: null,
            is_builtin: false,
            source_type: "local",
          },
          translations.getFixedT("en-US"),
          "LinkSense"
        )
      ).toEqual({
        name: "Existing custom workflow",
        description: null,
      })
    }
  )
  it("localizes Browser Use while retaining the persisted built-in identity", () => {
    const result = capabilityPresentation(
      {
        ...docsCapability,
        id: "builtin:capability:linksense-local-browser",
        name: "linksense-local-browser",
        builtin_key: "linksense-local-browser",
      },
      translations.getFixedT("en-US"),
      "LinkSense"
    )
    expect(result.name).toBe("LinkSense Browser Use")
    expect(result.description).not.toBeNull()
  })
  it("localizes the Computer Use built-in", () => {
    const result = capabilityPresentation(
      {
        ...docsCapability,
        id: "builtin:capability:linksense-computer-use",
        name: "linksense-computer-use",
        builtin_key: "linksense-computer-use",
      },
      translations.getFixedT("en-US"),
      "LinkSense"
    )
    expect(result.name).toBe("Computer Use")
    expect(result.description).toBe(
      "Operate this computer through the paired LinkSense helper."
    )
  })
  it.each(["zh-CN", "en-US", "unknown"])(
    "shows optional personal names and formatted historical names in %s",
    (language) => {
      const personal = {
        ...docsCapability,
        is_builtin: false,
        builtin_key: null,
        name: "meeting-notes",
      }
      expect(
        capabilityPresentation(
          { ...personal, display_name: "会议纪要助手" },
          translations.getFixedT(language),
          "LinkSense"
        ).name
      ).toBe("会议纪要助手")
      for (const display_name of [null, undefined, "  "]) {
        expect(
          capabilityPresentation(
            { ...personal, display_name },
            translations.getFixedT(language),
            "LinkSense"
          ).name
        ).toBe("Meeting Notes")
      }
    }
  )

  it("localizes the LinkSense document reader Skill in both languages", () => {
    expect(
      capabilityPresentation(
        documentReaderCapability,
        translations.getFixedT("zh-CN"),
        "LinkSense"
      )
    ).toEqual({
      name: "LinkSense 文档读取",
      description:
        "将任务中的常见办公文档、电子书、CSV 和文本型 PDF 转换为 Markdown，供 AI 安全读取。",
    })
    expect(
      capabilityPresentation(
        documentReaderCapability,
        translations.getFixedT("en-US"),
        "LinkSense"
      )
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
        "LinkSense"
      )
    ).toEqual({
      name: "LinkSense 帮助文档",
      description: "根据官方中英文帮助文档解答产品使用与管理问题。",
    })
    expect(
      capabilityPresentation(
        docsCapability,
        translations.getFixedT("en-US"),
        "LinkSense"
      )
    ).toEqual({
      name: "LinkSense Docs",
      description:
        "Answers product usage and administration questions from the official bilingual help documentation.",
    })
  })
})
