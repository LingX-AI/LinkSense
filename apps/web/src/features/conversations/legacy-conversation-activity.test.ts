// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import { mapLegacyConversationActivity } from "@/features/conversations/legacy-conversation-activity"

describe("legacy conversation activity mapping", () => {
  it("falls back to payload.name for a legacy capability name", () => {
    const activity = mapLegacyConversationActivity(
      legacyCapabilityUsedEvent({
        capability_type: "skill",
        name: "Presentations",
      }),
      "fallback-id"
    )

    expect(activity.capability_name).toBe("Presentations")
    expect(activity.type).toBe("skill_use")
  })

  it("marks a legacy capability used event as completed", () => {
    const activity = mapLegacyConversationActivity(
      legacyCapabilityUsedEvent({
        capability_type: "plugin",
        name: "GitHub",
      }),
      "fallback-id"
    )

    expect(activity.status).toBe("completed")
  })
})

function legacyCapabilityUsedEvent(
  payload: Record<string, unknown>
): ConversationEvent {
  return {
    id: "conversation-1:7",
    type: "conversation.capability.used",
    turn_id: "40000000-0000-4000-8000-000000000001",
    sequence_no: 7,
    created_at: "2026-07-19T08:00:00.000Z",
    payload,
  }
}
