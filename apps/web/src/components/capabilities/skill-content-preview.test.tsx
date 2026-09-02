import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SkillContentPreview } from "@/components/capabilities/skill-content-preview"
import i18n from "@/i18n"

describe("SkillContentPreview", () => {
  afterEach(() => {
    cleanup()
  })

  it("shows untrusted SKILL.md content as focusable plain text", async () => {
    await i18n.changeLanguage("zh-CN")
    const content =
      '<script data-testid="unsafe-script">alert("xss")</script>\n# PPTX Skill'

    render(
      <SkillContentPreview type="skill" content={content} truncated={false} />
    )

    expect(screen.getByRole("heading", { name: "SKILL.md 正文" })).toBeVisible()
    const body = screen.getByRole("region", { name: "SKILL.md 正文" })
    expect(body.tagName).toBe("PRE")
    expect(body).toHaveAttribute("tabindex", "0")
    expect(body).toHaveClass("border-[color:var(--app-border)]")
    expect(body.textContent).toBe(content)
    expect(screen.queryByTestId("unsafe-script")).not.toBeInTheDocument()
    expect(screen.queryByText(/截断后的预览/u)).not.toBeInTheDocument()
  })

  it("shows the English truncation notice for a truncated body", async () => {
    await i18n.changeLanguage("en-US")

    render(
      <SkillContentPreview type="skill" content="# Long Skill" truncated />
    )

    expect(screen.getByRole("heading", { name: "SKILL.md body" })).toBeVisible()
    expect(
      screen.getByText(
        "The SKILL.md body is too long, so this preview is truncated. The complete SKILL.md will still be installed."
      )
    ).toBeVisible()
  })

  it("shows a localized message for an empty Skill body", async () => {
    await i18n.changeLanguage("zh-CN")

    render(<SkillContentPreview type="skill" content="" truncated={false} />)

    expect(
      screen.getByRole("region", { name: "SKILL.md 正文" })
    ).toHaveTextContent("SKILL.md 正文为空。")
  })

  it("does not render the SKILL.md section for a Plugin preview", async () => {
    await i18n.changeLanguage("zh-CN")

    render(
      <SkillContentPreview type="plugin" content={null} truncated={false} />
    )

    expect(
      screen.queryByRole("heading", { name: "SKILL.md 正文" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("region")).not.toBeInTheDocument()
  })
})
