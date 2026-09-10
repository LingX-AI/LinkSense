import { describe, expect, it } from "vitest"

import { backendI18n, translateError } from "../src/lib/i18n.js"

describe("backend error translations", () => {
  it("uses Chinese quota wording for exhausted credits and preserves English and fallback", () => {
    const chinese = "你的可用额度已用尽，暂时不能发起新任务。"
    expect(translateError("CREDIT_LIMIT_EXCEEDED", "zh-CN")).toBe(chinese)
    expect(translateError("CREDIT_LIMIT_EXCEEDED", "en-US")).toBe("Your available credit quota is exhausted and you cannot start a new task right now.")
    expect(backendI18n.t("errors.conversation.creditLimitExceeded", { lng: "fr-FR" })).toBe(chinese)
  })

  it("describes unavailable access without requiring an input-box selection in both locales and fallback", () => {
    expect(translateError("KNOWLEDGE_NO_AVAILABLE_BASES", "zh-CN")).toBe("当前没有可访问且可用的知识库。")
    expect(translateError("KNOWLEDGE_NO_AVAILABLE_BASES", "en-US")).toBe("No knowledge bases are currently accessible and available.")
    expect(backendI18n.t("errors.knowledgeSearch.noAvailableBases", { lng: "fr-FR" })).toBe("当前没有可访问且可用的知识库。")
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
