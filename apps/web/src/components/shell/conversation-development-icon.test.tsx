import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ConversationDevelopmentIcon } from "./conversation-development-icon"
import i18n from "@/i18n"

afterEach(() => cleanup())

describe("conversation development icon", () => {
  it.each([
    ["zh-CN", "development", "应用开发任务"],
    ["zh-CN", "preview", "应用调试对话"],
    ["en-US", "development", "Application development task"],
    ["en-US", "preview", "Application debug conversation"],
    ["fr-FR", "development", "应用开发任务"],
  ] as const)(
    "labels %s %s tasks and places the icon before the title",
    async (locale, role, label) => {
      await i18n.changeLanguage(locale)
      render(
        <div>
          <ConversationDevelopmentIcon role={role} />
          <span>Task title</span>
        </div>
      )
      const icon = screen.getByRole("img", { name: label })
      expect(icon).toHaveAttribute("title", label)
      expect(
        icon.querySelector('[data-application-icon-preset="code-xml"] svg')
      ).toHaveClass("size-5")
      expect(icon.querySelector(".lucide-code-xml")).toBeNull()
      expect(
        icon.compareDocumentPosition(screen.getByText("Task title")) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  )

  it.each([null, undefined])(
    "renders no development icon for a regular task (%s)",
    (role) => {
      const { container } = render(<ConversationDevelopmentIcon role={role} />)
      expect(container).toBeEmptyDOMElement()
    }
  )

  it("provides Chinese fallback text when development translations are missing", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    for (const key of ["developmentTask", "previewTask", "resizePreview"]) {
      const path = `applicationDevelopment.${key}`
      expect(fallback.t(path, { lng: "en-US" })).toBe(
        i18n.t(path, { lng: "zh-CN" })
      )
      expect(fallback.t(path, { lng: "en-US" })).not.toBe(path)
    }
  })
})
