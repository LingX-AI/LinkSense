import { createRef, type ComponentProps } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { createConversationComposerValue } from "./conversation-composer-value"
import { ConversationDraftComposer } from "./conversation-draft-composer"
import type { ConversationComposerHandle } from "./conversation-composer"

afterEach(cleanup)
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

function fixture() {
  const draft = createConversationComposerValue()
  const props: ComponentProps<typeof ConversationDraftComposer> = {
    draft,
    capabilities: [],
    selectedIds: [],
    onSelectedIdsChange: vi.fn(),
    attachments: [],
    isRunning: false,
    interrupting: false,
    submitting: false,
    uploading: false,
    onSubmit: vi.fn(),
    onStartNewTask: vi.fn(),
    onStartApplication: vi.fn(),
    onInterrupt: vi.fn(),
    onAttach: vi.fn(),
    loadAttachmentPreview: vi.fn(async () => new Blob()),
    onRemoveAttachment: vi.fn(),
    onClearAttachments: vi.fn(),
    onError: vi.fn(),
  }
  return { draft, props }
}

describe("isolated composer value", () => {
  it("keeps IME edits immediate and submits the complete latest text after composition finishes", () => {
    const { props, draft } = fixture()
    render(<ConversationDraftComposer {...props} />)
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: "优" } })
    expect(input).toHaveValue("优")
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 })
    expect(props.onSubmit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: "优化应用布局" } })
    fireEvent.compositionEnd(input, { data: "优化应用布局" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(draft.getSnapshot()).toBe("优化应用布局")
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("优化应用布局")
  })

  it("applies programmatic restore and clear operations and does not overwrite new edits when a submission fails", () => {
    const { props, draft } = fixture()
    const ref = createRef<ConversationComposerHandle>()
    render(<ConversationDraftComposer {...props} ref={ref} />)
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    act(() => {
      draft.setValue("Restored draft")
      ref.current?.focus()
    })
    expect(input).toHaveValue("Restored draft")
    expect(input).toHaveFocus()
    act(() => draft.setValue(""))
    expect(input).toHaveValue("")
    fireEvent.change(input, { target: { value: "New edit" } })
    act(() => draft.setValue((current) => current || "Failed submission"))
    expect(input).toHaveValue("New edit")
    act(() => {
      draft.setValue("")
      draft.setValue((current) => current || "Failed submission")
    })
    expect(input).toHaveValue("Failed submission")
  })

  it("uses current action guards after a parent update without resetting the text or selection", () => {
    const { props, draft } = fixture()
    const { rerender } = render(<ConversationDraftComposer {...props} />)
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    fireEvent.change(input, { target: { value: "Typing draft" } })
    if (!(input instanceof HTMLTextAreaElement))
      throw new Error("Expected textarea")
    input.focus()
    input.setSelectionRange(3, 7)
    rerender(<ConversationDraftComposer {...props} taskStartDisabled />)
    expect(input).toHaveValue("Typing draft")
    expect(input.selectionStart).toBe(3)
    expect(input.selectionEnd).toBe(7)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(draft.getSnapshot()).toBe("Typing draft")
  })

  it("keeps values separate for simultaneous development and test composers and unsubscribes when switching", () => {
    const first = fixture()
    const second = fixture()
    first.draft.setValue("Builder draft")
    second.draft.setValue("Test draft")
    const { rerender } = render(<ConversationDraftComposer {...first.props} />)
    rerender(<ConversationDraftComposer {...second.props} />)
    act(() => first.draft.setValue("Updated builder draft"))
    expect(screen.getByRole("textbox")).toHaveValue("Test draft")
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Updated test draft" },
    })
    expect(first.draft.getSnapshot()).toBe("Updated builder draft")
    expect(second.draft.getSnapshot()).toBe("Updated test draft")
  })
})
