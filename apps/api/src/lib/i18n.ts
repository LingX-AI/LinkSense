import { createInstance } from "i18next";
import {
  auditFlatTranslations,
  errorCatalog,
  localizedErrorMessage,
  supportedLocales,
  type ErrorCode,
  type Locale,
} from "@linksense/shared";
import { backendMessages as esMessages } from "./locales/es-ES.js";
import { backendMessages as ptMessages } from "./locales/pt-BR.js";
import { backendMessages as frMessages } from "./locales/fr-FR.js";
import { backendMessages as jaMessages } from "./locales/ja-JP.js";
import { supplementalBackendMessages } from "./locales/supplemental.js";

type SourceLocale = "zh-CN" | "en-US";

const translations = (locale: Locale) =>
  Object.fromEntries(
    (Object.keys(errorCatalog) as ErrorCode[]).map((code) => [
      errorCatalog[code].message_key,
      localizedErrorMessage(code, locale),
    ]),
  );

const mailTranslations: Record<SourceLocale, Record<string, string>> = {
  "zh-CN": {
    "mail.socialVerification.subject": "验证您的注册邮箱",
    "mail.socialVerification.text": "请在发起注册的同一浏览器中打开以下链接，确认邮箱并完成社交账号注册。链接 15 分钟内有效；如非本人操作，请忽略。\n\n{{url}}",
    "mail.passwordReset.subject": "设置或重置 {{productName}} 密码",
    "mail.passwordReset.preheader":
      "使用安全的一次性链接设置或重置您的 {{productName}} 密码。",
    "mail.passwordReset.eyebrow": "账号安全",
    "mail.passwordReset.title": "设置或重置密码",
    "mail.passwordReset.greeting": "您好，",
    "mail.passwordReset.greetingNamed": "{{name}}，您好：",
    "mail.passwordReset.intro":
      "我们收到了为您的 {{productName}} 账号设置或重置密码的请求。点击下方按钮继续。",
    "mail.passwordReset.action": "设置或重置密码",
    "mail.passwordReset.expiry":
      "此安全链接将在 {{minutes}} 分钟后失效，并且只能使用一次。",
    "mail.passwordReset.fallback":
      "如果按钮无法打开，请复制下面的安全链接并粘贴到浏览器中：",
    "mail.passwordReset.securityTitle": "不是您本人操作？",
    "mail.passwordReset.securityBody":
      "您可以安全地忽略这封邮件，账号密码不会发生变化。{{productName}} 不会通过邮件向您索要密码。",
    "mail.passwordReset.automated":
      "这是一封由 {{productName}} 自动发送的账号安全邮件，请勿直接回复。",
    "mail.registration.subject": "激活您的 {{productName}} 账号",
    "mail.registration.preheader":
      "使用安全的一次性链接激活您的 {{productName}} 账号。",
    "mail.registration.eyebrow": "账号激活",
    "mail.registration.title": "完成账号注册",
    "mail.registration.greeting": "您好，",
    "mail.registration.greetingNamed": "{{name}}，您好：",
    "mail.registration.intro":
      "我们收到了使用此邮箱注册 {{productName}} 的请求。点击下方按钮设置登录密码并激活账号。",
    "mail.registration.action": "设置密码并激活账号",
    "mail.registration.expiry":
      "此激活链接将在 {{minutes}} 分钟后失效，并且只能使用一次。",
    "mail.registration.fallback":
      "如果按钮无法打开，请复制下面的激活链接并粘贴到浏览器中：",
    "mail.registration.securityTitle": "不是您本人操作？",
    "mail.registration.securityBody":
      "您可以安全地忽略这封邮件，系统不会创建账号。{{productName}} 不会通过邮件向您索要密码。",
    "mail.registration.automated":
      "这是一封由 {{productName}} 自动发送的账号激活邮件，请勿直接回复。",
  },
  "en-US": {
    "mail.socialVerification.subject": "Verify your registration email",
    "mail.socialVerification.text": "Open this link in the browser where you started signing up to verify your email and finish social sign-up. It expires in 15 minutes. Ignore this message if you did not request it.\n\n{{url}}",
    "mail.passwordReset.subject": "Set or reset your {{productName}} password",
    "mail.passwordReset.preheader":
      "Use a secure one-time link to set or reset your {{productName}} password.",
    "mail.passwordReset.eyebrow": "ACCOUNT SECURITY",
    "mail.passwordReset.title": "Set or reset your password",
    "mail.passwordReset.greeting": "Hello,",
    "mail.passwordReset.greetingNamed": "Hello {{name}},",
    "mail.passwordReset.intro":
      "We received a request to set or reset the password for your {{productName}} account. Use the button below to continue.",
    "mail.passwordReset.action": "Set or reset password",
    "mail.passwordReset.expiry":
      "This secure link expires in {{minutes}} minutes and can only be used once.",
    "mail.passwordReset.fallback":
      "If the button does not open, copy and paste this secure link into your browser:",
    "mail.passwordReset.securityTitle": "Didn't request this?",
    "mail.passwordReset.securityBody":
      "You can safely ignore this email and your password will stay unchanged. {{productName}} will never ask for your password by email.",
    "mail.passwordReset.automated":
      "This automated account security email was sent by {{productName}}. Please do not reply.",
    "mail.registration.subject": "Activate your {{productName}} account",
    "mail.registration.preheader":
      "Use a secure one-time link to activate your {{productName}} account.",
    "mail.registration.eyebrow": "ACCOUNT ACTIVATION",
    "mail.registration.title": "Finish creating your account",
    "mail.registration.greeting": "Hello,",
    "mail.registration.greetingNamed": "Hello {{name}},",
    "mail.registration.intro":
      "We received a request to register this email with {{productName}}. Use the button below to set your sign-in password and activate the account.",
    "mail.registration.action": "Set password and activate account",
    "mail.registration.expiry":
      "This activation link expires in {{minutes}} minutes and can only be used once.",
    "mail.registration.fallback":
      "If the button does not open, copy and paste this activation link into your browser:",
    "mail.registration.securityTitle": "Didn't request this?",
    "mail.registration.securityBody":
      "You can safely ignore this email and no account will be created. {{productName}} will never ask for your password by email.",
    "mail.registration.automated":
      "This automated account activation email was sent by {{productName}}. Please do not reply.",
  },
};

