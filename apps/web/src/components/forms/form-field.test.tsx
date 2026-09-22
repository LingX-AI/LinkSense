import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FieldShell, SettingsFieldGroup, SettingsFieldRow } from "./form-field"

describe("settings form fields", () => {
  it("renders page fields with labels and hints in the left column", () => {
    render(
      <SettingsFieldGroup data-testid="group">
        <FieldShell
          id="name"
          label="Name"
          hint="Shown to everyone"
          layout="settings"
          controlWidth="medium"
        >
          <input id="name" />
        </FieldShell>
        <SettingsFieldRow
          id="enabled"
          label="Enabled"
          hint="Allow access"
          controlWidth="compact"
        >
          <button id="enabled">Toggle</button>
        </SettingsFieldRow>
      </SettingsFieldGroup>
    )

    expect(screen.getByTestId("group")).toHaveClass("divide-y")
    expect(
      screen.getByLabelText("Name").closest('[data-layout="settings"]')
    ).toHaveClass("md:grid-cols-[minmax(0,1fr)_minmax(18rem,42%)]")
    expect(screen.getByLabelText("Name").parentElement).toHaveClass(
      "md:justify-self-end",
      "md:max-w-sm"
    )
    expect(
      screen.getByRole("button", { name: "Enabled" }).parentElement
    ).toHaveClass("md:justify-self-end", "md:max-w-48")
    expect(
      screen.getByText("Shown to everyone").parentElement
    ).toContainElement(screen.getByText("Name"))
    expect(screen.getByText("Allow access").parentElement).toContainElement(
      screen.getByText("Enabled")
    )
  })

  it("keeps the default field layout unchanged for dialogs", () => {
    render(
      <FieldShell id="dialog-name" label="Dialog name" hint="Dialog hint">
        <input id="dialog-name" />
      </FieldShell>
    )

    const field = screen
      .getByLabelText("Dialog name")
      .closest('[data-slot="field"]')
    expect(field).toHaveAttribute("data-orientation", "vertical")
    expect(field).not.toHaveAttribute("data-layout", "settings")
  })

  it("places multiline controls below their label without a right-column width limit", () => {
    render(
      <FieldShell
        id="instructions"
        label="Instructions"
        hint="Used for future tasks"
        layout="settings"
        controlWidth="compact"
        multiline
      >
        <textarea id="instructions" />
      </FieldShell>
    )
    const input = screen.getByRole("textbox", { name: "Instructions" })
    const field = input.closest('[data-layout="settings"]')
    expect(field).toHaveAttribute("data-orientation", "vertical")
    expect(field).not.toHaveClass("md:grid")
    expect(input.parentElement).not.toHaveClass("md:max-w-48")
    expect(field?.firstElementChild).toContainElement(
      screen.getByText("Instructions")
    )
    expect(field?.lastElementChild).toContainElement(input)
  })
})
