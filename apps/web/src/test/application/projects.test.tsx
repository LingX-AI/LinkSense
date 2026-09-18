import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  projectInputSchema,
  projectOrderSchema,
  type Project,
} from "@linksense/shared"
import { z } from "zod"
import { conversationSchema, type Conversation } from "@/api/contracts"
import {
  readNewProject,
  rememberNewProject,
} from "@/features/projects/new-project-preference"

import {
  setupApplicationTests,
  conversation,
  conversations,
  installApiMock,
  json,
  renderApp,
  user,
} from "./fixture"

const workId = "80000000-0000-4000-8000-000000000001"
const personalId = "80000000-0000-4000-8000-000000000002"
const now = "2026-09-09T00:00:00.000Z"
const initialProjects: Project[] = [
  { id: workId, name: "工作", icon: "folder", color: "default", created_at: now, updated_at: now },
  { id: personalId, name: "生活", icon: "folder", color: "default", created_at: now, updated_at: now },
]

function installProjectApi(
  options: {
    projects?: Project[]
    loadFailure?: boolean
    projectsStart?: Promise<void>
    moveFailure?: boolean
    reorderFailure?: boolean
    pinned?: boolean
    firstProjectId?: string | null
    listAfterRename?: Promise<void>
    newTaskEventStreamBody?: string
    newTaskEventStreamStart?: Promise<void>
    newTaskCreationStart?: Promise<void>
    newTaskTurnResponse?: () => Promise<Response>
  } = {}
) {
  let projects = [...(options.projects ?? initialProjects)]
  let tasks: Conversation[] = conversations.map((task, index) =>
    conversationSchema.parse({
      ...task,
      project_id:
        index === 0
          ? options.firstProjectId === undefined
            ? workId
            : options.firstProjectId
          : null,
      pinned_at: options.pinned && index === 0 ? now : null,
    })
  )
  const actions: Array<{ path: string; method: string; body: unknown }> = []
  let renamed = false
  const fixture = installApiMock({
    newTaskCreationStart: options.newTaskCreationStart,
    newTaskEventStreamBody: options.newTaskEventStreamBody,
    newTaskEventStreamStart: options.newTaskEventStreamStart,
    conversationListResponse: async () => {
      if (renamed) await options.listAfterRename
      return json({ success: true, data: { items: tasks, next_cursor: null } })
    },
    conversationGetResponse: async () =>
      json({
        success: true,
        data: { ...conversation, ...tasks.find((task) => task.id === "c1") },
      }),
  })
  const baseFetch = window.fetch
  let createdProjectId: string | null = null
  const uploadedAttachments: Array<{
    id: string
    name: string
    kind: "attachment"
    size: number
  }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const method = init?.method ?? "GET"
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      if (path.startsWith("/api/v1/projects")) {
        actions.push({ path, method, body })
        if (method === "GET") {
          await options.projectsStart
          return options.loadFailure
            ? json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
            : json({ success: true, data: projects })
        }
        const id = path.split("/").at(-1)
        if (method === "PUT" && id === "order") {
          if (options.reorderFailure)
            return json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
          const { project_ids } = projectOrderSchema.parse(body)
          projects = project_ids.flatMap((id) =>
            projects.filter((project) => project.id === id)
          )
          return json({ success: true, data: projects })
        }
        if (method === "DELETE") {
          projects = projects.filter((project) => project.id !== id)
          tasks = tasks.map((task) =>
            task.project_id === id ? { ...task, project_id: null } : task
          )
          return new Response(null, { status: 204 })
        }
        const { name, icon, color } = projectInputSchema.parse(body)
        if (
          projects.some(
            (project) => project.name === name && project.id !== id
          )
        )
          return json(
            { success: false, error_code: "PROJECT_NAME_EXISTS" },
            409
          )
        const project: Project = {
          id: method === "POST" ? "80000000-0000-4000-8000-000000000003" : id!,
          name,
          icon: icon ?? projects.find((item) => item.id === id)?.icon ?? "folder",
          color: color ?? projects.find((item) => item.id === id)?.color ?? "default",
          created_at: now,
          updated_at: now,
        }
        projects =
          method === "POST"
            ? [...projects, project]
            : projects.map((item) => (item.id === id ? project : item))
        return json(
          { success: true, data: project },
          method === "POST" ? 201 : 200
        )
      }
      if (
        method === "PATCH" &&
        path.startsWith("/api/v1/conversations/") &&
        body &&
        typeof body === "object" &&
        "title" in body
      ) {
        const { title } = z.object({ title: z.string() }).parse(body)
        const id = path.split("/").at(-1)
        const current = tasks.find((task) => task.id === id)
        if (!current) throw new Error("Task must exist before renaming")
        const updated = conversationSchema.parse({
          ...conversation,
          ...current,
          title,
          title_source: "manual",
        })
        tasks = tasks.map((task) => (task.id === id ? updated : task))
        renamed = true
        actions.push({ path, method, body })
        return json({ success: true, data: updated })
      }
      if (
        method === "PATCH" &&
        path.startsWith("/api/v1/conversations/") &&
        body &&
        typeof body === "object" &&
        "project_id" in body
      ) {
        actions.push({ path, method, body })
        if (options.moveFailure)
          return json(
            { success: false, error_code: "PROJECT_NOT_FOUND" },
            404
          )
        const { project_id } = z
          .object({ project_id: z.string().uuid().nullable() })
          .parse(body)
        const id = path.split("/").at(-1)
        tasks = tasks.map((task) =>
          task.id === id ? { ...task, project_id } : task
        )
        if (id === "new-task-1") createdProjectId = project_id
        return json({
          success: true,
          data: {
            ...conversation,
            id,
            project_id,
            messages: id === "new-task-1" ? [] : conversation.messages,
            attachments:
              id === "new-task-1"
                ? uploadedAttachments
                : conversation.attachments,
          },
        })
      }
      if (
        path === "/api/v1/conversations/new-task-1/attachments" &&
        method === "POST"
      ) {
        const file =
          init?.body instanceof FormData ? init.body.get("file") : null
        if (!(file instanceof File)) throw new Error("Expected uploaded file")
        const attachment = {
          id: "project-attachment",
          name: file.name,
          kind: "attachment" as const,
          size: file.size,
        }
        uploadedAttachments.push(attachment)
        return json({ success: true, data: attachment })
      }
      if (
        path === "/api/v1/conversations/new-task-1/turns" &&
        method === "POST" &&
        options.newTaskTurnResponse
      ) {
        actions.push({ path, method, body })
        return options.newTaskTurnResponse()
      }
      const response = await baseFetch(input, init)
      if (path === "/api/v1/conversations" && method === "POST") {
        createdProjectId = z
          .object({ project_id: z.string().uuid().nullable() })
          .parse(body).project_id
        const payload = await response.json()
        const created = conversationSchema.parse({
          ...payload.data,
          project_id: createdProjectId,
        })
        tasks = [created, ...tasks]
        return json(
          {
            ...payload,
            data: created,
          },
          201
        )
      }
      if (path === "/api/v1/conversations/new-task-1" && method === "GET") {
        const payload = await response.json()
        return json({
          ...payload,
          data: {
            ...payload.data,
            ...tasks.find((task) => task.id === "new-task-1"),
            project_id: createdProjectId,
            attachments: uploadedAttachments,
          },
        })
      }
      return response
    })
  )
  return {
    actions,
    requests: fixture.requests,
    setGeneratedTitle: (id: string, title: string) => {
      tasks = tasks.map((task) =>
        task.id === id ? { ...task, title, title_source: "generated" } : task
      )
    },
  }
}

