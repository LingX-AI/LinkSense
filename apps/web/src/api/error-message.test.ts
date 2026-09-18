import { beforeEach, describe, expect, it } from "vitest"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import i18n from "@/i18n"

describe("getErrorMessage", () => {
  it("distinguishes a closed submission in Chinese, English, and fallback translations", () => {
    const error = new ApiError({ status: 409, errorCode: "TURN_START_CLOSED" })
    expect(getErrorMessage(error, i18n.getFixedT("zh-CN"))).toBe(
      "上次提交已结束，本次未执行。请重新提交。"
    )
    expect(getErrorMessage(error, i18n.getFixedT("en-US"))).toBe(
      "The previous submission has ended. This request was not run. Please submit it again."
    )
    const instance = i18n.cloneInstance({ forkResourceStore: true })
    instance.removeResourceBundle("en-US", "translation")
    expect(getErrorMessage(error, instance.getFixedT("en-US"))).toBe(
      "上次提交已结束，本次未执行。请重新提交。"
    )
  })

  it.each([
    ["APPLICATION_NOT_FOUND", "notFound"],
    ["APPLICATION_DISABLED", "disabled"],
    ["APPLICATION_RUNTIME_BUSY", "runtimeBusy"],
    ["APPLICATION_CENTER_UNAVAILABLE", "centerUnavailable"],
    ["APPLICATION_DEPENDENCY_UNAVAILABLE", "dependencyUnavailable"],
  ] as const)("localizes %s without a server message key", (errorCode, key) => {
    const error = new ApiError({ status: 409, errorCode })
    for (const language of ["zh-CN", "en-US"]) {
      const t = i18n.getFixedT(language)
      expect(getErrorMessage(error, t)).toBe(t(`errors.application.${key}`))
      expect(getErrorMessage(error, t)).not.toContain("errors.application.")
    }
    const instance = i18n.cloneInstance({ forkResourceStore: true })
    instance.removeResourceBundle("en-US", "translation")
    expect(getErrorMessage(error, instance.getFixedT("en-US"))).toBe(
      i18n.t(`errors.application.${key}`, { lng: "zh-CN" })
    )
  })

  it("translates ClawHub preview admission errors without exposing raw details", () => {
    const message = getErrorMessage(
      new ApiError({
        status: 429,
        errorCode: "CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED",
        messageKey: "errors.clawhub.installPreviewQuotaExceeded",
        message: "private upstream detail",
      }),
      i18n.getFixedT("zh-CN")
    )

    expect(message).toBe("待确认的 Skill 安装预览已达上限，请稍后再试。")
  })

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  it("appends a localized import failure reason from structured params", () => {
    const message = getErrorMessage(
      new ApiError({
        status: 400,
        errorCode: "INVALID_PACKAGE",
        messageKey: "errors.invalidPackage",
        params: {
          reason_code: "archive_path_invalid",
          path: "../escape.txt",
        },
      }),
      i18n.t
    )

    expect(message).toContain("插件/Skill 包结构无效或缺少必需文件。")
    expect(message).toContain("原因：")
    expect(message).toContain("../escape.txt")
  })

  it("falls back to a raw reason param when no reason code translation exists", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 400,
          errorCode: "INVALID_PACKAGE",
          params: { reason: "manifest file is missing" },
        }),
        i18n.t
      )
    ).toBe(
      "插件/Skill 包结构无效或缺少必需文件。 原因：manifest file is missing"
    )
  })

  it("does not expose the internal execution platform from raw API errors", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 500,
          errorCode: "UNMAPPED_RUNTIME_FAILURE",
          message: "Codex app-server failed to start",
          params: { reason: "CODEX_HOME is unavailable" },
        }),
        i18n.t
      )
    ).toBe("操作未完成，请稍后重试。")
  })

  it("interpolates runtime product branding for mapped errors", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 503,
          errorCode: "TEAMS_SSO_NOT_CONFIGURED",
        }),
        i18n.t,
        { productName: "MOSS 工作台" }
      )
    ).toBe("Teams 单点登录未配置，请使用 MOSS 工作台 登录。")
  })

  it("shows pending administrator approval for newly provisioned external users", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 403,
          errorCode: "EXTERNAL_ACCOUNT_PENDING_APPROVAL",
          messageKey: "auth.external.accountPendingApproval",
        }),
        i18n.t
      )
    ).toBe(
      "身份验证成功，账号已创建并等待管理员启用。请联系管理员，启用后再重新登录。"
    )
  })

  it("shows an actionable message when model endpoint authentication fails", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 422,
          errorCode: "KNOWLEDGE_MODEL_AUTHENTICATION_FAILED",
          messageKey: "errors.knowledgeModel.authenticationFailed",
        }),
        i18n.t
      )
    ).toBe(
      "模型服务未接受当前 API Key。若刚切换 Base URL，请输入新端点对应的有效密钥。"
    )
  })

  it("explains the pinned-task boundary for automations", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 422,
          errorCode: "AUTOMATION_TASK_NOT_PINNED",
        }),
        i18n.t
      )
    ).toBe("自动化只能关联当前账号下已置顶的有效任务。")
  })

  it("explains how to release a system model before deleting it", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 409,
          errorCode: "MODEL_IN_USE_BY_SYSTEM_SETTING",
        }),
        i18n.t
      )
    ).toBe("该模型正在被系统设置使用，请先切换或取消相关选择后再删除。")
  })

  it("explains when model management is locked by deployment configuration", () => {
    expect(
      getErrorMessage(
        new ApiError({
          status: 403,
          errorCode: "MODEL_MANAGEMENT_DISABLED",
        }),
        i18n.t
      )
    ).toBe("模型配置已由部署环境锁定，当前只能查看。")
  })
})
