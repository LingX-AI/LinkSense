import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import {
  ConversationAttachmentOverflow,
  type ConversationAttachmentOverflowItem,
} from "@/features/conversations/conversation-attachment-overflow"
import i18n from "@/i18n"

const files: ConversationFile[] = ["one.pdf", "two.pdf", "three.pdf"].map(
  (name, index) => ({
    id: `file-${index + 1}`,
    name,
    mime_type: "application/pdf",
    size: 1_024 + index,
    kind: "attachment",
    download_available: false,
  })
)

const items: ConversationAttachmentOverflowItem[] = files.map((file) => ({
  key: file.id,
  status: "uploaded",
  name: file.name,
  size: file.size,
  mimeType: file.mime_type,
  file,
}))

describe("ConversationAttachmentOverflow", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
  })

  it("provides localized accessible labels for the collapsed attachment list", async () => {
    const interaction = userEvent.setup()
    render(<ConversationAttachmentOverflow items={items} hiddenCount={1} />)

    const trigger = screen.getByRole("button", {
      name: "View all 3 attachments",
    })
    expect(trigger).toHaveTextContent("+1")

    await interaction.hover(trigger)
    const completeList = await screen.findByLabelText("All attachments (3)")
    expect(completeList).toBeVisible()
    expect(screen.queryByText("Uploaded")).not.toBeInTheDocument()
    expect(
      completeList.querySelector(".attachment-overflow-loading")
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Clear all" })
    ).not.toBeInTheDocument()
  })

  it("clears every uploaded attachment from an editable overflow list", async () => {
    const interaction = userEvent.setup()
    const onRemove = vi.fn()
    const onClearAll = vi.fn()
    render(
      <ConversationAttachmentOverflow
        items={items}
        hiddenCount={1}
        onRemove={onRemove}
        onClearAll={onClearAll}
      />
    )

    await interaction.hover(
      screen.getByRole("button", { name: "View all 3 attachments" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "Clear all" })
    )

    expect(onClearAll).toHaveBeenCalledOnce()
    expect(onClearAll).toHaveBeenCalledWith(files)
    expect(onRemove).not.toHaveBeenCalled()
  })
})
