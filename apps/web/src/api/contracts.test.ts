import { credentialPluginConfigurationSchema } from "@linksense/shared"
import { describe, expect, it } from "vitest"

import {
  authSessionSchema,
  auditRecordSchema,
  bootstrapSchema,
  capabilityImportPreviewSchema,
  capabilitySummarySchema,
  conversationDetailSchema,
  conversationSchema,
  credentialBindingSchema,
  credentialSchema,
  getNativeCodexPayload,
  healthSchema,
  initializeSystemResultSchema,
  marketplaceCatalogItemSchema,
  marketplaceReviewDetailSchema,
  sseEventSchema,
  turnStartReceiptSchema,
  userSchema,
} from "@/api/contracts"

const now = "2026-07-11T00:00:00.000Z"

describe("API response contracts", () => {
  it("keeps authentication responses independent from full user profiles", () => {
    const authUser = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "person@example.com",
      name: "Person",
      avatar_object_key: null,
      role: "admin",
      status: "active",
      preferred_locale: "zh-CN",
      running_message_action: "queue",
      last_login_at: "2026-08-31T08:00:00.000Z",
      last_login_method: "password",
      password_updated_at: "2026-08-01T08:00:00.000Z",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-31T08:00:00.000Z",
    }
    const session = {
      access_token: "a".repeat(48),
      access_token_expires_at: "2026-09-01T10:00:00.000Z",
      refresh_session_expires_at: "2026-11-30T08:00:00.000Z",
      user: authUser,
    }

    expect(authSessionSchema.parse(session)).toEqual(session)
    expect(initializeSystemResultSchema.parse({ user: authUser })).toEqual({
      user: authUser,
    })
    expect(
      userSchema.safeParse({
        ...authUser,
        avatar_url: null,
      }).success
    ).toBe(false)
  })

  it("accepts current application icon metadata on conversation summaries", () => {
    const result = conversationSchema.parse({
      category_id: null,
      id: "conversation-application-icon",
      title: "AISG学校政策问答助手",
      updated_at: now,
      application: {
        id: "50000000-0000-4000-8000-000000000001",
        name: "AISG学校政策问答助手",
        icon: { type: "preset", preset: "graduation-cap" },
      },
    })

    expect(result.application?.icon).toEqual({
      type: "preset",
      preset: "graduation-cap",
    })
  })

  it("accepts durable starting and already-running turn receipts", () => {
    const receipt = {
      turn_id: "00000000-0000-4000-8000-000000000001",
      accepted: true,
      status: "starting",
    }

    expect(turnStartReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(
      turnStartReceiptSchema.parse({ ...receipt, status: "running" })
    ).toEqual({ ...receipt, status: "running" })
    expect(
      turnStartReceiptSchema.safeParse({ ...receipt, status: "completed" })
        .success
    ).toBe(false)
  })

  it("requires the SKILL.md body preview fields on capability import previews", () => {
    const preview = {
      preview_token: "preview-token",
      expires_at: now,
      operation: "install",
      capability_id: null,
      source: {
        source_type: "local",
        import_kind: "zip",
        source_url: null,
        filename: "pptx.zip",
      },
      type: "skill",
      name: "pptx",
      description: null,
      manifest: {},
      declared_capabilities: [],
      declared_environment_keys: [],
      risk_summary: {},
      has_logo: false,
      skill_content_preview: "# PPTX Skill",
      skill_content_truncated: false,
    }

    expect(capabilityImportPreviewSchema.parse(preview)).toMatchObject({
      skill_content_preview: preview.skill_content_preview,
      skill_content_truncated: false,
    })
    expect(
      capabilityImportPreviewSchema.safeParse({
        ...preview,
        skill_content_preview: "😀".repeat(100_000),
        skill_content_truncated: true,
      }).success
    ).toBe(true)
    expect(
      capabilityImportPreviewSchema.safeParse({
        ...preview,
        skill_content_preview: undefined,
      }).success
    ).toBe(false)
    expect(
      capabilityImportPreviewSchema.safeParse({
        ...preview,
        skill_content_truncated: undefined,
      }).success
    ).toBe(false)
  })

  it("accepts ClawHub remote-file capability import previews", () => {
    const preview = {
      preview_token: "clawhub-preview-token",
      expires_at: now,
      operation: "install",
      capability_id: null,
      source: {
        source_type: "clawhub",
        import_kind: "remote_files",
        skill_id: "00000000-0000-4000-8000-000000000002",
        owner_handle: "openclaw",
        slug: "browser-use",
        version: "1.2.3",
        security_status: "clean",
        security_has_warnings: true,
        canonical_url: "https://clawhub.ai/openclaw/browser-use",
      },
      type: "skill",
      name: "Browser Use",
      description: "Browser automation skill",
      manifest: {},
      declared_capabilities: ["network"],
      declared_environment_keys: [],
      risk_summary: { contains_scripts: true },
      has_logo: false,
      skill_content_preview: "# Browser Use",
      skill_content_truncated: false,
    }

    expect(capabilityImportPreviewSchema.parse(preview).source).toEqual(
      preview.source
    )
  })

  it("normalizes the canonical bootstrap authentication shape", () => {
    const result = bootstrapSchema.parse({
      initialized: true,
      initialization_credential_required: true,
      organization_display_name: "示例系统",
      default_locale: "en-US",
      logo_url: "/api/v1/system/logo?v=2026-08-05T00%3A00%3A00.000Z",
      logo_updated_at: "2026-08-05T00:00:00.000Z",
      auth: {
        password: { status: "available" },
        oidc: { status: "available" },
        teams: { status: "not_configured" },
      },
      maintenance: {
        enabled: true,
        active: true,
        reason: "Database upgrade",
        start_at: "2026-08-04T12:00:00.000Z",
        end_at: "2026-08-04T13:00:00.000Z",
      },
    })

    expect(result.system_name).toBe("示例系统")
    expect(result.initialization_credential_required).toBe(true)
    expect(result.default_language).toBe("en-US")
    expect(result.logo_url).toBe(
      "/api/v1/system/logo?v=2026-08-05T00%3A00%3A00.000Z"
    )
    expect(result.logo_updated_at).toBe("2026-08-05T00:00:00.000Z")
    expect(result.oidc?.status).toBe("available")
    expect(result.teams_sso?.status).toBe("not_configured")
    expect(result.maintenance?.active).toBe(true)
  })

  it("normalizes current user token usage summaries", () => {
    const result = userSchema.parse({
      id: "user-1",
      name: "林晓",
      email: "lin@example.com",
      role: "user",
      status: "active",
      registration_source: "self_registration",
      credit_quota: {
        total: null,
        weekly: {
          limit_credits: "0.001",
          used_credits: "0.00025",
          remaining_credits: "0.00075",
          remaining_percentage: 75,
          reset_at: now,
        },
        monthly: null,
      },
    })

    expect(result.credit_quota).toEqual({
      total: null,
      weekly: {
        limit_credits: "0.001",
        used_credits: "0.00025",
        remaining_credits: "0.00075",
        remaining_percentage: 75,
        reset_at: now,
      },
      monthly: null,
    })
    expect(
      userSchema.parse({
        id: "user-1",
        name: "林晓",
        email: "lin@example.com",
        role: "user",
        status: "active",
        registration_source: "organization_invitation",
      }).credit_quota
    ).toBeUndefined()
  })

  it("rejects removed school credential and binding structures", () => {
    expect(
      credentialSchema.parse({
        id: "credential-1",
        name: "个人服务",
        provider_type: "custom_api_key",
        secret_keys: ["API_KEY", "API_SECRET"],
        status: "active",
        created_at: now,
        updated_at: now,
        last_used_at: null,
      }).secret_keys
    ).toEqual(["API_KEY", "API_SECRET"])
    expect(
      credentialSchema.safeParse({
        id: "credential-1",
        name: "共享服务",
        provider_type: "custom_api_key",
        scope: "school",
        status: "active",
        created_at: now,
        updated_at: now,
        last_used_at: null,
      }).success
    ).toBe(false)
    expect(
      credentialBindingSchema.safeParse({
        id: "binding-1",
        capability_id: "plugin-1",
        credential_id: "credential-1",
        env_key: "SERVICE_API_KEY",
        status: "active",
        created_at: now,
        updated_at: now,
        binding_scope: "school",
      }).success
    ).toBe(false)
    expect(
      credentialPluginConfigurationSchema.safeParse({
        capability_id: "plugin-1",
        available: true,
        fields: [{ env_key: "SERVICE_API_KEY", status: "school" }],
      }).success
    ).toBe(false)
  })

  it("flattens a conversation detail projection and keeps only staged attachments in the composer", () => {
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: "conversation-1",
        title: "测试对话",
        archive_status: "active",
        updated_at: now,
      },
      turns: [{ id: "turn-1", status: "running", model: "gpt-5.6-sol" }],
      messages: [
        {
          id: "message-1",
          turn_id: "turn-1",
          role: "user",
          content_text: "开始",
          selected_capabilities: [
            {
              id: "60000000-0000-4000-8000-000000000001",
              name: "frontend-slides",
              type: "skill",
            },
          ],
          display: {
            kind: "presentation_annotation",
            file_id: "70000000-0000-4000-8000-000000000001",
            file_name: "AI 入门.pptx",
            annotations: [
              {
                request: "改为英文",
                slide_number: 1,
                selection_count: 1,
              },
            ],
            annotation_count: 1,
          },
        },
        {
          id: "message-2",
          turn_id: "turn-1",
          role: "assistant",
          content_text: "完成",
        },
      ],
      pending_requests: [
        {
          id: "pending-1",
          queue_no: 1,
          status: "waiting_previous_turn",
          input_text: "后续请求",
          priority_capability_ids: ["skill-1"],
          created_at: now,
        },
      ],
      events: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: "30000000-0000-4000-8000-000000000001",
          sequence_no: 4,
          visibility: "user_visible",
          sse_event_id: "conversation-1:4",
          event_type: "conversation.step.started",
          payload: {
            schema_version: 1,
            item_id: "analysis-1",
            action: "analysis",
            safe_summary: "正在分析",
          },
          created_at: now,
        },
      ],
      activities: [
        {
          id: "activity-1",
          type: "conversation.step.started",
          action: "analysis",
        },
      ],
      model_context_usage: {
        used_tokens: 39_021,
        model_context_window: 142_500,
        updated_at: now,
      },
      turn_file_change_counts: { "turn-1": 3 },
      files: [
        {
          id: "draft-file",
          filename: "draft.pdf",
          kind: "attachment",
          status: "staged",
        },
        {
          id: "used-file",
          filename: "used.pdf",
          kind: "attachment",
          status: "bound",
          turn_id: "turn-1",
        },
        {
          id: "pending-file",
          filename: "next.pdf",
          kind: "attachment",
          status: "bound",
          pending_request_id: "pending-1",
        },
        {
          id: "artifact",
          filename: "report.pdf",
          kind: "artifact",
          status: "available",
          turn_id: "turn-1",
          downloadable: true,
        },
      ],
    })

    expect(result.running_turn?.id).toBe("turn-1")
    expect(result.running_turn?.model).toBe("gpt-5.6-sol")
    expect(result.attachments?.map((file) => file.id)).toEqual(["draft-file"])
    expect(result.messages?.[0]?.attachments?.[0]?.id).toBe("used-file")
    expect(result.messages?.[0]?.display).toMatchObject({
      kind: "presentation_annotation",
      annotations: [{ request: "改为英文" }],
    })
    expect(result.messages?.[0]?.selected_capabilities).toEqual([
      {
        id: "60000000-0000-4000-8000-000000000001",
        name: "frontend-slides",
        type: "skill",
      },
    ])
    expect(result.messages?.[1]?.artifacts).toBeUndefined()
    expect(result.artifacts?.[0]?.id).toBe("artifact")
    expect(result.last_event_id).toBe("conversation-1:4")
    expect(result.activities?.[0]?.type).toBe("analysis")
    expect(result.model_context_usage).toEqual({
      used_tokens: 39_021,
      model_context_window: 142_500,
      updated_at: now,
    })
    expect(result.turn_file_change_counts).toEqual({ "turn-1": 3 })
    expect(result.pending_requests?.[0]).toMatchObject({
      input_text: "后续请求",
      priority_capability_ids: ["skill-1"],
      attachments: [expect.objectContaining({ id: "pending-file" })],
    })
  })

  it("preserves knowledge selection snapshots and structured citations", () => {
    const knowledgeBaseId = "10000000-0000-4000-8000-000000000001"
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: "conversation-knowledge",
        title: "知识库问答",
        updated_at: now,
        selected_knowledge_base_ids: [knowledgeBaseId],
      },
      pending_requests: [
        {
          id: "pending-knowledge",
          queue_no: 1,
          status: "waiting_previous_turn",
          knowledge_base_ids: [knowledgeBaseId],
        },
      ],
      messages: [
        {
          id: "message-knowledge-user",
          role: "user",
          content_text: "保修多久？",
          selected_knowledge_base_ids: [knowledgeBaseId],
        },
        {
          id: "message-knowledge-assistant",
          role: "assistant",
          content_text: "保修期为一年。",
          knowledge_citations: [
            {
              citation_id: "90000000-0000-4000-8000-000000000001",
              citation_no: 1,
              summary: {
                knowledge_base_name: "售后知识库",
                document_name: "售后政策.pdf",
                title_path: ["售后政策"],
                page_numbers: [2],
              },
              anchors: [{ occurrence_no: 1, after_offset_utf16: 7 }],
            },
          ],
        },
      ],
    })

    expect(result.selected_knowledge_base_ids).toEqual([knowledgeBaseId])
    expect(result.pending_requests?.[0]?.knowledge_base_ids).toEqual([
      knowledgeBaseId,
    ])
    expect(result.messages?.[0]?.selected_knowledge_base_ids).toEqual([
      knowledgeBaseId,
    ])
    expect(result.messages?.[1]?.knowledge_citations?.[0]).toMatchObject({
      citation_id: "90000000-0000-4000-8000-000000000001",
      citation_no: 1,
      summary: { document_name: "售后政策.pdf" },
      anchors: [{ occurrence_no: 1, after_offset_utf16: 7 }],
    })
  })

  it("defaults missing turn file-change counts in a conversation detail", () => {
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: "conversation-without-file-counts",
        title: "没有文件统计",
        archive_status: "active",
        updated_at: now,
      },
    })

    expect(result.turn_file_change_counts).toEqual({})
  })

  it("preserves fork-source metadata and copied message sequence numbers", () => {
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: "forked-conversation",
        title: "源任务(2)",
        archive_status: "active",
        updated_at: now,
        fork_source: {
          available: true,
          conversation_id: "source-conversation",
          message_id: "source-message",
          title: "源任务",
          boundary_sequence_no: 2,
        },
      },
      messages: [
        {
          id: "copied-message",
          turn_id: "copied-turn",
          sequence_no: 2,
          role: "assistant",
          content_text: "复制的回答",
          created_at: now,
        },
      ],
    })

    expect(result.fork_source).toEqual({
      available: true,
      conversation_id: "source-conversation",
      message_id: "source-message",
      title: "源任务",
      boundary_sequence_no: 2,
    })
    expect(result.messages?.[0]?.sequence_no).toBe(2)
  })

  it("projects current-turn guidance metadata onto its user message", () => {
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const turnId = "30000000-0000-4000-8000-000000000001"
    const messageId = "40000000-0000-4000-8000-000000000001"
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: conversationId,
        title: "运行中的任务",
        archive_status: "active",
        updated_at: now,
      },
      turns: [
        {
          id: turnId,
          status: "running",
          started_at: now,
          completed_at: null,
        },
      ],
      messages: [
        {
          id: messageId,
          turn_id: turnId,
          role: "user",
          content_text: "所有页面的这类图片都去掉",
          created_at: now,
        },
      ],
      events: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          conversation_id: conversationId,
          turn_id: turnId,
          sequence_no: 7,
          visibility: "user_visible",
          sse_event_id: `${conversationId}:7`,
          event_type: "conversation.message.completed",
          payload: {
            schema_version: 1,
            message_id: messageId,
            role: "user",
            usage_type: "steer_current_turn",
          },
          created_at: now,
        },
      ],
    })

    expect(result.messages?.[0]).toMatchObject({
      usage_type: "steer_current_turn",
      event_sequence_no: 7,
    })
  })

  it("prefers the explicit latest SSE cursor over the filtered detail events", () => {
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: "conversation-with-explicit-cursor",
        title: "长任务",
        archive_status: "active",
        updated_at: now,
      },
      last_event_id: "conversation-with-explicit-cursor:950",
      events: [],
    })

    expect(result.last_event_id).toBe("conversation-with-explicit-cursor:950")
  })

  it("joins native message phases and assigns turn artifacts only to the final answer", () => {
    const result = conversationDetailSchema.parse({
      conversation: {
        category_id: null,
        id: "conversation-native",
        title: "原生事件",
        archive_status: "active",
        updated_at: now,
      },
      turns: [
        {
          id: "turn-native",
          status: "completed",
          started_at: now,
          completed_at: now,
        },
      ],
      messages: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          turn_id: "turn-native",
          role: "assistant",
          content_text: "正在检查文件",
        },
        {
          id: "40000000-0000-4000-8000-000000000002",
          turn_id: "turn-native",
          role: "assistant",
          content_text: "检查完成",
        },
      ],
      events: [
        nativeEvent({
          sequence: 2,
          itemId: "item-commentary",
          messageId: "40000000-0000-4000-8000-000000000001",
          phase: "commentary",
        }),
        nativeEvent({
          sequence: 5,
          itemId: "item-final",
          messageId: "40000000-0000-4000-8000-000000000002",
          phase: "final_answer",
        }),
      ],
      files: [
        {
          id: "artifact-native",
          filename: "report.xlsx",
          kind: "artifact",
          status: "available",
          turn_id: "turn-native",
          downloadable: true,
        },
      ],
    })

    expect(result.messages?.[0]).toMatchObject({
      item_id: "item-commentary",
      phase: "commentary",
      event_sequence_no: 2,
    })
    expect(result.messages?.[0]?.artifacts).toBeUndefined()
    expect(result.messages?.[1]).toMatchObject({
      item_id: "item-final",
      phase: "final_answer",
      event_sequence_no: 5,
      artifacts: [expect.objectContaining({ id: "artifact-native" })],
    })
    expect(result.artifacts).toEqual([])
    expect(result.events).toEqual([
      expect.objectContaining({
        id: "conversation-native:2",
        type: "item/completed",
        sequence_no: 2,
      }),
      expect.objectContaining({
        id: "conversation-native:5",
        type: "item/completed",
        sequence_no: 5,
      }),
    ])
  })

  it("preserves sanitized native activity detail fields", () => {
    const event = sseEventSchema.parse({
      id: "60000000-0000-4000-8000-000000000007",
      conversation_id: "20000000-0000-4000-8000-000000000001",
      turn_id: "30000000-0000-4000-8000-000000000001",
      sequence_no: 7,
      visibility: "user_collapsed",
      sse_event_id: "conversation-native:7",
      event_type: "item/completed",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "thread-native",
          turnId: "turn-native",
          item: {
            id: "command-native",
            type: "commandExecution",
            status: "completed",
            command: "pnpm test",
            commandActions: [
              { type: "unknown", command: "pnpm test" },
              { type: "search", command: "rg TODO apps/web" },
            ],
            source: "agent",
            exitCode: 0,
            durationMs: 1250,
          },
        },
      },
      created_at: now,
    })

    const commandPayload = getNativeCodexPayload(event)
    expect(commandPayload?.method).toBe("item/completed")
    if (commandPayload?.method !== "item/completed") {
      throw new Error("expected completed native command payload")
    }
    expect(commandPayload.params.item).toMatchObject({
      command: "pnpm test",
      commandActions: [
        { type: "unknown", command: "pnpm test" },
        { type: "search", command: "rg TODO apps/web" },
      ],
      source: "agent",
      exitCode: 0,
      durationMs: 1250,
    })

    const knowledgeEvent = sseEventSchema.parse({
      id: "60000000-0000-4000-8000-000000000018",
      conversation_id: "20000000-0000-4000-8000-000000000001",
      turn_id: "30000000-0000-4000-8000-000000000001",
      sequence_no: 18,
      visibility: "user_collapsed",
      sse_event_id: "conversation-native:18",
      event_type: "item/completed",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "thread-native",
          turnId: "turn-native",
          item: {
            id: "knowledge-search-native",
            type: "mcpToolCall",
            server: "linksense_core",
            tool: "search_knowledge_base",
            status: "completed",
            failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
          },
        },
      },
      created_at: now,
    })
    const knowledgePayload = getNativeCodexPayload(knowledgeEvent)
    expect(knowledgePayload?.method).toBe("item/completed")
    if (knowledgePayload?.method !== "item/completed") {
      throw new Error("expected completed native knowledge payload")
    }
    expect(knowledgePayload.params.item).toEqual({
      id: "knowledge-search-native",
      type: "mcpToolCall",
      server: "linksense_core",
      tool: "search_knowledge_base",
      status: "completed",
      failureCode: "KNOWLEDGE_NO_AVAILABLE_BASES",
    })

    const nullableSearchEvent = sseEventSchema.parse({
      id: "60000000-0000-4000-8000-000000000008",
      conversation_id: "20000000-0000-4000-8000-000000000001",
      turn_id: "30000000-0000-4000-8000-000000000001",
      sequence_no: 8,
      visibility: "user_collapsed",
      sse_event_id: "conversation-native:8",
      event_type: "item/started",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/started",
        params: {
          threadId: "thread-native",
          turnId: "turn-native",
          item: {
            id: "search-native",
            type: "webSearch",
            action: {
              type: "search",
              query: null,
              queries: null,
            },
          },
        },
      },
      created_at: now,
    })
    const searchPayload = getNativeCodexPayload(nullableSearchEvent)
    expect(searchPayload?.method).toBe("item/started")
    if (searchPayload?.method !== "item/started") {
      throw new Error("expected started native search payload")
    }
    expect(
      searchPayload.params.item.type === "webSearch"
        ? searchPayload.params.item.action
        : null
    ).toEqual({ type: "search", query: null, queries: null })
  })

  it("preserves bounded native reasoning summaries and rejects unsafe deltas", () => {
    const record = {
      id: "60000000-0000-4000-8000-000000000009",
      conversation_id: "20000000-0000-4000-8000-000000000001",
      turn_id: "30000000-0000-4000-8000-000000000001",
      sequence_no: 9,
      visibility: "user_collapsed",
      sse_event_id: "conversation-native:9",
      event_type: "item/reasoning/summaryTextDelta",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "thread-native",
          turnId: "turn-native",
          itemId: "reasoning-native",
          summaryIndex: 0,
          delta: "Evaluating $WORKSPACE/tests with token=[REDACTED]",
        },
      },
      created_at: now,
    } as const

    const event = sseEventSchema.parse(record)
    const payload = getNativeCodexPayload(event)
    expect(payload?.method).toBe("item/reasoning/summaryTextDelta")
    if (payload?.method !== "item/reasoning/summaryTextDelta") {
      throw new Error("expected native reasoning summary delta")
    }
    expect(payload.params).toMatchObject({
      itemId: "reasoning-native",
      summaryIndex: 0,
      delta: "Evaluating $WORKSPACE/tests with token=[REDACTED]",
    })
    expect(
      sseEventSchema.safeParse({
        ...record,
        payload: {
          ...record.payload,
          params: {
            ...record.payload.params,
            delta: "Reading /Users/one/private/report.txt",
          },
        },
      }).success
    ).toBe(false)
  })

  it("accepts the durable Plan review identity attached to a native Plan item", () => {
    const payload = getNativeCodexPayload({
      type: "item/completed",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "thread-plan",
          turnId: "turn-plan",
          item: {
            id: "native-plan-1",
            type: "plan",
            text: "## 实施计划",
          },
        },
        local: {
          message_id: "60000000-0000-4000-8000-000000000010",
          plan_review_id: "60000000-0000-4000-8000-000000000011",
        },
      },
    })

    expect(payload).toMatchObject({
      method: "item/completed",
      local: {
        message_id: "60000000-0000-4000-8000-000000000010",
        plan_review_id: "60000000-0000-4000-8000-000000000011",
      },
    })
  })

  it("accepts the exact final answer superseded by a blocked native Stop hook", () => {
    const supersededMessageId = "60000000-0000-4000-8000-000000000012"
    const payload = getNativeCodexPayload({
      type: "hook/completed",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "hook/completed",
        params: {
          threadId: "thread-plan",
          turnId: "turn-plan",
          run: { eventName: "stop", status: "blocked" },
          supersededItemId: "native-invalid-final-1",
        },
        local: {
          superseded_message_id: supersededMessageId,
          superseded_item_id: "native-invalid-final-1",
        },
      },
    })

    expect(payload).toMatchObject({
      method: "hook/completed",
      params: { supersededItemId: "native-invalid-final-1" },
      local: {
        superseded_message_id: supersededMessageId,
        superseded_item_id: "native-invalid-final-1",
      },
    })
  })

  it.each([
    ["unredacted secret", "curl --token=raw-secret-value"],
    ["absolute path", "cat /Users/one/private/report.txt"],
    ["oversized preview", "x".repeat(2_001)],
  ])("rejects %s in native command previews", (_label, command) => {
    const payload = nativeCommandPayload(command)
    const record = nativeCommandRecord(payload)

    expect(sseEventSchema.safeParse(record).success).toBe(false)
    expect(
      getNativeCodexPayload({ type: "item/completed", payload })
    ).toBeNull()
  })

  it("rejects non-protocol native local aliases and capability metadata", () => {
    const payload = nativeCommandPayload("pnpm test")

    expect(
      getNativeCodexPayload({
        type: "item/completed",
        payload: { ...payload, local: { messageId: "message-1" } },
      })
    ).toBeNull()
    expect(
      getNativeCodexPayload({
        type: "item/completed",
        payload: {
          ...payload,
          local: {
            capability: { id: "skill-1", name: "PPTX", type: "skill" },
          },
        },
      })
    ).toBeNull()
  })

  it("normalizes conversation, capability preference, and SSE fields", () => {
    const conversation = conversationSchema.parse({
      category_id: null,
      id: "conversation-1",
      title: "未命名对话",
      title_source: "fallback",
      archive_status: "active",
      updated_at: now,
    })
    const capability = capabilitySummarySchema.parse({
      id: "capability-1",
      name: "Documents",
      slug: "documents",
      type: "skill",
      description: null,
      status: "active",
      source_type: "local",
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      is_owner: true,
      can_manage: true,
      can_govern: true,
      has_logo: false,
      preference_status: "disabled",
      manifest: {},
      risk_summary: {},
      created_at: now,
      updated_at: now,
    })
    const event = sseEventSchema.parse({
      id: "60000000-0000-4000-8000-000000000001",
      conversation_id: "20000000-0000-4000-8000-000000000001",
      turn_id: "30000000-0000-4000-8000-000000000001",
      sequence_no: 7,
      visibility: "user_visible",
      sse_event_id: "20000000-0000-4000-8000-000000000001:7",
      event_type: "conversation.completed",
      payload: {
        schema_version: 1,
        turn_id: "30000000-0000-4000-8000-000000000001",
        codex_turn_id: "native-turn-1",
        status: "completed",
      },
      created_at: now,
    })

    expect(conversation.title).toBe("未命名任务")
    expect(capability.personally_disabled).toBe(true)
    expect(capability).toMatchObject({
      builtin_key: null,
      is_builtin: false,
      can_select: false,
      can_delete: true,
    })
    expect(event).toMatchObject({
      id: "20000000-0000-4000-8000-000000000001:7",
      type: "conversation.completed",
      created_at: now,
    })
  })

  it.each([
    undefined,
    { verdict: "blocked", scanner_version: "obsolete" },
    "invalid",
  ])(
    "omits removed scan metadata %j from capability responses",
    (review) => {
      const capability = capabilitySummarySchema.parse({
        id: "historical-capability",
        name: "Historical Skill",
        slug: "historical-skill",
        type: "skill",
        description: null,
        status: "active",
        source_type: "local",
        marketplace_listing_id: null,
        marketplace_release_id: null,
        logo_url: null,
        is_owner: true,
        can_manage: true,
        can_govern: false,
        has_logo: false,
        preference_status: "disabled",
        manifest: {},
        risk_summary: { supply_chain_review: review },
        created_at: now,
        updated_at: now,
      })

      expect(capability.risk_summary).not.toHaveProperty("supply_chain_review")
    }
  )

  it("normalizes built-in capabilities as non-selectable and non-deletable", () => {
    const input = {
      id: "builtin:capability:linksense-browser",
      name: "linksense-browser",
      slug: "linksense-browser",
      type: "skill",
      description: null,
      status: "active",
      source_type: "builtin",
      builtin_key: "linksense-browser",
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
    }
    const builtIn = capabilitySummarySchema.parse(input)

    expect(builtIn).toMatchObject({
      is_builtin: true,
      can_select: false,
      can_delete: false,
    })
    expect(
      capabilitySummarySchema.safeParse({ ...input, can_delete: true }).success
    ).toBe(false)
  })

  it("accepts reviewed marketplace evidence and rejects removed capability scopes", () => {
    const listing = {
      id: "10000000-0000-4000-8000-000000000001",
      publisher_id: "10000000-0000-4000-8000-000000000002",
      publisher_name: "Publisher",
      type: "skill",
      slug: "team-reports",
      status: "published",
      current_release_id: "10000000-0000-4000-8000-000000000003",
      suspended_by: null,
      suspended_at: null,
      suspension_reason: null,
      created_at: now,
      updated_at: now,
    }
    const release = {
      id: listing.current_release_id,
      listing_id: listing.id,
      source_capability_id: "10000000-0000-4000-8000-000000000004",
      release_number: 1,
      status: "approved",
      name: "team-reports",
      description: "Team reports",
      release_notes: "Initial release",
      logo_url: null,
      content_sha256: "a".repeat(64),
      manifest: { name: "team-reports" },
      risk_summary: {
        contains_mcp_server: false,
        contains_scripts: false,
        contains_external_connections: false,
        requires_environment_variables: false,
        requires_credentials: false,
        contains_dependency_download_commands: false,
        declared_environment_keys: [],
        dependency_commands: [],
      },
      submitted_by: listing.publisher_id,
      reviewer_id: "10000000-0000-4000-8000-000000000005",
      review_comment: "Approved",
      submitted_at: now,
      reviewed_at: now,
      published_at: now,
      created_at: now,
      updated_at: now,
    }

    expect(
      marketplaceCatalogItemSchema.parse({
        listing,
        release,
        installed_capability_id: null,
        installed_release_id: null,
        update_available: false,
        install_count: 3,
      })
    ).toMatchObject({ listing: { status: "published" }, install_count: 3 })
    expect(
      marketplaceReviewDetailSchema.parse({
        listing,
        release,
        files: ["SKILL.md"],
        skill_content: "# Team reports",
      })
    ).toMatchObject({ files: ["SKILL.md"] })
    expect(
      capabilitySummarySchema.safeParse({
        id: "capability-1",
        name: "Removed scope",
        slug: "removed-scope",
        type: "skill",
        description: null,
        scope: "global",
        status: "active",
        source_type: "local",
        marketplace_listing_id: null,
        marketplace_release_id: null,
        logo_url: null,
        is_owner: true,
        can_manage: true,
        can_govern: true,
        has_logo: false,
        preference_status: "enabled",
        manifest: {},
        risk_summary: {},
        created_at: now,
        updated_at: now,
      }).success
    ).toBe(false)
  })

  it("normalizes legacy fallback task titles without changing manual titles", () => {
    const legacyEnglishFallback = conversationSchema.parse({
      category_id: null,
      id: "conversation-legacy-en",
      title: "Untitled conversation",
      title_source: "fallback",
      updated_at: now,
    })
    const manualLegacyText = conversationSchema.parse({
      category_id: null,
      id: "conversation-manual",
      title: "未命名对话",
      title_source: "manual",
      updated_at: now,
    })

    expect(legacyEnglishFallback.title).toBe("Untitled task")
    expect(manualLegacyText.title).toBe("未命名对话")
  })

  it("converts health component maps into the frontend list contract", () => {
    const result = healthSchema.parse({
      status: "unavailable",
      readiness: "unready",
      running_turn_count: 4,
      redis_running_turn_count: 4,
      runner_running_turn_count: 3,
      observed_unresolved_running_turn_slot_count: 1,
      running_turn_recovery: {
        outcome: "not_started",
        last_attempt_at: null,
        last_success_at: null,
        last_failure_at: null,
        reason_code: null,
      },
      docker_resource_usage: {
        status: "available",
        checked_at: now,
        reason_code: null,
        services: [
          {
            key: "api",
            service_type: "compose",
            status: "available",
            container_count: 2,
            running_container_count: 2,
            cpu_percent: 12.5,
            memory_used_bytes: 268_435_456,
            memory_limit_bytes: 1_073_741_824,
            memory_percent: 25,
            pids: 42,
            state: "running",
          },
        ],
      },
      components: {
        api: { status: "available", checked_at: now, reason_code: null },
        auth_email: { status: "degraded" },
        oidc: { status: "not_configured" },
        running_turn_recovery: {
          status: "not_observed",
          checked_at: now,
          reason_code: "RUNNING_TURN_RECOVERY_NOT_OBSERVED",
        },
      },
    })

    expect(result.overall_status).toBe("unavailable")
    expect(result).toMatchObject({
      running_turn_count: 4,
      redis_running_turn_count: 4,
      runner_running_turn_count: 3,
      observed_unresolved_running_turn_slot_count: 1,
      running_turn_recovery: { outcome: "not_started" },
      docker_resource_usage: {
        status: "available",
        services: [
          expect.objectContaining({
            key: "api",
            memory_percent: 25,
          }),
        ],
      },
    })
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "api", status: "healthy" }),
        expect.objectContaining({ key: "auth_email", status: "degraded" }),
        expect.objectContaining({ key: "oidc", status: "not_configured" }),
        expect.objectContaining({
          key: "running_turn_recovery",
          status: "not_observed",
        }),
      ])
    )
  })

  it("maps canonical audit actor and IP fields without exposing extra data", () => {
    const result = auditRecordSchema.parse({
      id: "audit-1",
      actor_id: "user-1",
      actor_email: "user@example.test",
      action: "conversation_created",
      target_type: null,
      target_id: null,
      result: "success",
      ip_address: "192.0.2.1",
      metadata: null,
      created_at: now,
    })

    expect(result.actor_name).toBe("user-1")
    expect(result.actor_email).toBe("user@example.test")
    expect(result.target_type).toBeNull()
    expect(result.target_id).toBeNull()
    expect(result.source_ip).toBe("192.0.2.1")
    expect(result.metadata).toBeUndefined()
  })
})

