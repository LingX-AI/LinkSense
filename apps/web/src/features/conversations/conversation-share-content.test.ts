import { describe, expect, it } from "vitest"
import type { Conversation } from "@/api/contracts"
import {
  captureConversationShareSnapshot,
  projectConversationShareSnapshot,
} from "@/features/conversations/conversation-share-content"
import { publicConversationShareSchema } from "@/features/conversations/conversation-share-contracts"

const id = "10000000-0000-4000-8000-000000000001"
const turnId = "20000000-0000-4000-8000-000000000001"
const messageId = "30000000-0000-4000-8000-000000000001"
const fileId = "40000000-0000-4000-8000-000000000001"

function conversation(): Conversation {
  return {
    id,
    title: "Task",
    updated_at: "2026-09-09T00:00:00.000Z",
    project_id: null,
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: "default",
    archived: false,
    messages: [
      {
        id: messageId,
        role: "assistant",
        content: "Visible output",
        turn_id: turnId,
        phase: "final_answer",
        artifacts: [
          {
            id: fileId,
            name: "result.md",
            kind: "artifact",
            size: 5,
            turn_id: turnId,
            status: "ready",
            download_available: true,
          },
        ],
      },
    ],
    turns: [{ id: turnId, status: "completed" }],
    user_input_requests: [],
  }
}

describe("sharing preview projection", () => {
  it("captures only message-bound files and disables their public download", () => {
    const source = conversation()
    source.artifacts = [
      {
        id: "40000000-0000-4000-8000-000000000002",
        name: "unloaded-private.md",
        size: 10,
        download_available: true,
      },
    ]
    const snapshot = captureConversationShareSnapshot(source)
    const preview = projectConversationShareSnapshot(snapshot)
    expect(snapshot.files).toEqual([
      {
        id: fileId,
        filename: "result.md",
        kind: "artifact",
        size_bytes: 5,
        turn_id: turnId,
        status: "ready",
        downloadable: false,
      },
    ])
    expect(preview.messages?.[0]?.artifacts?.[0]?.download_available).toBe(
      false
    )
    expect(JSON.stringify(preview)).not.toContain("unloaded-private.md")
  })

  it("renders a streaming snapshot without a live turn and without later text mutations", () => {
    const source = conversation()
    source.turns = [{ id: turnId, status: "running" }]
    const snapshot = captureConversationShareSnapshot(source)
    source.messages![0]!.content += " Later output"
    const preview = projectConversationShareSnapshot(snapshot)
    expect(preview.messages?.[0]?.content).toBe("Visible output")
    expect(preview.running_turn).toBeNull()
    expect(preview.turns).toEqual([])
  })

  it("excludes messages that have not yet been accepted by the server", () => {
    const source = conversation()
    source.messages?.push({
      id: "optimistic-request",
      role: "user",
      content: "Sending",
    })
    const snapshot = captureConversationShareSnapshot(source)
    expect(snapshot.messages).toHaveLength(1)
    expect(snapshot.messages[0]?.id).toBe(messageId)
  })

  it("uses the same projection for the preview and the public response without exposing task classification", () => {
    const source = conversation()
    source.project_id = "50000000-0000-4000-8000-000000000001"
    const snapshot = captureConversationShareSnapshot(source)
    const result = publicConversationShareSchema.parse({
      id: fileId,
      conversation_id: id,
      title: "Task",
      url_path: `/share/${fileId}`,
      created_at: source.updated_at,
      updated_at: source.updated_at,
      snapshot,
    })
    expect(result.snapshot).toEqual(projectConversationShareSnapshot(snapshot))
    expect(result.snapshot.project_id).toBeNull()
    expect(JSON.stringify(snapshot)).not.toContain(source.project_id)
  })
})