async function chooseProject(
  interaction: ReturnType<typeof userEvent.setup>,
  name: string,
  root: HTMLElement = document.body
) {
  const trigger = await within(root).findByRole("combobox", {
    name: "项目",
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  await interaction.click(trigger)
  await interaction.click(await screen.findByRole("option", { name }))
}

async function openMoveProjectMenu(
  interaction: ReturnType<typeof userEvent.setup>
) {
  const trigger = await screen.findByRole("menuitem", {
    name: "移动到项目",
  })
  await waitFor(() =>
    expect(trigger).not.toHaveAttribute("aria-disabled", "true")
  )
  await interaction.hover(trigger)
  await waitFor(() => expect(trigger).toHaveAttribute("data-popup-open"))
  return waitFor(() => {
    const submenu = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-sub-content"][data-open]'
    )
    expect(submenu).not.toBeNull()
    return submenu!
  })
}

async function dragFirstTaskToPersonalProject() {
  const sidebar = await screen.findByRole("complementary", {
    name: "LinkSense 导航",
  })
  const title = await within(sidebar).findByText(conversations[0].title)
  const source = title.closest<HTMLElement>(".sidebar-conversation-item")!
  const target = within(sidebar).getByRole("button", {
    name: "生活",
  }).parentElement!
  await waitFor(() =>
    expect(
      within(source).getByRole("button", { name: /使用键盘调整任务/u })
    ).toBeEnabled()
  )
  const original = HTMLElement.prototype.getBoundingClientRect
  const geometry = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this === source) return new DOMRect(0, 40, 240, 36)
      if (this === target) return new DOMRect(0, 0, 240, 36)
      return original.call(this)
    })
  try {
    fireEvent.pointerDown(title, {
      button: 0,
      clientX: 20,
      clientY: 50,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 20, clientY: 56 })
    await waitFor(() => expect(source).toHaveAttribute("data-dragging", "true"))
    expect(source).toHaveClass("select-none")
    expect(source).not.toHaveClass("opacity-0")
    expect(source).not.toHaveClass("opacity-60")
    expect(source).not.toHaveClass("invisible")
    expect(source).not.toHaveClass("hidden")
    expect(title).toBeVisible()
    expect(title).toHaveClass("font-medium")
    const previewTitle = screen.getByText(conversations[0].title, {
      selector: '[aria-hidden="true"] span',
    })
    expect(previewTitle).toHaveClass("font-medium")
    expect(previewTitle.parentElement).toHaveClass("opacity-80")
    expect(title.closest("a")).toHaveAttribute("draggable", "false")
    fireEvent.pointerMove(document, { clientX: 20, clientY: 10 })
    await waitFor(() =>
      expect(target).toHaveAttribute("data-drop-target", "true")
    )
    expect(
      target.querySelector('[data-slot="sidebar-drop-indicator"]')
    ).toHaveAttribute("data-edge", "after")
    fireEvent.pointerUp(document)
  } finally {
    geometry.mockRestore()
  }
}

