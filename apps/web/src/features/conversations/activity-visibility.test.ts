import { describe, expect, it } from "vitest"

import {
  shouldDisplayConversationActivity,
  shouldDisplayNativeActivity,
} from "@/features/conversations/activity-visibility"

describe("conversation activity visibility", () => {
  it("hides capability attachment events from live and persisted timelines", () => {
    expect(
      shouldDisplayConversationActivity("conversation.capability.attached")
    ).toBe(false)
    expect(shouldDisplayConversationActivity("capability_attached")).toBe(false)
  })

  it("keeps legacy progress visible while hiding only attachment bookkeeping", () => {
    expect(
      shouldDisplayConversationActivity("conversation.capability.used")
    ).toBe(true)
    expect(shouldDisplayConversationActivity("skill_use")).toBe(true)
    expect(shouldDisplayConversationActivity("tool_completed")).toBe(true)
    expect(shouldDisplayConversationActivity("future_tool_action")).toBe(true)
    expect(shouldDisplayConversationActivity("system_capability_used")).toBe(
      true
    )
    expect(shouldDisplayConversationActivity("reconnecting")).toBe(true)
  })

  it("filters reasoning items without hiding other native activity", () => {
    expect(
      shouldDisplayNativeActivity({
        id: "reasoning-1",
        type: "reasoning",
        summary: ["internal reasoning"],
      })
    ).toBe(false)
    expect(
      shouldDisplayNativeActivity({
        id: "command-1",
        type: "commandExecution",
        status: "completed",
        command: "pnpm test",
        commandActions: [],
      })
    ).toBe(true)
  })
})
