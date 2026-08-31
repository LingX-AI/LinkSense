import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel } from "@/components/ui/field"

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
