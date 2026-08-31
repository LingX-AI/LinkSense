import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SettingsSectionHeader } from "@/components/settings/settings-section-header"

afterEach(cleanup)

describe("SettingsSectionHeader", () => {
  it("keeps status next to the title while actions use the outer layout", () => {
    render(
      <SettingsSectionHeader
        id="settings-section"
        title="Knowledge retrieval models"
        description="Choose the models used by knowledge retrieval."
        status={<span>Configured</span>}
        action={<button type="button">Add model</button>}
      />
    )

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Knowledge retrieval models",
    })
    const header = heading.closest('[data-slot="settings-section-header"]')
    const description = screen.getByText(
      "Choose the models used by knowledge retrieval."
    )
    const status = screen.getByText("Configured")
    const action = screen.getByRole("button", { name: "Add model" })

    expect(heading).toHaveClass(
      "text-sm",
      "leading-5",
      "font-semibold",
      "text-pretty"
    )
    expect(description).toHaveClass("form-hint", "text-pretty")
    expect(header).toHaveClass(
      "flex",
      "gap-3",
      "sm:flex-row",
      "sm:items-start",
      "sm:justify-between"
    )
    expect(status.parentElement).toHaveAttribute(
      "data-slot",
      "settings-section-status"
    )
    expect(
      status.closest('[data-slot="settings-section-title-row"]')
    ).toContainElement(heading)
    expect(action.parentElement).toHaveClass("flex", "items-center", "pt-0.5")
  })

  it("supports sections without descriptions or actions", () => {
    const { container } = render(
      <SettingsSectionHeader id="simple-section" title="Appearance" />
    )

    expect(
      screen.getByRole("heading", { level: 2, name: "Appearance" })
    ).toBeInTheDocument()
    expect(container.querySelector("p")).not.toBeInTheDocument()
  })
})
