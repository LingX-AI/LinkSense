import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { supportedLocales } from "@linksense/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { conversationSchema, type Conversation } from "@/api/contracts"
import { SidebarTaskGroups } from "./sidebar-task-groups"
import { rememberSidebarProjectOpen } from "./sidebar-project-preference"

const project = {
  icon: "folder" as const,
  color: "default" as const,
  id: "80000000-0000-4000-8000-000000000001",
  name: "日常工作",
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
}

const pinnedTask = conversationSchema.parse({
  id: "pinned-task",
  title: "Pinned task",
  project_id: null,
  pinned_at: "2026-09-09T00:00:00.000Z",
  updated_at: project.updated_at,
})

function renderGroups(userId = "first", pinned = [] as (typeof pinnedTask)[]) {
  const onAction = vi.fn()
  render(
    <SidebarTaskGroups
      userId={userId}
      pinned={pinned}
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
    expect(within(projects).queryByText("暂无项目")).not.toBeInTheDocument()
    expect(within(recent).queryByText("暂无任务")).not.toBeInTheDocument()
  })

  it("does not show an empty project hint when unavailable-project tasks remain", () => {
    render(
      <SidebarTaskGroups
        userId="first"
        pinned={[]}
        recent={[{ ...pinnedTask, pinned_at: null, project_id: project.id }]}
        projects={[]}
        loadingMore={false}
        onAction={vi.fn()}
      >
        {() => <a href="/conversations/task">归属任务</a>}
      </SidebarTaskGroups>
    )
    expect(
      within(screen.getByRole("region", { name: "项目暂不可用" })).getByRole(
        "link",
        { name: "归属任务" }
      )
    ).toBeVisible()
    expect(screen.queryByText("暂无项目")).not.toBeInTheDocument()
  })

  it.each([
    ["zh-CN", "暂无项目", "暂无任务"],
    ["en-US", "No projects yet", "No tasks yet"],
    ["es-ES", "Todavía no hay proyectos", "Todavía no hay tareas"],
    ["pt-BR", "Nenhum projeto ainda", "Nenhuma tarefa ainda"],
    ["fr-FR", "Aucun projet", "Aucune tâche"],
    ["ja-JP", "プロジェクトはまだありません", "タスクはまだありません"],
    ["de-DE", "暂无项目", "暂无任务"],
  ])(
    "shows compact, collapsible empty states in %s",
    async (language, emptyProjects, emptyTasks) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
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
      for (const [label, message] of [
        [i18n.t("nav.projects"), emptyProjects],
        [i18n.t("nav.recent"), emptyTasks],
      ]) {
        const section = screen.getByRole("region", { name: label })
        const empty = within(section).getByText(message)
        expect(empty).toBeVisible()
        expect(empty).toHaveClass("px-2.5", "py-1", "text-muted-foreground")
        const trigger = within(section).getByRole("button", { name: label })
        await interaction.click(trigger)
        expect(empty).not.toBeVisible()
        expect(
          within(section).getByRole("button", {
            name: i18n.t("conversation.taskSort.open", { section: label }),
          })
        ).toBeEnabled()
        await interaction.keyboard("{Enter}")
        expect(empty).toBeVisible()
      }
      expect(
        screen.getByRole("button", { name: i18n.t("projects.create") })
      ).toBeEnabled()
      expect(screen.queryByRole("link")).not.toBeInTheDocument()
    }
  )

  it("waits for project and task loading to finish before showing empty states", () => {
    const view = (projectsReady: boolean, loadingMore: boolean) => (
      <SidebarTaskGroups
        userId="first"
        pinned={[]}
        recent={[]}
        projects={[]}
        projectsReady={projectsReady}
        loadingMore={loadingMore}
        onAction={vi.fn()}
      >
        {() => null}
      </SidebarTaskGroups>
    )
    const { rerender } = render(view(false, true))
    expect(screen.queryByText("暂无项目")).not.toBeInTheDocument()
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument()
    rerender(view(true, true))
    expect(screen.getByText("暂无项目")).toBeVisible()
    expect(screen.queryByText("暂无任务")).not.toBeInTheDocument()
    rerender(view(true, false))
    expect(screen.getByText("暂无任务")).toBeVisible()
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

  it.each(supportedLocales)(
    "shows one running indicator only on collapsed projects with running tasks in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const runningTask = conversationSchema.parse({
        id: "running-task",
        title: "Running task",
        project_id: project.id,
        execution_status: "running",
        updated_at: project.updated_at,
      })
      const otherProject = {
        ...project,
        id: `${project.id.slice(0, -1)}2`,
        name: "Other project",
      }
      const view = (
        recent: Conversation[],
        reconnectFailedConversationIds?: ReadonlySet<string>
      ) => (
        <SidebarTaskGroups
          userId="first"
          pinned={[]}
          recent={recent}
          projects={[project, otherProject]}
          loadingMore={false}
          reconnectFailedConversationIds={reconnectFailedConversationIds}
          onAction={vi.fn()}
        >
          {({ conversations }) =>
            conversations.map((task) => (
              <a key={task.id} href={`/conversations/${task.id}`}>
                {task.title}
              </a>
            ))
          }
        </SidebarTaskGroups>
      )
      const tasks = [runningTask, { ...runningTask, id: "second-running-task" }]
      const { rerender } = render(view(tasks))
      const group = screen.getByRole("region", { name: project.name })
      const folder = within(group).getByRole("button", { name: project.name })
      const header = folder.parentElement!
      expect(within(header).queryByRole("status")).not.toBeInTheDocument()

      await interaction.click(folder)
      const status = within(header).getByRole("status", {
        name: i18n.t("statuses.running"),
      })
      expect(status).toHaveClass(
        "right-2.5",
        "pointer-events-none",
        "group-hover/project:opacity-0",
        "group-has-data-[popup-open]/project:opacity-0",
        "group-has-[:focus-visible]/project:opacity-0",
        "[@media(hover:none)]:right-8"
      )
      expect(status.querySelector("svg")).toHaveClass(
        "size-3.5",
        "animate-spin",
        "[animation-duration:1.5s]",
        "motion-reduce:animate-none"
      )
      expect(within(header).getAllByRole("status")).toHaveLength(1)
      expect(within(group).queryByRole("link")).not.toBeInTheDocument()

      await interaction.click(
        screen.getByRole("button", { name: otherProject.name })
      )
      expect(
        within(
          screen.getByRole("region", { name: otherProject.name })
        ).queryByRole("status")
      ).not.toBeInTheDocument()

      rerender(view([tasks[1]!]))
      expect(within(header).getByRole("status")).toBeInTheDocument()
      await interaction.click(folder)
      expect(within(header).queryByRole("status")).not.toBeInTheDocument()
      expect(
        within(group).getByRole("link", { name: runningTask.title })
      ).toBeVisible()
      await interaction.click(folder)
      rerender(view([{ ...runningTask, execution_status: "completed" }]))
      expect(within(header).queryByRole("status")).not.toBeInTheDocument()
      rerender(view([runningTask]))
      expect(within(header).getByRole("status")).toBeInTheDocument()
      rerender(view([runningTask], new Set([runningTask.id])))
      expect(within(header).queryByRole("status")).not.toBeInTheDocument()
      rerender(view([{ ...runningTask, project_id: otherProject.id }]))
      expect(within(header).queryByRole("status")).not.toBeInTheDocument()
      expect(
        within(
          screen.getByRole("region", { name: otherProject.name })
        ).getByRole("status")
      ).toBeInTheDocument()
      rerender(view([]))
      expect(within(header).queryByRole("status")).not.toBeInTheDocument()
      expect(
        within(
          screen.getByRole("region", { name: otherProject.name })
        ).queryByRole("status")
      ).not.toBeInTheDocument()
    }
  )

  it.each([
    undefined,
    "idle",
    "pending",
    "completed",
    "failed",
    "interrupted",
  ] as const)(
    "does not show a collapsed project as running for a task with status %s",
    (executionStatus) => {
      rememberSidebarProjectOpen("first", project.id, false)
      render(
        <SidebarTaskGroups
          userId="first"
          pinned={[]}
          recent={[
            conversationSchema.parse({
              id: "task",
              title: "Task",
              project_id: project.id,
              execution_status: executionStatus,
              updated_at: project.updated_at,
            }),
          ]}
          projects={[project]}
          loadingMore={false}
          onAction={vi.fn()}
        >
          {() => null}
        </SidebarTaskGroups>
      )
      expect(
        screen.getByRole("button", { name: project.name })
      ).toHaveAttribute("aria-expanded", "false")
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    }
  )

  it("uses the same adaptive font size for section headings and project names", () => {
    renderGroups("first", [pinnedTask])
    for (const name of ["置顶", "项目", "最近"]) {
      const heading = screen.getByRole("heading", { name })
      expect(heading).toHaveClass("text-[length:var(--app-font-13)]")
      expect(heading).not.toHaveClass("text-[length:var(--app-ui-font-size)]")
    }
    expect(screen.getByText(project.name)).toHaveClass(
      "text-[length:var(--app-font-13)]"
    )
  })

  it.each([
    ["zh-CN", "置顶", "项目", "最近"],
    ["en-US", "Pinned", "Projects", "Recent"],
  ])(
    "toggles all three sections independently with pointer and keyboard in %s",
    async (language, pinnedLabel, projectsLabel, recentLabel) => {
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
          pinned={[pinnedTask]}
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
      const pinned = screen.getByRole("button", {
        name: pinnedLabel,
      })
      const recent = screen.getByRole("button", {
        name: recentLabel,
      })
      expect(pinned).toHaveAttribute("aria-expanded", "true")
      expect(projects).toHaveAttribute("aria-expanded", "true")
      expect(recent).toHaveAttribute("aria-expanded", "true")

      await interaction.click(pinned)
      expect(pinned).toHaveAttribute("aria-expanded", "false")
      expect(
        screen.queryByRole("link", { name: "Pinned task" })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: project.name })).toBeVisible()

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
      expect(
        screen.queryByRole("link", { name: "Pinned task" })
      ).not.toBeInTheDocument()

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
      await interaction.click(pinned)
      expect(pinned).toHaveAttribute("aria-expanded", "true")
      expect(screen.getByRole("link", { name: "Pinned task" })).toBeVisible()
    }
  )

  it("keeps section arrows visible when expanded and collapsed without hovering", async () => {
    const interaction = userEvent.setup()
    renderGroups("first", [pinnedTask])
    for (const name of ["置顶", "项目", "最近"]) {
      const trigger = screen.getByRole("button", { name })
      expect(trigger).toHaveClass("w-full", "group/section-trigger")
      expect(trigger.closest(".group\\/tasks-heading")).toContainElement(
        trigger
      )
      const arrow = trigger.querySelector("svg")
      expect(arrow).toHaveAttribute("aria-hidden", "true")
      expect(arrow).toBeVisible()
      expect(arrow).not.toHaveClass("opacity-0")
      expect(arrow).toHaveClass("group-aria-expanded/section-trigger:rotate-90")
      await interaction.click(trigger)
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(arrow).toBeVisible()
      expect(arrow).not.toHaveClass("opacity-0")
      await interaction.keyboard("{Enter}")
      expect(trigger).toHaveAttribute("aria-expanded", "true")
      expect(arrow).toBeVisible()
    }
  })

  it.each(["置顶", "项目", "最近"])(
    "animates the %s section height and arrow while respecting reduced motion",
    (name) => {
      renderGroups("first", [pinnedTask])
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
        "transition-transform",
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

  it("keeps heading actions visible without hovering and preserves keyboard creation", async () => {
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
    expect(create).toHaveClass("size-7", "rounded-lg")
    for (const action of [
      create,
      screen.getByRole("button", { name: "设置项目任务排序方式" }),
      screen.getByRole("button", { name: "设置最近任务排序方式" }),
    ]) {
      expect(action).toBeVisible()
      expect(action).not.toHaveClass("opacity-0")
      expect(action).not.toHaveClass("pointer-events-none")
    }
    expect(create).not.toHaveClass("[&_svg:not([class*='size-'])]:size-3")
    await interaction.tab()
    expect(screen.getByRole("button", { name: "项目" })).toHaveFocus()
    await interaction.tab()
    expect(
      screen.getByRole("button", { name: "设置项目任务排序方式" })
    ).toHaveFocus()
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
      "h-9",
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

  it.each([
    [
      "zh-CN",
      "设置置顶任务排序方式",
      "设置项目任务排序方式",
      "设置最近任务排序方式",
      "优先级",
    ],
    [
      "en-US",
      "Set the task order for Pinned",
      "Set the task order for Projects",
      "Set the task order for Recent",
      "Priority",
    ],
  ])(
    "offers the three Codex task-order modes for every sidebar scope in %s",
    async (language, pinnedMenu, projectsMenu, recentMenu, priorityLabel) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const onSortModeChange = vi.fn()
      render(
        <SidebarTaskGroups
          userId="first"
          pinned={[pinnedTask]}
          recent={[]}
          projects={[project]}
          loadingMore={false}
          sortModes={{
            pinned: "manual",
            projects: "updated_at",
            recent: "updated_at",
          }}
          onSortModeChange={onSortModeChange}
          onAction={vi.fn()}
        >
          {() => null}
        </SidebarTaskGroups>
      )

      for (const [scope, menuLabel] of [
        ["pinned", pinnedMenu],
        ["projects", projectsMenu],
        ["recent", recentMenu],
      ] as const) {
        await interaction.click(screen.getByRole("button", { name: menuLabel }))
        const menu = await screen.findByRole("menu")
        expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3)
        await interaction.click(
          within(menu).getByRole("menuitemradio", { name: priorityLabel })
        )
        expect(onSortModeChange).toHaveBeenLastCalledWith(scope, "priority")
      }
    }
  )

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
    expect(folder).toHaveClass("pl-2.5", "gap-2", "border-transparent")
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
