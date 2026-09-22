import { useState } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  projectIconSchema,
  projectColorSchema,
  type ProjectAppearance,
} from "@linksense/shared"
import i18n from "@/i18n"
import { ProjectAppearancePicker } from "./project-appearance-picker"
import { ProjectIcon } from "./project-icon"

afterEach(cleanup)

function ControlledPicker() {
  const [value, onChange] = useState<ProjectAppearance>({
    icon: "folder",
    color: "default",
  })
  return <ProjectAppearancePicker value={value} onChange={onChange} />
}

describe("project appearance picker", () => {
  it.each(["zh-CN", "en-US", "de-DE"])(
    "selects colors and icons without closing the picker in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const t = i18n.t.bind(i18n)
      const user = userEvent.setup()
      render(<ControlledPicker />)
      const trigger = screen.getByRole("button", {
        name: t("projects.appearance.choose"),
      })
      await user.click(trigger)
      const popup = screen.getByRole("dialog", {
        name: t("projects.appearance.choose"),
      })
      const colorGroup = within(popup).getByRole("group", {
        name: t("projects.appearance.color"),
      })
      expect(within(colorGroup).getAllByRole("button")).toHaveLength(12)
      for (const color of projectColorSchema.options)
        expect(
          within(popup).getByRole("button", {
            name: t(`projects.appearance.colors.${color}`),
          })
        ).toBeVisible()
      for (const color of ["teal", "cyan", "brown", "gray"] as const) {
        const label = t(`projects.appearance.colors.${color}`)
        expect(label).not.toContain("projects.appearance")
        await user.click(within(colorGroup).getByRole("button", { name: label }))
        expect(trigger.querySelector("svg")).toHaveAttribute(
          "data-project-color",
          color
        )
      }
      for (const icon of projectIconSchema.options)
        expect(
          within(popup).getByRole("button", {
            name: t(`projects.appearance.icons.${icon}`),
          })
        ).toBeVisible()
      for (const icon of popup.querySelectorAll("[data-project-icon]"))
        expect(icon).toHaveClass("size-6")
      await user.click(
        within(popup).getByRole("button", {
          name: t("projects.appearance.colors.blue"),
        })
      )
      await user.click(
        within(popup).getByRole("button", {
          name: t("projects.appearance.icons.flower"),
        })
      )
      expect(
        within(popup).getByRole("button", {
          name: t("projects.appearance.icons.flower"),
        })
      ).toHaveAttribute("aria-pressed", "true")
      expect(trigger.querySelector("svg")).toHaveAttribute(
        "data-project-icon",
        "flower"
      )
      expect(trigger.querySelector("svg")).toHaveAttribute(
        "data-project-color",
        "blue"
      )
      await user.click(
        within(popup).getByRole("button", {
          name: t("projects.appearance.done"),
        })
      )
      expect(trigger).toHaveFocus()
      await user.click(trigger)
      expect(
        screen.getByRole("button", {
          name: t("projects.appearance.colors.blue"),
        })
      ).toHaveAttribute("aria-pressed", "true")
    }
  )

  it("keeps a disabled picker closed", async () => {
    await i18n.changeLanguage("zh-CN")
    const onChange = vi.fn()
    render(
      <ProjectAppearancePicker
        value={{ icon: "heart", color: "pink" }}
        disabled
        onChange={onChange}
      />
    )
    expect(screen.getByRole("button")).toBeDisabled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("shows the configured icon in the same color when the project expands", () => {
    const { container, rerender } = render(
      <ProjectIcon icon="flower" color="blue" />
    )
    expect(container.querySelector("svg")).toHaveClass(
      "lucide-flower-2",
      "text-[var(--project-icon-blue)]"
    )
    rerender(<ProjectIcon icon="flower" color="blue" open />)
    expect(container.querySelector("svg")).toHaveClass("lucide-flower-2")
    rerender(<ProjectIcon icon="folder" color="default" open />)
    expect(container.querySelector("svg")).toHaveClass("lucide-folder-open")
  })
})
