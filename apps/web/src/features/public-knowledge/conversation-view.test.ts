import { describe, expect, it } from "vitest"
import { publicKnowledgeConversationDetailSchema } from "@linksense/shared"
import { projectPublicKnowledgeConversation } from "./conversation-view"
import { publicSearchEvent, publicProgressEvent } from "./progress.test-fixture"

describe("public Q&A chat projection", () => {
  it("projects stable messages, recorded duration and confirmed searches without private bindings", () => {
    const id = "00000000-0000-4000-8000-000000000001",
      date = "2026-11-05T00:00:00Z"
    const detail = publicKnowledgeConversationDetailSchema.parse({
      conversation: {
        id,
        visitor_id: id,
        title: "Question",
        created_at: date,
        updated_at: date,
      },
      turns: [
        {
          id,
          input_text: "Question",
          output_text: "Answer [1]",
          status: "completed",
          model: "model",
          application_version: "1.0.0",
          citations: [],
          error_code: null,
          duration_ms: 1000,
          created_at: date,
        },
      ],
    })
    const result = projectPublicKnowledgeConversation(detail)
    expect(
      result.messages?.map((message) => [
        message.id,
        message.role,
        message.content,
      ])
    ).toEqual([
      [`${id}:question`, "user", "Question"],
      [`${id}:answer`, "assistant", "Answer [1]"],
    ])
    expect(result.application).toBeUndefined()
    expect(result.selected_knowledge_base_ids).toBeUndefined()
    expect(result.turns?.[0]?.completed_at).toBe("2026-11-05T00:00:01.000Z")
    expect(result.messages?.[1]?.created_at).toBe("2026-11-05T00:00:01.000Z")
    // Old answers remain readable; only recorded events become activities.
    expect(result.activities).toEqual([])
    expect(result.events).toEqual([])
    for (const status of ["failed", "interrupted"] as const) {
      const ended = projectPublicKnowledgeConversation({
        ...detail,
        turns: [{ ...detail.turns[0]!, status, duration_ms: 0 }],
      })
      expect(ended.turns?.[0]?.completed_at).toBe("2026-11-05T00:00:00.000Z")
      // A failure before search must not fabricate a completed operation.
      expect(ended.activities).toEqual([])
    }
    const running = projectPublicKnowledgeConversation({
      ...detail,
      turns: [
        {
          ...detail.turns[0]!,
          status: "running",
          duration_ms: null,
          output_text: "",
        },
      ],
    })
    expect(running.running_turn?.completed_at).toBeNull()
    expect(running.activities).toEqual([])
    for (const status of ["running", "failed", "interrupted"] as const) {
      const searched = projectPublicKnowledgeConversation({
        ...detail,
        turns: [
          {
            ...detail.turns[0]!,
            status,
            output_text: "",
            duration_ms: status === "running" ? null : 1000,
            citations: [
              {
                number: 1,
                knowledge_base_id: id,
                document_id: id,
                document_version_id: id,
                title: "Reference title",
                page_numbers: [],
                excerpt: "Reference content",
              },
            ],
          },
        ],
      })
      expect(searched.activities).toEqual(result.activities)
      expect(JSON.stringify(searched.activities)).not.toContain("Reference")
    }
    const queued = projectPublicKnowledgeConversation({
      ...detail,
      turns: [{ ...detail.turns[0]!, status: "queued", output_text: "" }],
    })
    expect(queued.execution_status).toBe("pending")
    expect(queued.running_turn).toBeNull()
    expect(queued.turns).toEqual([])
    expect(queued.messages).toHaveLength(1)
    expect(queued.activities).toEqual([])
    const active = {
      ...detail,
      turns: [
        {
          ...detail.turns[0]!,
          status: "running" as const,
          output_text: "",
          duration_ms: null,
        },
      ],
      events: [publicSearchEvent(id, id, 1)],
    }
    expect(
      projectPublicKnowledgeConversation(active).activities?.at(-1)?.status
    ).toBe("running")
    active.events.push(publicSearchEvent(id, id, 2, true))
    const native = (
      sequence: number,
      method: string,
      params: Record<string, unknown>
    ) =>
      publicProgressEvent(id, id, sequence, method, {
        schema_version: 2,
        source: "codex_app_server",
        method,
        params: { threadId: id, turnId: id, ...params },
      })
    active.events.push(
      native(3, "item/started", {
        item: {
          id: "message",
          type: "agentMessage",
          phase: "final_answer",
          text: "",
        },
      })
    )
    active.events.push(
      native(4, "item/agentMessage/delta", {
        itemId: "message",
        delta: "Partial",
      })
    )
    const partial = projectPublicKnowledgeConversation(active)
    expect(partial.activities?.at(-1)?.status).toBe("completed")
    expect(partial.messages?.at(-1)).toMatchObject({
      content: "Partial",
      streaming: true,
      phase: "final_answer",
    })
    active.events.push(
      native(5, "item/completed", {
        item: {
          id: "message",
          type: "agentMessage",
          phase: "final_answer",
          text: "Authoritative answer",
        },
      })
    )
    expect(
      projectPublicKnowledgeConversation(active).messages?.at(-1)
    ).toMatchObject({ content: "Authoritative answer", streaming: false })
  })
})
