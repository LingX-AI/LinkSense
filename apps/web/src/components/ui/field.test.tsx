import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import { FieldDescription, FieldLabel } from "@/components/ui/field"
import appStyles from "@/index.css?raw"

describe("FieldLabel", () => {
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
