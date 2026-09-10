import { describe, expect, it } from "vitest"

import {
  auditActionCodes,
  auditFlatTranslations,
  auditResultCodes,
  auditTargetTypeCodes,
  auditTranslationKey,
  auditTranslationResource,
} from "./audit-i18n.js"

describe("audit i18n catalog", () => {
  it("uses quota wording in Chinese credit audit actions and retains the English label", () => {
    const key = auditTranslationKey("actions", "users_credit_limits_updated")
    expect(auditFlatTranslations("zh-CN")[key]).toBe("已更新用户额度")
    expect(auditFlatTranslations("en-US")[key]).toBe("User credit quotas updated")
  })

  it.each(["zh-CN", "en-US"] as const)(
    "provides complete %s resources for every registered code",
    (locale) => {
      const resource = auditTranslationResource(locale)

      expect(Object.keys(resource.actions)).toHaveLength(auditActionCodes.length)
      expect(Object.keys(resource.targetTypes)).toHaveLength(
        auditTargetTypeCodes.length
      )
      expect(Object.keys(resource.results)).toHaveLength(auditResultCodes.length)
      expect(Object.values(resource.actions).every(Boolean)).toBe(true)
      expect(Object.values(resource.targetTypes).every(Boolean)).toBe(true)
      expect(Object.values(resource.results).every(Boolean)).toBe(true)
    }
  )

  it("keeps dotted action codes addressable in frontend and backend resources", () => {
    const key = auditTranslationKey(
      "actions",
      "knowledge_base.maintenance_rebuild_completed"
    )

    expect(key).toBe(
      "auditValues.actions.knowledge_base__dot__maintenance_rebuild_completed"
    )
    expect(auditFlatTranslations("zh-CN")[key]).toBe("知识库维护重建已完成")
    expect(auditFlatTranslations("en-US")[key]).toBe(
      "Knowledge base maintenance rebuild completed"
    )
  })
})
