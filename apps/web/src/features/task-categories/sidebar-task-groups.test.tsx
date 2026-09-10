import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { SidebarTaskGroups } from "./sidebar-task-groups"

const category = {
  id: "80000000-0000-4000-8000-000000000001",
  name: "日常工作",
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
}

function renderGroups() {
  const onAction = vi.fn()
  render(
    <SidebarTaskGroups
      pinned={[]}
      recent={[]}
      categories={[category]}
      loadingMore={false}
      onAction={onAction}
    >
      {() => <a href="/conversations/task">归属任务</a>}
    </SidebarTaskGroups>
  )
  return onAction
}

describe("sidebar task category controls", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("scopes the create action reveal to the heading row and keeps a larger square control near the right edge", async () => {
    const interaction = userEvent.setup()
    const onAction = renderGroups()
    const create = screen.getByRole("button", { name: "新建任务分类" })
    const headingRow = create.parentElement

    expect(headingRow).toHaveClass("group/tasks-heading", "pr-0.5")
    expect(headingRow).toContainElement(
      screen.getByRole("heading", { name: "任务" })
    )
    expect(headingRow).not.toContainElement(
      screen.getByRole("region", { name: category.name })
    )
    expect(create).toHaveClass(
      "size-7",
      "rounded-lg",
      "opacity-0",
      "pointer-events-none",
      "group-hover/tasks-heading:opacity-100",
      "group-hover/tasks-heading:pointer-events-auto",
      "group-has-[:focus-visible]/tasks-heading:opacity-100",
      "group-has-[:focus-visible]/tasks-heading:pointer-events-auto",
      "[@media(hover:none)]:opacity-100",
      "[@media(hover:none)]:pointer-events-auto"
    )
    expect(create).not.toHaveClass("[&_svg:not([class*='size-'])]:size-3")
    await interaction.tab()
    expect(create).toHaveFocus()
    await interaction.keyboard("{Enter}")
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ mode: "create" })
  })

  it("highlights the whole category header including the menu without giving expanded folders a permanent button background", () => {
    renderGroups()
    const folder = screen.getByRole("button", { name: category.name })
    const more = screen.getByRole("button", { name: "日常工作的更多操作" })
    const header = folder.parentElement

    expect(header).toContainElement(more)
    expect(header).not.toContainElement(
      screen.getByRole("link", { name: "归属任务" })
    )
    expect(header).toHaveClass(
      "relative",
      "rounded-[10px]",
      "hover:bg-[var(--app-sidebar-hover)]"
    )
    expect(folder).toHaveClass(
      "h-8",
      "w-full",
      "pr-9",
      "hover:bg-transparent",
      "aria-expanded:bg-transparent"
    )
    expect(more).toHaveClass(
      "absolute",
      "right-1",
      "hover:bg-transparent",
      "aria-expanded:bg-transparent",
      "opacity-0",
      "pointer-events-none",
      "group-hover/category:opacity-100",
      "group-hover/category:pointer-events-auto",
      "group-has-[:focus-visible]/category:opacity-100",
      "group-has-[:focus-visible]/category:pointer-events-auto",
      "data-popup-open:opacity-100",
      "data-popup-open:pointer-events-auto",
      "[@media(hover:none)]:opacity-100",
      "[@media(hover:none)]:pointer-events-auto"
    )
  })

  it("uses navigation-sized open and closed folder icons while toggling with pointer and keyboard", async () => {
    const interaction = userEvent.setup()
    renderGroups()
    const folder = screen.getByRole("button", { name: category.name })
    expect(folder.querySelectorAll("svg")).toHaveLength(1)
    expect(folder.querySelector("svg")).toHaveClass(
      "lucide-folder-open",
      "size-3.5"
    )
    expect(folder).toHaveAttribute("aria-expanded", "true")

    await interaction.click(folder)
    expect(folder).toHaveAttribute("aria-expanded", "false")
    expect(folder.querySelector("svg")).toHaveClass(
      "lucide-folder-closed",
      "size-3.5"
    )
    expect(
      screen.queryByRole("link", { name: "归属任务" })
    ).not.toBeInTheDocument()
    await interaction.keyboard("{Enter}")
    expect(folder).toHaveAttribute("aria-expanded", "true")
    expect(folder.querySelector("svg")).toHaveClass(
      "lucide-folder-open",
      "size-3.5"
    )
    expect(screen.getByRole("link", { name: "归属任务" })).toBeVisible()
    await interaction.keyboard(" ")
    expect(folder).toHaveAttribute("aria-expanded", "false")
    expect(folder.querySelector("svg")).toHaveClass(
      "lucide-folder-closed",
      "size-3.5"
    )
  })

  it("keeps the menu active away from the header and invokes an action without collapsing the folder", async () => {
    const interaction = userEvent.setup()
    const onAction = renderGroups()
    const folder = screen.getByRole("button", { name: category.name })
    const more = screen.getByRole("button", { name: "日常工作的更多操作" })
    await interaction.click(more)
    const menu = await screen.findByRole("menu")
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["重命名", "删除"])
    await interaction.hover(menu)
    expect(more).toHaveAttribute("data-popup-open")
    expect(folder).toHaveAttribute("aria-expanded", "true")
    await interaction.click(
      within(menu).getByRole("menuitem", { name: "重命名" })
    )
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      mode: "rename",
      category,
    })
    expect(folder).toHaveAttribute("aria-expanded", "true")
  })

  it("animates the measured category content height and respects reduced motion", () => {
    renderGroups()
    const panel = screen
      .getByRole("region", { name: category.name })
      .querySelector('[data-slot="collapsible-content"]')
    expect(panel).toHaveClass(
      "h-(--collapsible-panel-height)",
      "overflow-hidden",
      "transition-[height,opacity]",
      "duration-200",
      "ease-out",
      "data-starting-style:h-0",
      "data-ending-style:h-0",
      "data-starting-style:opacity-0",
      "data-ending-style:opacity-0",
      "motion-reduce:transition-none"
    )
    expect(panel).not.toHaveClass("pl-5")
  })

  it("aligns task names and empty text with the category label using the group's inherited inset", () => {
    renderGroups()
    const group = screen.getByRole("region", { name: category.name })
    const folder = within(group).getByRole("button", { name: category.name })
    expect(folder).toHaveClass("pl-2.5", "gap-1.5", "border")
    expect(folder.querySelector("svg")).toHaveClass("size-3.5")
    expect(group).toHaveClass(
      "[--sidebar-conversation-indent:calc(1.875rem-7px)]"
    )
    const panel = group.querySelector('[data-slot="collapsible-content"]')!
    expect(panel.className).not.toMatch(/\[--sidebar-conversation-indent:/u)
    expect(panel).toContainElement(
      within(group).getByRole("link", { name: "归属任务" })
    )
    expect(within(group).getByText("暂无任务")).toHaveClass(
      "pl-[calc(8px+var(--sidebar-conversation-indent))]",
      "text-[length:var(--app-font-13)]",
      "leading-[var(--app-ui-compact-line-height)]"
    )
  })
})
