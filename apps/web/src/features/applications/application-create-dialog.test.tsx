import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { ApplicationCreateDialog } from "./application-create-dialog"

afterEach(cleanup)

describe.each(["zh-CN", "en-US"])(
  "application creation choices (%s)",
  (locale) => {
    it("prioritizes chat creation and gives each alternative one accessible action", async () => {
      await i18n.changeLanguage(locale)
      const choose = vi.fn()
      render(
        <ApplicationCreateDialog
          open
          onChoose={choose}
          onOpenChange={vi.fn()}
        />
      )
      const dialog = screen.getByRole("dialog", {
        name: i18n.t("applications.createTitle"),
      })
      expect(dialog).toHaveAccessibleDescription(
        i18n.t("applications.createTypeDescription")
      )
      const titles = [
        i18n.t("applications.creation.interactiveTitle"),
        i18n.t("applications.createStandardApp"),
        i18n.t("applications.importInteractiveApp"),
      ]
      const descriptions = [
        locale === "zh-CN"
          ? "说出你的想法，LinkSense帮你实现"
          : "Share your idea and let LinkSense bring it to life.",
        i18n.t("applications.createStandardAppDescription"),
        i18n.t("applications.importInteractiveAppDescription"),
      ]
      const methods = ["development", "standard", "interactive"]
      const actions = titles.map((name) =>
        within(dialog).getByRole("button", { name })
      )
      const primary = actions[0]
      if (!primary) throw new Error("Expected chat creation action")
      expect(within(dialog).getAllByRole("button")).toHaveLength(4)
      expect(
        within(primary).getByText(i18n.t("applications.creation.recommended"))
      ).toBeVisible()
      expect(
        within(primary).getByText(i18n.t("applications.creation.start"))
      ).toBeVisible()
      expect(
        dialog.querySelector('[data-slot="application-creation-illustration"]')
      ).toHaveAttribute("aria-hidden", "true")
      expect(
        dialog.querySelector('[data-slot="application-creation-illustration"]')
      ).toHaveClass("hidden", "sm:block")
      expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "flex-col")
      expect(actions[0]?.parentElement).toHaveClass("overflow-y-auto")
      const alternatives = dialog.querySelector(
        '[data-slot="application-creation-alternatives"]'
      )
      expect(alternatives).toHaveClass("flex-col")
      expect(alternatives).toContainElement(actions[1])
      expect(alternatives).toContainElement(actions[2])
      expect(alternatives).not.toContainElement(actions[0])
      expect(dialog.textContent).not.toMatch(
        /manifest\.json|index\.html|MCP|Skill/u
      )
      expect(
        within(dialog).queryByRole("button", {
          name: i18n.t("applications.declaration.title"),
        })
      ).not.toBeInTheDocument()
      const user = userEvent.setup()
      for (const [index, action] of actions.entries()) {
        expect(action).toHaveAccessibleDescription(descriptions[index])
        expect(action.querySelector("button, a, input")).toBeNull()
        await user.click(action)
        expect(choose).toHaveBeenNthCalledWith(index + 1, methods[index])
      }
    })

    it("supports keyboard selection in reading order and closing without creating an app", async () => {
      await i18n.changeLanguage(locale)
      const choose = vi.fn(),
        close = vi.fn(),
        user = userEvent.setup()
      render(
        <ApplicationCreateDialog open onChoose={choose} onOpenChange={close} />
      )
      const primary = screen.getByRole("button", {
        name: i18n.t("applications.creation.interactiveTitle"),
      })
      await waitFor(() => expect(primary).toHaveFocus())
      await user.keyboard("{Enter}")
      expect(choose).toHaveBeenLastCalledWith("development")
      await user.tab()
      expect(
        screen.getByRole("button", {
          name: i18n.t("applications.createStandardApp"),
        })
      ).toHaveFocus()
      await user.keyboard(" ")
      expect(choose).toHaveBeenLastCalledWith("standard")
      await user.tab()
      expect(
        screen.getByRole("button", {
          name: i18n.t("applications.importInteractiveApp"),
        })
      ).toHaveFocus()
      await user.keyboard("{Enter}")
      expect(choose).toHaveBeenLastCalledWith("interactive")
      await user.tab()
      expect(
        screen.getByRole("button", { name: i18n.t("common.close") })
      ).toHaveFocus()
      await user.keyboard("{Escape}")
      expect(close).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ reason: "escape-key" })
      )
      expect(choose).toHaveBeenCalledTimes(3)
    })
  }
)

it("falls back to Chinese for the creation choices and package instructions", async () => {
  const fallback = i18n.cloneInstance({ lng: "de-DE", fallbackLng: "zh-CN" })
  await fallback.changeLanguage("de-DE")
  render(
    <I18nextProvider i18n={fallback}>
      <ApplicationCreateDialog open onChoose={vi.fn()} onOpenChange={vi.fn()} />
    </I18nextProvider>
  )
  expect(
    screen.getByRole("button", { name: "用对话创建交互式应用" })
  ).toBeVisible()
  expect(
    screen.getByRole("button", { name: "用对话创建交互式应用" })
  ).toHaveAccessibleDescription("说出你的想法，LinkSense帮你实现")
  for (const key of [
    "applications.creation.recommended",
    "applications.creation.interactiveTitle",
    "applications.creation.interactiveDescription",
    "applications.creation.start",
    "applications.createTypeDescription",
    "applications.createStandardAppDescription",
    "applications.importInteractiveAppDescription",
    "applications.interactivePackageRequirements",
  ]) {
    expect(fallback.t(key)).toBe(i18n.getFixedT("zh-CN")(key))
    expect(fallback.t(key)).not.toBe(key)
  }
})
