import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  OfficeAnnotationBatchTray,
  type OfficeAnnotationDraft,
} from "@/features/conversations/office-annotation-batch-tray"
import i18n from "@/i18n"

const drafts: readonly OfficeAnnotationDraft[] = [
  {
    id: "annotation-1",
    request: "修改标题",
    officeSelection: {
      kind: "word",
      selection: {
        type: "text",
        selectedText: "季度目标",
        paragraphText: "季度目标",
        before: "",
        after: "",
        startParagraphIndex: 0,
        endParagraphIndex: 0,
        isMultiParagraph: false,
      },
    },
  },
]

function renderTray(submitting = false) {
  const onSend = vi.fn().mockResolvedValue(undefined)
  render(
    <OfficeAnnotationBatchTray
      drafts={drafts}
      submitting={submitting}
      onRemove={vi.fn()}
      onClear={vi.fn()}
      onLocate={vi.fn()}
      onSend={onSend}
    />
  )
  return onSend
}

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

describe("OfficeAnnotationBatchTray send button", () => {
  it.each([
    ["zh-CN", "发送"],
    ["en-US", "Send"],
    ["de-DE", "发送"],
  ])("shows a compact text button in %s", async (language, label) => {
    await i18n.changeLanguage(language)
    const onSend = renderTray()
    await userEvent.click(screen.getByRole("button"))

    const dialog = await screen.findByRole("dialog")
    const button = within(dialog).getByRole("button", { name: label })
    expect(button).toHaveTextContent(label)
    expect(button).toHaveClass("h-6", "px-2.5", "text-xs", "rounded-lg")
    expect(button.querySelector("svg")).not.toBeInTheDocument()

    await userEvent.click(button)

    expect(onSend).toHaveBeenCalledOnce()
  })

  it("keeps the send label and disables the button while submitting", async () => {
    await i18n.changeLanguage("zh-CN")
    const onSend = renderTray(true)
    await userEvent.click(screen.getByRole("button"))

    const dialog = await screen.findByRole("dialog")
    const button = within(dialog).getByRole("button", { name: "发送" })
    expect(button).toHaveTextContent("发送")
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button.querySelector(".animate-spin")).toBeInTheDocument()

    await userEvent.click(button)

    expect(onSend).not.toHaveBeenCalled()
  })
})
