import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

afterEach(cleanup)

describe("segmented tabs", () => {
  it.each(["horizontal", "vertical"] as const)(
    "preserves %s keyboard selection without activating disabled segments",
    async (orientation) => {
      const user = userEvent.setup()
      render(
        <Tabs defaultValue="first" orientation={orientation}>
          <TabsList aria-label="Sections">
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              Unavailable
            </TabsTrigger>
            <TabsTrigger value="last">Longer last section</TabsTrigger>
          </TabsList>
          <TabsContent value="first">First content</TabsContent>
          <TabsContent value="last">Last content</TabsContent>
        </Tabs>
      )
      const first = screen.getByRole("tab", { name: "First" })
      const disabled = screen.getByRole("tab", { name: "Unavailable" })
      const last = screen.getByRole("tab", { name: "Longer last section" })
      first.focus()
      await user.keyboard(
        orientation === "horizontal" ? "{ArrowRight}" : "{ArrowDown}"
      )
      expect(disabled).toHaveFocus()
      expect(first).toHaveAttribute("aria-selected", "true")
      await user.keyboard("{Enter}")
      expect(first).toHaveAttribute("aria-selected", "true")
      await user.keyboard(
        orientation === "horizontal" ? "{ArrowRight}" : "{ArrowDown}"
      )
      expect(last).toHaveFocus()
      await user.keyboard("{Enter}")
      expect(last).toHaveAttribute("aria-selected", "true")
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Last content")
      expect(last).toHaveAttribute(
        "aria-controls",
        screen.getByRole("tabpanel").id
      )
      await user.keyboard("{Home} ")
      expect(first).toHaveAttribute("aria-selected", "true")
      expect(screen.getByRole("tabpanel")).toHaveTextContent("First content")
    }
  )

  it("keeps multiple controls independent without adding decorative text to accessible labels", async () => {
    const user = userEvent.setup()
    render(
      <>
        {["Primary", "Secondary"].map((label) => (
          <Tabs key={label} defaultValue="one">
            <TabsList aria-label={label}>
              <TabsTrigger value="one">One</TabsTrigger>
              <TabsTrigger value="two">Two</TabsTrigger>
            </TabsList>
            <TabsContent value="one">{label} first content</TabsContent>
            <TabsContent value="two">{label} second content</TabsContent>
          </Tabs>
        ))}
      </>
    )
    const primary = within(screen.getByRole("tablist", { name: "Primary" }))
    const secondary = within(screen.getByRole("tablist", { name: "Secondary" }))
    await user.click(primary.getByRole("tab", { name: "Two" }))
    expect(primary.getByRole("tab", { name: "Two" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(secondary.getByRole("tab", { name: "One" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(
      screen.getAllByRole("tabpanel").map((panel) => panel.textContent)
    ).toEqual(["Primary second content", "Secondary first content"])
  })
})
