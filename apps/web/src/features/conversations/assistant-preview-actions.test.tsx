import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CopyIcon, DownloadIcon } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AssistantPreviewAction,
  AssistantPreviewActions,
} from "@/features/conversations/assistant-preview-actions"
import i18n from "@/i18n"
import conversationStyles from "@/index.css?raw"

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

describe("shared preview actions", () => {
  it("keeps the action rail pointer-accessible while moving from the preview to a button", async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    render(
      <section className="group relative pr-8" aria-label="Preview">
        <div>Preview content</div>
        <AssistantPreviewActions label="Preview actions">
          <AssistantPreviewAction label="Copy" onClick={select}>
            <CopyIcon aria-hidden="true" />
          </AssistantPreviewAction>
        </AssistantPreviewActions>
      </section>
    )
    const toolbar = screen.getByRole("toolbar")
    expect(toolbar).toHaveClass("right-0", "w-8", "pl-2")
    expect(toolbar).not.toHaveClass("left-full")
    expect(toolbar.parentElement).toHaveClass("pr-8")
    const rule = conversationStyles.match(
      /\.assistant-html-preview-actions\s*\{([^}]*)\}/u
    )?.[1]
    expect(rule).toMatch(/pointer-events:\s*auto;/u)
    expect(rule).not.toMatch(/transform:/u)
    expect(conversationStyles).toMatch(
      /\.assistant-html-preview-actions:hover,\s*\.assistant-html-preview-actions:focus-within\s*\{[^}]*opacity:\s*1;/u
    )
    await user.hover(screen.getByText("Preview content"))
    await user.hover(toolbar)
    const button = screen.getByRole("button", { name: "Copy" })
    expect(button).toHaveClass(
      "size-6",
      "[&_svg:not([class*='size-'])]:size-3"
    )
    await user.hover(button)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Copy")
    await user.click(button)
    expect(select).toHaveBeenCalledOnce()
  })
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "shows names on hover for direct vertical actions in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      const select = vi.fn()
      const copyLabel = locale === "en-US" ? "Copy code" : "复制代码"
      render(
        <section className="group relative pr-8">
          <AssistantPreviewActions
            label={i18n.t("conversation.diagram.actions")}
          >
            <AssistantPreviewAction
              label={i18n.t("conversation.diagram.copy")}
              onClick={select}
            >
              <CopyIcon aria-hidden="true" />
            </AssistantPreviewAction>
            <AssistantPreviewAction
              label={i18n.t("conversation.diagram.export")}
              disabled
            >
              <DownloadIcon aria-hidden="true" />
            </AssistantPreviewAction>
          </AssistantPreviewActions>
        </section>
      )
      const toolbar = screen.getByRole("toolbar")
      expect(toolbar).toHaveClass(
        "absolute",
        "right-0",
        "top-2",
        "pl-2",
        "flex-col"
      )
      expect(toolbar).toHaveAttribute("aria-orientation", "vertical")
      expect(within(toolbar).getAllByRole("button")).toHaveLength(2)
      expect(screen.queryByRole("menu")).toBeNull()
      const copyButton = screen.getByRole("button", { name: copyLabel })
      expect(copyButton.textContent).toBe("")
      expect(copyButton).not.toHaveAttribute("title")
      expect(copyButton).not.toHaveAttribute("aria-haspopup")
      await user.hover(copyButton)
      const tooltip = await screen.findByRole("tooltip")
      expect(tooltip).toHaveTextContent(copyLabel)
      expect(tooltip).toHaveClass("rounded-md", "font-medium")
      expect(tooltip.querySelector("svg")).toBeNull()
      await user.click(copyButton)
      expect(select).toHaveBeenCalledOnce()
      await user.unhover(copyButton)
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())
      expect(
        screen.getByRole("button", {
          name: i18n.t("conversation.diagram.export"),
        })
      ).toBeDisabled()
    }
  )

  it("shows names on keyboard focus and activates the action without a menu", async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    render(
      <AssistantPreviewActions label="Preview actions">
        <AssistantPreviewAction label="Copy" onClick={select}>
          <CopyIcon aria-hidden="true" />
        </AssistantPreviewAction>
        <AssistantPreviewAction label="Export" disabled onClick={select}>
          <DownloadIcon aria-hidden="true" />
        </AssistantPreviewAction>
      </AssistantPreviewActions>
    )
    await user.tab()
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Copy")
    await user.keyboard("{Enter}")
    expect(select).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Export" }))
    expect(select).toHaveBeenCalledOnce()
  })
})
