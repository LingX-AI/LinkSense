// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { Conversation } from "@/api/contracts"
import {
  conversationPath,
  isConversationPathActive,
  isInteractiveApplicationRunPath,
} from "@/features/conversations/conversation-navigation"

describe("conversation navigation", () => {
  it("keeps ordinary and standard application tasks on the native route", () => {
    expect(conversationPath(target(null))).toBe("/conversations/conversation-1")
    expect(
      conversationPath(
        target({
          id: "application-1",
          name: "Standard application",
          kind: "standard",
          package_id: null,
        })
      )
    ).toBe("/conversations/conversation-1")
  })

  it("returns interactive application tasks to their application runtime", () => {
    const conversation = target({
      id: "application-1",
      name: "Research workbench",
      kind: "interactive",
      package_id: "package-1",
    })

    expect(conversationPath(conversation)).toBe(
      "/applications/application-1/run/conversation-1"
    )
    expect(
      isConversationPathActive(
        "/applications/application-1/run/conversation-1",
        conversation
      )
    ).toBe(true)
    expect(
      isInteractiveApplicationRunPath(
        "/applications/application-1/run/conversation-1"
      )
    ).toBe(true)
  })
})

function target(
  application: Conversation["application"]
): Pick<Conversation, "id" | "application"> {
  return { id: "conversation-1", application }
}
