import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AnnotationHoverCard } from "@/components/media/annotation-hover-card"

describe("AnnotationHoverCard", () => {
  afterEach(() => cleanup())

  it("keeps annotation details hidden until the count is hovered", async () => {
    const interaction = userEvent.setup()
    const onOpen = vi.fn()

    render(
      <AnnotationHoverCard
        ariaLabel="演示文稿注释：AI 入门.pptx"
        fileName="AI 入门.pptx"
        mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
        annotations={[{ request: "把标题改为英文" }]}
        annotationLabel="1 条注释"
        openLabel="预览演示文稿 AI 入门.pptx"
        onOpen={onOpen}
      />
    )

    const trigger = screen.getByRole("button", { name: "1 条注释" })
    expect(screen.queryByText("把标题改为英文")).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await interaction.hover(trigger)

    const request = await screen.findByText("把标题改为英文")
    const content = request.closest('[data-slot="hover-card-content"]')
    if (!(content instanceof HTMLElement)) {
      throw new Error("Missing shared annotation hover card")
    }
    expect(content).toHaveClass(
      "rounded-xl",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "p-3.5",
      "text-[var(--app-text)]",
      "shadow-md"
    )
    expect(content).not.toHaveClass(
      "rounded-2xl",
      "border-border",
      "p-4",
      "shadow-lg",
      "shadow-[var(--app-hover-card-shadow)]"
    )
    expect(content.parentElement).toHaveAttribute("data-align", "end")
    expect(content).toHaveAccessibleName("演示文稿注释：AI 入门.pptx")
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(trigger).toHaveAttribute("aria-controls", content.id)

    await interaction.click(
      within(content).getByRole("button", {
        name: "预览演示文稿 AI 入门.pptx",
      })
    )
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("closes the details after the pointer leaves the hover card", async () => {
    const interaction = userEvent.setup()

    render(
      <AnnotationHoverCard
        ariaLabel="文档注释：项目建议书.docx"
        fileName="项目建议书.docx"
        annotations={[{ request: "把标题改成蓝色" }]}
        annotationLabel="1 条注释"
      />
    )

    const trigger = screen.getByRole("button", { name: "1 条注释" })
    await interaction.hover(trigger)
    expect(await screen.findByText("把标题改成蓝色")).toBeVisible()

    await interaction.unhover(trigger)
    await interaction.hover(document.body)

    await waitFor(() =>
      expect(screen.queryByText("把标题改成蓝色")).not.toBeInTheDocument()
    )
  })

  it("also opens the shared details card from keyboard activation", async () => {
    const interaction = userEvent.setup()
    const onOpen = vi.fn()

    render(
      <AnnotationHoverCard
        ariaLabel="文档注释：项目建议书.docx"
        fileName="项目建议书.docx"
        annotations={[{ request: "把标题改成蓝色" }]}
        annotationLabel="1 条注释"
        openLabel="预览文档 项目建议书.docx"
        onOpen={onOpen}
      />
    )

    await interaction.tab()

    const trigger = screen.getByRole("button", { name: "1 条注释" })
    expect(trigger).toHaveFocus()
    await interaction.keyboard("{Enter}")

    expect(await screen.findByText("把标题改成蓝色")).toBeVisible()
    expect(
      screen.getByRole("button", { name: "预览文档 项目建议书.docx" })
    ).toHaveFocus()

    await interaction.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByText("把标题改成蓝色")).not.toBeInTheDocument()
    )
    expect(trigger).toHaveFocus()
  })

  it("opens the details on press for touch and pointer users", async () => {
    const interaction = userEvent.setup()

    render(
      <AnnotationHoverCard
        ariaLabel="文档注释：项目建议书.docx"
        fileName="项目建议书.docx"
        annotations={[{ request: "把标题改成蓝色" }]}
        annotationLabel="1 条注释"
      />
    )

    await interaction.click(screen.getByRole("button", { name: "1 条注释" }))

    expect(await screen.findByText("把标题改成蓝色")).toBeVisible()
  })
})
