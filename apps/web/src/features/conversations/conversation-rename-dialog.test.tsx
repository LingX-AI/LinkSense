import { useState } from "react"
import { I18nextProvider } from "react-i18next"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { ConversationRenameDialog } from "./conversation-rename-dialog"

function RenameForm({ onSubmit }: { onSubmit: (title: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <I18nextProvider i18n={i18n}>
      <ConversationRenameDialog
        open
        onOpenChange={() => undefined}
        value={value}
        onValueChange={setValue}
        onSubmit={onSubmit}
      />
    </I18nextProvider>
  )
}

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

describe("conversation rename input", () => {
  it.each([
    ["zh-CN", "新的生活计划"],
    ["en-US", "Updated personal plan"],
  ] as const)(
    "preserves every typed character and submits the title in %s",
    async (language, title) => {
      await i18n.changeLanguage(language)
      const onSubmit = vi.fn()
      const interaction = userEvent.setup()
      render(<RenameForm onSubmit={onSubmit} />)
      const input = screen.getByRole("textbox", {
        name: i18n.t("conversation.title"),
      })
      const label = document.querySelector(`label[for="${input.id}"]`)
      expect(label?.lastElementChild).toHaveTextContent("*")
      expect(label?.lastElementChild).toHaveClass("text-destructive")
      expect(input).toBeRequired()
      await waitFor(() => expect(input).toHaveFocus())
      await interaction.type(input, title)
      expect(input).toHaveFocus()
      expect(input).toHaveValue(title)
      await interaction.click(
        screen.getByRole("button", { name: i18n.t("common.save") })
      )
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(title)
    }
  )
})
