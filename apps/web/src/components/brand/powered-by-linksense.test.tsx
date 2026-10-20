import { cleanup, render, screen } from "@testing-library/react"
import { compile } from "tailwindcss"
import tailwindTheme from "tailwindcss/theme.css?raw"
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

  it("links the phrase and full mark to LinkSense without link decoration", () => {
    render(<PoweredByLinkSense />)

    const badge = screen.getByRole("link", { name: "由 LinkSense 提供支持" })
    const logo = badge.querySelector("img")
    expect(badge).toHaveClass("h-5", "text-xs")
    expect(badge.tagName).toBe("A")
    expect(badge).toHaveAttribute("href", "https://linksense.org")
    expect(badge).toHaveAttribute("target", "_blank")
    expect(badge).toHaveAttribute("rel", "noopener noreferrer")
    expect(badge).toHaveClass(
      "text-foreground",
      "no-underline",
      "visited:text-foreground",
      "hover:text-foreground",
      "hover:no-underline"
    )
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
        .getByRole("link", { name: "由 LinkSense 提供支持" })
        .querySelector("img")
    ).toHaveAttribute("src", "/attribution/linksense-mark-light.svg")
  })

  it.each(["shell", "page", "public", "conversation"] as const)(
    "owns the same edge inset in the %s placement",
    async (placement) => {
      render(<PoweredByLinkSense placement={placement} />)

      const attribution = screen.getByRole("link", {
        name: "由 LinkSense 提供支持",
      })
      const frame = attribution.parentElement
      expect(frame).toHaveAttribute("data-slot", "powered-by-linksense")
      expect(frame).toHaveAttribute("data-placement", placement)
      expect(frame).toHaveClass("[--attribution-inset:18px]", "shrink-0")
      expect(frame).not.toHaveClass("fixed", "h-8", "h-12", "md:h-16")
      if (!frame) throw new Error("Attribution frame is missing")
      const compiler = await compile(`${tailwindTheme}\n@tailwind utilities;`)
      const styles = compiler.build(Array.from(frame.classList))
      expect(styles).toMatch(/--attribution-inset:\s*18px;/u)

      if (placement === "conversation") {
        expect(frame?.tagName).toBe("DIV")
        expect(frame).toHaveClass("hidden", "md:flex")
        expect(frame).toHaveClass(
          "mr-[calc(var(--attribution-inset)-var(--conversation-horizontal-gutter))]",
          "mb-[calc(var(--attribution-inset)-var(--conversation-bottom-inset))]"
        )
      } else {
        expect(frame).toBe(screen.getByRole("contentinfo"))
        expect(frame).toHaveClass(
          "flex",
          "justify-end",
          "px-[var(--attribution-inset)]",
          "pb-[var(--attribution-inset)]",
          "right-[var(--attribution-inset)]",
          "bottom-[var(--attribution-inset)]"
        )
        expect(styles).toMatch(/right:\s*var\(--attribution-inset\);/u)
        expect(styles).toMatch(/bottom:\s*var\(--attribution-inset\);/u)
        expect(styles).toMatch(/padding-inline:\s*var\(--attribution-inset\);/u)
        expect(styles).toMatch(/padding-bottom:\s*var\(--attribution-inset\);/u)
      }

      if (placement === "public") {
        expect(frame).toHaveClass(
          "mt-auto",
          "-mx-[var(--public-shell-horizontal-padding)]"
        )
      }
    }
  )

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
        screen.getByRole("link", { name: accessibleName })
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
