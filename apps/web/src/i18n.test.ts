import { describe, expect, it, vi } from "vitest"
import {
  applicationIconPresets,
  taskArtifactFileTypeSchema,
} from "@linksense/shared"

import i18n, { resolveBrowserLanguage, setAppLanguage } from "@/i18n"
import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key)
  )
}

function leafStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (typeof value !== "object" || value === null) return []
  return Object.values(value).flatMap(leafStrings)
}

describe("i18n resources", () => {
  it("detects supported languages across browser language APIs", () => {
    expect(resolveBrowserLanguage(["en-GB", "zh-CN"], "zh-CN")).toBe("en-US")
    expect(resolveBrowserLanguage(["fr-FR", "zh-HK"], "en-US")).toBe("zh-CN")
    expect(resolveBrowserLanguage(undefined, "en-AU")).toBe("en-US")
    expect(resolveBrowserLanguage([], "zh-TW")).toBe("zh-CN")
    expect(resolveBrowserLanguage(["fr-FR"], "fr-FR")).toBe("en-US")
    expect(resolveBrowserLanguage(undefined, undefined)).toBe("en-US")
  })

  it("does not broadcast a language change when the language is unchanged", async () => {
    await i18n.changeLanguage("zh-CN")
    window.localStorage.removeItem("linksense.language")
    const onLanguageChanged = vi.fn()
    i18n.on("languageChanged", onLanguageChanged)

    try {
      await setAppLanguage("zh-CN")

      expect(onLanguageChanged).not.toHaveBeenCalled()
      expect(document.documentElement.lang).toBe("zh-CN")
      expect(window.localStorage.getItem("linksense.language")).toBe("zh-CN")
    } finally {
      i18n.off("languageChanged", onLanguageChanged)
      window.localStorage.removeItem("linksense.language")
    }
  })

  it("broadcasts one event when the application language changes", async () => {
    await i18n.changeLanguage("zh-CN")
    window.localStorage.removeItem("linksense.language")
    const onLanguageChanged = vi.fn()
    i18n.on("languageChanged", onLanguageChanged)

    try {
      await setAppLanguage("en-US", { persist: false })

      expect(onLanguageChanged).toHaveBeenCalledTimes(1)
      expect(onLanguageChanged).toHaveBeenCalledWith("en-US")
      expect(document.documentElement.lang).toBe("en-US")
      expect(window.localStorage.getItem("linksense.language")).toBeNull()
    } finally {
      i18n.off("languageChanged", onLanguageChanged)
      await i18n.changeLanguage("zh-CN")
      window.localStorage.removeItem("linksense.language")
    }
  })

  it("replaces an unsupported runtime language with the requested language", async () => {
    await i18n.changeLanguage("zh-CN")
    i18n.language = "fr-FR"
    const onLanguageChanged = vi.fn()
    i18n.on("languageChanged", onLanguageChanged)

    try {
      await setAppLanguage("zh-CN", { persist: false })

      expect(i18n.language).toBe("zh-CN")
      expect(onLanguageChanged).toHaveBeenCalledTimes(1)
      expect(onLanguageChanged).toHaveBeenCalledWith("zh-CN")
    } finally {
      i18n.off("languageChanged", onLanguageChanged)
      await i18n.changeLanguage("zh-CN")
    }
  })

  it("keeps zh-CN and en-US key sets aligned", () => {
    expect(leafKeys(enUS).sort()).toEqual(leafKeys(zhCN).sort())
  })

  it("localizes every artifact filter and falls back to Chinese for an unsupported language", () => {
    const fileTypes = ["all", ...taskArtifactFileTypeSchema.options]
    expect(Object.keys(zhCN.library.artifacts.fileTypes)).toEqual(fileTypes)
    expect(Object.keys(enUS.library.artifacts.fileTypes)).toEqual(fileTypes)
    for (const key of [
      "library.artifacts.fileTypeLabel",
      ...fileTypes.map((value) => `library.artifacts.fileTypes.${value}`),
    ]) {
      for (const lng of ["zh-CN", "en-US"]) {
        expect(i18n.t(key, { lng })).not.toBe(key)
        expect(i18n.t(key, { lng })).not.toBe("")
      }
      expect(i18n.t(key, { lng: "fr-FR" })).toBe(i18n.t(key, { lng: "zh-CN" }))
    }
    expect(i18n.t("library.artifacts.fileTypeLabel", { lng: "en-US" })).toBe(
      "Filter by file type"
    )
    expect(
      i18n.t("library.artifacts.fileTypes.archive", { lng: "zh-CN" })
    ).toBe("压缩包")
  })

  it("labels the reranking switch by when it takes effect", async () => {
    expect(i18n.t("admin.knowledgeModels.enabled", { lng: "zh-CN" })).toBe(
      "检索时启用"
    )
    expect(i18n.t("admin.knowledgeModels.enabled", { lng: "en-US" })).toBe(
      "Enable during search"
    )

    await i18n.changeLanguage("fr-FR")
    expect(i18n.t("admin.knowledgeModels.enabled")).toBe("检索时启用")
    await i18n.changeLanguage("zh-CN")
  })

  it("uses a specific label for saving initial user token configuration", () => {
    expect(
      i18n.t("admin.modelProvider.saveUserTokenLimits", { lng: "zh-CN" })
    ).toBe("保存配置")
    expect(
      i18n.t("admin.modelProvider.saveUserTokenLimits", { lng: "en-US" })
    ).toBe("Save configuration")
  })

  it("localizes administrator update guidance and keeps zh-CN fallback", async () => {
    expect(
      i18n.t("systemUpdate.notice.title", {
        lng: "zh-CN",
        version: "v0.2.0",
      })
    ).toBe("LinkSense v0.2.0 已发布")
    expect(
      i18n.t("systemUpdate.notice.title", {
        lng: "en-US",
        version: "v0.2.0",
      })
    ).toBe("LinkSense v0.2.0 is available")

    await i18n.changeLanguage("fr-FR")
    expect(i18n.t("systemUpdate.checkNow")).toBe("立即检查")
    await i18n.changeLanguage("zh-CN")
  })

  it("localizes every built-in application icon scene", () => {
    expect(Object.keys(zhCN.applications.iconPresets)).toEqual([
      ...applicationIconPresets,
    ])
    expect(Object.keys(enUS.applications.iconPresets)).toEqual([
      ...applicationIconPresets,
    ])
  })

  it("keeps browser notification status copy concise in both languages", () => {
    expect(zhCN.browserNotifications.settingsDescription).toContain(
      "未在使用 LinkSense"
    )
    expect(
      i18n.t("browserNotifications.statusCompletedBody", {
        lng: "zh-CN",
      })
    ).toBe("处理成功")
    expect(
      i18n.t("browserNotifications.statusFailedBody", {
        lng: "en-US",
      })
    ).toBe("Processing failed")
    expect(enUS.browserNotifications.settingsDescription).toContain(
      "not actively using LinkSense"
    )
  })

  it("localizes model changes with both model names", () => {
    const params = {
      previousModel: "GPT-5.6 Sol",
      currentModel: "GPT-5.6 Terra",
    }

    expect(
      i18n.t("conversation.modelChanged", { lng: "zh-CN", ...params })
    ).toBe("模型已从 GPT-5.6 Sol 更改为 GPT-5.6 Terra。")
    expect(
      i18n.t("conversation.modelChanged", { lng: "en-US", ...params })
    ).toBe("Model changed from GPT-5.6 Sol to GPT-5.6 Terra.")
  })

  it("describes the 8–16 character password policy in plain language", () => {
    expect(zhCN.auth.passwordPolicy).toBe(
      "8~16 个字符，且包含大写、小写、数字和标点或符号。"
    )
    expect(zhCN.errors.passwordPolicy).toBe(
      "密码需为 8~16 个字符，且包含大写、小写、数字和标点或符号。"
    )
    expect(enUS.auth.passwordPolicy).toBe(
      "8–16 characters with uppercase, lowercase, a number, and punctuation or a symbol."
    )
    expect(enUS.errors.passwordPolicy).toBe(
      "Password must be 8–16 characters and include uppercase, lowercase, a number, and punctuation or a symbol."
    )
    expect(
      [
        zhCN.auth.passwordPolicy,
        zhCN.errors.passwordPolicy,
        enUS.auth.passwordPolicy,
        enUS.errors.passwordPolicy,
      ].join(" ")
    ).not.toMatch(/Unicode|code points?/iu)
  })

  it("uses general-purpose examples for custom instructions", () => {
    expect(zhCN.settings.customInstructionsPlaceholder).toBe(
      "例如：回答时优先使用中文；先给出结论，再补充必要说明。"
    )
    expect(enUS.settings.customInstructionsPlaceholder).toBe(
      "For example: Keep answers concise; lead with the conclusion, then add any necessary details."
    )
    expect(
      [
        zhCN.settings.customInstructionsPlaceholder,
        enUS.settings.customInstructionsPlaceholder,
      ].join(" ")
    ).not.toMatch(/代码|单元测试|\bcode\b|unit tests?/iu)
  })

  it("warns in both locales that switching embedding models requires a full rebuild", () => {
    expect(zhCN.admin.knowledgeModels.embeddingChangeConfirmTitle).toContain(
      "危险操作"
    )
    expect(
      zhCN.admin.knowledgeModels.embeddingChangeConfirmDescription
    ).toContain("必须前往“系统健康”全量重建所有知识库索引")
    expect(zhCN.admin.knowledgeModels.embeddingChangeDangerNotice).toContain(
      "不能只重建部分知识库"
    )
    expect(
      zhCN.admin.knowledgeModels.savedAfterEmbeddingChangeDescription
    ).toContain("系统健康")
    expect(
      enUS.admin.knowledgeModels.embeddingChangeConfirmDescription
    ).toContain("fully rebuild every knowledge-base index")
    expect(enUS.admin.knowledgeModels.embeddingChangeDangerNotice).toContain(
      "dangerous"
    )
    expect(
      enUS.admin.knowledgeModels.savedAfterEmbeddingChangeDescription
    ).toContain("System health")
  })

  it("uses conversation terminology only for model availability and selection", () => {
    const allowedChineseConversationTerms = new Set([
      "对话模型",
      "对话可选",
      "对话默认模型",
      "对话与系统模型选择",
      "对话可选：{{name}}",
      "拖动左侧手柄或在操作菜单中上下移动。输入框按渠道顺序、渠道内模型顺序展示已开启“对话可选”的模型。",
      "对话默认模型用于用户尚未选择模型时；任务自动命名模型用于生成任务名称。",
      "集中管理对话、知识检索等模型及其服务渠道。用户选择模型后，系统会自动使用对应服务；管理员可为每个对话模型设置可选的推理强度。",
      "适合原生支持 Responses 的服务，可使用完整的对话和工具能力。",
      "这里的模型共用当前渠道的连接地址和密钥。对话模型可设置是否出现在用户的模型选项中；知识检索等模型会由系统按需使用。",
      "启用后，系统会理解文档中的图片，帮助用户搜到图片里的信息。请从支持图片理解的对话模型中选择一个。",
      "至少需要保留一个\u201c对话可选\u201d的对话模型。",
      "模型设置当前为只读。你可以查看现有内容，但不能新增、编辑、删除模型或调整\u201c对话可选\u201d状态。",
    ])
    expect(
      leafStrings(zhCN).filter(
        (value) =>
          value.includes("对话") && !allowedChineseConversationTerms.has(value)
      )
    ).toEqual([])
    expect(
      leafStrings(enUS).filter((value) => /\bthreads?\b/iu.test(value))
    ).toEqual([])
  })

  it("keeps model-setting descriptions focused on user outcomes", () => {
    const chineseDescriptions = leafStrings({
      modelProvider: zhCN.admin.modelProvider,
      knowledgeModels: zhCN.admin.knowledgeModels,
      imageUnderstanding: zhCN.admin.imageUnderstanding,
      imageGeneration: zhCN.admin.imageGeneration,
    })
    const englishDescriptions = leafStrings({
      modelProvider: enUS.admin.modelProvider,
      knowledgeModels: enUS.admin.knowledgeModels,
      imageUnderstanding: enUS.admin.imageUnderstanding,
      imageGeneration: enUS.admin.imageGeneration,
    })

    expect(chineseDescriptions.join(" ")).not.toMatch(
      /上游|执行引擎|RRF|MCP|Skill|适配|结构化输出|真实探测|部署约束/iu
    )
    expect(englishDescriptions.join(" ")).not.toMatch(
      /upstream|execution engine|RRF|MCP|Skill|adapter|structured output|live probe|deployment constraints/iu
    )
  })

  it("does not expose the internal execution platform in user-visible translations", () => {
    expect(leafStrings(zhCN).filter((value) => /codex/iu.test(value))).toEqual(
      []
    )
    expect(leafStrings(enUS).filter((value) => /codex/iu.test(value))).toEqual(
      []
    )
  })

  it("explains that task deletion does not reduce usage history in both languages", () => {
    expect(zhCN.usage.tasksHint).toContain("后续删除不影响历史统计")
    expect(zhCN.usage.turnsHint).toContain("后续删除不影响历史统计")
    expect(zhCN.usage.tokenCompositionNote).toContain("后续删除任务不会回减")
    expect(enUS.usage.tasksHint).toContain(
      "later deletion does not change history"
    )
    expect(enUS.usage.turnsHint).toContain(
      "later deletion does not change history"
    )
    expect(enUS.usage.tokenCompositionNote).toContain(
      "later task deletion does not reduce history"
    )
  })

  it("uses Plugin Center terminology in every user-visible translation", () => {
    expect(
      leafStrings(zhCN).filter((value) => /(商店|商城)/u.test(value))
    ).toEqual([])
    expect(
      leafStrings(enUS).filter((value) =>
        /\b(?:marketplace|store)\b/iu.test(value)
      )
    ).toEqual([])
    expect(zhCN.nav.capabilities).toBe("插件中心")
    expect(zhCN.nav.adminCapabilities).toBe("插件中心")
    expect(zhCN.marketplace.title).toBe("插件中心")
    expect(zhCN.marketplace.adminTitle).toBe("插件中心")
    expect(zhCN.marketplace.catalogTabs).toEqual({
      plugin: "插件",
      skill: "技能",
      mcp: "MCP",
      application: "应用",
    })
    expect(enUS.nav.capabilities).toBe("Plugin Center")
    expect(enUS.nav.adminCapabilities).toBe("Plugin Center")
    expect(enUS.marketplace.title).toBe("Plugin Center")
    expect(enUS.marketplace.adminTitle).toBe("Plugin Center")
    expect(enUS.marketplace.catalogTabs).toEqual({
      plugin: "Plugins",
      skill: "Skills",
      mcp: "MCP",
      application: "Applications",
    })
    expect(
      leafStrings(zhCN).filter((value) => value.includes("技能中心"))
    ).toEqual([])
    expect(
      leafStrings(enUS).filter((value) => /Skill Center/iu.test(value))
    ).toEqual([])
  })

  it("uses audit log terminology in navigation and page titles", () => {
    expect(zhCN.nav.audit).toBe("审计日志")
    expect(zhCN.settings.auditDescription).toBe("查询跨用户审计日志")
    expect(zhCN.admin.auditTitle).toBe("审计日志")
    expect(enUS.nav.audit).toBe("Audit logs")
    expect(enUS.settings.auditDescription).toBe("Query cross-user audit logs")
    expect(enUS.admin.auditTitle).toBe("Audit logs")
    expect(zhCN.admin.auditDetailsTitle).toBe("审计日志详情")
    expect(enUS.admin.auditDetailsTitle).toBe("Audit log details")
    expect(zhCN.admin.auditConversationDetailsTitle).toBe("任务执行详情")
    expect(enUS.admin.auditConversationDetailsTitle).toBe(
      "Task execution details"
    )
    expect(zhCN.admin.retainedArtifactDetailsTitle).toBe("已删除任务产物详情")
    expect(enUS.admin.retainedArtifactDetailsTitle).toBe(
      "Deleted-task artifact details"
    )
  })

  it("keeps the publication review notice neutral in both languages", () => {
    expect(zhCN.marketplace.reviewPolicyNotice).toBe(
      "每一个新发布都必须重新审核；审核通过后不会自动更新已有安装。"
    )
    expect(enUS.marketplace.reviewPolicyNotice).toBe(
      "Every new release is reviewed again. Approved releases never auto-update existing installations."
    )
  })

  it("uses model channels as the managed concept while keeping Base URL as a channel field", () => {
    expect(zhCN.admin.modelProvider.providers).toBe("模型渠道列表")
    expect(zhCN.admin.modelTabs.imageGeneration).toBe("图片生成模型")
    expect(zhCN.admin.modelProvider.addProvider).toBe("添加模型渠道")
    expect(zhCN.admin.modelProvider.providerTitle).toBe("模型渠道 {{index}}")
    expect(zhCN.admin.modelProvider.providerName).toBe("渠道名称")
    expect(zhCN.admin.modelProvider.renameProviderTitle).toBe("重命名模型渠道")
    expect(zhCN.admin.modelProvider.showInComposer).toBe("对话可选")
    expect(zhCN.admin.modelProvider.selectedEfforts).toBe("已选择 {{count}} 项")
    expect(zhCN.admin.modelProvider.baseUrl).toBe("Base URL")
    expect(zhCN.admin.modelProvider.apiKey).toBe("API_KEY")
    expect(zhCN.admin.modelProvider.apiKeyConfiguredHint).toBe(
      "密钥已安全保存。只有需要更换时才输入新密钥。"
    )
    expect(zhCN.admin.modelProvider.titleModel).toBe("任务自动命名模型")
    expect(zhCN.admin.imageGeneration.title).toBe("图片生成模型")
    expect(zhCN.admin.imageGeneration.providers.alibaba_bailian).toBe(
      "阿里云百炼"
    )
    expect(zhCN.usage.workloads.task_title_generation).toBe("任务自动命名")
    expect(zhCN.usage.workloads.image_generation).toBe("图片生成")
    expect(zhCN.usage.modelKinds.image).toBe("图片模型")
    expect(zhCN.errors.lastModelRequired).toBe(
      "至少需要保留一个“对话可选”的对话模型。"
    )
    expect(enUS.admin.modelProvider.providers).toBe("Model channels")
    expect(enUS.admin.modelTabs.imageGeneration).toBe("Image generation model")
    expect(enUS.admin.modelProvider.addProvider).toBe("Add model channel")
    expect(enUS.admin.modelProvider.providerTitle).toBe(
      "Model channel {{index}}"
    )
    expect(enUS.admin.modelProvider.providerName).toBe("Channel name")
    expect(enUS.admin.modelProvider.renameProviderTitle).toBe(
      "Rename model channel"
    )
    expect(enUS.admin.modelProvider.showInComposer).toBe(
      "Available in conversations"
    )
    expect(enUS.admin.modelProvider.selectedEfforts).toBe("{{count}} selected")
    expect(enUS.admin.modelProvider.baseUrl).toBe("Base URL")
    expect(enUS.admin.modelProvider.apiKey).toBe("API_KEY")
    expect(enUS.admin.modelProvider.apiKeyConfiguredHint).toBe(
      "The key is stored securely. Enter a new key only when replacing it."
    )
    expect(enUS.admin.modelProvider.titleModel).toBe("Task auto-naming model")
    expect(enUS.admin.imageGeneration.title).toBe("Image generation model")
    expect(enUS.admin.imageGeneration.providers.alibaba_bailian).toBe(
      "Alibaba Cloud Bailian"
    )
    expect(zhCN.admin.modelProvider.supportsImageInput).toBe("支持图片理解")
    expect(enUS.admin.modelProvider.supportsImageInput).toBe(
      "Supports image understanding"
    )
    expect(enUS.usage.workloads.task_title_generation).toBe("Task auto naming")
    expect(enUS.usage.workloads.image_generation).toBe("Image generation")
    expect(enUS.usage.modelKinds.image).toBe("Image model")
    expect(enUS.errors.lastModelRequired).toBe(
      "At least one chat model must remain available in conversations."
    )
  })

  it("uses an ellipsis for page-loading labels", () => {
    expect(zhCN.common.pageLoading).toBe("正在加载…")
    expect(enUS.common.pageLoading).toBe("Loading…")
  })

  it("localizes session restoration failures", () => {
    expect(zhCN.auth.sessionRestoreFailed).toBe(
      "登录状态恢复失败，请检查网络后重试。"
    )
    expect(enUS.auth.sessionRestoreFailed).toBe(
      "Your sign-in session could not be restored. Check your connection and try again."
    )
  })

  it("uses title case for shared English action labels", () => {
    expect(enUS.common.gotIt).toBe("Got It")
    expect(enUS.common.signOut).toBe("Sign Out")
    expect(enUS.common.more).toBe("More Actions")
    expect(enUS.conversation.goal.details).toBe("View Goal Details")
  })

  it("localizes the user group multi-select in both languages", () => {
    expect(zhCN.admin.members).toBe("成员数")
    expect(zhCN.admin.groupMembersEmpty).toBe("该用户组暂无成员。")
    expect(zhCN.admin.selectGroups).toBe("选择用户组")
    expect(zhCN.admin.searchGroups).toBe("搜索用户组")
    expect(zhCN.admin.groupSearchEmpty).toBe("未找到匹配的用户组。")
    expect(enUS.admin.selectGroups).toBe("Select user groups")
    expect(enUS.admin.searchGroups).toBe("Search user groups")
    expect(enUS.admin.groupSearchEmpty).toBe("No matching user groups found.")
    expect(enUS.admin.members).toBe("Members")
    expect(enUS.admin.groupMembersEmpty).toBe("This user group has no members.")
  })

  it("localizes the combined groups and users management surface", () => {
    expect(zhCN.nav.usersAndGroups).toBe("用户与用户组")
    expect(zhCN.settings.usersAndGroupsDescription).toBe(
      "管理用户账号、角色、状态和用户组成员"
    )
    expect(zhCN.admin.usersAndGroupsTitle).toBe("用户与用户组")
    expect(zhCN.admin.usersAndGroupsTabsLabel).toBe("用户与用户组管理")
    expect(enUS.nav.usersAndGroups).toBe("Users & groups")
    expect(enUS.settings.usersAndGroupsDescription).toBe(
      "Manage user accounts, roles, status, and group membership"
    )
    expect(enUS.admin.usersAndGroupsTitle).toBe("Users & groups")
    expect(enUS.admin.usersAndGroupsTabsLabel).toBe(
      "Users and groups management"
    )
  })

  it("uses explicit navigation names for plugin credentials and archived tasks", () => {
    expect(zhCN.settings.credentials).toBe("插件凭据")
    expect(zhCN.credential.title).toBe("插件凭据")
    expect(zhCN.nav.archived).toBe("已归档任务")
    expect(zhCN.conversation.clearArchived).toBe("清除全部")
    expect(zhCN.conversation.archivedTaskCount_one).toBe("{{count}} 个任务")
    expect(zhCN.conversation.archivedTaskCount_other).toBe("{{count}} 个任务")
    expect(zhCN.conversation.unarchiveNamed).toContain("{{title}}")
    expect(zhCN.conversation.searchTitle).toBe("搜索")
    expect(zhCN.conversation.searchEmpty).toBe("没有找到结果")
    expect(zhCN.conversation.clearArchivedDescription).toContain(
      "未归档任务不受影响"
    )
    expect(zhCN.conversation.clearingArchived).toBe("正在清除已归档任务…")
    expect(enUS.settings.credentials).toBe("Plugin credentials")
    expect(enUS.credential.title).toBe("Plugin credentials")
    expect(enUS.nav.archived).toBe("Archived tasks")
    expect(enUS.conversation.clearArchived).toBe("Clear all")
    expect(enUS.conversation.archivedTaskCount_one).toBe("{{count}} task")
    expect(enUS.conversation.archivedTaskCount_other).toBe("{{count}} tasks")
    expect(enUS.conversation.unarchiveNamed).toContain("{{title}}")
    expect(enUS.conversation.searchTitle).toBe("Search")
    expect(enUS.conversation.searchEmpty).toBe("No results found")
    expect(enUS.conversation.clearArchivedDescription).toContain(
      "Active tasks are not affected"
    )
    expect(enUS.conversation.clearingArchived).toBe("Clearing archived tasks…")
  })

  it("localizes desktop sidebar and automation notification controls", () => {
    expect(zhCN.nav.automations).toBe("自动化")
    expect(enUS.nav.automations).toBe("Automations")
    expect(zhCN.nav.knowledgeBases).toBe("资料库")
    expect(enUS.nav.knowledgeBases).toBe("Resource library")
    expect(zhCN.library.title).toBe("资料库")
    expect(enUS.library.title).toBe("Resource library")
    expect(zhCN.library.tabsLabel).toBe("资料库内容")
    expect(enUS.library.tabsLabel).toBe("Resource library content")
    expect(i18n.getFixedT("fr-FR")("nav.knowledgeBases")).toBe("资料库")
    expect(i18n.getFixedT("fr-FR")("library.title")).toBe("资料库")
    expect(i18n.getFixedT("fr-FR")("library.tabsLabel")).toBe("资料库内容")
    expect(zhCN.library.tabs.artifacts).toBe("任务产物")
    expect(enUS.library.tabs.artifacts).toBe("Task artifacts")
    expect(zhCN.library.artifacts.loadingMore).toBe("正在加载更多…")
    expect(enUS.library.artifacts.loadingMore).toBe("Loading more…")
    expect(zhCN.nav.helpCenter).toBe("帮助中心")
    expect(zhCN.nav.helpCenterNewTab).toBe("在新标签页打开帮助中心")
    expect(enUS.nav.helpCenter).toBe("Help Center")
    expect(enUS.nav.helpCenterNewTab).toBe("Open Help Center in a new tab")
    expect(zhCN.support.menuLabel).toBe("反馈与帮助")
    expect(zhCN.support.feedbackTitle).toBe("提交反馈")
    expect(zhCN.support.feedbackPlaceholder).toBe(
      "描述你的反馈，或直接粘贴文本及图片…"
    )
    expect(enUS.support.menuLabel).toBe("Feedback and help")
    expect(enUS.support.feedbackTitle).toBe("Submit feedback")
    expect(enUS.support.feedbackPlaceholder).toBe(
      "Describe your feedback or paste text and images…"
    )
    expect(zhCN.nav.feedback).toBe("用户反馈")
    expect(enUS.nav.feedback).toBe("User feedback")
    expect(zhCN.support.feedbackImagesHint).toContain("{{count}}")
    expect(enUS.support.feedbackImagesHint).toContain("PNG")
    expect(zhCN.adminFeedback.deleteLabel).toContain("{{name}}")
    expect(zhCN.adminFeedback.deleteDescription).toContain("无法撤销")
    expect(enUS.adminFeedback.deleteLabel).toContain("{{name}}")
    expect(enUS.adminFeedback.deleteDescription).toContain("cannot be undone")
    expect(zhCN.automation.newTaskHint).toContain("只创建一次")
    expect(enUS.automation.newTaskHint).toContain("created and pinned once")
    expect(zhCN.automation.runNowLoading).toBe("正在执行自动化…")
    expect(enUS.automation.runNowLoading).toBe("Running automation…")
    expect(zhCN.nav.collapseSidebar).toBe("折叠侧边栏")
    expect(zhCN.nav.expandSidebar).toBe("展开侧边栏")
    expect(enUS.nav.collapseSidebar).toBe("Collapse sidebar")
    expect(enUS.nav.expandSidebar).toBe("Expand sidebar")
    expect(zhCN.nav.automationNotifications).toBe("自动化通知")
    expect(zhCN.nav.automationNotificationsUnread).toContain("未读任务")
    expect(enUS.nav.automationNotifications).toBe("Automation notifications")
    expect(enUS.nav.automationNotificationsUnread).toContain("unread")
    expect(zhCN.nav.unreadCompletion).toBe("任务已完成，尚未查看")
    expect(enUS.nav.unreadCompletion).toBe("Task completed and not yet viewed")
    expect(zhCN.nav.unreadFailure).toBe("任务执行失败，尚未查看")
    expect(enUS.nav.unreadFailure).toBe("Task failed and has not been viewed")
  })

  it("localizes the sign-out confirmation", () => {
    expect(zhCN.auth.signOutTitle).toBe("退出登录？")
    expect(zhCN.auth.signOutDescription).toContain("{{productName}}")
    expect(enUS.auth.signOutTitle).toBe("Sign out?")
    expect(enUS.auth.signOutDescription).toContain("{{productName}}")
  })

  it("localizes the searchable knowledge sharing multi-select", () => {
    expect(zhCN.knowledge.share.searchUserPlaceholder).toBe(
      "搜索用户名称或邮箱…"
    )
    expect(zhCN.knowledge.share.searchGroupPlaceholder).toBe("搜索用户组名称…")
    expect(zhCN.knowledge.share.removeTarget).toBe("移除共享对象 {{name}}")
    expect(enUS.knowledge.share.searchUserPlaceholder).toBe(
      "Search users by name or email…"
    )
    expect(enUS.knowledge.share.searchGroupPlaceholder).toBe(
      "Search user groups by name…"
    )
    expect(enUS.knowledge.share.removeTarget).toBe("Remove recipient {{name}}")
  })

  it("localizes knowledge folder expansion controls", () => {
    expect(zhCN.knowledge.directory.expandFolder).toBe("展开目录 {{name}}")
    expect(zhCN.knowledge.directory.collapseFolder).toBe("收起目录 {{name}}")
    expect(enUS.knowledge.directory.expandFolder).toBe("Expand folder {{name}}")
    expect(enUS.knowledge.directory.collapseFolder).toBe(
      "Collapse folder {{name}}"
    )
    expect(zhCN.knowledge.directory.showFolders).toBe("显示目录")
    expect(enUS.knowledge.directory.showFolders).toBe("Show folders")
  })

  it("localizes knowledge-base source labels", () => {
    expect(zhCN.knowledge.sourceType.label).toBe("来源：{{source}}")
    expect(zhCN.knowledge.sourceType.local).toBe("本地")
    expect(zhCN.knowledge.sourceType.sharepoint).toBe("SharePoint")
    expect(enUS.knowledge.sourceType.label).toBe("Source: {{source}}")
    expect(enUS.knowledge.sourceType.local).toBe("Local")
    expect(enUS.knowledge.sourceType.sharepoint).toBe("SharePoint")
    expect(zhCN.knowledge.create.syncFrequency).toEqual({
      daily: "每天",
      weekly: "每周",
      monthly: "每月",
    })
    expect(enUS.knowledge.create.syncFrequency).toEqual({
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
    })
    expect(zhCN.knowledge.create.syncWeekdayLabel).toBe("星期")
    expect(enUS.knowledge.create.syncWeekdayLabel).toBe("Weekday")
    expect(zhCN.knowledge.create.syncTimeZone).toContain("{{timeZone}}")
    expect(enUS.knowledge.create.syncTimeZone).toContain("{{timeZone}}")
  })

  it("uses task-oriented composer placeholder copy in both languages", () => {
    expect(zhCN.conversation.placeholder).toBe(
      "描述你希望 {{productName}} 完成的任务…"
    )
    expect(enUS.conversation.placeholder).toBe(
      "Describe what you want {{productName}} to do…"
    )
    expect(
      i18n.t("conversation.placeholder", {
        lng: "zh-CN",
        productName: "MOSS",
      })
    ).toBe("描述你希望 MOSS 完成的任务…")
    expect(
      i18n.t("conversation.placeholder", {
        lng: "en-US",
        productName: "MOSS",
      })
    ).toBe("Describe what you want MOSS to do…")
  })

  it("localizes Markdown table controls in both languages", () => {
    expect(zhCN.conversation.copyCode).toBe("复制代码")
    expect(zhCN.conversation.copyTable).toBe("复制表格")
    expect(zhCN.conversation.tableScrollHint).toBe("左右滑动查看完整内容")
    expect(zhCN.conversation.expandTable).toBe("放大查看表格")
    expect(zhCN.conversation.tableDialogTitle).toBe("完整表格")
    expect(enUS.conversation.copyCode).toBe("Copy code")
    expect(enUS.conversation.copyTable).toBe("Copy table")
    expect(enUS.conversation.tableScrollHint).toBe(
      "Scroll sideways to see the full table"
    )
    expect(enUS.conversation.expandTable).toBe("Open table in a larger view")
    expect(enUS.conversation.tableDialogTitle).toBe("Full table")
  })

  it("localizes the inline HTML generation hint", () => {
    expect(zhCN.conversation.inlineHtmlPreview.generatingHint).toBe(
      "正在生成中，可能需要一些时间"
    )
    expect(enUS.conversation.inlineHtmlPreview.generatingHint).toBe(
      "Generating now, this may take a little while"
    )
  })

  it("keeps reconnect progress localized and the exhausted error text stable", () => {
    expect(zhCN.conversation.activities.reconnectingAttempt).toBe(
      "正在重新连接 {{attempt}}/{{total}}"
    )
    expect(enUS.conversation.activities.reconnectingAttempt).toBe(
      "Reconnecting {{attempt}}/{{total}}"
    )
    expect(zhCN.conversation.streamDisconnectedBeforeCompletion).toBe(
      "stream disconnected before completion."
    )
    expect(enUS.conversation.streamDisconnectedBeforeCompletion).toBe(
      "stream disconnected before completion."
    )
    expect(zhCN.conversation.streamDisconnectedWarning).toBe(
      "任务因流连接中断而终止"
    )
    expect(enUS.conversation.streamDisconnectedWarning).toBe(
      "Task stopped because the response stream disconnected"
    )
  })

  it("uses generic public terminology instead of school-limited wording", () => {
    expect(
      leafStrings(zhCN).filter((value) =>
        /(学校|全校|校园|校级|校方|校内|校外|院校)/u.test(value)
      )
    ).toEqual([])
    expect(
      leafStrings(enUS).filter((value) =>
        /\b(?:school|school-wide|campus|campuses)\b/iu.test(value)
      )
    ).toEqual([])
  })

  it("localizes the supported reasoning levels and falls back to zh-CN", async () => {
    expect(zhCN.reasoningEffort.low).toBe("轻量")
    expect(zhCN.reasoningEffort.max).toBe("最高")
    expect(zhCN.reasoningEffort.ultra).toBe("极致")
    expect(enUS.reasoningEffort.low).toBe("Light")
    expect(enUS.reasoningEffort.max).toBe("Max")
    expect(enUS.reasoningEffort.ultra).toBe("Ultra")

    await i18n.changeLanguage("fr-FR")
    expect(i18n.t("reasoningEffort.ultra")).toBe("极致")
    await i18n.changeLanguage("zh-CN")
  })

  it("falls back to zh-CN for a missing English key", async () => {
    await i18n.changeLanguage("en-US")
    i18n.addResource("zh-CN", "translation", "test.fallbackOnly", "中文兜底")
    expect(i18n.t("test.fallbackOnly")).toBe("中文兜底")
  })
})
