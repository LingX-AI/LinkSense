import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Combobox,
  ComboboxChips,
  ComboboxChipsInput,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { InputGroup } from "@/components/ui/input-group"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

describe("form control radius", () => {
  afterEach(() => {
    cleanup()
  })

  it("uses the shared partial-radius treatment instead of pill-shaped controls", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Description" />
        <InputGroup aria-label="Search group" />
        <Select defaultValue="one">
          <SelectTrigger aria-label="Choice">
            <SelectValue>One</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>
      </>
    )

    for (const control of [
      screen.getByRole("textbox", { name: "Name" }),
      screen.getByRole("textbox", { name: "Description" }),
      screen.getByRole("group", { name: "Search group" }),
      screen.getByRole("combobox", { name: "Choice" }),
    ]) {
      expect(control).toHaveClass("rounded-lg")
      expect(control).not.toHaveClass("rounded-2xl", "rounded-full")
    }
  })

  it("uses smaller radii for the select popup and its options", async () => {
    const interaction = userEvent.setup()
    render(
      <Select defaultValue="one">
        <SelectTrigger aria-label="Popup choice">
          <SelectValue>One</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
          <SelectItem value="two">Two</SelectItem>
        </SelectContent>
      </Select>
    )

    await interaction.click(
      screen.getByRole("combobox", { name: "Popup choice" })
    )

    const options = await screen.findAllByRole("option")
    expect(document.querySelector("[data-slot=select-content]")).toHaveClass(
      "rounded-lg"
    )
    for (const option of options) {
      expect(option).toHaveClass("rounded-md")
      expect(option).not.toHaveClass("rounded-xl", "rounded-full")
    }
  })

  it("keeps form-control focus feedback free of outer rings and shadows", () => {
    render(
      <>
        <Input aria-label="Focus name" />
        <Textarea aria-label="Focus description" />
        <InputGroup aria-label="Focus group" />
        <Select defaultValue="one">
          <SelectTrigger aria-label="Focus choice">
            <SelectValue>One</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>
        <Checkbox aria-label="Focus checkbox" />
        <RadioGroup defaultValue="one">
          <RadioGroupItem value="one" aria-label="Focus radio" />
        </RadioGroup>
      </>
    )

    for (const control of [
      screen.getByRole("textbox", { name: "Focus name" }),
      screen.getByRole("textbox", { name: "Focus description" }),
      screen.getByRole("group", { name: "Focus group" }),
      screen.getByRole("combobox", { name: "Focus choice" }),
      screen.getByRole("checkbox", { name: "Focus checkbox" }),
      screen.getByRole("radio", { name: "Focus radio" }),
    ]) {
      const statefulShadowClasses = control.className
        .split(/\s+/u)
        .filter((className) =>
          /(?:focus-visible|focus-within|aria-invalid|has-\[)/u.test(className)
        )
        .filter((className) =>
          /(?:^|:)(?:ring(?:-|\[)|shadow(?:-|\[))/u.test(className)
        )
      expect(statefulShadowClasses).toEqual([])
    }
  })

  it("uses background feedback without adding focus borders to editable controls", () => {
    render(
      <>
        <Input aria-label="Subdued focus input" />
        <Textarea aria-label="Subdued focus textarea" />
        <InputGroup aria-label="Subdued focus group" />
        <Select defaultValue="one">
          <SelectTrigger aria-label="Subdued focus select">
            <SelectValue>One</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>
        <Combobox items={["one"]} multiple>
          <ComboboxChips aria-label="Subdued focus combobox chips">
            <ComboboxChipsInput aria-label="Subdued focus combobox input" />
          </ComboboxChips>
        </Combobox>
      </>
    )

    expect(
      screen.getByRole("textbox", { name: "Subdued focus input" })
    ).toHaveClass("focus-visible:bg-input/65")
    expect(
      screen.getByRole("textbox", { name: "Subdued focus textarea" })
    ).toHaveClass("focus-visible:bg-input/65")
    expect(
      screen.getByRole("group", { name: "Subdued focus group" })
    ).toHaveClass(
      "has-[[data-slot=input-group-control]:focus-visible]:bg-input/65"
    )
    expect(
      screen.getByRole("combobox", { name: "Subdued focus select" })
    ).toHaveClass("focus-visible:bg-input/65")
    expect(screen.getByLabelText("Subdued focus combobox chips")).toHaveClass(
      "focus-within:bg-input/65"
    )

    for (const control of [
      screen.getByRole("textbox", { name: "Subdued focus input" }),
      screen.getByRole("textbox", { name: "Subdued focus textarea" }),
      screen.getByRole("group", { name: "Subdued focus group" }),
      screen.getByRole("combobox", { name: "Subdued focus select" }),
      screen.getByLabelText("Subdued focus combobox chips"),
    ]) {
      expect(control.className).not.toContain("border-input-focus-border")
    }
  })
})
