import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Badge } from "./badge"

describe("Badge sizing", () => {
  it("keeps existing badges unchanged and offers a smaller, lighter status label", () => {
    const { rerender } = render(<Badge variant="secondary">Status</Badge>)
    expect(screen.getByText("Status")).toHaveClass(
      "h-5",
      "text-xs",
      "font-medium"
    )
    rerender(
      <Badge variant="secondary" size="sm">
        Status
      </Badge>
    )
    expect(screen.getByText("Status")).toHaveClass(
      "h-4",
      "text-[10px]",
      "font-normal",
      "bg-secondary"
    )
    expect(screen.getByText("Status")).not.toHaveClass(
      "h-5",
      "text-xs",
      "font-medium"
    )
    rerender(
      <Badge variant="secondary" weight="normal">
        Status
      </Badge>
    )
    expect(screen.getByText("Status")).toHaveClass(
      "h-5",
      "text-xs",
      "font-normal"
    )
    expect(screen.getByText("Status")).not.toHaveClass("font-medium")
  })
})