const usageExportTranslations: Record<SourceLocale, Record<string, string>> = {
  "zh-CN": {
    "usageExport.workbookTitle": "{{productName}} 用量统计",
    "usageExport.filename": "{{productPrefix}}-用量统计.xlsx",
    "usageExport.sheets.summary": "概览",
    "usageExport.sheets.trend": "趋势",
    "usageExport.sheets.models": "按模型",
    "usageExport.sheets.workloads": "按用途",
    "usageExport.sheets.applications": "按应用",
    "usageExport.sheets.applicationModels": "应用模型明细",
    "usageExport.sheets.groups": "按用户组",
    "usageExport.sheets.groupModels": "用户组模型明细",
    "usageExport.sheets.users": "按用户",
    "usageExport.sheets.userModels": "用户模型明细",
    "usageExport.fields.period": "统计周期",
    "usageExport.fields.periodStart": "周期开始",
    "usageExport.fields.dateFrom": "开始时间",
    "usageExport.fields.dateTo": "结束时间",
    "usageExport.fields.timeZone": "时区",
    "usageExport.fields.generatedAt": "生成时间",
    "usageExport.fields.tokenCoverageStartedAt": "Token 统计开始时间",
    "usageExport.fields.tasks": "任务数",
    "usageExport.fields.turns": "轮次数",
    "usageExport.fields.requests": "模型调用数",
    "usageExport.fields.totalTokens": "总 Token",
    "usageExport.fields.inputTokens": "输入 Token",
    "usageExport.fields.cachedInputTokens": "缓存输入 Token",
    "usageExport.fields.outputTokens": "输出 Token",
    "usageExport.fields.reasoningOutputTokens": "推理输出 Token",
    "usageExport.fields.totalCost": "总费用",
    "usageExport.fields.inputCost": "输入费用",
    "usageExport.fields.cachedInputCost": "缓存输入费用",
    "usageExport.fields.outputCost": "输出费用",
    "usageExport.fields.unpricedTokens": "未计价 Token",
    "usageExport.fields.model": "模型",
    "usageExport.fields.modelId": "模型 ID",
    "usageExport.fields.modelKind": "模型类型",
    "usageExport.fields.workloads": "用途",
    "usageExport.fields.measurementMethods": "统计方式",
    "usageExport.fields.workload": "模型用途",
    "usageExport.fields.application": "应用",
    "usageExport.fields.group": "用户组",
    "usageExport.fields.memberCount": "成员数",
    "usageExport.fields.user": "用户",
    "usageExport.fields.email": "邮箱",
    "usageExport.fields.role": "角色",
    "usageExport.fields.status": "状态",
    "usageExport.fields.groups": "所属用户组",
    "usageExport.modelKinds.generation": "生成模型",
    "usageExport.modelKinds.image": "图片模型",
    "usageExport.modelKinds.embedding": "嵌入模型",
    "usageExport.modelKinds.rerank": "重排模型",
    "usageExport.workloads.assistant_response": "AI 回答",
    "usageExport.workloads.memory_generation": "记忆生成",
    "usageExport.workloads.task_title_generation": "任务自动命名",
    "usageExport.workloads.document_embedding": "文档向量化",
    "usageExport.workloads.query_embedding": "查询向量化",
    "usageExport.workloads.rerank": "检索重排",
    "usageExport.workloads.image_generation": "图片生成",
    "usageExport.measurementMethods.provider": "供应商返回",
    "usageExport.measurementMethods.estimated": "本地估算",
    "usageExport.roles.user": "普通用户",
    "usageExport.roles.admin": "管理员",
    "usageExport.statuses.active": "启用",
    "usageExport.statuses.disabled": "停用",
    "usageExport.ungrouped": "未分组用户",
    "usageExport.unattributedApplication": "未关联应用",
    "usageExport.allTime": "全部时间",
    "usageExport.ranges.sevenDays": "最近 7 天",
    "usageExport.ranges.thirtyDays": "最近 30 天",
    "usageExport.notAvailable": "不适用",
    "usageExport.notes.groupSemantics":
      "用户组按当前有效成员关系统计；同一用户可能属于多个用户组，因此用户组行不能相加得到全局总量。",
    "usageExport.notes.cost":
      "费用以调用时固化的历史价格为准。明细金额按分分摊，确保同一合计下显示的两位小数明细之和等于显示合计；未计价 Token 不计入费用。",
    "usageExport.notes.tokenComposition":
      "缓存输入 Token 是输入 Token 的子集，推理输出 Token 是输出 Token 的子集，均不会重复计入总 Token。",
  },
  "en-US": {
    "usageExport.workbookTitle": "{{productName}} Usage analytics",
    "usageExport.filename": "{{productPrefix}}-usage-analytics.xlsx",
    "usageExport.sheets.summary": "Summary",
    "usageExport.sheets.trend": "Trend",
    "usageExport.sheets.models": "By model",
    "usageExport.sheets.workloads": "By workload",
    "usageExport.sheets.applications": "By application",
    "usageExport.sheets.applicationModels": "Application model detail",
    "usageExport.sheets.groups": "By group",
    "usageExport.sheets.groupModels": "Group model detail",
    "usageExport.sheets.users": "By user",
    "usageExport.sheets.userModels": "User model detail",
    "usageExport.fields.period": "Reporting period",
    "usageExport.fields.periodStart": "Period start",
    "usageExport.fields.dateFrom": "Start time",
    "usageExport.fields.dateTo": "End time",
    "usageExport.fields.timeZone": "Time zone",
    "usageExport.fields.generatedAt": "Generated at",
    "usageExport.fields.tokenCoverageStartedAt": "Token coverage started at",
    "usageExport.fields.tasks": "Tasks",
    "usageExport.fields.turns": "Turns",
    "usageExport.fields.requests": "Model calls",
    "usageExport.fields.totalTokens": "Total tokens",
    "usageExport.fields.inputTokens": "Input tokens",
    "usageExport.fields.cachedInputTokens": "Cached input tokens",
    "usageExport.fields.outputTokens": "Output tokens",
    "usageExport.fields.reasoningOutputTokens": "Reasoning output tokens",
    "usageExport.fields.totalCost": "Total cost",
    "usageExport.fields.inputCost": "Input cost",
    "usageExport.fields.cachedInputCost": "Cached input cost",
    "usageExport.fields.outputCost": "Output cost",
    "usageExport.fields.unpricedTokens": "Unpriced tokens",
    "usageExport.fields.model": "Model",
    "usageExport.fields.modelId": "Model ID",
    "usageExport.fields.modelKind": "Model type",
    "usageExport.fields.workloads": "Workloads",
    "usageExport.fields.measurementMethods": "Measurement",
    "usageExport.fields.workload": "Model workload",
    "usageExport.fields.application": "Application",
    "usageExport.fields.group": "User group",
    "usageExport.fields.memberCount": "Members",
    "usageExport.fields.user": "User",
    "usageExport.fields.email": "Email",
    "usageExport.fields.role": "Role",
    "usageExport.fields.status": "Status",
    "usageExport.fields.groups": "User groups",
    "usageExport.modelKinds.generation": "Generation model",
    "usageExport.modelKinds.image": "Image model",
    "usageExport.modelKinds.embedding": "Embedding model",
    "usageExport.modelKinds.rerank": "Rerank model",
    "usageExport.workloads.assistant_response": "AI responses",
    "usageExport.workloads.memory_generation": "Memory generation",
    "usageExport.workloads.task_title_generation": "Task auto naming",
    "usageExport.workloads.document_embedding": "Document embeddings",
    "usageExport.workloads.query_embedding": "Query embeddings",
    "usageExport.workloads.rerank": "Retrieval reranking",
    "usageExport.workloads.image_generation": "Image generation",
    "usageExport.measurementMethods.provider": "Provider reported",
    "usageExport.measurementMethods.estimated": "Locally estimated",
    "usageExport.roles.user": "User",
    "usageExport.roles.admin": "Administrator",
    "usageExport.statuses.active": "Active",
    "usageExport.statuses.disabled": "Disabled",
    "usageExport.ungrouped": "Ungrouped users",
    "usageExport.unattributedApplication": "Not linked to an application",
    "usageExport.allTime": "All time",
    "usageExport.ranges.sevenDays": "Last 7 days",
    "usageExport.ranges.thirtyDays": "Last 30 days",
    "usageExport.notAvailable": "Not applicable",
    "usageExport.notes.groupSemantics":
      "Groups use current active membership. A user may belong to multiple groups, so group rows cannot be added together to derive the global total.",
    "usageExport.notes.cost":
      "Costs use prices captured when calls were recorded. Detail amounts are allocated to cents so displayed two-decimal details add up to their displayed total. Unpriced tokens are excluded from cost.",
    "usageExport.notes.tokenComposition":
      "Cached input tokens are a subset of input tokens, and reasoning output tokens are a subset of output tokens. Neither is added to total tokens again.",
  },
};

