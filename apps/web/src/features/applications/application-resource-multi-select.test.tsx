import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { supportedLocales } from "@linksense/shared"
import { afterEach, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { ResourceMultiSelect } from "./application-resource-multi-select"

afterEach(cleanup)

it.each(
  supportedLocales.flatMap((locale) =>
    [false, true].map((detailInline) => ({ locale, detailInline }))
  )
)(
  "keeps long resource text readable and selectable in $locale with inline detail $detailInline",
  async ({ locale, detailInline }) => {
    await i18n.changeLanguage(locale)
    const label = "School data query and reporting guide ".repeat(5).trim()
    const detail = "Use authorized school data to answer scoped questions. "
      .repeat(8)
      .trim()
    const onChange = vi.fn()
    const interaction = userEvent.setup()
    render(
      <ResourceMultiSelect
        id="resource-picker"
        title={i18n.t("applications.skills")}
        description={i18n.t("publicKnowledge.skillsHelp")}
        items={[{ id: "guide", label, detail, detailInline, disabled: false }]}
        selectedIds={[]}
        onChange={onChange}
        emptyLabel={i18n.t("applications.noSkills")}
        placeholder={i18n.t("applications.skillSelectPlaceholder")}
        searchPlaceholder={i18n.t("applications.skillSearchPlaceholder")}
      />
    )

    await interaction.click(
      screen.getByRole("combobox", { name: i18n.t("applications.skills") })
    )
    for (const text of [label, detail]) {
      expect(screen.getByText(text)).toHaveClass("whitespace-normal")
      expect(screen.getByText(text)).not.toHaveClass("truncate")
    }
    await interaction.click(screen.getByRole("option"))
    expect(onChange).toHaveBeenCalledWith(["guide"])
    await interaction.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  }
)
