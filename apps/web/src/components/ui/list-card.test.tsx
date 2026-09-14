import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ListCard } from "./list-card"

afterEach(cleanup)

describe("ListCard", () => {
  it("groups rows in a single rounded border with separators only between visible rows", () => {
    const { rerender, container } = render(
      <ListCard>
        <article key="first">First</article>
        {false}
        {[
          <article key="second">Second</article>,
          <article key="third">Third</article>,
        ]}
      </ListCard>
    )
    const card = screen.getByText("First").closest('[data-slot="card"]')
    expect(card).toHaveClass("rounded-card", "border", "py-0", "gap-0")
    expect(card).toContainElement(screen.getByText("Third"))
    expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(
      2
    )
    const rows = screen.getAllByRole("article")
    expect(rows[0]?.nextElementSibling).toHaveAttribute(
      "data-slot",
      "separator"
    )
    expect(rows[2]?.nextElementSibling).toBeNull()
    rerender(
      <ListCard>
        <article>Only</article>
      </ListCard>
    )
    expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(
      0
    )
    rerender(
      <ListCard>
        {null}
        {false}
      </ListCard>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
