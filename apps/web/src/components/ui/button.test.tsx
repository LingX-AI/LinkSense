import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"

describe("Button", () => {
  it.each([false, true])(
    "keeps annotation actions blue with white text when pressed=%s",
    (pressed) => {
      render(
        <Button variant="annotation" aria-pressed={pressed}>
          Annotate
        </Button>
      )
      expect(screen.getByRole("button", { name: "Annotate" })).toHaveClass(
        "bg-[var(--app-selection)]",
        "text-white",
        "hover:bg-[color-mix(in_srgb,var(--app-selection)_88%,var(--app-text))]"
      )
    }
  )

  it("uses targeted transitions and removes the mobile tap delay", () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveClass(
      "touch-manipulation",
      "transition-[color,background-color,border-color,box-shadow,transform,opacity]"
    )
    expect(button).not.toHaveClass("transition-all")
  })

  it("renders the extra-large size as a 44px high primary action", () => {
    render(<Button size="xl">Continue</Button>)

    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass(
      "h-11",
      "rounded-lg",
      "px-5"
    )
  })

  it("renders destructive actions with a solid red background", () => {
    render(<Button variant="destructive">Delete</Button>)

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground",
      "hover:bg-destructive/90"
    )
  })

  it("renders low-emphasis destructive actions with a tinted background", () => {
    render(<Button variant="destructive-ghost">Clear all</Button>)

    expect(screen.getByRole("button", { name: "Clear all" })).toHaveClass(
      "bg-destructive/10",
      "text-destructive",
      "hover:bg-destructive/15"
    )
  })

  it("uses the shared subtle hover surface for neutral actions", () => {
    render(
      <>
        <Button variant="ghost">Ghost</Button>
        <Button variant="outline">Outline</Button>
      </>
    )

    expect(screen.getByRole("button", { name: "Ghost" })).toHaveClass(
      "hover:bg-hover"
    )
    expect(screen.getByRole("button", { name: "Outline" })).toHaveClass(
      "hover:bg-hover"
    )
  })

  it("renders strong outline actions with a more visible semantic border", () => {
    render(<Button variant="outline-strong">Test notification</Button>)

    expect(
      screen.getByRole("button", { name: "Test notification" })
    ).toHaveClass("border-foreground/35", "hover:border-foreground/50")
  })

  it("renders card actions with the shared application card border", () => {
    render(<Button variant="card-outline">Create application</Button>)

    expect(
      screen.getByRole("button", { name: "Create application" })
    ).toHaveClass(
      "border-[color:var(--app-border)]",
      "bg-card",
      "hover:border-foreground/20"
    )
  })
})
