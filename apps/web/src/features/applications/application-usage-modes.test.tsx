import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ApplicationUsageMode } from "@linksense/shared"
import i18n from "@/i18n"
import { ApplicationUsageModes } from "./application-usage-modes"

afterEach(cleanup)
function Options() {
  const [modes, setModes] = useState<ApplicationUsageMode[]>(["install"])
  return <ApplicationUsageModes value={modes} onChange={setModes} />
}

describe("application usage options", () => {
  it("uses a form-label-sized legend and two rounded choice cards on one row", async () => {
    await i18n.changeLanguage("zh-CN")
    render(<Options />)
    const legend = screen.getByText(
      i18n.t("applications.distribution.usageModes")
    )
    expect(legend).toHaveAttribute("data-variant", "label")
    const cards = screen
      .getAllByRole("checkbox")
      .map((checkbox) => checkbox.closest("label"))
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card).toHaveClass(
        "has-[>[data-slot=field]]:rounded-2xl",
        "has-[>[data-slot=field]]:border",
        "border-divider"
      )
      expect(card?.querySelector(':scope > [data-slot="field"]')).not.toBeNull()
    }
    expect(cards[0]?.parentElement).toBe(cards[1]?.parentElement)
    expect(cards[0]?.parentElement).toHaveClass("grid", "grid-cols-2")
  })

  it("toggles from the card description or keyboard without changing the other option", async () => {
    await i18n.changeLanguage("zh-CN")
    render(<Options />)
    const service = screen.getByRole("checkbox", { name: "应用服务" })
    const description = i18n.t(
      "applications.distribution.modeDescriptions.service"
    )
    expect(service).toHaveAccessibleDescription(description)
    await userEvent.click(screen.getByText(description))
    expect(service).toBeChecked()
    expect(service).toHaveFocus()
    await userEvent.keyboard(" ")
    expect(service).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "应用安装包" })).toBeChecked()
  })

  it("does not change disabled options when clicking their cards", async () => {
    await i18n.changeLanguage("zh-CN")
    const onChange = vi.fn()
    render(
      <ApplicationUsageModes value={["install"]} onChange={onChange} disabled />
    )
    for (const mode of ["install", "service"] as const) {
      const checkbox = screen.getByRole("checkbox", {
        name: i18n.t(`applications.distribution.modes.${mode}`),
      })
      expect(checkbox).toHaveAttribute("aria-disabled", "true")
      await userEvent.click(
        screen.getByText(
          i18n.t(`applications.distribution.modeDescriptions.${mode}`)
        )
      )
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(["zh-CN", "en-US"])(
    "lets users select either option or both in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(<Options />)
      const install = screen.getByRole("checkbox", {
        name: i18n.t("applications.distribution.modes.install"),
      })
      const service = screen.getByRole("checkbox", {
        name: i18n.t("applications.distribution.modes.service"),
      })
      expect(install).toBeChecked()
      expect(service).not.toBeChecked()
      await userEvent.click(service)
      expect(install).toBeChecked()
      expect(service).toBeChecked()
      await userEvent.click(install)
      expect(install).not.toBeChecked()
      expect(service).toBeChecked()
    }
  )

  it("falls back to Chinese for an unsupported language", async () => {
    await i18n.changeLanguage("fr")
    render(<Options />)
    expect(screen.getByRole("checkbox", { name: "应用安装包" })).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "应用服务" })).toBeVisible()
  })
})
