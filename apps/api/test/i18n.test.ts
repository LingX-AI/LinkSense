import { describe, expect, it } from "vitest"
import { supportedLocales } from "@linksense/shared"

import { backendI18n, translateError } from "../src/lib/i18n.js"

describe("backend error translations", () => {
  it.each(supportedLocales)("has a complete authored resource bundle for %s", (locale) => {
    const source = backendI18n.getResourceBundle("en-US", "translation") as Record<string, string>
    const target = backendI18n.getResourceBundle(locale, "translation") as Record<string, string>
    expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort())
    const tokens = (value: string) => [...value.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token).sort()
    for (const [key, value] of Object.entries(target)) {
      expect(value.trim(), key).not.toBe("")
      expect(tokens(value), key).toEqual(tokens(source[key]!))
      if (locale !== "en-US" && key.startsWith("mail.")) expect(value, key).not.toBe(source[key])
    }
  })
  it.each([
    ["es-ES", "Sitio no encontrado", "Desarrollar Demo"],
    ["pt-BR", "Site não encontrado", "Desenvolver Demo"],
    ["fr-FR", "Site introuvable", "Développer Demo"],
    ["ja-JP", "サイトが見つかりません", "Demoを開発"],
  ])("provides reviewed backend copy for %s", (locale, title, taskTitle) => {
    expect(backendI18n.t("webSitePage.notFoundTitle", { lng: locale })).toBe(
      title,
    )
    expect(
      backendI18n.t("applicationDevelopment.taskTitle", {
        lng: locale,
        name: "Demo",
      }),
    ).toBe(taskTitle)
  })

  it.each([
    ["audit.export.actorName", "操作人名称", "Actor Name"],
    ["audit.export.actorEmail", "操作人邮箱", "Actor Email"],
    ["webSitePage.notFoundTitle", "站点未找到", "Site not found"],
    ["webSitePage.notFoundDescription", "站点可能已删除或取消发布，请检查链接后再试。", "This site may have been deleted or unpublished. Please check the link and try again."],
  ])("translates %s in both languages and falls back for a missing translation", (key, chinese, english) => {
    expect(backendI18n.t(key, { lng: "zh-CN" })).toBe(chinese)
    expect(backendI18n.t(key, { lng: "en-US" })).toBe(english)
    expect(backendI18n.t(key, { lng: "de-DE" })).toBe(chinese)
  })

  it("translates a closed submission in both languages and falls back to Chinese", () => {
    const chinese = "上次提交已结束，本次未执行。请重新提交。"
    expect(translateError("TURN_START_CLOSED", "zh-CN")).toBe(chinese)
    expect(translateError("TURN_START_CLOSED", "en-US")).toBe("The previous submission has ended. This request was not run. Please submit it again.")
    expect(backendI18n.t("errors.runner.turnStartClosed", { lng: "de-DE" })).toBe(chinese)
  })
  it("uses Chinese quota wording for exhausted credits and preserves English and fallback", () => {
    const chinese = "你的可用额度已用尽，暂时不能发起新任务。"
    expect(translateError("CREDIT_LIMIT_EXCEEDED", "zh-CN")).toBe(chinese)
    expect(translateError("CREDIT_LIMIT_EXCEEDED", "en-US")).toBe("Your available credit quota is exhausted and you cannot start a new task right now.")
    expect(backendI18n.t("errors.conversation.creditLimitExceeded", { lng: "de-DE" })).toBe(chinese)
  })

  it("describes unavailable access without requiring an input-box selection in both locales and fallback", () => {
    expect(translateError("KNOWLEDGE_NO_AVAILABLE_BASES", "zh-CN")).toBe("当前没有可访问且可用的知识库。")
    expect(translateError("KNOWLEDGE_NO_AVAILABLE_BASES", "en-US")).toBe("No knowledge bases are currently accessible and available.")
    expect(backendI18n.t("errors.knowledgeSearch.noAvailableBases", { lng: "de-DE" })).toBe("当前没有可访问且可用的知识库。")
  })

  it("translates execution service incompatibility without referring to plugin configuration", () => {
    expect(
      translateError("EXECUTION_SERVICE_INCOMPATIBLE", "zh-CN"),
    ).toBe("执行服务版本不一致，请稍后重试。若问题持续，请联系管理员。")
    expect(
      translateError("EXECUTION_SERVICE_INCOMPATIBLE", "en-US"),
    ).toBe(
      "The execution service versions are incompatible. Try again later. If the problem persists, contact an administrator.",
    )
  })

  it("translates a cleanup target that cannot be retried", () => {
    expect(
      translateError("KNOWLEDGE_CLEANUP_TARGET_NOT_RETRYABLE", "zh-CN"),
    ).toBe("该清理目标当前没有可重试的失败任务。")
    expect(
      translateError("KNOWLEDGE_CLEANUP_TARGET_NOT_RETRYABLE", "en-US"),
    ).toBe("This cleanup target has no failed task that can be retried.")
  })

  it("translates a Plan turn that completed without a reviewable Plan", () => {
    expect(translateError("PLAN_OUTPUT_MISSING", "zh-CN")).toBe(
      "计划模式未生成可确认的计划，请重新发起请求。",
    )
    expect(translateError("PLAN_OUTPUT_MISSING", "en-US")).toBe(
      "Plan mode did not produce a plan you can review. Start the request again.",
    )
  })

  it("warns against retrying an image whose usage record failed", () => {
    expect(
      translateError("IMAGE_GENERATION_RECORDING_FAILED", "zh-CN"),
    ).toContain("请勿自动重试")
    expect(
      translateError("IMAGE_GENERATION_RECORDING_FAILED", "en-US"),
    ).toContain("do not retry automatically")
  })

  it("warns against retrying an image whose artifact registration failed", () => {
    expect(
      translateError(
        "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
        "zh-CN",
      ),
    ).toContain("请勿自动重试")
    expect(
      translateError(
        "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
        "en-US",
      ),
    ).toContain("do not retry automatically")
  })
})
