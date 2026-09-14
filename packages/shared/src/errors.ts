import { z } from "zod";

import { jsonObjectSchema } from "./common.js";

type ErrorCatalogEntry = {
  message_key: string;
  http_status: number;
  messages: {
    "zh-CN": string;
    "en-US": string;
  };
};

export const errorCatalog = {
  TASK_CATEGORY_NOT_FOUND: {
    message_key: "taskCategories.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "该任务分类不存在或你无权访问，请重新选择分类",
      "en-US": "This task category is unavailable. Please choose another category",
    },
  },
  TASK_CATEGORY_NAME_EXISTS: {
    message_key: "taskCategories.nameExists",
    http_status: 409,
    messages: {
      "zh-CN": "已存在同名任务分类，请使用其他名称",
      "en-US": "A task category with this name already exists. Choose another name",
    },
  },
  BOT_CHANNEL_CONNECTION_CONFLICT: {
    message_key: "errors.botChannels.BOT_CHANNEL_CONNECTION_CONFLICT",
    http_status: 409,
    messages: {
      "zh-CN": "此渠道或机器人已连接，请先断开已有连接。",
      "en-US": "This channel or bot is already connected. Disconnect the existing connection first.",
    },
  },
  BOT_CHANNEL_BUSY: {
    message_key: "errors.botChannels.BOT_CHANNEL_BUSY",
    http_status: 409,
    messages: {
      "zh-CN": "该渠道正在处理消息，请稍后再断开。",
      "en-US": "This channel is processing a message. Try disconnecting again shortly.",
    },
  },
  BOT_CHANNEL_CONNECTION_FAILED: {
    message_key: "errors.botChannels.BOT_CHANNEL_CONNECTION_FAILED",
    http_status: 502,
    messages: {
      "zh-CN": "无法连接消息渠道，请检查应用配置、授权和网络。",
      "en-US": "Unable to connect. Check the app configuration, permissions, and network.",
    },
  },
  BOT_CHANNEL_DELIVERY_FAILED: {
    message_key: "errors.botChannels.BOT_CHANNEL_DELIVERY_FAILED",
    http_status: 502,
    messages: {
      "zh-CN": "消息暂未送达，请检查渠道状态和发送权限。",
      "en-US": "The message could not be delivered. Check the channel status and messaging permissions.",
    },
  },
  BOT_CHANNEL_PROTOCOL_INVALID: {
    message_key: "errors.botChannels.BOT_CHANNEL_PROTOCOL_INVALID",
    http_status: 502,
    messages: {
      "zh-CN": "消息渠道返回了无法识别的数据。",
      "en-US": "The messaging channel returned an invalid response.",
    },
  },
  VALIDATION_ERROR: {
    message_key: "errors.common.validation",
    http_status: 400,
    messages: {
      "zh-CN": "请求内容无效，请检查后重试。",
      "en-US": "The request is invalid. Check the input and try again.",
    },
  },
  AUTH_REQUIRED: {
    message_key: "errors.common.authenticationRequired",
    http_status: 401,
    messages: {
      "zh-CN": "请先登录后继续。",
      "en-US": "Sign in to continue.",
    },
  },
  FORBIDDEN: {
    message_key: "errors.common.forbidden",
    http_status: 403,
    messages: {
      "zh-CN": "你没有执行此操作的权限。",
      "en-US": "You do not have permission to perform this action.",
    },
  },
  NOT_FOUND: {
    message_key: "errors.common.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到请求的资源。",
      "en-US": "The requested resource was not found.",
    },
  },
  CONFLICT: {
    message_key: "errors.common.conflict",
    http_status: 409,
    messages: {
      "zh-CN": "当前状态与此操作冲突，请刷新后重试。",
      "en-US":
        "The current state conflicts with this action. Refresh and try again.",
    },
  },
  COLLABORATION_MODE_UNAVAILABLE: {
    message_key: "errors.conversation.collaborationModeUnavailable",
    http_status: 409,
    messages: {
      "zh-CN":
        "任务正在运行、存在排队请求、目标尚未结束或已绑定自动化，暂时不能切换计划模式。",
      "en-US":
        "Plan mode cannot be changed while the task is running, has queued requests, has an active Goal, or is bound to an automation.",
    },
  },
  CONVERSATION_COMPACTION_UNAVAILABLE: {
    message_key: "errors.conversation.compactionUnavailable",
    http_status: 409,
    messages: {
      "zh-CN": "只能在当前任务停止后压缩上下文。",
      "en-US":
        "Context can only be compacted after the current task has stopped.",
    },
  },
  USER_INPUT_REQUEST_UNAVAILABLE: {
    message_key: "errors.conversation.userInputRequestUnavailable",
    http_status: 409,
    messages: {
      "zh-CN": "这个问题已经结束或失效，请刷新任务后重试。",
      "en-US":
        "This question has already ended or expired. Refresh the task and try again.",
    },
  },
  PLAN_REVIEW_PENDING: {
    message_key: "errors.conversation.planReviewPending",
    http_status: 409,
    messages: {
      "zh-CN": "请先实施、修改、跳过或退出当前计划，再继续操作。",
      "en-US":
        "Implement, revise, skip, or exit the current plan before continuing.",
    },
  },
  PLAN_REVIEW_UNAVAILABLE: {
    message_key: "errors.conversation.planReviewUnavailable",
    http_status: 409,
    messages: {
      "zh-CN": "这个计划确认已经结束或失效，请刷新任务后重试。",
      "en-US":
        "This plan review has already ended or is no longer available. Refresh the task and try again.",
    },
  },
  PLAN_OUTPUT_MISSING: {
    message_key: "errors.conversation.planOutputMissing",
    http_status: 500,
    messages: {
      "zh-CN": "计划模式未生成可确认的计划，请重新发起请求。",
      "en-US":
        "Plan mode did not produce a plan you can review. Start the request again.",
    },
  },
  INTERNAL_ERROR: {
    message_key: "errors.common.internal",
    http_status: 500,
    messages: {
      "zh-CN": "系统暂时无法完成此操作，请稍后重试。",
      "en-US": "The system could not complete this action. Try again later.",
    },
  },
  USER_DISABLED: {
    message_key: "errors.user.disabled",
    http_status: 403,
    messages: {
      "zh-CN": "该用户已被禁用，请联系管理员。",
      "en-US": "This user is disabled. Contact an administrator.",
    },
  },
  OIDC_ACCOUNT_PENDING_APPROVAL: {
    message_key: "auth.oidc.accountPendingApproval",
    http_status: 403,
    messages: {
      "zh-CN":
        "单点登录验证成功，账号已创建并等待管理员启用。请联系管理员，启用后再重新登录。",
      "en-US":
        "Single sign-on succeeded. Your account was created and is awaiting administrator approval. Contact an administrator, then sign in again after it is enabled.",
    },
  },
  EXTERNAL_ACCOUNT_PENDING_APPROVAL: {
    message_key: "auth.external.accountPendingApproval",
    http_status: 403,
    messages: {
      "zh-CN":
        "身份验证成功，账号已创建并等待管理员启用。请联系管理员，启用后再重新登录。",
      "en-US":
        "Sign-in succeeded. Your account was created and is awaiting administrator approval. Contact an administrator, then sign in again after it is enabled.",
    },
  },
  CAPABILITY_NOT_FOUND: {
    message_key: "errors.capability.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该插件或 Skill。",
      "en-US": "The plugin or skill was not found.",
    },
  },
  MCP_SERVER_NOT_FOUND: {
    message_key: "errors.mcp.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该 MCP 服务器。",
      "en-US": "The MCP server was not found.",
    },
  },
  MCP_INSECURE_HTTP_ACKNOWLEDGEMENT_REQUIRED: {
    message_key: "errors.mcp.insecureHttpAcknowledgementRequired",
    http_status: 422,
    messages: {
      "zh-CN": "HTTP 连接不会加密凭据和工具数据，请先确认风险。",
      "en-US":
        "HTTP does not encrypt credentials or tool data. Acknowledge the risk first.",
    },
  },
  MCP_CREDENTIAL_REQUIRED: {
    message_key: "errors.mcp.credentialRequired",
    http_status: 422,
    messages: {
      "zh-CN": "该认证方式需要提供凭据。",
      "en-US": "The selected authentication method requires a credential.",
    },
  },
  MCP_DESTINATION_FORBIDDEN: {
    message_key: "errors.mcp.destinationForbidden",
    http_status: 422,
    messages: {
      "zh-CN": "MCP 地址不能指向本机、私有网络或云元数据服务。",
      "en-US":
        "The MCP address cannot target localhost, a private network, or a cloud metadata service.",
    },
  },
  MCP_CONNECTION_FAILED: {
    message_key: "errors.mcp.connectionFailed",
    http_status: 422,
    messages: {
      "zh-CN": "无法连接并初始化该 MCP 服务器，请检查地址和凭据。",
      "en-US":
        "The MCP server could not be connected and initialized. Check its URL and credential.",
    },
  },
  APPLICATION_NOT_FOUND: {
    message_key: "errors.application.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该应用，或你已无权使用该应用。",
      "en-US":
        "The application was not found or is no longer available to you.",
    },
  },
  APPLICATION_DISABLED: {
    message_key: "errors.application.disabled",
    http_status: 409,
    messages: {
      "zh-CN": "该应用已停用，暂时无法开始新的任务轮次。",
      "en-US": "This application is disabled and cannot start a new turn.",
    },
  },
  APPLICATION_CONVERSATION_RENAME_UNSUPPORTED: {
    message_key: "errors.application.conversationRenameUnsupported",
    http_status: 409,
    messages: {
      "zh-CN": "应用任务标题由应用管理，不支持重命名。",
      "en-US":
        "Application task titles are managed by the application and cannot be renamed.",
    },
  },
  APPLICATION_DEPENDENCY_UNAVAILABLE: {
    message_key: "errors.application.dependencyUnavailable",
    http_status: 409,
    messages: {
      "zh-CN":
        "应用引用的插件、Skill 或知识库当前不可用，请联系应用创建者更新配置。",
      "en-US":
        "A plugin, skill, or knowledge base used by this application is unavailable. Ask the owner to update its configuration.",
    },
  },
  APPLICATION_ICON_UPLOAD_INVALID: {
    message_key: "errors.application.iconUploadInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "应用图标上传失败，请选择符合类型、文件大小和尺寸限制的图片。",
      "en-US":
        "Application icon upload failed. Choose an image that meets the type, file-size, and dimension limits.",
    },
  },
  APPLICATION_PACKAGE_INVALID: {
    message_key: "errors.application.packageInvalid",
    http_status: 400,
    messages: {
      "zh-CN":
        "交互式应用包无效。请确认 ZIP 根目录包含有效的 manifest.json 和 index.html。",
      "en-US":
        "The interactive application package is invalid. Make sure the ZIP root contains valid manifest.json and index.html files.",
    },
  },
  APPLICATION_PACKAGE_VERSION_CONFLICT: {
    message_key: "errors.application.packageVersionConflict",
    http_status: 409,
    messages: {
      "zh-CN": "该交互式应用版本已导入，请更新 manifest.json 中的版本号。",
      "en-US":
        "This interactive application version has already been imported. Update the version in manifest.json.",
    },
  },
  APPLICATION_CUSTOM_EVENT_INVALID: {
    message_key: "errors.application.customEventInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "自定义事件名称或数据不符合应用声明的格式。",
      "en-US":
        "The custom event name or payload does not match the application contract.",
    },
  },
  APPLICATION_GRANT_TARGET_INVALID: {
    message_key: "errors.application.grantTargetInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "应用分享目标无效或不可用。",
      "en-US": "The application share target is invalid or unavailable.",
    },
  },
  APPLICATION_GRANT_CONFLICT: {
    message_key: "errors.application.grantConflict",
    http_status: 409,
    messages: {
      "zh-CN": "该用户或用户组已经可以使用此应用。",
      "en-US": "This user or group already has access to the application.",
    },
  },
  APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED: {
    message_key: "errors.application.externalAccessNotConfigured",
    http_status: 404,
    messages: {
      "zh-CN": "该应用尚未配置外部访问。",
      "en-US": "External access has not been configured for this application.",
    },
  },
  APPLICATION_EXTERNAL_ACCESS_DISABLED: {
    message_key: "errors.application.externalAccessDisabled",
    http_status: 403,
    messages: {
      "zh-CN": "该应用的外部访问已停用。",
      "en-US": "External access for this application is disabled.",
    },
  },
  APPLICATION_EXTERNAL_ORIGIN_FORBIDDEN: {
    message_key: "errors.application.externalOriginForbidden",
    http_status: 403,
    messages: {
      "zh-CN": "当前页面来源不在该应用允许嵌入的域名列表中。",
      "en-US": "This page origin is not allowed to embed the application.",
    },
  },
  APPLICATION_EXTERNAL_CREDENTIALS_INVALID: {
    message_key: "errors.application.externalCredentialsInvalid",
    http_status: 401,
    messages: {
      "zh-CN": "App ID 或 App Secret 无效。",
      "en-US": "The App ID or App Secret is invalid.",
    },
  },
  APPLICATION_EMBED_TICKET_INVALID: {
    message_key: "errors.application.embedTicketInvalid",
    http_status: 401,
    messages: {
      "zh-CN": "嵌入凭证无效、已使用或已过期，请重新获取。",
      "en-US": "The embed ticket is invalid, already used, or expired. Request a new one.",
    },
  },
  APPLICATION_EMBED_SESSION_EXPIRED: {
    message_key: "errors.application.embedSessionExpired",
    http_status: 401,
    messages: {
      "zh-CN": "外部会话已失效，请由宿主系统重新认证。",
      "en-US": "The external session has expired. Reauthenticate through the host system.",
    },
  },
  APPLICATION_EMBED_RENEWAL_REUSED: {
    message_key: "errors.application.embedRenewalReused",
    http_status: 401,
    messages: {
      "zh-CN": "检测到会话续期令牌重复使用，该会话已被撤销。",
      "en-US": "Renewal-token reuse was detected and the session has been revoked.",
    },
  },
  APPLICATION_EXTERNAL_RATE_LIMITED: {
    message_key: "errors.application.externalRateLimited",
    http_status: 429,
    messages: {
      "zh-CN": "外部访问请求过于频繁，请稍后重试。",
      "en-US": "External access requests are too frequent. Try again later.",
    },
  },
  WEIXIN_CONNECTION_NOT_FOUND: {
    message_key: "errors.weixin.connectionNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到微信连接，请重新连接。",
      "en-US": "The Weixin connection was not found. Connect it again.",
    },
  },
  WEIXIN_CONNECTION_CONFLICT: {
    message_key: "errors.weixin.connectionConflict",
    http_status: 409,
    messages: {
      "zh-CN": "微信连接状态已发生变化，请刷新后重试。",
      "en-US": "The Weixin connection changed. Refresh and try again.",
    },
  },
  WEIXIN_LOGIN_SESSION_NOT_FOUND: {
    message_key: "errors.weixin.loginSessionNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "微信连接二维码已过期，请重新生成。",
      "en-US": "The Weixin connection QR code expired. Generate a new one.",
    },
  },
  WEIXIN_UPSTREAM_UNAVAILABLE: {
    message_key: "errors.weixin.upstreamUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "微信连接服务暂时不可用，请稍后重试。",
      "en-US": "The Weixin connection service is temporarily unavailable. Try again later.",
    },
  },
  WEIXIN_PROTOCOL_INVALID: {
    message_key: "errors.weixin.protocolInvalid",
    http_status: 502,
    messages: {
      "zh-CN": "微信返回了无法识别的连接数据，请重新连接或联系管理员。",
      "en-US": "Weixin returned unrecognized connection data. Reconnect or contact an administrator.",
    },
  },
  WEIXIN_COORDINATION_UNAVAILABLE: {
    message_key: "errors.weixin.coordinationUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "微信连接状态暂时不可用，请稍后重试。",
      "en-US": "Weixin connection state is temporarily unavailable. Try again later.",
    },
  },
  FEISHU_CONNECTION_NOT_FOUND: {
    message_key: "errors.feishu.connectionNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到飞书连接，请重新连接。",
      "en-US": "The Feishu connection was not found. Connect it again.",
    },
  },
  FEISHU_CONNECTION_CONFLICT: {
    message_key: "errors.feishu.connectionConflict",
    http_status: 409,
    messages: {
      "zh-CN": "飞书连接状态已发生变化，请刷新后重试。",
      "en-US": "The Feishu connection changed. Refresh and try again.",
    },
  },
  FEISHU_REGISTRATION_NOT_FOUND: {
    message_key: "errors.feishu.registrationNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "飞书连接二维码已过期，请重新生成。",
      "en-US": "The Feishu connection QR code expired. Generate a new one.",
    },
  },
  FEISHU_REGISTRATION_UNAVAILABLE: {
    message_key: "errors.feishu.registrationUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "飞书暂时无法自动创建机器人，请稍后重试。",
      "en-US": "Feishu cannot create the bot automatically right now. Try again later.",
    },
  },
  FEISHU_PROTOCOL_INVALID: {
    message_key: "errors.feishu.protocolInvalid",
    http_status: 502,
    messages: {
      "zh-CN": "飞书返回了无法识别的连接数据，请重新连接或联系管理员。",
      "en-US": "Feishu returned unrecognized connection data. Reconnect or contact an administrator.",
    },
  },
  FEISHU_COORDINATION_UNAVAILABLE: {
    message_key: "errors.feishu.coordinationUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "飞书连接状态暂时不可用，请稍后重试。",
      "en-US": "Feishu connection state is temporarily unavailable. Try again later.",
    },
  },
  KNOWLEDGE_BASE_NOT_FOUND: {
    message_key: "errors.knowledgeBase.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该知识库。",
      "en-US": "The knowledge base was not found.",
    },
  },
  KNOWLEDGE_BASE_ACCESS_DENIED: {
    message_key: "errors.knowledgeBase.accessDenied",
    http_status: 403,
    messages: {
      "zh-CN": "你无权访问该知识库。",
      "en-US": "You do not have access to this knowledge base.",
    },
  },
  KNOWLEDGE_BASE_NOT_ACTIVE: {
    message_key: "errors.knowledgeBase.notActive",
    http_status: 409,
    messages: {
      "zh-CN": "知识库当前不是可写入的启用状态。",
      "en-US": "The knowledge base is not currently active and writable.",
    },
  },
  KNOWLEDGE_BASE_DISABLED: {
    message_key: "errors.knowledgeBase.disabled",
    http_status: 403,
    messages: {
      "zh-CN": "该知识库已被停用。",
      "en-US": "This knowledge base is disabled.",
    },
  },
  KNOWLEDGE_BASE_CREATION_UNAVAILABLE: {
    message_key: "errors.knowledgeBase.creationUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "知识库所需服务尚未就绪，暂时无法创建知识库。",
      "en-US":
        "The required knowledge-base services are not ready, so a knowledge base cannot be created right now.",
    },
  },
  KNOWLEDGE_BASE_ARCHIVE_REQUIRED: {
    message_key: "errors.knowledgeBase.archiveRequired",
    http_status: 409,
    messages: {
      "zh-CN": "只能删除已经归档的知识库。",
      "en-US": "Only an archived knowledge base can be deleted.",
    },
  },
  KNOWLEDGE_BASE_IN_USE: {
    message_key: "errors.knowledgeBase.inUse",
    http_status: 409,
    messages: {
      "zh-CN": "该知识库仍被应用使用，请先从相关应用中移除。",
      "en-US":
        "This knowledge base is still used by applications. Remove it from those applications first.",
    },
  },
  KNOWLEDGE_BASE_GRANT_TARGET_INVALID: {
    message_key: "errors.knowledgeBase.grantTargetInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "知识库分享目标无效或不可用。",
      "en-US": "The knowledge base share target is invalid or unavailable.",
    },
  },
  KNOWLEDGE_BASE_GRANT_CONFLICT: {
    message_key: "errors.knowledgeBase.grantConflict",
    http_status: 409,
    messages: {
      "zh-CN": "该用户或用户组已获得此知识库的使用权限。",
      "en-US": "This user or group already has access to the knowledge base.",
    },
  },
  KNOWLEDGE_MAINTENANCE_IN_PROGRESS: {
    message_key: "errors.knowledgeMaintenance.inProgress",
    http_status: 409,
    messages: {
      "zh-CN": "已有知识库全量重建任务正在等待或执行。",
      "en-US": "A full knowledge-base rebuild is already pending or running.",
    },
  },
  KNOWLEDGE_MAINTENANCE_UNAVAILABLE: {
    message_key: "errors.knowledgeMaintenance.unavailable",
    http_status: 503,
    messages: {
      "zh-CN": "知识库向量索引正在维护，检索和常规向量处理暂不可用。",
      "en-US":
        "Knowledge-base vector search and regular vector processing are unavailable during index maintenance.",
    },
  },
  KNOWLEDGE_CLEANUP_TARGET_NOT_RETRYABLE: {
    message_key: "errors.knowledgeCleanup.targetNotRetryable",
    http_status: 409,
    messages: {
      "zh-CN": "该清理目标当前没有可重试的失败任务。",
      "en-US": "This cleanup target has no failed task that can be retried.",
    },
  },
  KNOWLEDGE_DOCUMENT_NOT_FOUND: {
    message_key: "errors.knowledgeDocument.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该知识库文档。",
      "en-US": "The knowledge-base document was not found.",
    },
  },
  KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED: {
    message_key: "errors.knowledgeDocument.typeUnsupported",
    http_status: 415,
    messages: {
      "zh-CN": "不支持上传该文件格式。",
      "en-US": "This file format is not supported for upload.",
    },
  },
  KNOWLEDGE_DOCUMENT_TOO_LARGE: {
    message_key: "errors.knowledgeDocument.tooLarge",
    http_status: 413,
    messages: {
      "zh-CN": "文件大小超过允许上限。",
      "en-US": "The file exceeds the allowed size limit.",
    },
  },
  KNOWLEDGE_UPLOAD_BATCH_LIMIT_EXCEEDED: {
    message_key: "errors.knowledgeDocument.batchLimitExceeded",
    http_status: 413,
    messages: {
      "zh-CN": "单次上传的文件数量超过允许上限。",
      "en-US": "The upload contains too many files.",
    },
  },
  KNOWLEDGE_STORAGE_QUOTA_EXCEEDED: {
    message_key: "errors.knowledgeBase.storageQuotaExceeded",
    http_status: 413,
    messages: {
      "zh-CN": "知识库存储空间不足。",
      "en-US": "The knowledge base does not have enough storage capacity.",
    },
  },
  KNOWLEDGE_DOCUMENT_ENCRYPTED: {
    message_key: "errors.knowledgeDocument.encrypted",
    http_status: 400,
    messages: {
      "zh-CN": "不支持密码保护或加密文档。",
      "en-US": "Password-protected or encrypted documents are not supported.",
    },
  },
  KNOWLEDGE_DOCUMENT_INVALID: {
    message_key: "errors.knowledgeDocument.invalid",
    http_status: 400,
    messages: {
      "zh-CN": "文档为空、损坏或实际格式与文件名不一致。",
      "en-US":
        "The document is empty, damaged, or does not match its declared format.",
    },
  },
  KNOWLEDGE_DOCUMENT_DUPLICATE: {
    message_key: "errors.knowledgeDocument.duplicate",
    http_status: 409,
    messages: {
      "zh-CN": "知识库中已存在内容相同的文档。",
      "en-US": "An identical document already exists in this knowledge base.",
    },
  },
  KNOWLEDGE_DOCUMENT_NAME_CONFLICT: {
    message_key: "errors.knowledgeDocument.nameConflict",
    http_status: 409,
    messages: {
      "zh-CN": "知识库中已存在同名但内容不同的文档，请选择替换或保留两个文档。",
      "en-US":
        "A different document with the same name exists. Choose replace or keep both.",
    },
  },
  KNOWLEDGE_DOCUMENT_PROCESSING_CONFLICT: {
    message_key: "errors.knowledgeDocument.processingConflict",
    http_status: 409,
    messages: {
      "zh-CN": "该文档已有处理任务正在进行。",
      "en-US": "This document already has an active processing operation.",
    },
  },
  KNOWLEDGE_DOCUMENT_BUSY: {
    message_key: "errors.knowledgeDocument.busy",
    http_status: 409,
    messages: {
      "zh-CN": "该文档正在被其他处理或删除操作占用，请稍后重试。",
      "en-US":
        "This document is busy with another processing or deletion operation. Try again later.",
    },
  },
  KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE: {
    message_key: "errors.knowledge.externalServiceUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "知识库依赖服务暂时不可用，请稍后重试。",
      "en-US":
        "A knowledge-base dependency is temporarily unavailable. Try again later.",
    },
  },
  KNOWLEDGE_OFFICE_CONVERSION_FAILED: {
    message_key: "errors.knowledgeDocument.officeConversionFailed",
    http_status: 422,
    messages: {
      "zh-CN": "文档无法转换为可解析格式。",
      "en-US": "The document could not be converted to a parseable format.",
    },
  },
  KNOWLEDGE_OFFICE_CONVERTER_UNAVAILABLE: {
    message_key: "errors.knowledgeDocument.officeConverterUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "文档格式转换服务暂不可用，请稍后重试。",
      "en-US": "Document format conversion is temporarily unavailable. Try again later.",
    },
  },
  KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY: {
    message_key: "errors.knowledgeDocument.contentNotReady",
    http_status: 409,
    messages: {
      "zh-CN": "该文档的解析内容尚未就绪。",
      "en-US": "The parsed content for this document is not ready.",
    },
  },
  KNOWLEDGE_PROCESSING_CANCELLED: {
    message_key: "errors.knowledgeDocument.processingCancelled",
    http_status: 409,
    messages: {
      "zh-CN": "文档处理已由用户取消。",
      "en-US": "Document processing was cancelled by the user.",
    },
  },
  KNOWLEDGE_PROCESSING_CANCEL_NOT_ALLOWED: {
    message_key: "errors.knowledgeDocument.cancelNotAllowed",
    http_status: 409,
    messages: {
      "zh-CN": "文档处理已进入激活阶段或已经结束，无法取消。",
      "en-US":
        "Document processing is activating or already finished and cannot be cancelled.",
    },
  },
  KNOWLEDGE_PROCESSING_UNAVAILABLE: {
    message_key: "errors.knowledgeDocument.processingUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "知识库文档处理服务暂不可用。",
      "en-US": "Knowledge-base document processing is temporarily unavailable.",
    },
  },
  IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED: {
    message_key: "errors.imageUnderstanding.validationFailed",
    http_status: 422,
    messages: {
      "zh-CN": "图片理解模型未通过图像、结构化输出或禁用思考校验。",
      "en-US":
        "The image-understanding model failed image, structured-output, or thinking-disable validation.",
    },
  },
  IMAGE_GENERATION_NOT_CONFIGURED: {
    message_key: "errors.imageGeneration.notConfigured",
    http_status: 503,
    messages: {
      "zh-CN": "管理员尚未完成图片生成模型配置。",
      "en-US":
        "An administrator has not configured the image generation model yet.",
    },
  },
  IMAGE_GENERATION_FORBIDDEN: {
    message_key: "errors.imageGeneration.forbidden",
    http_status: 403,
    messages: {
      "zh-CN": "当前任务轮次不能使用图片生成。",
      "en-US": "Image generation is not available for this task turn.",
    },
  },
  IMAGE_GENERATION_TURN_INACTIVE: {
    message_key: "errors.imageGeneration.turnInactive",
    http_status: 409,
    messages: {
      "zh-CN": "当前任务轮次已经结束，不能继续生成图片。",
      "en-US": "The current task turn has ended and cannot generate images.",
    },
  },
  IMAGE_GENERATION_PROVIDER_REJECTED: {
    message_key: "errors.imageGeneration.providerRejected",
    http_status: 422,
    messages: {
      "zh-CN": "图片生成供应商拒绝了本次请求，请检查提示词、模型或密钥。",
      "en-US":
        "The image provider rejected the request. Check the prompt, model, or API key.",
    },
  },
  IMAGE_GENERATION_OUTPUT_INVALID: {
    message_key: "errors.imageGeneration.outputInvalid",
    http_status: 502,
    messages: {
      "zh-CN": "图片生成供应商返回了无法识别的结果。",
      "en-US": "The image provider returned an unsupported result.",
    },
  },
  IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED: {
    message_key: "errors.imageGeneration.transparencyUnsupported",
    http_status: 422,
    messages: {
      "zh-CN":
        "当前图片生成供应商或模型不支持原生透明背景，请改用自动透明模式或联系管理员调整模型。",
      "en-US":
        "The configured image provider or model does not support native transparency. Use automatic transparency or ask an administrator to change the model.",
    },
  },
  IMAGE_GENERATION_TRANSPARENCY_INVALID: {
    message_key: "errors.imageGeneration.transparencyInvalid",
    http_status: 502,
    messages: {
      "zh-CN":
        "图片供应商已完成生成，但透明背景处理未通过质量校验。为避免重复计费，请勿自动重试。",
      "en-US":
        "The image provider completed generation, but transparent-background processing failed validation. To avoid duplicate charges, do not retry automatically.",
    },
  },
  IMAGE_GENERATION_RECORDING_FAILED: {
    message_key: "errors.imageGeneration.recordingFailed",
    http_status: 500,
    messages: {
      "zh-CN":
        "图片供应商已处理请求，但 LinkSense 未能记录本次生成。为避免重复计费，请勿自动重试并联系管理员。",
      "en-US":
        "The image provider processed the request, but LinkSense could not record it. To avoid duplicate charges, do not retry automatically and contact an administrator.",
    },
  },
  IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED: {
    message_key: "errors.imageGeneration.artifactRegistrationFailed",
    http_status: 500,
    messages: {
      "zh-CN":
        "图片供应商已完成生成，但 LinkSense 未能登记生成文件。为避免重复计费，请勿自动重试并联系管理员。",
      "en-US":
        "The image provider completed generation, but LinkSense could not register the generated file. To avoid duplicate charges, do not retry automatically and contact an administrator.",
    },
  },
  IMAGE_GENERATION_UNAVAILABLE: {
    message_key: "errors.imageGeneration.unavailable",
    http_status: 503,
    messages: {
      "zh-CN": "图片生成服务暂时不可用，请稍后重试。",
      "en-US": "Image generation is temporarily unavailable. Try again later.",
    },
  },
  KNOWLEDGE_MODEL_VALIDATION_FAILED: {
    message_key: "errors.knowledgeModel.validationFailed",
    http_status: 422,
    messages: {
      "zh-CN":
        "知识库嵌入模型或重排模型连接校验失败，请检查端点、密钥、模型 ID 与向量维度。",
      "en-US":
        "The knowledge embedding or rerank model failed validation. Check the endpoint, key, model ID, and vector dimensions.",
    },
  },
  KNOWLEDGE_MODEL_AUTHENTICATION_FAILED: {
    message_key: "errors.knowledgeModel.authenticationFailed",
    http_status: 422,
    messages: {
      "zh-CN":
        "模型服务未接受当前 API Key。若刚切换 Base URL，请输入新端点对应的有效密钥。",
      "en-US":
        "The model service did not accept the current API key. If you changed the Base URL, enter a valid key for the new endpoint.",
    },
  },
  KNOWLEDGE_MODEL_SERVICE_UNAVAILABLE: {
    message_key: "errors.knowledgeModel.serviceUnavailable",
    http_status: 422,
    messages: {
      "zh-CN":
        "模型服务拒绝了校验请求或暂不可用，请检查 Base URL、模型 ID、网络和服务状态。",
      "en-US":
        "The model service rejected the validation request or is unavailable. Check the Base URL, model ID, network, and service status.",
    },
  },
  KNOWLEDGE_MODEL_RESPONSE_INVALID: {
    message_key: "errors.knowledgeModel.responseInvalid",
    http_status: 422,
    messages: {
      "zh-CN":
        "模型返回内容不符合要求，请检查接口兼容性、模型 ID 和嵌入向量维度。",
      "en-US":
        "The model response is incompatible. Check the API compatibility, model ID, and embedding vector dimensions.",
    },
  },
  KNOWLEDGE_MODEL_NOT_CONFIGURED: {
    message_key: "errors.knowledgeModel.notConfigured",
    http_status: 503,
    messages: {
      "zh-CN": "管理员尚未完成知识库嵌入模型配置。",
      "en-US":
        "An administrator has not configured the knowledge embedding model yet.",
    },
  },
  KNOWLEDGE_SOURCE_NOT_CONFIGURED: {
    message_key: "errors.knowledgeSource.notConfigured",
    http_status: 409,
    messages: {
      "zh-CN": "SharePoint 知识库数据源尚未由管理员完成配置。",
      "en-US":
        "The SharePoint knowledge source has not been configured by an administrator.",
    },
  },
  KNOWLEDGE_SOURCE_CREDENTIAL_VALIDATION_FAILED: {
    message_key: "errors.knowledgeSource.credentialValidationFailed",
    http_status: 422,
    messages: {
      "zh-CN": "SharePoint 应用身份验证失败，请检查租户、应用 ID 和密钥。",
      "en-US":
        "SharePoint application authentication failed. Check the tenant, application ID, and secret.",
    },
  },
  KNOWLEDGE_SOURCE_URL_INVALID: {
    message_key: "errors.knowledgeSource.urlInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "SharePoint 目录 URL 无效，或不属于管理员配置的租户域名。",
      "en-US":
        "The SharePoint folder URL is invalid or does not belong to the configured tenant domain.",
    },
  },
  KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND: {
    message_key: "errors.knowledgeSource.folderNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "无法访问该 SharePoint 目录，请检查 URL 和站点授权。",
      "en-US":
        "The SharePoint folder could not be accessed. Check the URL and site permission assignment.",
    },
  },
  KNOWLEDGE_SOURCE_ALREADY_CONNECTED: {
    message_key: "errors.knowledgeSource.alreadyConnected",
    http_status: 409,
    messages: {
      "zh-CN": "该 SharePoint 目录已经连接到另一个知识库。",
      "en-US":
        "This SharePoint folder is already connected to another knowledge base.",
    },
  },
  KNOWLEDGE_SOURCE_NOT_FOUND: {
    message_key: "errors.knowledgeSource.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该知识库的数据源。",
      "en-US": "The knowledge-base source was not found.",
    },
  },
  KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE: {
    message_key: "errors.knowledgeSource.syncUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "SharePoint 同步暂时不可用，系统会按计划重试。",
      "en-US":
        "SharePoint synchronization is temporarily unavailable and will be retried on schedule.",
    },
  },
  KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED: {
    message_key: "errors.knowledgeSource.itemSyncFailed",
    http_status: 503,
    messages: {
      "zh-CN": "部分 SharePoint 文档同步失败，系统会按计划重试。",
      "en-US":
        "Some SharePoint documents failed to synchronize and will be retried on schedule.",
    },
  },
  KNOWLEDGE_PREVIEW_UNSUPPORTED: {
    message_key: "errors.knowledgeDocument.previewUnsupported",
    http_status: 422,
    messages: {
      "zh-CN": "该文件格式暂不支持原文预览，请下载原件或查看解析内容。",
      "en-US":
        "Original preview is not supported for this format. Download the original or view parsed content.",
    },
  },
  KNOWLEDGE_PREVIEW_UNAVAILABLE: {
    message_key: "errors.knowledgeDocument.previewUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "原文预览服务暂不可用，请手动重试或下载原件。",
      "en-US":
        "Original preview is unavailable. Try again manually or download the original.",
    },
  },
  KNOWLEDGE_ORIGINAL_UNAVAILABLE: {
    message_key: "errors.knowledgeDocument.originalUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "暂时无法读取文档原件。",
      "en-US": "The original document is temporarily unavailable.",
    },
  },
  KNOWLEDGE_NO_AVAILABLE_BASES: {
    message_key: "errors.knowledgeSearch.noAvailableBases",
    http_status: 409,
    messages: {
      "zh-CN": "当前没有可访问且可用的知识库。",
      "en-US":
        "No knowledge bases are currently accessible and available.",
    },
  },
  KNOWLEDGE_SEARCH_UNAVAILABLE: {
    message_key: "errors.knowledgeSearch.unavailable",
    http_status: 503,
    messages: {
      "zh-CN": "知识库检索服务暂不可用。",
      "en-US": "Knowledge-base search is temporarily unavailable.",
    },
  },
  EMBEDDING_INPUT_TOO_LARGE: {
    message_key: "errors.knowledgeDocument.embeddingInputTooLarge",
    http_status: 422,
    messages: {
      "zh-CN":
        "嵌入模型最大 Token 配置可能与外部服务不匹配，请联系管理员检查配置。",
      "en-US":
        "The embedding token limit may not match the external service. Ask an administrator to check the configuration.",
    },
  },
  EMBEDDING_DIMENSION_MISMATCH: {
    message_key: "errors.knowledgeBase.embeddingDimensionMismatch",
    http_status: 503,
    messages: {
      "zh-CN": "当前嵌入向量维度与知识库索引不一致，需要手动执行全量重建。",
      "en-US":
        "The embedding dimensions do not match the knowledge index. A manual full rebuild is required.",
    },
  },
  INVALID_PACKAGE: {
    message_key: "errors.capability.invalidPackage",
    http_status: 400,
    messages: {
      "zh-CN": "能力包结构无效或缺少必需文件。",
      "en-US": "The capability package is invalid or missing required files.",
    },
  },
  IMPORT_FAILED: {
    message_key: "errors.capability.importFailed",
    http_status: 400,
    messages: {
      "zh-CN": "能力导入失败，请检查来源后重试。",
      "en-US": "The capability import failed. Check the source and try again.",
    },
  },
  CAPABILITY_UPDATE_UNCHANGED: {
    message_key: "errors.capability.updateUnchanged",
    http_status: 409,
    messages: {
      "zh-CN": "内容与当前技能相同，无需更新。",
      "en-US": "The content is identical to the current skill. No update is needed.",
    },
  },
  CAPABILITY_UPDATE_CONFLICT: {
    message_key: "errors.capability.updateConflict",
    http_status: 409,
    messages: {
      "zh-CN": "此技能已发生变化，请重新打开更新窗口，核对最新内容后再提交。",
      "en-US": "This skill has changed. Reopen the update dialog and review the latest content before submitting.",
    },
  },
  CAPABILITY_HOME_SYNC_FAILED: {
    message_key: "errors.capability.homeSyncFailed",
    http_status: 503,
    messages: {
      "zh-CN":
        "能力状态已保存，但用户目录同步失败。系统会在下一轮任务开始前重试。",
      "en-US":
        "The capability state was saved, but the user directory could not be synchronized. The system will retry before the next task turn.",
    },
  },
  SKILL_CREATOR_PREVIEW_INVALID: {
    message_key: "errors.skillCreator.previewInvalid",
    http_status: 409,
    messages: {
      "zh-CN": "Skill 安装预览已失效，请重新检查 ZIP 包后再确认安装。",
      "en-US":
        "The Skill installation preview is no longer valid. Check the ZIP package again before confirming installation.",
    },
  },
  SKILL_CREATOR_CONFIRMATION_REQUIRED: {
    message_key: "errors.skillCreator.confirmationRequired",
    http_status: 409,
    messages: {
      "zh-CN": "请先查看 Skill 预览并明确确认安装，然后再继续。",
      "en-US":
        "Review the Skill preview and explicitly confirm installation before continuing.",
    },
  },
  MARKETPLACE_LISTING_NOT_FOUND: {
    message_key: "errors.marketplace.listingNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该插件中心条目。",
      "en-US": "The Plugin Center listing was not found.",
    },
  },
  MARKETPLACE_RELEASE_NOT_FOUND: {
    message_key: "errors.marketplace.releaseNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该发布版本。",
      "en-US": "The Plugin Center release was not found.",
    },
  },
  MARKETPLACE_RELEASE_PENDING_CONFLICT: {
    message_key: "errors.marketplace.pendingReleaseConflict",
    http_status: 409,
    messages: {
      "zh-CN": "该插件中心条目已有待审核版本，请先完成或撤回当前申请。",
      "en-US":
        "This listing already has a pending release. Complete or withdraw it first.",
    },
  },
  MARKETPLACE_RELEASE_NOT_INSTALLABLE: {
    message_key: "errors.marketplace.releaseNotInstallable",
    http_status: 409,
    messages: {
      "zh-CN": "该插件中心版本当前不可安装或更新。",
      "en-US":
        "This Plugin Center release cannot currently be installed or updated.",
    },
  },
  MARKETPLACE_RELEASE_INTEGRITY_FAILED: {
    message_key: "errors.marketplace.releaseIntegrityFailed",
    http_status: 503,
    messages: {
      "zh-CN": "插件中心发布包完整性校验失败，已阻止安装或审核。",
      "en-US":
        "Plugin Center release integrity verification failed. Installation or review was blocked.",
    },
  },
  MARKETPLACE_LISTING_SUSPENDED: {
    message_key: "errors.marketplace.listingSuspended",
    http_status: 403,
    messages: {
      "zh-CN": "该插件中心条目已被管理员停用。",
      "en-US":
        "This Plugin Center listing has been suspended by an administrator.",
    },
  },
  CLAWHUB_SKILL_NOT_FOUND: {
    message_key: "errors.clawhub.skillNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "技能仓库中未找到该 Skill。",
      "en-US": "The skill was not found in the skill repository.",
    },
  },
  CLAWHUB_SKILL_NOT_INSTALLABLE: {
    message_key: "errors.clawhub.skillNotInstallable",
    http_status: 409,
    messages: {
      "zh-CN": "该 Skill 当前不可安装，请检查可用状态和安全检查结果。",
      "en-US":
        "This skill cannot currently be installed. Check its availability and security status.",
    },
  },
  CLAWHUB_SKILL_ALREADY_INSTALLED: {
    message_key: "errors.clawhub.skillAlreadyInstalled",
    http_status: 409,
    messages: {
      "zh-CN": "你已经安装了该 Skill。",
      "en-US": "You have already installed this skill.",
    },
  },
  CLAWHUB_SERVICE_UNAVAILABLE: {
    message_key: "errors.clawhub.serviceUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "暂时无法从 ClawHub 获取 Skill，请稍后重试。",
      "en-US": "The skill could not be fetched from ClawHub. Try again later.",
    },
  },
  CLAWHUB_INSTALL_PREVIEW_BUSY: {
    message_key: "errors.clawhub.installPreviewBusy",
    http_status: 409,
    messages: {
      "zh-CN": "已有一个 Skill 正在准备安装，请等待完成后再试。",
      "en-US":
        "Another skill installation preview is being prepared. Wait for it to finish and try again.",
    },
  },
  CLAWHUB_INSTALL_PREVIEW_RATE_LIMITED: {
    message_key: "errors.clawhub.installPreviewRateLimited",
    http_status: 429,
    messages: {
      "zh-CN": "安装预览请求过于频繁，请稍后再试。",
      "en-US":
        "Too many installation previews were requested. Try again later.",
    },
  },
  CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED: {
    message_key: "errors.clawhub.installPreviewQuotaExceeded",
    http_status: 429,
    messages: {
      "zh-CN": "待确认的 Skill 安装预览已达上限，请稍后再试。",
      "en-US":
        "The active skill installation preview limit has been reached. Try again later.",
    },
  },
  CLAWHUB_PACKAGE_INTEGRITY_FAILED: {
    message_key: "errors.clawhub.packageIntegrityFailed",
    http_status: 503,
    messages: {
      "zh-CN": "ClawHub Skill 文件完整性校验失败，已阻止安装。",
      "en-US":
        "ClawHub skill file integrity verification failed. Installation was blocked.",
    },
  },
  CREDENTIAL_NOT_FOUND: {
    message_key: "errors.credential.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该凭据。",
      "en-US": "The credential was not found.",
    },
  },
  CONVERSATION_NOT_FOUND: {
    message_key: "errors.conversation.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该任务。",
      "en-US": "The task was not found.",
    },
  },
  CONVERSATION_ORDER_CONFLICT: {
    message_key: "errors.conversation.orderConflict",
    http_status: 409,
    messages: {
      "zh-CN": "任务列表已发生变化，请刷新后重新排序。",
      "en-US": "The task list changed. Refresh it before sorting again.",
    },
  },
  AUTOMATION_NOT_FOUND: {
    message_key: "errors.automation.notFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该自动化。",
      "en-US": "The automation was not found.",
    },
  },
  AUTOMATION_LIMIT_REACHED: {
    message_key: "errors.automation.limitReached",
    http_status: 409,
    messages: {
      "zh-CN": "自动化数量已达到上限，请删除不再需要的自动化后重试。",
      "en-US":
        "You have reached the automation limit. Delete an automation you no longer need and try again.",
    },
  },
  AUTOMATION_TASK_NOT_PINNED: {
    message_key: "errors.automation.taskNotPinned",
    http_status: 422,
    messages: {
      "zh-CN": "自动化只能关联当前账号下已置顶的有效任务。",
      "en-US":
        "Automations can only use active pinned tasks owned by your account.",
    },
  },
  AUTOMATION_TASK_IN_USE: {
    message_key: "errors.automation.taskInUse",
    http_status: 409,
    messages: {
      "zh-CN": "该任务仍关联自动化，请先删除或重新绑定自动化。",
      "en-US":
        "This task is still used by an automation. Delete or reassign the automation first.",
    },
  },
  AUTOMATION_EMPTY_RESULT: {
    message_key: "errors.automation.emptyResult",
    http_status: 502,
    messages: {
      "zh-CN": "自动化执行已结束，但没有产出可展示的内容，请重新执行。",
      "en-US":
        "The automation finished without producing displayable output. Run it again.",
    },
  },
  AUTOMATION_EXPIRED: {
    message_key: "errors.automation.expired",
    http_status: 409,
    messages: {
      "zh-CN": "该自动化任务已到期，不能再执行。",
      "en-US": "This automation has expired and can no longer run.",
    },
  },
  ACCESS_DENIED: {
    message_key: "errors.conversation.accessDenied",
    http_status: 403,
    messages: {
      "zh-CN": "你无权访问该任务。",
      "en-US": "You do not have access to this task.",
    },
  },
  ATTACHMENT_UPLOAD_INVALID: {
    message_key: "errors.file.attachmentUploadInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "附件上传失败，请选择符合要求的文件后重试。",
      "en-US":
        "The attachment upload failed. Choose a supported file and try again.",
    },
  },
  ATTACHMENT_TEMPORARY_FILE_SKIPPED: {
    message_key: "errors.file.attachmentTemporaryFileSkipped",
    http_status: 400,
    messages: {
      "zh-CN": "已跳过临时文件，请选择其他有意义的文件。",
      "en-US": "Temporary files were skipped. Choose another meaningful file.",
    },
  },
  FILE_LIMIT_EXCEEDED: {
    message_key: "errors.file.limitExceeded",
    http_status: 413,
    messages: {
      "zh-CN": "文件大小或附件数量超过允许上限。",
      "en-US": "The file size or attachment count exceeds the allowed limit.",
    },
  },
  ARTIFACT_NOT_FOUND: {
    message_key: "errors.file.artifactNotFound",
    http_status: 404,
    messages: {
      "zh-CN": "未找到该产物。",
      "en-US": "The artifact was not found.",
    },
  },
  ARTIFACT_REGISTRATION_INVALID: {
    message_key: "errors.file.artifactRegistrationInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "产物登记失败，请检查文件路径、类型和大小后重试。",
      "en-US":
        "Artifact registration failed. Check the file path, type, and size, then try again.",
    },
  },
  DOWNLOAD_FORBIDDEN: {
    message_key: "errors.file.downloadForbidden",
    http_status: 403,
    messages: {
      "zh-CN": "你无权下载该产物。",
      "en-US": "You do not have permission to download this artifact.",
    },
  },
  EXTERNAL_IMAGE_DOWNLOAD_FAILED: {
    message_key: "errors.file.externalImageDownloadFailed",
    http_status: 400,
    messages: {
      "zh-CN": "外部图片下载失败，请检查图片地址后重试。",
      "en-US":
        "The external image could not be downloaded. Check the image URL and try again.",
    },
  },
  TURN_START_CLOSED: {
    message_key: "errors.runner.turnStartClosed",
    http_status: 409,
    messages: {
      "zh-CN": "上次提交已结束，本次未执行。请重新提交。",
      "en-US": "The previous submission has ended. This request was not run. Please submit it again.",
    },
  },
  RUNNER_UNAVAILABLE: {
    message_key: "errors.runner.unavailable",
    http_status: 503,
    messages: {
      "zh-CN": "执行服务暂不可用，请稍后重试。",
      "en-US": "The execution service is unavailable. Try again later.",
    },
  },
  DEPLOYMENT_STOPPED: {
    message_key: "errors.deploymentStopped",
    http_status: 503,
    messages: {
      "zh-CN": "本次任务因系统更新而中止，已有内容已保留。请确认进度后手动继续。",
      "en-US": "This task was stopped for a system update. Existing content was kept. Review its progress before continuing manually.",
    },
  },
  EXECUTION_SERVICE_INCOMPATIBLE: {
    message_key: "errors.runner.executionServiceIncompatible",
    http_status: 503,
    messages: {
      "zh-CN": "执行服务版本不一致，请稍后重试。若问题持续，请联系管理员。",
      "en-US":
        "The execution service versions are incompatible. Try again later. If the problem persists, contact an administrator.",
    },
  },
  AUTH_INVALID_CREDENTIALS: {
    message_key: "errors.auth.invalidCredentials",
    http_status: 401,
    messages: {
      "zh-CN": "邮箱或密码错误。",
      "en-US": "Invalid email or password.",
    },
  },
  AUTH_LOGIN_RATE_LIMITED: {
    message_key: "auth.login.rateLimited",
    http_status: 429,
    messages: {
      "zh-CN": "登录尝试过于频繁，请稍后再试。",
      "en-US": "Too many login attempts. Please try again later.",
    },
  },
  AUTH_LOGIN_PROTECTION_UNAVAILABLE: {
    message_key: "errors.auth.loginProtectionUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "登录保护服务暂不可用，请稍后再试。",
      "en-US":
        "Login protection is temporarily unavailable. Please try again later.",
    },
  },
  AUTH_SESSION_EXPIRED: {
    message_key: "errors.auth.sessionExpired",
    http_status: 401,
    messages: {
      "zh-CN": "登录会话已过期，请重新登录。",
      "en-US": "Your session has expired. Please sign in again.",
    },
  },
  AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN: {
    message_key: "errors.auth.crossOriginRequestForbidden",
    http_status: 403,
    messages: {
      "zh-CN": "无法验证请求来源，请从当前应用内重试。",
      "en-US":
        "The request origin could not be verified. Try again from this application.",
    },
  },
  PASSWORD_POLICY_VIOLATION: {
    message_key: "errors.auth.passwordPolicyViolation",
    http_status: 400,
    messages: {
      "zh-CN": "密码需为 8~16 个字符，且包含大写、小写、数字和标点或符号。",
      "en-US":
        "Password must be 8–16 characters and include uppercase, lowercase, a number, and punctuation or a symbol.",
    },
  },
  PASSWORD_RESET_REQUEST_ACCEPTED: {
    message_key: "auth.passwordReset.requestAccepted",
    http_status: 202,
    messages: {
      "zh-CN": "如果该邮箱对应可用账号，系统将发送密码设置或重置邮件。",
      "en-US":
        "If the email belongs to an eligible account, a password setup or reset email will be sent.",
    },
  },
  PASSWORD_RESET_PROTECTION_UNAVAILABLE: {
    message_key: "errors.auth.passwordResetProtectionUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "密码申请保护服务暂不可用，请稍后重试。",
      "en-US":
        "Password request protection is temporarily unavailable. Please try again later.",
    },
  },
  PASSWORD_EMAIL_UNAVAILABLE: {
    message_key: "auth.passwordReset.emailUnavailable",
    http_status: 503,
    messages: {
      "zh-CN":
        "密码设置或重置邮件服务暂不可用，请稍后重试；如已配置，也可使用 SSO 或 Teams 登录。",
      "en-US":
        "The password setup or reset email service is temporarily unavailable. Try again later, or use SSO or Teams if configured.",
    },
  },
  PASSWORD_RESET_EMAIL_DELIVERY_FAILED: {
    message_key: "auth.passwordReset.deliveryFailed",
    http_status: 503,
    messages: {
      "zh-CN": "安全链接暂未发出，请稍后重试。",
      "en-US": "The secure link could not be sent. Please try again later.",
    },
  },
  PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED: {
    message_key: "auth.passwordReset.invalidOrExpired",
    http_status: 400,
    messages: {
      "zh-CN": "密码设置链接无效或已过期，请重新申请。",
      "en-US":
        "The password setup link is invalid or has expired. Request a new one.",
    },
  },
  REGISTRATION_DISABLED: {
    message_key: "auth.registration.disabled",
    http_status: 403,
    messages: {
      "zh-CN": "当前未开放注册。",
      "en-US": "Registration is currently closed.",
    },
  },
  REGISTRATION_REQUEST_ACCEPTED: {
    message_key: "auth.registration.requestAccepted",
    http_status: 202,
    messages: {
      "zh-CN": "如果该邮箱可以注册，系统将发送账号激活邮件。",
      "en-US":
        "If the email address is eligible, an account activation email will be sent.",
    },
  },
  REGISTRATION_PROTECTION_UNAVAILABLE: {
    message_key: "errors.auth.registrationProtectionUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "注册申请保护服务暂不可用，请稍后重试。",
      "en-US":
        "Registration request protection is temporarily unavailable. Please try again later.",
    },
  },
  REGISTRATION_EMAIL_UNAVAILABLE: {
    message_key: "auth.registration.emailUnavailable",
    http_status: 503,
    messages: {
      "zh-CN": "账号激活邮件服务暂不可用，请稍后重试。",
      "en-US":
        "Account activation email is temporarily unavailable. Please try again later.",
    },
  },
  REGISTRATION_EMAIL_DELIVERY_FAILED: {
    message_key: "auth.registration.deliveryFailed",
    http_status: 503,
    messages: {
      "zh-CN": "账号激活邮件暂未发出，请稍后重试。",
      "en-US":
        "The account activation email could not be sent. Please try again later.",
    },
  },
  REGISTRATION_TOKEN_INVALID_OR_EXPIRED: {
    message_key: "auth.registration.invalidOrExpired",
    http_status: 400,
    messages: {
      "zh-CN": "账号激活链接无效或已过期，请重新申请。",
      "en-US":
        "The account activation link is invalid or has expired. Request a new one.",
    },
  },
  REGISTRATION_EMAIL_ALREADY_REGISTERED: {
    message_key: "auth.registration.emailAlreadyRegistered",
    http_status: 409,
    messages: {
      "zh-CN": "该邮箱已经有账号，请直接登录或重置密码。",
      "en-US":
        "An account already exists for this email. Sign in or reset the password instead.",
    },
  },
  USER_EMAIL_ALREADY_EXISTS: {
    message_key: "errors.user.emailAlreadyExists",
    http_status: 409,
    messages: {
      "zh-CN": "该邮箱已被其他用户使用。",
      "en-US": "This email address is already used by another user.",
    },
  },
  USER_EMAIL_CHANGE_ADMIN_REQUIRED: {
    message_key: "errors.user.emailChangeAdminRequired",
    http_status: 403,
    messages: {
      "zh-CN": "只有管理员可以修改用户邮箱。",
      "en-US": "Only an administrator can change a user's email address.",
    },
  },
  ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN: {
    message_key: "errors.user.adminSelfChangeForbidden",
    http_status: 409,
    messages: {
      "zh-CN": "管理员不能禁用自己或降低自己的管理员角色。",
      "en-US":
        "Administrators cannot disable themselves or remove their own administrator role.",
    },
  },
  LAST_ENABLED_ADMIN_REQUIRED: {
    message_key: "errors.user.lastEnabledAdminRequired",
    http_status: 409,
    messages: {
      "zh-CN": "系统必须至少保留一个启用状态的管理员，无法执行此操作。",
      "en-US":
        "At least one enabled administrator must remain. This operation cannot be completed.",
    },
  },
  AVATAR_UPLOAD_INVALID: {
    message_key: "errors.user.avatarUploadInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "头像上传失败，请选择符合要求的图片后重试。",
      "en-US": "Avatar upload failed. Choose a supported image and try again.",
    },
  },
  FEEDBACK_SUBMISSION_INVALID: {
    message_key: "errors.feedback.submissionInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "反馈内容或图片不符合要求，请检查后重试。",
      "en-US":
        "The feedback text or images do not meet the requirements. Check them and try again.",
    },
  },
  FEEDBACK_SUBMISSION_FAILED: {
    message_key: "errors.feedback.submissionFailed",
    http_status: 503,
    messages: {
      "zh-CN": "反馈暂时无法提交，请稍后重试。",
      "en-US": "Feedback could not be submitted right now. Try again later.",
    },
  },
  CAPABILITY_LOGO_UPLOAD_INVALID: {
    message_key: "errors.capability.logoUploadInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "Logo 上传失败，请选择符合要求的图片后重试。",
      "en-US": "Logo upload failed. Choose a supported image and try again.",
    },
  },
  PRODUCT_LOGO_UPLOAD_INVALID: {
    message_key: "errors.settings.productLogoUploadInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "系统 Logo 上传失败，请选择符合要求的图片后重试。",
      "en-US":
        "System logo upload failed. Choose a supported image and try again.",
    },
  },
  CREDENTIAL_BINDING_CONFLICT: {
    message_key: "errors.credential.bindingConflict",
    http_status: 409,
    messages: {
      "zh-CN": "凭据绑定存在冲突，请先明确所需凭据。",
      "en-US":
        "Credential bindings conflict. Select an explicit credential before continuing.",
    },
  },
  CREDENTIAL_BINDING_REQUIRED: {
    message_key: "errors.credential.bindingRequired",
    http_status: 409,
    messages: {
      "zh-CN": "缺少此插件所需的凭据，请先完成绑定。",
      "en-US":
        "A required credential is missing. Bind a credential before continuing.",
    },
  },
  EXECUTION_ENVIRONMENT_INVALID: {
    message_key: "errors.runner.executionEnvironmentInvalid",
    http_status: 400,
    messages: {
      "zh-CN": "插件执行环境不安全或不受支持，请检查插件的 MCP 配置。",
      "en-US":
        "The plugin execution environment is unsafe or unsupported. Check its MCP configuration.",
    },
  },
  CONVERSATION_OVERLOADED: {
    message_key: "errors.conversation.overloaded",
    http_status: 429,
    messages: {
      "zh-CN": "当前系统使用人数过载，请稍后重试。",
      "en-US": "The system is currently at capacity. Try again later.",
    },
  },
  CREDIT_LIMIT_EXCEEDED: {
    message_key: "errors.conversation.creditLimitExceeded",
    http_status: 429,
    messages: {
      "zh-CN": "你的可用额度已用尽，暂时不能发起新任务。",
      "en-US":
        "Your available credit quota is exhausted and you cannot start a new task right now.",
    },
  },
  PENDING_REQUEST_LIMIT_REACHED: {
    message_key: "errors.conversation.pendingRequestLimitReached",
    http_status: 409,
    messages: {
      "zh-CN": "后续请求已达上限，请先处理现有请求。",
      "en-US":
        "The pending request limit has been reached. Handle an existing request first.",
    },
  },
  PENDING_REQUEST_NOT_QUEUE_HEAD: {
    message_key: "errors.conversation.pendingRequestNotQueueHead",
    http_status: 409,
    messages: {
      "zh-CN": "只能继续执行队首请求。",
      "en-US": "Only the first pending request can be continued.",
    },
  },
  TURN_INTERRUPT_REQUESTED: {
    message_key: "conversation.interrupt.requested",
    http_status: 202,
    messages: { "zh-CN": "正在中断。", "en-US": "Interrupting." },
  },
  TURN_INTERRUPT_REQUEST_FAILED: {
    message_key: "errors.conversation.interruptRequestFailed",
    http_status: 503,
    messages: {
      "zh-CN": "无法发送中断请求，请重试。",
      "en-US": "The interrupt request could not be sent. Try again.",
    },
  },
  TURN_STEER_REQUEST_FAILED: {
    message_key: "errors.conversation.steerRequestFailed",
    http_status: 409,
    messages: {
      "zh-CN": "无法引导当前执行，请确认执行仍在进行后重试。",
      "en-US":
        "Unable to guide the current run. Confirm it is still running and try again.",
    },
  },
  TURN_STEER_REQUEST_UNCERTAIN: {
    message_key: "errors.conversation.steerRequestUncertain",
    http_status: 503,
    messages: {
      "zh-CN":
        "暂时无法确认引导请求是否已受理，请保留当前输入并重试以继续对账。",
      "en-US":
        "The guide request result is temporarily uncertain. Keep the current input and retry to reconcile it.",
    },
  },
  VOICE_TRANSCRIPTION_FAILED: {
    message_key: "errors.composer.voiceTranscriptionFailed",
    http_status: 400,
    messages: {
      "zh-CN": "语音转文字失败，请重试或手动输入。",
      "en-US": "Speech-to-text failed. Try again or enter the text manually.",
    },
  },
  VOICE_TRANSCRIPTION_RATE_LIMITED: {
    message_key: "errors.composer.voiceTranscriptionRateLimited",
    http_status: 429,
    messages: {
      "zh-CN": "语音输入每分钟最多使用 20 次，请稍后再试。",
      "en-US":
        "Voice input can be used up to 20 times per minute. Try again shortly.",
    },
  },
  TEAMS_SSO_NOT_CONFIGURED: {
    message_key: "auth.teamsSso.notConfigured",
    http_status: 503,
    messages: {
      "zh-CN": "Teams 单点登录未配置，请使用账号密码登录。",
      "en-US":
        "Teams single sign-on is not configured. Sign in with your account password.",
    },
  },
  TEAMS_SSO_FAILED: {
    message_key: "errors.teamsFailed",
    http_status: 401,
    messages: {
      "zh-CN": "Teams 登录失败，请重试或联系管理员。",
      "en-US": "Teams sign-in failed. Try again or contact an administrator.",
    },
  },
  AUTH_EMAIL_CAPABILITY_DEGRADED: {
    message_key: "health.authEmail.degraded",
    http_status: 503,
    messages: {
      "zh-CN": "认证邮件功能暂不可用，无法申请新的首次设密或密码重置邮件。",
      "en-US":
        "Authentication email is temporarily unavailable. New password setup or reset emails cannot be requested.",
    },
  },
  DEPLOYMENT_SETTING_READ_ONLY: {
    message_key: "errors.settings.deploymentSettingReadOnly",
    http_status: 403,
    messages: {
      "zh-CN": "该设置由部署配置管理，只能查看状态。",
      "en-US":
        "This setting is managed by deployment configuration and is read-only.",
    },
  },
  PRODUCT_SETTING_UNKNOWN: {
    message_key: "errors.settings.productSettingUnknown",
    http_status: 400,
    messages: {
      "zh-CN": "包含不支持的产品设置。",
      "en-US": "The request contains an unsupported product setting.",
    },
  },
  SYSTEM_MAINTENANCE_ACTIVE: {
    message_key: "errors.system.maintenanceActive",
    http_status: 503,
    messages: {
      "zh-CN": "系统正在维护，请在维护结束后重试。",
      "en-US":
        "The system is under maintenance. Try again after maintenance ends.",
    },
  },
  MODEL_PROVIDER_NOT_CONFIGURED: {
    message_key: "errors.modelProvider.notConfigured",
    http_status: 503,
    messages: {
      "zh-CN": "管理员尚未完成模型服务配置。",
      "en-US": "An administrator has not configured the model service yet.",
    },
  },
  MODEL_MANAGEMENT_DISABLED: {
    message_key: "errors.modelProvider.managementDisabled",
    http_status: 403,
    messages: {
      "zh-CN": "模型配置已由部署环境锁定，当前只能查看。",
      "en-US":
        "Model configuration is locked by the deployment environment and is read-only.",
    },
  },
  MODEL_SELECTION_INVALID: {
    message_key: "errors.modelProvider.selectionInvalid",
    http_status: 409,
    messages: {
      "zh-CN": "所选模型或推理强度当前不可用，请重新选择。",
      "en-US":
        "The selected model or reasoning effort is unavailable. Choose again.",
    },
  },
  MODEL_IN_USE_BY_SYSTEM_SETTING: {
    message_key: "errors.modelProvider.inUseBySystemSetting",
    http_status: 409,
    messages: {
      "zh-CN": "该模型正在被系统设置使用，请先切换或取消相关选择后再删除。",
      "en-US":
        "This model is used by a system setting. Change or clear that selection before deleting it.",
    },
  },
  LAST_ENABLED_MODEL_REQUIRED: {
    message_key: "errors.modelProvider.lastEnabledRequired",
    http_status: 409,
    messages: {
      "zh-CN": "至少需要保留一个“对话可选”的对话模型。",
      "en-US":
        "At least one chat model must remain available in conversations.",
    },
  },
  SYSTEM_ALREADY_INITIALIZED: {
    message_key: "errors.system.alreadyInitialized",
    http_status: 409,
    messages: {
      "zh-CN": "系统已完成初始化。",
      "en-US": "The system has already been initialized.",
    },
  },
  SYSTEM_INITIALIZATION_CREDENTIAL_INVALID: {
    message_key: "errors.system.initializationCredentialInvalid",
    http_status: 403,
    messages: {
      "zh-CN": "初始化凭据无效，请使用安装完成时显示的一次性凭据。",
      "en-US":
        "The initialization credential is invalid. Use the one-time credential shown after installation.",
    },
  },
  CODEX_TURN_FAILED: {
    message_key: "errors.codexTurnFailed",
    http_status: 500,
    messages: {
      "zh-CN": "当前执行失败，请检查提示后重试。",
      "en-US": "The current run failed. Review the message and try again.",
    },
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof errorCatalog;
export const errorCodeSchema = z.enum(
  Object.keys(errorCatalog) as [ErrorCode, ...ErrorCode[]],
);

// Earlier product wording used these names. New API code should emit the
// technical-contract value while readers can normalize persisted/client input.
export const legacyErrorCodeAliases = {
  ADMIN_SELF_PRIVILEGE_CHANGE_FORBIDDEN:
    "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
  SYSTEM_CONCURRENCY_LIMIT_REACHED: "CONVERSATION_OVERLOADED",
  SYSTEM_SETTINGS_INVALID: "PRODUCT_SETTING_UNKNOWN",
} as const satisfies Record<string, ErrorCode>;

export const auditErrorCodeSchema = z.enum(["SMTP_UNAVAILABLE"]);

export const successCodeCatalog = {
  SYSTEM_SETTINGS_UPDATED: {
    message_key: "settings.updated",
    messages: {
      "zh-CN": "系统设置已更新。",
      "en-US": "System settings updated.",
    },
  },
} as const;

export const apiErrorEnvelopeSchema = z.strictObject({
  success: z.literal(false),
  error_code: errorCodeSchema,
  message_key: z.string().min(1).max(200),
  message: z.string().min(1),
  params: jsonObjectSchema.optional(),
  request_id: z.string().min(1).max(160).optional(),
});

export function apiSuccessEnvelopeSchema<T extends z.ZodTypeAny>(
  dataSchema: T,
) {
  return z.strictObject({
    success: z.literal(true),
    data: dataSchema,
    request_id: z.string().min(1).max(160).optional(),
  });
}

export function getErrorCatalogEntry(code: ErrorCode): ErrorCatalogEntry {
  return errorCatalog[code];
}

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
