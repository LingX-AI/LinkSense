import { describe, expect, it } from "vitest"

import type { Conversation } from "@/api/contracts"
import {
  embedGateMessageKey,
  hostAuthenticationFailureError,
  projectExternalEmbedConversation,
  type EmbedOptimisticSubmission,
} from "./embed-conversation-view"

describe("external embed conversation projection", () => {
  it("hides internal resource selections from the embedded conversation view", () => {
    const projected = projectExternalEmbedConversation(
      conversation({
        application: {
          id: "application-id",
          name: "Policy assistant",
          kind: "standard",
          package_id: null,
        },
        selected_knowledge_base_ids: ["application-kb"],
        messages: [
          {
            id: "message-user-1",
            role: "user",
            content: "你好",
            selected_capabilities: [
              {
                id: "skill_policy_lookup",
                name: "Policy lookup",
                type: "skill",
              },
            ],
            selected_knowledge_base_ids: ["application-kb"],
            application: { id: "application-id", name: "Policy assistant" },
          },
          {
            id: "message-assistant-1",
            role: "assistant",
            content: "可以参考政策手册。",
            knowledge_citations: [
              {
                citation_id: "70000000-0000-4000-8000-000000000001",
                citation_no: 1,
                anchors: [{ occurrence_no: 1, after_offset_utf16: 0 }],
                summary: {
                  knowledge_base_name: "外部知识库",
                  document_name: "policy.pdf",
                  title_path: [],
                  page_numbers: [],
                },
              },
            ],
          },
        ],
      }),
      null
    )

    expect(projected.selected_knowledge_base_ids).toEqual([])
    expect(projected.messages?.[0]?.selected_capabilities).toEqual([])
    expect(projected.messages?.[0]?.selected_knowledge_base_ids).toEqual([])
    expect(projected.messages?.[1]?.knowledge_citations).toEqual([])
  })

  it("adds a local user message while the accepted turn has not appeared in the refreshed conversation yet", () => {
    const optimisticSubmission: EmbedOptimisticSubmission = {
      id: "local-submit-1",
      turnId: "60000000-0000-4000-8000-000000000001",
      content: "你好呀",
      createdAt: "2026-08-14T01:00:00.000Z",
      attachments: [],
    }

    const projected = projectExternalEmbedConversation(
      conversation({
        messages: [
          {
            id: "assistant-message-1",
            role: "assistant",
            content: "欢迎",
          },
        ],
      }),
      optimisticSubmission
    )

    expect(projected.messages).toHaveLength(2)
    expect(projected.messages?.[1]).toMatchObject({
      id: "embed-optimistic-local-submit-1",
      role: "user",
      content: "你好呀",
      turn_id: "60000000-0000-4000-8000-000000000001",
      selected_capabilities: [],
      selected_knowledge_base_ids: [],
    })
  })

  it("does not duplicate the local user message after the server message is visible", () => {
    const optimisticSubmission: EmbedOptimisticSubmission = {
      id: "local-submit-1",
      turnId: "60000000-0000-4000-8000-000000000001",
      content: "你好呀",
      createdAt: "2026-08-14T01:00:00.000Z",
      attachments: [],
    }

    const projected = projectExternalEmbedConversation(
      conversation({
        messages: [
          {
            id: "persisted-user-message",
            role: "user",
            content: "你好呀",
            turn_id: "60000000-0000-4000-8000-000000000001",
            selected_knowledge_base_ids: ["application-kb"],
          },
        ],
      }),
      optimisticSubmission
    )

    expect(projected.messages).toHaveLength(1)
    expect(projected.messages?.[0]?.id).toBe("persisted-user-message")
    expect(projected.messages?.[0]?.selected_knowledge_base_ids).toEqual([])
  })
})

describe("external embed gate copy", () => {
  it("does not ask public embeds to wait for host credentials", () => {
    expect(embedGateMessageKey("authenticating", "public")).toBe(
      "embed.startingPublicSession"
    )
    expect(embedGateMessageKey("authenticating", "required")).toBe(
      "embed.authenticating"
    )
  })

  it("uses host authentication failures to leave the waiting state", () => {
    expect(
      hostAuthenticationFailureError(
        {
          type: "linksense:host-authentication-failed",
          appId: "lsa_application",
          message: "App ID 或 App Secret 无效，请更新外部后端中的密钥后重试。",
        },
        "lsa_application",
        "fallback"
      )
    ).toBe("App ID 或 App Secret 无效，请更新外部后端中的密钥后重试。")
    expect(
      hostAuthenticationFailureError(
        {
          type: "linksense:host-authentication-failed",
          appId: "lsa_other",
          message: "wrong application",
        },
        "lsa_application",
        "fallback"
      )
    ).toBeNull()
    expect(
      hostAuthenticationFailureError(
        {
          type: "linksense:host-authentication-failed",
          appId: "lsa_application",
        },
        "lsa_application",
        "fallback"
      )
    ).toBe("fallback")
  })
})

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  const base: Conversation = {
    id: "conversation-id",
    title: "Embedded app",
    archived: false,
    updated_at: "2026-08-14T00:00:00.000Z",
    execution_status: "idle",
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: "default",
    selected_knowledge_base_ids: [],
    messages: [],
    attachments: [],
    artifacts: [],
    turns: [],
    running_turn: null,
    pending_requests: [],
    user_input_requests: [],
    plan_reviews: [],
    activities: [],
    events: [],
    turn_file_change_counts: {},
  }
  return { ...base, ...overrides }
}
