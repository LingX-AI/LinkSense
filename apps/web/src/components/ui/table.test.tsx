import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  TableHeader,
} from "./table"

afterEach(cleanup)

describe("Table appearance", () => {
  it.each([undefined, "data-table"])(
    "uses shared column typography with table class %s",
    (className) => {
      render(
        <Table className={className}>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      )
      for (const header of screen.getAllByRole("columnheader")) {
        expect(header).toHaveClass("text-sm", "font-medium", "text-foreground")
      }
    }
  )

  it("adds a rounded card to the scroll container without changing table semantics", () => {
    const { rerender } = render(
      <Table appearance="card" aria-label="Records">
        <TableBody>
          <TableRow>
            <TableCell>First</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Second</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const table = screen.getByRole("table", { name: "Records" })
    expect(table.parentElement).toHaveClass(
      "rounded-card",
      "border",
      "overflow-x-auto"
    )
    expect(table).not.toHaveAttribute("appearance")
    expect(screen.getAllByRole("row")).toHaveLength(2)
    expect(screen.getByText("First")).toHaveClass("after:bg-divider")
    rerender(<Table aria-label="Embedded" />)
    expect(screen.getByRole("table").parentElement).not.toHaveClass("border")
  })
})
