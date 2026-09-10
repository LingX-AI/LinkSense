import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { RefreshButton } from "./refresh-button"

afterEach(cleanup)

describe("RefreshButton", () => {
  it.each([
    ["zh-CN", "刷新"],
    ["en-US", "Refresh"],
    ["fr-FR", "刷新"],
  ])("renders a localized icon-only action in %s", async (language, label) => {
    await i18n.changeLanguage(language)
    const onRefresh = vi.fn()
    const interaction = userEvent.setup()
    render(<RefreshButton refreshing={false} onRefresh={onRefresh} />)

    const button = screen.getByRole("button", { name: label })
    expect(button).toHaveAttribute("title", label)
    expect(button).toHaveTextContent(/^$/)
    expect(button).toHaveClass("hover:bg-hover", "size-7")
    expect(
      Array.from(button.classList).filter(
        (name) => name.startsWith("bg-") && !name.startsWith("bg-clip-")
      )
    ).toEqual([])
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    await interaction.tab()
    expect(button).toHaveFocus()
    await interaction.keyboard("{Enter}")
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("shows loading and prevents duplicate refreshes until loading completes", async () => {
    const onRefresh = vi.fn()
    const interaction = userEvent.setup()
    const { rerender } = render(
      <RefreshButton refreshing onRefresh={onRefresh} />
    )
    const button = screen.getByRole("button")
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button.querySelector("svg")).toHaveClass("animate-spin")
    await interaction.click(button)
    expect(onRefresh).not.toHaveBeenCalled()

    rerender(<RefreshButton refreshing={false} onRefresh={onRefresh} />)
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute("aria-busy")
    expect(button.querySelector("svg")).not.toHaveClass("animate-spin")
    await interaction.click(button)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
