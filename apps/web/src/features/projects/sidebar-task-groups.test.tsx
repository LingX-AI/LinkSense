import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { conversationSchema } from "@/api/contracts"
import { SidebarTaskGroups } from "./sidebar-task-groups"

const project = {
  icon: "folder" as const,
  color: "default" as const,
  id: "80000000-0000-4000-8000-000000000001",
  name: "日常工作",
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
}

function renderGroups(userId = "first") {
  const onAction = vi.fn()
  render(
    <SidebarTaskGroups
      userId={userId}
      pinned={[]}
      recent={[]}
      projects={[project]}
      loadingMore={false}
      onAction={onAction}
    >
      {() => <a href="/conversations/task">归属任务</a>}
    </SidebarTaskGroups>
  )
  return onAction
}

describe("sidebar task project controls", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("separates project tasks from Recent while preserving pinned and unavailable-project tasks", () => {
    const task = (id: string, projectId: string | null) =>
      conversationSchema.parse({
        id,
        title: id,
        project_id: projectId,
        updated_at: project.updated_at,
      })
    render(
      <SidebarTaskGroups
        userId="first"
        pinned={[task("pinned", null)]}
        recent={[
          task("project-task", project.id),
          task("recent-first", null),
          task("unavailable-task", "80000000-0000-4000-8000-000000000002"),
          task("recent-second", null),
        ]}
        projects={[project]}
        loadingMore={false}
        onAction={vi.fn()}
      >
        {({ conversations }) =>
          conversations.map((conversation) => (
            <a key={conversation.id} href={`/conversations/${conversation.id}`}>
              {conversation.title}
            </a>
          ))
        }
      </SidebarTaskGroups>
    )
    const projects = screen.getByRole("region", { name: "项目" })
    const recent = screen.getByRole("region", { name: "最近" })
    expect(
      within(projects)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["project-task", "unavailable-task"])
    expect(
      within(recent)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["recent-first", "recent-second"])
    expect(
      within(screen.getByRole("region", { name: "置顶" })).getByRole("link", {
        name: "pinned",
      })
    ).toBeVisible()
    expect(
      within(projects).getByRole("region", { name: "项目暂不可用" })
    ).toBeVisible()
    expect(
      projects.compareDocumentPosition(recent) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("keeps separate section headings and project creation available when both lists are empty", () => {
    render(
      <SidebarTaskGroups
        userId="first"
        pinned={[]}
        recent={[]}
        projects={[]}
        loadingMore={false}
        onAction={vi.fn()}
      >
        {() => null}
      </SidebarTaskGroups>
    )
    expect(
      within(screen.getByRole("region", { name: "项目" })).getByRole("button", {
        name: "新建项目",
      })
    ).toBeEnabled()
    expect(screen.getByRole("region", { name: "最近" })).toBeVisible()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("restores the last collapsed or expanded choice after remounting the sidebar", async () => {
    const interaction = userEvent.setup()
    renderGroups()
    await interaction.click(screen.getByRole("button", { name: project.name }))
    cleanup()

    renderGroups()
    const folder = screen.getByRole("button", { name: project.name })
    expect(folder).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("link", { name: "归属任务" })
    ).not.toBeInTheDocument()

    await interaction.click(folder)
    cleanup()
    renderGroups()
    expect(screen.getByRole("button", { name: project.name })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByRole("link", { name: "归属任务" })).toBeVisible()
  })

  it("uses the smaller adaptive font size for Projects and Recent headings", () => {
    renderGroups()
    for (const name of ["项目", "最近"]) {
      const heading = screen.getByRole("heading", { name })
      expect(heading).toHaveClass("text-[length:var(--app-font-13)]")
      expect(heading).not.toHaveClass("text-[length:var(--app-ui-font-size)]")
    }
  })

  it.each([
    ["zh-CN", "项目", "最近"],
    ["en-US", "Projects", "Recent"],
  ])(
    "toggles the two sections independently with pointer and keyboard in %s",
    async (language, projectsLabel, recentLabel) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const task = conversationSchema.parse({
        id: "recent-task",
        title: "Recent task",
        project_id: null,
        updated_at: project.updated_at,
      })
      render(
        <SidebarTaskGroups
          userId="first"
          pinned={[{ ...task, id: "pinned-task", title: "Pinned task" }]}
          recent={[task]}
          projects={[project]}
          loadingMore={false}
          onAction={vi.fn()}
        >
          {({ conversations }) =>
            conversations.map((conversation) => (
              <a
                key={conversation.id}
                href={`/conversations/${conversation.id}`}
              >
                {conversation.title}
              </a>
            ))
          }
        </SidebarTaskGroups>
      )
      const projects = screen.getByRole("button", {
        name: projectsLabel,
      })
      const recent = screen.getByRole("button", {
        name: recentLabel,
      })
      expect(projects).toHaveAttribute("aria-expanded", "true")
      expect(recent).toHaveAttribute("aria-expanded", "true")

      await interaction.click(projects)
      expect(projects).toHaveAttribute("aria-expanded", "false")
      expect(
        screen.queryByRole("button", { name: project.name })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Recent task" })).toBeVisible()
      await interaction.click(recent)
      expect(recent).toHaveAttribute("aria-expanded", "false")
      expect(
        screen.queryByRole("link", { name: "Recent task" })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Pinned task" })).toBeVisible()

      await interaction.keyboard("{Enter}")
      expect(recent).toHaveAttribute("aria-expanded", "true")
      expect(screen.getByRole("link", { name: "Recent task" })).toBeVisible()
      await interaction.click(projects)
      expect(screen.getByRole("button", { name: project.name })).toBeVisible()
      await interaction.keyboard(" ")
      expect(projects).toHaveAttribute("aria-expanded", "false")
      expect(
        screen.queryByRole("button", { name: project.name })
      ).not.toBeInTheDocument()
    }
  )

  it("reveals section arrows on heading hover, keyboard focus, and touch devices", () => {
    renderGroups()
    for (const name of ["项目", "最近"]) {
      const trigger = screen.getByRole("button", { name })
      expect(trigger).toHaveClass("w-full", "group/section-trigger")
      expect(trigger.closest(".group\\/tasks-heading")).toContainElement(
        trigger
      )
      const arrow = trigger.querySelector("svg")
      expect(arrow).toHaveAttribute("aria-hidden", "true")
      expect(arrow).toHaveClass(
        "opacity-0",
        "group-hover/tasks-heading:opacity-100",
        "group-has-[:focus-visible]/tasks-heading:opacity-100",
        "group-aria-expanded/section-trigger:rotate-90",
        "[@media(hover:none)]:opacity-100"
      )
    }
  })

  it.each(["项目", "最近"])(
    "animates the %s section height and arrow while respecting reduced motion",
    (name) => {
      renderGroups()
      const section = screen.getByRole("region", { name })
      const panel = section.querySelector(
        ":scope > [data-slot='collapsible-content']"
      )
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
      expect(
        within(section).getByRole("button", { name }).querySelector("svg")
      ).toHaveClass(
        "transition-[transform,opacity]",
        "duration-200",
        "ease-out",
        "motion-reduce:transition-none"
      )
    }
  )

  it("preserves individual project state and keeps creation available while the section is collapsed", async () => {
    const interaction = userEvent.setup()
    const onAction = renderGroups()
    const projects = screen.getByRole("button", { name: "项目" })
    await interaction.click(screen.getByRole("button", { name: project.name }))
    await interaction.click(projects)
    await interaction.click(screen.getByRole("button", { name: "新建项目" }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ mode: "create" })
    expect(projects).toHaveAttribute("aria-expanded", "false")
    await interaction.click(projects)
    expect(screen.getByRole("button", { name: project.name })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
    expect(
      screen.queryByRole("link", { name: "归属任务" })
    ).not.toBeInTheDocument()
  })

  it("keeps a renamed project collapsed and restores the correct preference when switching users", async () => {
    const interaction = userEvent.setup()
    const view = (userId: string, name = project.name) => (
      <SidebarTaskGroups
        userId={userId}
        pinned={[]}
        recent={[]}
        projects={[{ ...project, name }]}
        loadingMore={false}
        onAction={vi.fn()}
      >
        {() => <a href="/conversations/task">归属任务</a>}
      </SidebarTaskGroups>
    )
    const { rerender } = render(view("first"))
    await interaction.click(screen.getByRole("button", { name: project.name }))
    rerender(view("first", "新名称"))
    expect(screen.getByRole("button", { name: "新名称" })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
    rerender(view("second", "新名称"))
    expect(screen.getByRole("button", { name: "新名称" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    rerender(view("first", "新名称"))
    expect(screen.getByRole("button", { name: "新名称" })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
  })

  it("still toggles when browser storage is unavailable", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("full")
    })
    const interaction = userEvent.setup()
    renderGroups()
    const folder = screen.getByRole("button", { name: project.name })
    await interaction.click(folder)
    expect(folder).toHaveAttribute("aria-expanded", "false")
    await interaction.click(folder)
    expect(folder).toHaveAttribute("aria-expanded", "true")
  })

  it("scopes the create action reveal to the heading row and keeps a larger square control near the right edge", async () => {
    const interaction = userEvent.setup()
    const onAction = renderGroups()
    const create = screen.getByRole("button", { name: "新建项目" })
    const headingRow = create.parentElement

    expect(headingRow).toHaveClass("group/tasks-heading", "pr-0.5")
    expect(headingRow).toContainElement(
      screen.getByRole("heading", { name: "项目" })
    )
    expect(headingRow).not.toContainElement(
      screen.getByRole("region", { name: project.name })
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
    expect(screen.getByRole("button", { name: "项目" })).toHaveFocus()
    await interaction.tab()
    expect(create).toHaveFocus()
    await interaction.keyboard("{Enter}")
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ mode: "create" })
    expect(screen.getByRole("button", { name: "项目" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
  })

  it("highlights the whole project header including the menu without giving expanded folders a permanent button background", () => {
    renderGroups()
    const folder = screen.getByRole("button", { name: project.name })
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
      "group-hover/project:opacity-100",
      "group-hover/project:pointer-events-auto",
      "group-has-[:focus-visible]/project:opacity-100",
      "group-has-[:focus-visible]/project:pointer-events-auto",
      "data-popup-open:opacity-100",
      "data-popup-open:pointer-events-auto",
      "[@media(hover:none)]:opacity-100",
      "[@media(hover:none)]:pointer-events-auto"
    )
  })

  it("uses navigation-sized open and closed folder icons while toggling with pointer and keyboard", async () => {
    const interaction = userEvent.setup()
    renderGroups()
    const folder = screen.getByRole("button", { name: project.name })
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
    const folder = screen.getByRole("button", { name: project.name })
    const more = screen.getByRole("button", { name: "日常工作的更多操作" })
    await interaction.click(more)
    const menu = await screen.findByRole("menu")
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["编辑", "移除项目"])
    await interaction.hover(menu)
    expect(more).toHaveAttribute("data-popup-open")
    expect(folder).toHaveAttribute("aria-expanded", "true")
    await interaction.click(
      within(menu).getByRole("menuitem", { name: "编辑" })
    )
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      mode: "edit",
      project,
    })
    expect(folder).toHaveAttribute("aria-expanded", "true")
  })

  it("animates the measured project content height and respects reduced motion", () => {
    renderGroups()
    const panel = screen
      .getByRole("region", { name: project.name })
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

  it("aligns task names and empty text with the project label using the group's inherited inset", () => {
    renderGroups()
    const group = screen.getByRole("region", { name: project.name })
    const folder = within(group).getByRole("button", { name: project.name })
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
