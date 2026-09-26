import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import i18n from "@/i18n"

describe("PoweredByLinkSense", () => {
  beforeEach(async () => {
    document.documentElement.dataset.theme = "light"
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.theme
  })

  it("shows the required phrase and full mark without a click target", () => {
    render(<PoweredByLinkSense className="custom-position" />)

    const badge = screen.getByRole("note", { name: "由 LinkSense 提供支持" })
    const logo = badge.querySelector("img")
    expect(badge).toHaveClass("custom-position", "h-5", "text-xs")
    expect(badge).not.toHaveAttribute("href")
    expect(badge.querySelector("a, button")).toBeNull()
    expect(badge).toHaveTextContent("Powered by")
    expect(logo).toHaveAttribute("src", "/attribution/linksense-mark.svg")
    expect(logo).toHaveAttribute("alt", "LinkSense")
    expect(logo).toHaveClass("h-[18px]")
  })

  it("uses the dark lockup on a dark page", () => {
    document.documentElement.dataset.theme = "dark"
    render(<PoweredByLinkSense />)

    expect(
      screen
        .getByRole("note", { name: "由 LinkSense 提供支持" })
        .querySelector("img")
    ).toHaveAttribute("src", "/attribution/linksense-mark-light.svg")
  })

  it.each([
    ["zh-CN", "Powered by", "由 LinkSense 提供支持"],
    ["en-US", "Powered by", "Powered by LinkSense"],
    ["es-ES", "Powered by", "Con tecnología de LinkSense"],
    ["pt-BR", "Powered by", "Tecnologia de LinkSense"],
    ["fr-FR", "Powered by", "Propulsé par LinkSense"],
    ["ja-JP", "Powered by", "LinkSense が提供"],
  ])(
    "keeps the licensed notice visible in %s",
    async (locale, label, accessibleName) => {
      await i18n.changeLanguage(locale)
      render(<PoweredByLinkSense />)

      expect(
        screen.getByRole("note", { name: accessibleName })
      ).toHaveTextContent(label)
    }
  )

  it("falls back to Chinese when an accessibility translation is unavailable", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")

    expect(fallback.t("common.poweredByLinkSense", { lng: "en-US" })).toBe(
      "由 LinkSense 提供支持"
    )
  })
})
