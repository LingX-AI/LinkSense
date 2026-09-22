import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SettingsCard } from "./settings-card"
import { SettingsSectionHeader } from "./settings-section-header"

describe("SettingsCard", () => {
  it("places category headings above the bordered card and pads both sides equally", () => {
    render(
      <SettingsCard
        aria-labelledby="category"
        header={
          <SettingsSectionHeader
            id="category"
            title="Category"
            description="Category description"
          />
        }
      >
        <input aria-label="Setting" />
      </SettingsCard>
    )
    const heading = screen.getByRole("heading", { name: "Category" })
    const input = screen.getByRole("textbox", { name: "Setting" })
    const card = input.closest<HTMLElement>('[data-slot="card"]')
    expect(heading.closest('[data-slot="card"]')).toBeNull()
    expect(screen.getByRole("region", { name: "Category" })).toContainElement(
      card
    )
    expect(input.parentElement).toHaveClass("px-4", "sm:px-5")
    expect(card).toHaveClass("py-4", "sm:py-5")
    expect(heading.closest('[data-slot="settings-card"]')).toHaveClass("gap-3")
  })
})
