import { describe, expect, it } from "vitest"
import {
  appendSideChatQuote,
  selectedMessageText,
  sideChatTurnInput,
} from "./conversation-message-selection"

describe("side chat message selection", () => {
  it("uses only a selection inside the source message and limits the quote length", () => {
    const element = document.createElement("article")
    element.textContent = "A selected claim and its explanation"
    document.body.append(element)
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(element.firstChild!, 2)
    range.setEnd(element.firstChild!, 16)
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(
      selectedMessageText(element, selection, "whole message", "ask")
    ).toBe("selected claim")
    expect(
      selectedMessageText(
        document.createElement("article"),
        selection,
        "a".repeat(6_000),
        "ask"
      )
    ).toHaveLength(4_000)
    selection?.removeAllRanges()
    element.remove()
  })

  it("preserves a complete long answer when returning it to the main task", () => {
    const answer = "x".repeat(5_000) + "The final conclusion."
    expect(selectedMessageText(null, null, answer, "return")).toBe(answer)
  })

  it("preserves the main draft and appends an editable quote without submitting", () => {
    expect(
      appendSideChatQuote("Draft with a trailing line\n", "Quote", "Side")
    ).toBe("Draft with a trailing line\n\n\nSide\n> Quote\n\n")
    expect(
      appendSideChatQuote(
        "Existing draft",
        "First line\nSecond line",
        "From side chat"
      )
    ).toBe("Existing draft\n\nFrom side chat\n> First line\n> Second line\n\n")
  })

  it("uses normal turn submission for existing tasks and structured context for side chats", () => {
    expect(sideChatTurnInput({ input: "normal" })).toEqual({
      input_text: "normal",
    })
    expect(
      sideChatTurnInput({ input: "question", referenceId: "context" })
    ).toEqual({
      message_display: {
        kind: "conversation_reference",
        reference_id: "context",
        request: "question",
      },
    })
  })
})
describe("task reference turn submission", () => {
  it("sends explicit source IDs as metadata rather than authorizing pasted text", () => {
    expect(
      sideChatTurnInput({
        input: "Compare the findings",
        taskReferences: [
          { id: "source-a", title: "Research" },
          { id: "source-b", title: "Design" },
        ],
      })
    ).toEqual({
      message_display: {
        kind: "task_references",
        request: "Compare the findings",
        conversation_ids: ["source-a", "source-b"],
      },
    })
  })
})
