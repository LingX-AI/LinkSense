import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { Textarea } from "@/components/ui/textarea"

describe("card radius", () => {
  afterEach(cleanup)

  it.each(["default", "sm"] as const)(
    "uses the global radius for %s cards and their edge sections",
    (size) => {
      const { container } = render(
        <Card size={size} appearance="soft">
          <CardHeader>Header</CardHeader>
          <CardContent>Content</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
      )

      expect(container.querySelector('[data-slot="card"]')).toHaveClass(
        "rounded-card",
        "*:[img:first-child]:rounded-t-card",
        "*:[img:last-child]:rounded-b-card"
      )
      expect(container.querySelector('[data-slot="card-header"]')).toHaveClass(
        "rounded-t-card"
      )
      expect(container.querySelector('[data-slot="card-footer"]')).toHaveClass(
        "rounded-b-card"
      )
    }
  )

  it("preserves square inner rows in grouped lists", () => {
    const { container } = render(<Card className="rounded-none border-0" />)
    const card = container.querySelector('[data-slot="card"]')
    expect(card).toHaveClass("rounded-none")
    expect(card).not.toHaveClass("rounded-card")
  })

  it.each(["default", "soft"] as const)(
    "keeps editable, disabled and grouped fields distinct inside a %s dark card",
    (appearance) => {
      const { container, getByRole } = render(
        <div className="dark">
          <Card appearance={appearance}>
            <CardContent>
              <Input aria-label="Name" />
              <Textarea aria-label="Description" disabled />
              <InputGroup aria-label="Search">
                <InputGroupInput aria-label="Search text" />
              </InputGroup>
            </CardContent>
          </Card>
        </div>
      )

      expect(container.querySelector('[data-slot="card"]')).toHaveClass(
        appearance === "soft" ? "bg-card-soft" : "bg-card"
      )
      expect(getByRole("textbox", { name: "Name" })).toHaveClass(
        "bg-field",
        "focus-visible:bg-field-focus"
      )
      const disabledField = getByRole("textbox", { name: "Description" })
      expect(disabledField).toBeDisabled()
      expect(disabledField).toHaveClass("bg-field", "disabled:opacity-50")
      expect(getByRole("group", { name: "Search" })).toHaveClass("bg-field")
      expect(getByRole("textbox", { name: "Search text" })).toHaveClass(
        "bg-transparent",
        "focus-visible:bg-transparent"
      )
      expect(getByRole("textbox", { name: "Search text" })).not.toHaveClass(
        "bg-field"
      )
    }
  )
})