const userImportTranslations: Record<SourceLocale, Record<string, string>> = {
  "zh-CN": {
    "userImport.filename": "用户导入模板.xlsx",
    "userImport.sheets.import": "用户导入",
    "userImport.sheets.instructions": "填写说明",
    "userImport.headers.name": "姓名",
    "userImport.headers.email": "邮箱",
    "userImport.headers.role": "角色",
    "userImport.headers.userGroups": "用户组",
    "userImport.instructions.title": "用户导入模板填写说明",
    "userImport.instructions.intro":
      "请先阅读本页的字段说明和示范数据，再到“用户导入”工作表从第 2 行开始填写。请勿修改或新增表头；本页示范数据不会参与导入。",
    "userImport.instructions.field": "字段",
    "userImport.instructions.required": "是否必填",
    "userImport.instructions.example": "示例",
    "userImport.instructions.description": "填写说明",
    "userImport.instructions.yes": "是",
    "userImport.instructions.no": "否",
    "userImport.instructions.examplesTitle":
      "示范数据（仅供参考，不会参与导入）",
    "userImport.instructions.passwordNote":
      "安全说明：模板不包含密码、临时密码或密码哈希字段；系统也不会从导入文件中接收这些信息。",
    "userImport.fields.name.description": "用户显示名称，不能为空。",
    "userImport.fields.email.description": "必须填写唯一且格式有效的邮箱地址。",
    "userImport.fields.role.description":
      "仅支持 user（普通用户）或 admin（管理员）。",
    "userImport.fields.userGroups.description":
      "填写系统中已存在的用户组名称；多个用户组使用英文分号 ; 分隔，留空表示不加入用户组。",
    "userImport.examples.name": "张三",
    "userImport.examples.adminName": "李华",
    "userImport.examples.groups": "IT 部门;研发组",
    "userImport.validation.roleTitle": "角色填写错误",
    "userImport.validation.roleMessage": "角色只能填写 user 或 admin。",
  },
  "en-US": {
    "userImport.filename": "user-import-template.xlsx",
    "userImport.sheets.import": "User Import",
    "userImport.sheets.instructions": "Instructions",
    "userImport.headers.name": "Name",
    "userImport.headers.email": "Email",
    "userImport.headers.role": "Role",
    "userImport.headers.userGroups": "User groups",
    "userImport.instructions.title": "User import template instructions",
    "userImport.instructions.intro":
      "Review the field guidance and sample data on this sheet, then enter users from row 2 of the User Import sheet. Do not change or add headers. Samples on this sheet are never imported.",
    "userImport.instructions.field": "Field",
    "userImport.instructions.required": "Required",
    "userImport.instructions.example": "Example",
    "userImport.instructions.description": "How to fill it in",
    "userImport.instructions.yes": "Yes",
    "userImport.instructions.no": "No",
    "userImport.instructions.examplesTitle":
      "Sample data (for reference only; never imported)",
    "userImport.instructions.passwordNote":
      "Security note: the template has no password, temporary-password, or password-hash field, and the system does not accept these values from import files.",
    "userImport.fields.name.description":
      "The user's display name. This field cannot be blank.",
    "userImport.fields.email.description":
      "Enter a unique, valid email address.",
    "userImport.fields.role.description":
      "Use only user (standard user) or admin (administrator).",
    "userImport.fields.userGroups.description":
      "Enter existing user-group names. Separate multiple groups with a semicolon (;), or leave blank for no group.",
    "userImport.examples.name": "Alex Chen",
    "userImport.examples.adminName": "Morgan Lee",
    "userImport.examples.groups": "IT;Research",
    "userImport.validation.roleTitle": "Invalid role",
    "userImport.validation.roleMessage": "Role must be user or admin.",
  },
};

