import { useRef } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getVisibleConversationRows,
  useVisibleConversationMessages,
} from "./use-visible-conversation-messages"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("visible conversation range", () => {
  it("includes partially visible groups and excludes overscan, empty rows, and composer-covered content", () => {
    const rows = [
      { messageIds: ["above"], top: -200, bottom: 0, loaded: true },
      { messageIds: ["first"], top: -10, bottom: 150, loaded: true },
      { messageIds: ["second"], top: 150, bottom: 450, loaded: true },
      { messageIds: ["covered"], top: 450, bottom: 700, loaded: true },
      { messageIds: ["empty"], top: 200, bottom: 200, loaded: true },
    ]
    expect(
      getVisibleConversationRows(rows, { top: 0, bottom: 400 }).flatMap(
        (row) => row.messageIds
      )
    ).toEqual(["first", "second"])
    expect(getVisibleConversationRows(rows, { top: 500, bottom: 500 })).toEqual(
      []
    )
  })

  it("updates multiple highlights on scroll and loads only visible placeholders", async () => {
    const onVisible = vi.fn()
    const loadTurn = vi.fn(async () => undefined)
    let offset = 0
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("conversation-scroll"))
          return DOMRect.fromRect({ y: 0, height: 600 })
        if (this.classList.contains("conversation-bottom-stack"))
          return DOMRect.fromRect({ y: 400, height: 200 })
        if (this.classList.contains("conversation-top-bar"))
          return DOMRect.fromRect({ y: 0, height: 40 })
        return DOMRect.fromRect({
          y: Number(this.dataset.top ?? 0) - offset,
          height: 200,
        })
      }
    )
    function Harness() {
      const hostRef = useRef<HTMLDivElement>(null)
      useVisibleConversationMessages({
        hostRef,
        onVisibleMessageChange: onVisible,
        loadTurn,
      })
      return (
        <div className="conversation-workspace">
          <div className="conversation-top-bar" />
          <div className="conversation-scroll" data-testid="scroll">
            <div ref={hostRef}>
              <div
                data-conversation-row="a"
                data-message-ids="a"
                data-top="0"
              />
              <div
                data-conversation-row="b"
                data-message-ids="b"
                data-top="200"
              />
              <div
                data-conversation-row="c"
                data-message-ids="c"
                data-top="400"
              />
              <div
                data-conversation-row="d"
                data-message-ids="d"
                data-top="600"
                data-turn-id="turn-d"
                data-loaded="false"
              />
            </div>
          </div>
          <div className="conversation-bottom-stack" />
        </div>
      )
    }
    render(<Harness />)
    await waitFor(() => expect(onVisible).toHaveBeenLastCalledWith(["a", "b"]))
    expect(loadTurn).not.toHaveBeenCalled()
    offset = 400
    fireEvent.scroll(screen.getByTestId("scroll"))
    await waitFor(() => expect(onVisible).toHaveBeenLastCalledWith(["c"]))
    expect(loadTurn).toHaveBeenCalledWith("turn-d")
  })
})
