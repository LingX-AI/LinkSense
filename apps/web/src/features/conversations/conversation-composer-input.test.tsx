import { createRef } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConversationComposerInput } from "./conversation-composer-input"

const textareaRender = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/textarea", async (importOriginal) => {
  const { Textarea } =
    await importOriginal<typeof import("@/components/ui/textarea")>()
  return {
    Textarea: (props: React.ComponentProps<typeof Textarea>) => {
      textareaRender()
      return <Textarea {...props} />
    },
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ConversationComposerInput", () => {
  it("keeps the editor render and selection stable while using the latest action guards", () => {
    const ref = createRef<HTMLTextAreaElement>()
    const initial = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(
      <ConversationComposerInput
        ref={ref}
        value="draft"
        onChange={initial}
        onKeyDown={initial}
        onPaste={initial}
        onScroll={initial}
      />
    )
    const input = screen.getByRole("textbox")
    ref.current?.focus()
    ref.current?.setSelectionRange(1, 3)
    const renders = textareaRender.mock.calls.length

    rerender(
      <ConversationComposerInput
        ref={ref}
        value="draft"
        onChange={latest}
        onKeyDown={latest}
        onPaste={latest}
        onScroll={latest}
      />
    )

    expect(textareaRender).toHaveBeenCalledTimes(renders)
    expect(screen.getByRole("textbox")).toBe(input)
    expect(input).toHaveFocus()
    expect(ref.current?.selectionStart).toBe(1)
    expect(ref.current?.selectionEnd).toBe(3)
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.paste(input)
    fireEvent.scroll(input)
    fireEvent.change(input, { target: { value: "updated" } })
    expect(initial).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(4)
  })

  it("updates the editor when its content or availability changes", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ConversationComposerInput value="draft" onChange={onChange} />
    )
    rerender(
      <ConversationComposerInput value="saved" disabled onChange={onChange} />
    )
    expect(screen.getByRole("textbox")).toHaveValue("saved")
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(textareaRender).toHaveBeenCalledTimes(2)
  })
})
