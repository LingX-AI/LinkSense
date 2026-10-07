import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import {
  FieldDescription,
  FieldLabel,
  FieldLegend,
} from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import appStyles from "@/index.css?raw"

afterEach(cleanup)

describe("FieldLabel", () => {
  it.each([
    ["label", Label],
    ["field label", FieldLabel],
  ] as const)(
    "adds a red required indicator after the %s without changing the accessible name",
    (_, LabelComponent) => {
      const { rerender } = render(
        <>
          <LabelComponent htmlFor="required-field" required>
            Name
          </LabelComponent>
          <input id="required-field" required />
        </>
      )
      const input = screen.getByRole("textbox", { name: "Name" })
      const label = document.querySelector('label[for="required-field"]')
      const indicator = label?.lastElementChild
      expect(indicator).toHaveTextContent("*")
      expect(indicator).toHaveClass("text-destructive")
      expect(indicator).toHaveAttribute("aria-hidden", "true")
      expect(label).not.toHaveAttribute("required")
      expect(input).toBeRequired()

      rerender(
        <>
          <LabelComponent htmlFor="required-field" required={false}>
            Name
          </LabelComponent>
          <input id="required-field" />
        </>
      )
      expect(screen.getByRole("textbox", { name: "Name" })).not.toBeRequired()
      expect(screen.queryByText("*")).not.toBeInTheDocument()
    }
  )

  it("does not add a container background for a checked checkbox", () => {
    render(
      <FieldLabel data-testid="checkbox-label">
        <Checkbox checked />
        Selected option
      </FieldLabel>
    )

    expect(screen.getByTestId("checkbox-label")).not.toHaveClass(
      "has-data-checked:bg-input/30"
    )
    expect(
      screen.getByRole("checkbox", { name: "Selected option" })
    ).toBeChecked()
  })
})

describe("FieldLegend", () => {
  it("marks a required group while keeping its accessible name unchanged", () => {
    render(
      <fieldset>
        <FieldLegend required>Recipients</FieldLegend>
        <input aria-label="Recipient" />
      </fieldset>
    )
    const legend = screen.getByRole("group", {
      name: "Recipients",
    }).firstElementChild
    expect(legend?.lastElementChild).toHaveTextContent("*")
    expect(legend?.lastElementChild).toHaveClass("text-destructive")
    expect(legend?.lastElementChild).toHaveAttribute("aria-hidden", "true")
    expect(legend).not.toHaveAttribute("required")
  })
})

describe("FieldDescription", () => {
  it("matches the page description font tier while preserving its muted color", () => {
    render(<FieldDescription size="caption">Help text</FieldDescription>)
    expect(screen.getByText("Help text")).toHaveClass(
      "text-[length:var(--app-font-13)]",
      "leading-5",
      "text-muted-foreground"
    )
    expect(appStyles).toMatch(
      /\.management-header p,\s*\.settings-section > p\s*\{[^}]*font-size:\s*var\(--app-font-13\);[^}]*line-height:\s*var\(--app-line-20\);/u
    )
  })
})