function nativeEvent({
  sequence,
  itemId,
  messageId,
  phase,
}: {
  sequence: number
  itemId: string
  messageId: string
  phase: "commentary" | "final_answer"
}) {
  return {
    id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    conversation_id: "20000000-0000-4000-8000-000000000001",
    turn_id: "30000000-0000-4000-8000-000000000001",
    sequence_no: sequence,
    visibility: "user_visible",
    sse_event_id: `conversation-native:${sequence}`,
    event_type: "item/completed",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "thread-native",
        turnId: "turn-native",
        item: {
          id: itemId,
          type: "agentMessage",
          text: phase === "commentary" ? "正在检查文件" : "检查完成",
          phase,
        },
      },
      local: { message_id: messageId },
    },
    created_at: now,
  }
}

function nativeCommandPayload(command: string) {
  return {
    schema_version: 2 as const,
    source: "codex_app_server" as const,
    method: "item/completed" as const,
    params: {
      threadId: "thread-native",
      turnId: "turn-native",
      item: {
        id: "command-native",
        type: "commandExecution" as const,
        status: "completed" as const,
        command,
        commandActions: [{ type: "unknown" as const, command }],
      },
    },
  }
}

function nativeCommandRecord(payload: ReturnType<typeof nativeCommandPayload>) {
  return {
    id: "60000000-0000-4000-8000-000000000009",
    conversation_id: "20000000-0000-4000-8000-000000000001",
    turn_id: "30000000-0000-4000-8000-000000000001",
    sequence_no: 9,
    visibility: "user_collapsed",
    sse_event_id: "conversation-native:9",
    event_type: "item/completed",
    payload,
    created_at: now,
  }
}
