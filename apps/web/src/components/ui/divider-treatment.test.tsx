import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import { Card, CardFooter, CardHeader } from "@/components/ui/card"
import { Command, CommandList, CommandSeparator } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

describe("divider treatment", () => {
  afterEach(() => {
    cleanup()
  })

  it("draws table rows with the shared half-pixel divider treatment", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>First</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Last</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )

    for (const cell of [
      screen.getByRole("columnheader", { name: "Name" }),
      screen.getByRole("cell", { name: "First" }),
    ]) {
      expect(cell).toHaveClass(
        "relative",
        "after:h-[0.5px]",
        "after:bg-divider"
      )
      expect(cell).not.toHaveClass("border-b")
    }
    expect(screen.getByRole("row", { name: "Last" })).toHaveClass(
      "last:[&>td]:after:hidden"
    )
  })

  it("uses the same half-pixel divider in shared popup components", async () => {
    const interaction = userEvent.setup()
    render(
      <>
        <Separator data-testid="separator" />
        <Command>
          <CommandList>
            <CommandSeparator />
          </CommandList>
        </Command>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button>Open menu</Button>} />
          <DropdownMenuContent>
            <DropdownMenuItem>First action</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Second action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select defaultValue="one">
          <SelectTrigger aria-label="Choice">
            <SelectValue>One</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
            <SelectSeparator />
            <SelectItem value="two">Two</SelectItem>
          </SelectContent>
        </Select>
      </>
    )

    expect(screen.getByTestId("separator")).toHaveClass(
      "bg-divider",
      "data-horizontal:h-[0.5px]"
    )
    expect(
      document.querySelector('[data-slot="command-separator"]')
    ).toHaveClass("h-[0.5px]", "bg-divider")

    await interaction.click(screen.getByRole("button", { name: "Open menu" }))
    await screen.findByRole("menuitem", { name: "First action" })
    expect(
      document.querySelector('[data-slot="dropdown-menu-separator"]')
    ).toHaveClass("h-[0.5px]", "bg-divider")
    await interaction.keyboard("{Escape}")

    await interaction.click(screen.getByRole("combobox", { name: "Choice" }))
    await screen.findByRole("option", { name: "One" })
    expect(
      document.querySelector('[data-slot="select-separator"]')
    ).toHaveClass("h-[0.5px]", "bg-divider")
  })

  it("uses bordered, shadowless cards with shared section dividers", () => {
    const { container } = render(
      <Card>
        <CardHeader className="border-b">Header</CardHeader>
        <CardFooter className="border-t">Footer</CardFooter>
      </Card>
    )

    expect(container.querySelector('[data-slot="card"]')).toHaveClass(
      "border",
      "border-[color:var(--app-border)]",
      "shadow-none"
    )
    expect(container.querySelector('[data-slot="card"]')).not.toHaveClass(
      "border-border",
      "shadow-sm",
      "ring-1"
    )
    expect(screen.getByText("Header")).toHaveClass("border-b", "border-divider")
    expect(screen.getByText("Footer")).toHaveClass("border-t", "border-divider")
  })
})