const feishuTranslations: Record<SourceLocale, Record<string, string>> = {
  "zh-CN": {
    "feishu.personalAgent.name": "LinkSense 个人助手",
    "feishu.personalAgent.description":
      "由 LinkSense 自动创建，仅处理创建者在飞书中发送的私聊文本消息。",
  },
  "en-US": {
    "feishu.personalAgent.name": "LinkSense Personal Assistant",
    "feishu.personalAgent.description":
      "Created by LinkSense and limited to direct text messages from its owner in Feishu.",
  },
};

const backendMessages = {
  "es-ES": esMessages,
  "pt-BR": ptMessages,
  "fr-FR": frMessages,
  "ja-JP": jaMessages,
} satisfies Record<Exclude<Locale, SourceLocale>, Record<string, string>>;

export const backendI18n = createInstance();

function backendTranslationResource(locale: Locale): Record<string, string> {
  if (locale !== "zh-CN" && locale !== "en-US") {
    return {
      ...translations(locale),
      ...backendMessages[locale],
      ...auditFlatTranslations(locale),
      ...supplementalBackendMessages[locale],
    };
  }
  const source = locale;
  const chinese = source === "zh-CN";
  const resource = {
    ...translations(locale),
    ...mailTranslations[source],
    ...usageExportTranslations[source],
    ...userImportTranslations[source],
    ...feishuTranslations[source],
    "webSitePage.notFoundTitle": chinese ? "站点未找到" : "Site not found",
    "webSitePage.notFoundDescription": chinese
      ? "站点可能已删除或取消发布，请检查链接后再试。"
      : "This site may have been deleted or unpublished. Please check the link and try again.",
    "applicationDevelopment.taskTitle": chinese
      ? "开发 {{name}}"
      : "Develop {{name}}",
    "botChannels.processingFailed": chinese
      ? "这条消息暂时无法处理，请在 LinkSense 中查看任务状态后重试。"
      : "This message could not be processed. Check the task status in LinkSense before retrying.",
    "botChannels.taskFailed": chinese
      ? "任务未能完成，请在 LinkSense 中查看详情。"
      : "The task could not be completed. Open LinkSense for details.",
    "botChannels.emptyResponse": chinese
      ? "任务已完成，但没有可发送的文本回复。"
      : "The task finished without a text response.",
    "botChannels.longResponse": chinese
      ? "回复内容较长，请打开 LinkSense 查看完整回答。"
      : "The response is long. Open LinkSense to view the complete answer.",
    ...auditFlatTranslations(locale),
    "audit.export.actorName": chinese ? "操作人名称" : "Actor Name",
    "audit.export.actorEmail": chinese ? "操作人邮箱" : "Actor Email",
  };
  return { ...resource, ...supplementalBackendMessages[locale] };
}

await backendI18n.init({
  initImmediate: false,
  fallbackLng: "zh-CN",
  supportedLngs: supportedLocales,
  keySeparator: false,
  interpolation: { escapeValue: false },
  resources: Object.fromEntries(
    supportedLocales.map((locale) => [
      locale,
      { translation: backendTranslationResource(locale) },
    ]),
  ),
});

export function translateError(
  code: ErrorCode,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  return backendI18n.t(errorCatalog[code].message_key, {
    lng: locale,
    ...params,
  });
}

export function translateBackend(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  return backendI18n.t(key, { lng: locale, ...params });
}
