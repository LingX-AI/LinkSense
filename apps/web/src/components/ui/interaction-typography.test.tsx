import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

describe("interactive typography", () => {
  afterEach(() => {
    cleanup()
  })

  it("uses medium weight for dropdown and select navigation text", async () => {
    const interaction = userEvent.setup()
    render(
      <>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button>Open menu</Button>} />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>Profile</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select defaultValue="one">
          <SelectTrigger aria-label="Choice">
            <SelectValue>One</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
            <SelectItem value="two">Two</SelectItem>
          </SelectContent>
        </Select>
      </>
    )

    await interaction.click(screen.getByRole("button", { name: "Open menu" }))
    expect(await screen.findByText("Account")).toHaveClass("font-medium")
    expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveClass(
      "font-medium"
    )
    await interaction.keyboard("{Escape}")

    const selectTrigger = screen.getByRole("combobox", { name: "Choice" })
    expect(selectTrigger).toHaveClass("font-medium")
    await interaction.click(selectTrigger)
    for (const option of await screen.findAllByRole("option")) {
      expect(option).toHaveClass("font-medium")
    }
  })

  it("uses the spacious shadcn Base Tabs hierarchy for navigation tabs", () => {
    render(
      <>
        <Command>
          <CommandList>
            <CommandGroup heading="Navigation">
              <CommandItem>Search result</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        <Tabs defaultValue="first">
          <TabsList>
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger value="second">Second</TabsTrigger>
          </TabsList>
        </Tabs>
      </>
    )

    expect(screen.getByText("Search result")).toHaveClass(
      "font-medium",
      "data-selected:bg-hover"
    )
    expect(screen.getByText("Navigation").parentElement).toHaveClass(
      "**:[[cmdk-group-heading]]:font-semibold"
    )
    const firstTab = screen.getByRole("tab", { name: "First" })
    const tabList = firstTab.closest('[data-slot="tabs-list"]')
    expect(firstTab.closest('[data-slot="tabs"]')).toHaveClass("gap-3")
    expect(tabList).toHaveClass(
      "rounded-none",
      "bg-transparent",
      "gap-1",
      "p-0",
      "group-data-horizontal/tabs:min-h-10",
      "overflow-x-auto",
      "overflow-y-hidden",
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden"
    )
    expect(firstTab).toHaveClass(
      "rounded-xl",
      "font-medium",
      "h-auto",
      "min-h-8",
      "px-3",
      "py-1.5",
      "text-muted-foreground",
      "hover:bg-hover",
      "data-active:bg-muted/50"
    )
    expect(firstTab).not.toHaveClass("font-semibold")
  })
})