describe("task projects", () => {
  it("saves project appearance and reopens it consistently in the sidebar and composer", async () => {
    const { actions } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await chooseProject(interaction, "工作")
    await interaction.click(await screen.findByRole("button", { name: "工作的更多操作" }))
    await interaction.click(await screen.findByRole("menuitem", { name: "编辑" }))
    const dialog = await screen.findByRole("dialog", { name: "编辑项目" })
    await interaction.click(within(dialog).getByRole("button", { name: "选择项目图标和颜色" }))
    const picker = await screen.findByRole("dialog", { name: "选择项目图标和颜色" })
    await interaction.click(within(picker).getByRole("button", { name: "蓝色" }))
    await interaction.click(within(picker).getByRole("button", { name: "花朵" }))
    await interaction.click(within(picker).getByRole("button", { name: "完成" }))
    expect(actions.filter((action) => action.method === "PATCH")).toHaveLength(0)
    await interaction.click(within(dialog).getByRole("button", { name: "保存" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(actions).toContainEqual({ path: `/api/v1/projects/${workId}`, method: "PATCH", body: { name: "工作", icon: "flower", color: "blue" } })
    expect(screen.getByRole("button", { name: "工作" }).querySelector("svg")).toHaveAttribute("data-project-icon", "flower")
    expect(screen.getByRole("combobox", { name: "项目" }).querySelector("svg")).toHaveAttribute("data-project-color", "blue")
    await interaction.click(screen.getByRole("button", { name: "工作的更多操作" }))
    await interaction.click(await screen.findByRole("menuitem", { name: "编辑" }))
    const reopened = await screen.findByRole("dialog", { name: "编辑项目" })
    expect(within(reopened).getByRole("button", { name: "选择项目图标和颜色" }).querySelector("svg")).toHaveAttribute("data-project-icon", "flower")
    await interaction.click(within(reopened).getByRole("button", { name: "选择项目图标和颜色" }))
    await interaction.click(await screen.findByRole("button", { name: "红色" }))
    await interaction.click(screen.getByRole("button", { name: "完成" }))
    await interaction.click(within(reopened).getByRole("button", { name: "取消" }))
    expect(actions.filter((action) => action.method === "PATCH")).toHaveLength(1)
    expect(screen.getByRole("combobox", { name: "项目" }).querySelector("svg")).toHaveAttribute("data-project-color", "blue")
  })

  setupApplicationTests()

  it("waits for the remembered project to load before submitting a new task", async () => {
    let releaseProjects!: () => void
    const projectsStart = new Promise<void>((resolve) => {
      releaseProjects = resolve
    })
    const { requests } = installProjectApi({ projectsStart })
    rememberNewProject(user.id, workId)
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    try {
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "在原来的项目中创建任务")
      expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations" &&
            request.method === "POST"
        )
      ).toBe(false)
      releaseProjects()
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
      )
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() =>
        expect(requests).toContainEqual(
          expect.objectContaining({
            path: "/api/v1/conversations",
            method: "POST",
            body: expect.objectContaining({ project_id: workId }),
          })
        )
      )
    } finally {
      releaseProjects()
    }
  })

  it("updates the sidebar and heading when a newly categorized task receives an automatic title", async () => {
    const title = "生活计划自动命名"
    let releaseTitle!: () => void
    const newTaskEventStreamStart = new Promise<void>((resolve) => {
      releaseTitle = resolve
    })
    const { requests, setGeneratedTitle } = installProjectApi({
      newTaskEventStreamStart,
      newTaskEventStreamBody: `id: new-task-1:2\nevent: conversation.title.updated\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: null,
          sequence_no: 2,
          event_type: "conversation.title.updated",
          visibility: "user_visible",
          payload: { schema_version: 1, title },
          sse_event_id: "new-task-1:2",
          created_at: now,
        }
      )}\n\n`,
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    try {
      await chooseProject(interaction, "生活")
      await interaction.type(
        screen.getByRole("textbox", { name: "任务输入框" }),
        "安排生活计划"
      )
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      const group = await screen.findByRole("region", { name: "生活" })
      await within(group).findByRole("link", { name: /未命名任务/u })
      await waitFor(() =>
        expect(
          requests.some(
            (request) =>
              request.path === "/api/v1/conversations/new-task-1/events"
          )
        ).toBe(true)
      )
      setGeneratedTitle("new-task-1", title)
      releaseTitle()
      expect(
        await within(group).findByRole("link", { name: new RegExp(title) })
      ).toBeVisible()
      expect(
        await within(screen.getByRole("banner")).findByText(title)
      ).toBeVisible()
    } finally {
      releaseTitle()
    }
  })

  it.each([
    { projectId: workId, label: "工作" },
    { projectId: null, label: "选择项目" },
  ])(
    "inherits $label from the task detail instead of the last manual choice",
    async ({ projectId, label }) => {
      installProjectApi({ firstProjectId: projectId })
      rememberNewProject(user.id, personalId)
      const interaction = userEvent.setup()
      renderApp()
      await screen.findByRole("textbox", { name: "任务输入框" })
      const sidebar = screen.getByRole("complementary", {
        name: "LinkSense 导航",
      })
      await interaction.click(
        within(sidebar).getByRole("link", { name: "新任务" })
      )
      await waitFor(() =>
        expect(
          screen.getByRole("combobox", { name: "项目" })
        ).toHaveTextContent(label)
      )
      expect(readNewProject(user.id)).toBe(personalId)
    }
  )

  it("restores the last chosen project after reloading a new task page", async () => {
    installProjectApi()
    const interaction = userEvent.setup()
    const page = renderApp("/conversations/new")
    await chooseProject(interaction, "生活")
    page.unmount()
    renderApp("/conversations/new")
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "项目" })
      ).toHaveTextContent("生活")
    )
  })

  it.each(["sidebar", "header"])(
    "immediately updates a newly categorized task's sidebar title when renamed from %s while list refresh is delayed",
    async (entry) => {
      let releaseList!: () => void
      const listAfterRename = new Promise<void>((resolve) => {
        releaseList = resolve
      })
      const { actions } = installProjectApi({ listAfterRename })
      const interaction = userEvent.setup()
      renderApp("/conversations/new")
      try {
        await chooseProject(interaction, "生活")
        await interaction.upload(
          screen.getByLabelText("添加附件"),
          new File(["notes"], "notes.txt", { type: "text/plain" })
        )
        const project = await screen.findByRole("region", { name: "生活" })
        const task = await within(project).findByRole("link", {
          name: /未命名任务/u,
        })
        await waitFor(() =>
          expect(
            screen.getByRole("combobox", { name: "项目" })
          ).toBeEnabled()
        )
        if (entry === "sidebar") {
          await interaction.dblClick(within(task).getByText("未命名任务"))
        } else {
          const actionsButton = await waitFor(() =>
            within(screen.getByRole("banner")).getByRole("button", {
              name: "操作",
            })
          )
          await interaction.click(actionsButton)
          await interaction.click(
            await screen.findByRole("menuitem", { name: "重命名" })
          )
          // The exiting menu remains mounted while its focus cleanup runs.
          // Finish that transition before typing in the new dialog.
          await waitFor(() =>
            expect(
              screen.queryByRole("menu", { hidden: true })
            ).not.toBeInTheDocument()
          )
        }
        const dialog = await screen.findByRole("dialog", { name: "重命名" })
        const input = within(dialog).getByRole("textbox", { name: "任务" })
        await waitFor(() => expect(input).toHaveFocus())
        await interaction.clear(input)
        // This flow verifies cache reconciliation, using a real paste event
        // instead of making character timing part of the synchronization test.
        await interaction.paste("新的生活计划")
        expect(input).toHaveValue("新的生活计划")
        const saveButton = within(dialog).getByRole("button", { name: "保存" })
        await waitFor(() => expect(saveButton).toBeEnabled())
        await interaction.click(saveButton)
        await waitFor(() =>
          expect(actions).toContainEqual({
            path: "/api/v1/conversations/new-task-1",
            method: "PATCH",
            body: { title: "新的生活计划" },
          })
        )
        expect(
          await within(project).findByRole("link", { name: /新的生活计划/u })
        ).toBeVisible()
        expect(
          within(project).queryByRole("link", { name: /未命名任务/u })
        ).not.toBeInTheDocument()
        expect(
          within(screen.getByRole("banner")).getByText("新的生活计划")
        ).toBeVisible()
      } finally {
        releaseList()
      }
    }
  )

  it.each([false, true])(
    "saves project order through the API and keeps tasks in their groups, failure=%s",
    async (failure) => {
      const { actions } = installProjectApi({ reorderFailure: failure })
      renderApp("/conversations/new")
      const sidebar = await screen.findByRole("complementary", {
        name: "LinkSense 导航",
      })
      const work = await within(sidebar).findByRole("button", { name: "工作" })
      const personal = await within(sidebar).findByRole("button", {
        name: "生活",
      })
      const source = work.parentElement!
      const target = personal.parentElement!
      const original = HTMLElement.prototype.getBoundingClientRect
      const geometry = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: HTMLElement) {
          if (this === source) return new DOMRect(0, 0, 240, 32)
          if (this === target) return new DOMRect(0, 100, 240, 32)
          return original.call(this)
        })
      try {
        await waitFor(() =>
          expect(
            within(source).getByRole("button", { name: /使用键盘调整项目/u })
          ).toBeEnabled()
        )
        fireEvent.pointerDown(work, {
          button: 0,
          clientX: 20,
          clientY: 10,
          isPrimary: true,
        })
        fireEvent.pointerMove(document, { clientX: 20, clientY: 16 })
        await waitFor(() =>
          expect(source).toHaveAttribute("data-dragging", "true")
        )
        fireEvent.pointerMove(document, { clientX: 20, clientY: 126 })
        fireEvent.pointerUp(document)
        await waitFor(() =>
          expect(actions).toContainEqual({
            path: "/api/v1/projects/order",
            method: "PUT",
            body: { project_ids: [personalId, workId] },
          })
        )
        if (failure) await screen.findByText("项目顺序保存失败，请重试。")
        else await screen.findByText("已将项目“工作”移动到第 2 位。")
        await waitFor(() =>
          expect(
            within(sidebar)
              .getAllByRole("region", { name: /^(工作|生活)$/u })
              .map((node) => node.getAttribute("aria-label"))
          ).toEqual(failure ? ["工作", "生活"] : ["生活", "工作"])
        )
        expect(
          within(sidebar).getByRole("region", { name: "工作" })
        ).toContainElement(within(sidebar).getByText(conversations[0].title))
        expect(
          actions.filter(
            (action) =>
              action.path.startsWith("/api/v1/conversations") &&
              action.method === "PATCH"
          )
        ).toHaveLength(0)
      } finally {
        geometry.mockRestore()
      }
    }
  )

  it("searches names without case sensitivity and restores focus and selection on Escape", async () => {
    installProjectApi({
      projects: [
        initialProjects[0],
        { ...initialProjects[1], name: "LinkSense" },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await chooseProject(interaction, "工作")
    const trigger = screen.getByRole("combobox", { name: "项目" })
    await interaction.click(trigger)
    const search = await screen.findByRole("combobox", { name: "搜索项目" })
    await interaction.type(search, "linksense")
    expect(screen.getByRole("option", { name: "LinkSense" })).toBeVisible()
    expect(
      screen.queryByRole("option", { name: "工作" })
    ).not.toBeInTheDocument()
    await interaction.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "项目" })
      ).not.toBeInTheDocument()
    )
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveTextContent("工作")
  })

  it("opens a compact project menu above the trigger and searches without changing the draft", async () => {
    installProjectApi()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await chooseProject(interaction, "工作")
    const trigger = screen.getByRole("combobox", { name: "项目" })
    await interaction.click(trigger)
    const search = await screen.findByRole("combobox", { name: "搜索项目" })
    expect(search).toHaveFocus()
    expect(search.closest('[data-slot="popover-content"]')).toHaveAttribute(
      "data-side",
      "top"
    )
    expect(search).toHaveClass("pl-0!", "text-[length:var(--app-font-13)]")
    const command = search.closest('[data-slot="command"]')
    expect(command).toHaveClass(
      "[&_[data-slot=command-input-wrapper]]:p-0",
      "[&_[data-slot=input-group]]:gap-2",
      "[&_[data-slot=input-group-addon]>svg]:size-3.5"
    )
    const projectOption = screen.getByRole("option", { name: "工作" })
    expect(projectOption).toHaveClass("px-2", "gap-2")
    expect(projectOption.querySelector("svg")).toHaveClass("size-3.5")
    const projectPopup = screen.getByRole("dialog", { name: "项目" })
    for (const name of ["新建项目"]) {
      const action = within(projectPopup).getByRole("button", { name })
      expect(action).toHaveClass("border-0", "px-2", "gap-2")
      expect(action.querySelector("svg")).toHaveClass("size-3.5")
    }
    expect(screen.getByRole("option", { name: "工作" })).toHaveAttribute(
      "data-checked",
      "true"
    )
    await interaction.type(search, "生")
    expect(
      screen.queryByRole("option", { name: "工作" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "生活" })).toBeVisible()
    await interaction.keyboard("{Enter}")
    await waitFor(() => expect(trigger).toHaveTextContent("生活"))
    await interaction.click(trigger)
    expect(
      await screen.findByRole("combobox", { name: "搜索项目" })
    ).toHaveValue("")
    await interaction.type(
      screen.getByRole("combobox", { name: "搜索项目" }),
      "不存在的项目"
    )
    expect(await screen.findByText("未找到匹配的项目")).toBeVisible()
    const popup = screen.getByRole("dialog", { name: "项目" })
    expect(
      within(popup).getByRole("button", { name: "新建项目" })
    ).toBeVisible()
    expect(
      within(popup).queryByRole("button", { name: "公共空间" })
    ).not.toBeInTheDocument()
    expect(
      within(popup).queryByRole("option", { name: "公共空间" })
    ).not.toBeInTheDocument()
    await interaction.keyboard("{Escape}")
    expect(trigger).toHaveTextContent("生活")
  })

  it.each([
    { persisted: false, keyboard: false },
    { persisted: true, keyboard: false },
    { persisted: false, keyboard: true },
  ])(
    "clears the project without opening the menu or losing the draft, persisted=$persisted, keyboard=$keyboard",
    async ({ persisted, keyboard }) => {
      const { actions, requests } = installProjectApi()
      const interaction = userEvent.setup()
      renderApp("/conversations/new")
      await chooseProject(interaction, "工作")
      await interaction.type(
        screen.getByRole("textbox", { name: "任务输入框" }),
        "保留这段草稿"
      )
      if (persisted) {
        await interaction.upload(
          screen.getByLabelText("添加附件"),
          new File(["notes"], "notes.txt", { type: "text/plain" })
        )
        await waitFor(() =>
          expect(
            requests.some(
              (request) => request.path === "/api/v1/conversations/new-task-1"
            )
          ).toBe(true)
        )
      }
      const trigger = screen.getByRole("combobox", { name: "项目" })
      await waitFor(() => expect(trigger).toBeEnabled())
      await interaction.hover(trigger)
      const clear = await screen.findByRole("button", { name: "取消项目选择" })
      expect(trigger).not.toContainElement(clear)
      // Pressing must not replace a centering transform and move the click target.
      expect(clear).toHaveClass("inset-y-0", "my-auto")
      expect(clear).not.toHaveClass("-translate-y-1/2")
      expect(clear).not.toHaveClass("active:not-aria-[haspopup]:translate-y-px")
      if (keyboard) {
        trigger.focus()
        await interaction.tab()
        expect(clear).toHaveFocus()
        await interaction.keyboard("{Enter}")
      } else {
        await interaction.pointer({ target: clear, keys: "[MouseLeft>]" })
        expect(trigger).toHaveTextContent("工作")
        expect(clear).toHaveFocus()
        await interaction.pointer({ target: clear, keys: "[/MouseLeft]" })
      }
      await waitFor(() => expect(trigger).toHaveTextContent("选择项目"))
      expect(
        screen.queryByRole("dialog", { name: "项目" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "取消项目选择" })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
        "保留这段草稿"
      )
      expect(readNewProject(user.id)).toBeNull()
      expect(actions.some((action) => action.method === "DELETE")).toBe(false)
      if (persisted) {
        expect(actions).toContainEqual({
          path: "/api/v1/conversations/new-task-1",
          method: "PATCH",
          body: { project_id: null },
        })
        expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0)
      } else {
        expect(trigger).toHaveFocus()
        expect(
          requests.some(
            (request) =>
              request.path === "/api/v1/conversations" &&
              request.method === "POST"
          )
        ).toBe(false)
      }
    }
  )

  it("creates and selects a project from the picker while preserving the task draft", async () => {
    const { actions, requests } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    const input = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "保留我的草稿")
    const trigger = screen.getByRole("combobox", { name: "项目" })
    await waitFor(() => expect(trigger).toBeEnabled())
    await interaction.click(trigger)
    const popup = await screen.findByRole("dialog", { name: "项目" })
    await interaction.click(
      within(popup).getByRole("button", { name: "新建项目" })
    )
    const dialog = await screen.findByRole("dialog", { name: "新建项目" })
    await interaction.type(
      within(dialog).getByRole("textbox", { name: "项目名称" }),
      "研究"
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "创建" })
    )
    await waitFor(() => expect(trigger).toHaveTextContent("研究"))
    expect(input).toHaveValue("保留我的草稿")
    expect(actions).toContainEqual({
      path: "/api/v1/projects",
      method: "POST",
      body: { name: "研究", icon: "folder", color: "default" },
    })
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "POST"
      )
    ).toBe(false)
  })

  it.each([false, true])(
    "saves a dragged task's project and refreshes the sidebar, pinned=%s",
    async (pinned) => {
      const { actions } = installProjectApi({ pinned })
      renderApp("/conversations/new")
      await dragFirstTaskToPersonalProject()
      await waitFor(() =>
        expect(actions).toContainEqual({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { project_id: personalId },
        })
      )
      await waitFor(() =>
        expect(
          screen.getByText(
            `已将任务“${conversations[0].title}”移入项目“生活”。`
          )
        ).toHaveAttribute("role", "status")
      )
      const folder = screen.getByRole("region", { name: "生活" })
      if (pinned) {
        expect(
          within(folder).queryByText(conversations[0].title)
        ).not.toBeInTheDocument()
        expect(
          within(
            screen.getByRole("heading", { name: "置顶" }).closest("section")!
          ).getByText(conversations[0].title)
        ).toBeVisible()
      } else {
        expect(within(folder).getByText(conversations[0].title)).toBeVisible()
        expect(
          within(screen.getByRole("region", { name: "工作" })).queryByText(
            conversations[0].title
          )
        ).not.toBeInTheDocument()
      }
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeVisible()
    }
  )

  it("shows a failed drag's API error and keeps the task in its original project", async () => {
    installProjectApi({ moveFailure: true })
    renderApp("/conversations/new")
    await dragFirstTaskToPersonalProject()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "该项目不存在或你无权访问"
    )
    expect(
      within(screen.getByRole("region", { name: "工作" })).getByText(
        conversations[0].title
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole("region", { name: "生活" })).queryByText(
        conversations[0].title
      )
    ).not.toBeInTheDocument()
  })

  it("places project selection in a separate bar directly above the new task input", async () => {
    const { requests } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await chooseProject(interaction, "生活")
    const picker = screen.getByRole("combobox", { name: "项目" })
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const form = input.closest("form")
    const bar = picker.closest(".conversation-project-dock")

    expect(form).not.toBeNull()
    expect(bar).toHaveClass("min-h-10", "min-w-0", "flex-wrap")
    expect(bar?.parentElement).toBe(form?.parentElement)
    expect(bar?.nextElementSibling).toBe(form)
    expect(form).not.toContainElement(picker)
    expect(picker).toHaveClass("bg-transparent", "max-w-full", "min-w-0")
    expect(picker).toHaveTextContent("生活")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "POST"
      )
    ).toBe(false)
  })

  it("groups tasks into collapsible folders, keeps pinned tasks unique, and shows uncategorized tasks without a heading", async () => {
    installProjectApi({ pinned: true })
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const folder = await within(sidebar).findByRole("region", {
      name: "工作",
    })
    expect(
      within(folder).queryByText(conversations[0].title)
    ).not.toBeInTheDocument()
    expect(within(sidebar).getAllByText(conversations[0].title)).toHaveLength(1)
    expect(within(folder).getByText("暂无任务")).toBeVisible()
    expect(
      within(sidebar).queryByRole("heading", { name: "公共空间" })
    ).not.toBeInTheDocument()
    expect(within(sidebar).getByText(conversations[1].title)).toBeVisible()
    await interaction.click(
      within(folder).getByRole("button", { name: "工作" })
    )
    expect(within(folder).queryByText("暂无任务")).not.toBeInTheDocument()
    expect(within(sidebar).getByText(conversations[1].title)).toBeVisible()
  })

  it("creates a trimmed project from the task heading and makes it selectable without changing the draft", async () => {
    const { actions } = installProjectApi({ projects: [] })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "保留这段任务内容")
    await interaction.click(
      screen.getByRole("button", { name: "新建项目" })
    )
    const dialog = await screen.findByRole("dialog", { name: "新建项目" })
    const create = within(dialog).getByRole("button", { name: "创建" })
    expect(create).toBeDisabled()
    await interaction.type(
      within(dialog).getByRole("textbox", { name: "项目名称" }),
      "  研究  "
    )
    await interaction.click(create)
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(actions).toContainEqual({
      path: "/api/v1/projects",
      method: "POST",
      body: { name: "研究", icon: "folder", color: "default" },
    })
    expect(await screen.findByRole("button", { name: "研究" })).toBeVisible()
    await chooseProject(interaction, "研究")
    expect(composer).toHaveValue("保留这段任务内容")
  })

  it("keeps duplicate-name errors in the edit dialog and allows correction", async () => {
    installProjectApi()
    const interaction = userEvent.setup()
    renderApp()
    const projectFolder = await screen.findByRole("region", { name: "工作" })
    await interaction.click(
      await screen.findByRole("button", {
        name: "工作的更多操作",
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑" })
    )
    const dialog = await screen.findByRole("dialog", { name: "编辑项目" })
    const input = within(dialog).getByRole("textbox", { name: "项目名称" })
    await interaction.clear(input)
    await interaction.type(input, "生活")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "已存在同名项目"
    )
    await interaction.clear(input)
    await interaction.type(input, "项目")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )
    expect(
      await within(projectFolder).findByRole("button", { name: "项目" })
    ).toBeVisible()
  })

  it("removes a project and moves its existing tasks from Projects to Recent", async () => {
    const { actions } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp()
    const projectsSection = await screen.findByRole("region", { name: "项目" })
    const recentSection = screen.getByRole("region", { name: "最近" })
    expect(
      await within(projectsSection).findByText(conversations[0].title)
    ).toBeVisible()
    expect(
      within(recentSection).queryByText(conversations[0].title)
    ).not.toBeInTheDocument()
    expect(
      await within(recentSection).findByText(conversations[1].title)
    ).toBeVisible()
    expect(
      within(projectsSection).queryByText(conversations[1].title)
    ).not.toBeInTheDocument()
    expect(
      projectsSection.compareDocumentPosition(recentSection) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await interaction.click(
      await screen.findByRole("button", { name: "工作的更多操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "移除项目" })
    )
    const dialog = await screen.findByRole("dialog", { name: "移除项目" })
    expect(dialog).toHaveTextContent("消息记录和原项目文件都会保留")
    await interaction.click(
      within(dialog).getByRole("button", { name: "移除项目" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "工作" })
      ).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(
      within(recentSection).getByRole("link", {
        name: new RegExp(conversations[0].title),
      })
    ).toBeVisible()
    expect(
      within(projectsSection).queryByText(conversations[0].title)
    ).not.toBeInTheDocument()
    expect(actions.filter((action) => action.method === "DELETE")).toHaveLength(
      1
    )
  })

  it("moves existing tasks between projects and back to Common workspace", async () => {
    const { actions } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(
      await screen.findByRole("button", {
        name: `${conversations[0].title}的更多操作`,
      })
    )
    const workSubmenu = await openMoveProjectMenu(interaction)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      within(workSubmenu).getByRole("menuitem", { name: "工作" })
    ).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(within(workSubmenu).getByRole("menuitem", { name: "生活" }))
    const folder = screen.getByRole("region", { name: "生活" })
    expect(
      await within(folder).findByText(conversations[0].title)
    ).toBeVisible()
    await interaction.click(
      screen.getByRole("button", {
        name: `${conversations[0].title}的更多操作`,
      })
    )
    const personalSubmenu = await openMoveProjectMenu(interaction)
    fireEvent.click(
      within(personalSubmenu).getByRole("menuitem", { name: "公共空间" })
    )
    await waitFor(() =>
      expect(
        actions
          .filter((action) => action.method === "PATCH")
          .map((action) => action.body)
      ).toEqual([{ project_id: personalId }, { project_id: null }])
    )
    await waitFor(() =>
      expect(
        within(folder).queryByText(conversations[0].title)
      ).not.toBeInTheDocument()
    )
  })

  it("preserves the original group when moving fails", async () => {
    installProjectApi({ moveFailure: true })
    const interaction = userEvent.setup()
    renderApp()
    const sourceFolder = await screen.findByRole("region", { name: "工作" })
    await interaction.click(
      await screen.findByRole("button", {
        name: `${conversations[0].title}的更多操作`,
      })
    )
    const submenu = await openMoveProjectMenu(interaction)
    fireEvent.click(within(submenu).getByRole("menuitem", { name: "生活" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "该项目不存在或你无权访问"
    )
    expect(
      within(sourceFolder).getByText(conversations[0].title)
    ).toBeInTheDocument()
  })

  it.each([false, true])(
    "hides the project bar immediately across delayed task creation and admission, failure=%s",
    async (failure) => {
      let releaseCreation!: () => void
      const newTaskCreationStart = new Promise<void>((resolve) => {
        releaseCreation = resolve
      })
      let releaseTurn!: () => void
      const turnStart = new Promise<void>((resolve) => {
        releaseTurn = resolve
      })
      const { actions, requests } = installProjectApi({
        newTaskCreationStart,
        newTaskTurnResponse: async () => {
          await turnStart
          return failure
            ? json({ success: false, error_code: "INTERNAL_ERROR" }, 500)
            : json(
                {
                  success: true,
                  data: {
                    turn_id: "00000000-0000-4000-8000-000000000002",
                    accepted: true,
                    status: "starting",
                  },
                },
                202
              )
        },
      })
      const interaction = userEvent.setup()
      renderApp("/conversations/new")
      try {
        await chooseProject(interaction, "生活")
        await interaction.type(
          screen.getByRole("textbox", { name: "任务输入框" }),
          "整理今天的计划"
        )
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        expect(
          screen.queryByRole("combobox", { name: "项目" })
        ).not.toBeInTheDocument()
        expect(document.querySelector(".conversation-project-dock")).toBeNull()

        releaseCreation()
        await waitFor(() =>
          expect(actions).toContainEqual(
            expect.objectContaining({
              path: "/api/v1/conversations/new-task-1/turns",
              method: "POST",
            })
          )
        )
        expect(document.querySelector(".conversation-project-dock")).toBeNull()
        const detailRequests = () =>
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/new-task-1" &&
              request.method === "GET"
          ).length
        const beforeReceipt = detailRequests()
        releaseTurn()
        if (failure) {
          expect(
            await screen.findByRole("combobox", { name: "项目" })
          ).toHaveTextContent("生活")
          expect(
            screen.getByRole("textbox", { name: "任务输入框" })
          ).toHaveValue("整理今天的计划")
        } else {
          await waitFor(() =>
            expect(detailRequests()).toBeGreaterThan(beforeReceipt)
          )
          expect(
            document.querySelector(".conversation-project-dock")
          ).toBeNull()
          expect(
            screen.getByRole("article", { name: "用户消息" })
          ).toHaveTextContent("整理今天的计划")
        }
      } finally {
        releaseCreation()
        releaseTurn()
      }
    }
  )

  it("sends the chosen project with task creation", async () => {
    const { requests } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await chooseProject(interaction, "生活")
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "整理今天的计划"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations",
          method: "POST",
          body: expect.objectContaining({ project_id: personalId }),
        })
      )
    )
  })

  it("keeps the draft and uploaded attachment while changing the project before the first message", async () => {
    const { actions, requests } = installProjectApi()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await chooseProject(interaction, "工作")
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "请整理附件")
    await interaction.upload(
      screen.getByLabelText("添加附件"),
      new File(["notes"], "notes.txt", { type: "text/plain" })
    )
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.path === "/api/v1/conversations/new-task-1"
        )
      ).toBe(true)
    )
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "项目" })).toBeEnabled()
    )
    await chooseProject(interaction, "生活")
    await waitFor(() =>
      expect(actions).toContainEqual({
        path: "/api/v1/conversations/new-task-1",
        method: "PATCH",
        body: { project_id: personalId },
      })
    )
    expect(
      screen.getByRole("combobox", { name: "项目" }).closest("form")
    ).toBeNull()
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
      "请整理附件"
    )
    expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0)
  })

  it("shows a retry action when projects cannot be loaded while keeping tasks accessible", async () => {
    installProjectApi({ loadFailure: true })
    renderApp()
    expect(await screen.findByText("暂时无法加载项目")).toBeVisible()
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled()
    expect(
      screen.getByRole("link", { name: new RegExp(conversations[0].title) })
    ).toBeVisible()
  })
})
