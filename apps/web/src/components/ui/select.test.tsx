import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

const languages = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
  { value: "es-ES", label: "Español" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "fr-FR", label: "Français" },
  { value: "ja-JP", label: "日本語" },
]

function mockLayout(triggerTop: number) {
  // JSDOM has no layout engine. Provide element geometry, but let Base UI's
  // real positioning and collision detection decide which side to use.
  const viewport = new DOMRect(0, 0, 1200, 800)
  const trigger = new DOMRect(300, triggerTop, 200, 32)
  const popup = new DOMRect(0, 0, 220, 216)
  const empty = new DOMRect()

  function bounds(element: HTMLElement): DOMRect {
    if (element === document.documentElement || element === document.body) {
      return viewport
    }
    if (element.dataset.slot === "select-trigger") return trigger
    if (
      element.dataset.slot === "select-content" ||
      element.querySelector('[data-slot="select-content"]')
    ) {
      return popup
    }
    return empty
  }

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return bounds(this)
    }
  )
  for (const property of ["offsetWidth", "clientWidth"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
      function (this: HTMLElement) {
        return bounds(this).width
      }
    )
  }
  for (const property of ["offsetHeight", "clientHeight"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
      function (this: HTMLElement) {
        return bounds(this).height
      }
    )
  }
}

function renderLanguageSelect(side?: "top" | "bottom") {
  render(
    <Select defaultValue="ja-JP" items={languages}>
      <SelectTrigger aria-label="Interface language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent side={side}>
        <SelectGroup>
          {languages.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Select popup placement", () => {
  it.each([80, 450])(
    "opens below at y=%i when the last language is selected and space is sufficient",
    async (triggerTop) => {
      mockLayout(triggerTop)
      const user = userEvent.setup()
      renderLanguageSelect()

      await user.click(screen.getByRole("combobox"))

      const popup = (await screen.findByRole("listbox")).closest(
        '[data-slot="select-content"]'
      )
      expect(popup).toHaveAttribute("data-align-trigger", "false")
      await waitFor(() => expect(popup).toHaveAttribute("data-side", "bottom"))
      expect(screen.getByRole("option", { name: "日本語" })).toHaveAttribute(
        "aria-selected",
        "true"
      )

      await user.click(screen.getByRole("option", { name: "English" }))
      expect(screen.getByRole("combobox")).toHaveTextContent("English")
    }
  )

  it("flips above the trigger when there is insufficient space below", async () => {
    mockLayout(730)
    const user = userEvent.setup()
    renderLanguageSelect()

    await user.click(screen.getByRole("combobox"))

    const popup = (await screen.findByRole("listbox")).closest(
      '[data-slot="select-content"]'
    )
    expect(popup).toHaveAttribute("data-align-trigger", "false")
    await waitFor(() => expect(popup).toHaveAttribute("data-side", "top"))
  })

  it("preserves an explicitly requested opening direction", async () => {
    mockLayout(350)
    const user = userEvent.setup()
    renderLanguageSelect("top")

    await user.click(screen.getByRole("combobox"))

    const popup = (await screen.findByRole("listbox")).closest(
      '[data-slot="select-content"]'
    )
    await waitFor(() => expect(popup).toHaveAttribute("data-side", "top"))
  })
})
