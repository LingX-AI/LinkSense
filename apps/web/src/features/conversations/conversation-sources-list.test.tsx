import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConversationSourcesList } from "./conversation-sources-list"
import i18n from "@/i18n"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("task source list", () => {
  it("caps a long scrollable list and shows titles and safe external links", async () => {
    await i18n.changeLanguage("zh-CN")
    const sources = Array.from({ length: 100 }, (_, i) => ({
      url: `https://example.test/guide/${i}`,
      title: `来源 ${i}`,
    }))
    render(<ConversationSourcesList sources={sources} />)
    const region = screen.getByRole("region", { name: "来源" })
    expect(within(region).getAllByRole("link")).toHaveLength(100)
    expect(screen.getByTestId("conversation-sources-scroll")).toHaveClass(
      "max-h-[min(15rem,35dvh)]",
      "overflow-y-auto"
    )
    const first = within(region).getByRole("link", {
      name: "来源 0",
    })
    expect(first).toHaveAttribute("href", sources[0].url)
    expect(first).toHaveAttribute("target", "_blank")
    expect(first).toHaveAttribute("rel", "noopener noreferrer")
  })
  it("uses balanced padding, a single title line and smaller link icons", () => {
    render(
      <ConversationSourcesList
        sources={[{ url: "https://example.test/guide", title: "Guide" }]}
      />
    )
    const region = screen.getByRole("region")
    expect(region).toHaveClass("px-4")
    const scroll = screen.getByTestId("conversation-sources-scroll")
    expect(scroll.querySelector('[class*="pr-"]')).not.toBeInTheDocument()
    const link = screen.getByRole("link", { name: "Guide" })
    expect(link).toHaveClass("px-1.5")
    expect(link.textContent).toBe("Guide")
    expect(screen.queryByText("example.test")).not.toBeInTheDocument()
    expect(within(link).getByText("Guide")).toHaveClass("truncate")
    const icons = link.querySelectorAll("svg")
    expect(icons[0]).toHaveClass("size-3.5")
    expect(icons[1]).toHaveClass("size-3.5")
  })
  it("does not open a URL popup when a source is hovered or focused", () => {
    vi.useFakeTimers()
    render(
      <ConversationSourcesList
        sources={[{ url: "https://example.test/guide", title: "Guide" }]}
      />
    )
    const link = screen.getByRole("link", { name: "Guide" })
    fireEvent.mouseEnter(link)
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    expect(link).not.toHaveAttribute("title")
    fireEvent.mouseLeave(link)
    act(() => link.focus())
    expect(link).toHaveFocus()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    expect(link).toHaveAttribute("href", "https://example.test/guide")
    expect(link).toHaveAttribute("target", "_blank")
  })
  it.each([0, 1, 3])(
    "fits %i sources without reserving a fixed height",
    (count) => {
      render(
        <ConversationSourcesList
          sources={Array.from({ length: count }, (_, index) => ({
            url: `https://example.test/${index}`,
            title: null,
          }))}
        />
      )
      const list = screen.getByTestId("conversation-sources-scroll")
      expect(list).toHaveClass("h-auto", "max-h-[min(15rem,35dvh)]")
      expect(list).not.toHaveClass("h-60", "min-h-60")
      expect(screen.queryAllByRole("link")).toHaveLength(count)
    }
  )
  it("uses the URL when the title is unknown and updates as sources arrive", () => {
    const view = render(
      <ConversationSourcesList
        sources={[{ url: "https://example.test/a", title: null }]}
      />
    )
    expect(screen.getByText("https://example.test/a")).toBeVisible()
    view.rerender(
      <ConversationSourcesList
        sources={[{ url: "https://example.test/b", title: "New source" }]}
      />
    )
    expect(screen.queryByText("https://example.test/a")).not.toBeInTheDocument()
    expect(screen.getByText("New source")).toBeVisible()
  })
  it.each(["zh-CN", "en-US", "de-DE"])(
    "waits without a loading placeholder and localizes settled states in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const retry = vi.fn()
      const english = language === "en-US"
      const view = render(<ConversationSourcesList sources={[]} />)
      expect(
        screen.getByText(english ? "No sources yet" : "暂无来源")
      ).toBeVisible()
      view.rerender(<ConversationSourcesList sources={[]} loading />)
      expect(
        screen.getByRole("region", {
          name: english ? "Sources" : "来源",
        })
      ).toBeVisible()
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      expect(
        screen.queryByTestId("conversation-sources-scroll")
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(english ? "No sources yet" : "暂无来源")
      ).not.toBeInTheDocument()
      view.rerender(
        <ConversationSourcesList sources={[]} failed onRetry={retry} />
      )
      expect(screen.getByRole("alert")).toHaveTextContent(
        english ? "Couldn’t load sources" : "暂时无法加载来源"
      )
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: english ? "Retry" : "重试" }))
      expect(retry).toHaveBeenCalledOnce()
      await i18n.changeLanguage("zh-CN")
    }
  )
  it("preserves visible sources while refreshing without showing a skeleton", () => {
    const sources = [{ url: "https://example.test/guide", title: "Guide" }]
    const view = render(<ConversationSourcesList sources={sources} />)
    view.rerender(<ConversationSourcesList sources={sources} loading />)
    expect(screen.getByRole("link", { name: "Guide" })).toBeVisible()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(
      view.container.querySelector('[data-slot="skeleton"]')
    ).not.toBeInTheDocument()
  })
})
