import { describe, expect, it } from "vitest"
import type { ConversationUserInputRequest } from "@/api/contracts"
import { selectActiveUserInputRequest } from "./conversation-user-input-request-status"

function request(
  id: string,
  kind: "questions" | "async_questions",
  turnId: string,
  status: "pending" | "answering" | "answered" = "pending"
): ConversationUserInputRequest {
  const common = {
    id,
    turn_id: turnId,
    status,
    conversation_id: "conversation",
    item_id: id,
    questions: [],
    auto_resolve_at: null,
    resolved_at: null,
    resolved_action: null,
    created_at: id,
    updated_at: id,
  }
  return kind === "async_questions"
    ? { ...common, kind, response_content: null }
    : { ...common, kind }
}

describe("selectActiveUserInputRequest", () => {
  it("leaves plan confirmation available before showing optional asynchronous questions", () => {
    expect(
      selectActiveUserInputRequest(
        [request("1", "async_questions", "old")],
        undefined,
        true
      )
    ).toBeUndefined()
  })
  it("prioritizes a blocking question on the running turn over asynchronous questions", () => {
    const requests = [
      request("1", "async_questions", "old"),
      request("2", "questions", "old"),
      request("3", "questions", "current"),
    ]
    expect(selectActiveUserInputRequest(requests, "current")?.id).toBe("3")
  })

  it("offers the oldest unresolved asynchronous question after its turn has ended without mutating source order", () => {
    const requests = [
      request("3", "async_questions", "old"),
      request("1", "async_questions", "old", "answered"),
      request("2", "async_questions", "older", "answering"),
    ]
    expect(selectActiveUserInputRequest(requests)?.id).toBe("2")
    expect(requests.map((entry) => entry.id)).toEqual(["3", "1", "2"])
  })

  it("returns no active request when every question is resolved", () => {
    expect(
      selectActiveUserInputRequest([
        request("1", "async_questions", "old", "answered"),
      ])
    ).toBeUndefined()
  })
})
