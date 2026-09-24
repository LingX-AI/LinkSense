import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  conversation,
  installApiMock,
  json,
  renderApp,
  setupApplicationTests,
} from "./fixture"

const sourceFileId = "30000000-0000-4000-8000-000000000001"
const sourceTaskId = "20000000-0000-4000-8000-000000000002"

describe("historical file references in the composer", () => {
  setupApplicationTests()

  it("searches historical filenames, stages a selected file, and submits it with the message", async () => {
    let referenced = false
    const attachment = {
      id: "referenced-attachment-1",
      name: "预算说明.pdf",
      filename: "预算说明.pdf",
      kind: "attachment",
      status: "staged",
      size: 12,
      mime_type: "application/pdf",
    }
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            execution_status: "completed",
            running_turn: null,
            turns: [],
            attachments: referenced ? [attachment] : [],
          },
        }),
      referenceableFilesResponse: (query) =>
        json({
          success: true,
          data: {
            items:
              query.get("search") === "说明"
                ? [
                    {
                      id: sourceFileId,
                      conversation_id: sourceTaskId,
                      kind: "artifact",
                      filename: "预算说明.pdf",
                      mime_type: "application/pdf",
                      size_bytes: 12,
                      created_at: "2026-08-10T08:30:00.000Z",
                      task: {
                        id: sourceTaskId,
                        title: "上月预算",
                        archive_status: "archived",
                      },
                    },
                  ]
                : [],
            next_cursor: null,
          },
        }),
      attachmentReferenceResponse: (body) => {
        expect(body).toEqual({ source_file_id: sourceFileId })
        referenced = true
        return json({ success: true, data: attachment }, 201)
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "添加" }, { timeout: 10_000 })
    )
    expect(screen.getByRole("option", { name: "本地文件" })).toBeVisible()
    await interaction.click(screen.getByRole("option", { name: "引用文件" }))
    const popover = await screen.findByRole("dialog", {
      name: "引用历史任务文件",
    })
    expect(popover).toHaveClass("capability-popover")
    expect(
      popover.querySelector(
        '[data-slot="command-input-wrapper"] [data-slot="input-group"]'
      )
    ).toHaveClass("h-8!")
    const searchInput = within(popover).getByRole("combobox", {
      name: "搜索文件名…",
    })
    await interaction.type(searchInput, "上月预算")
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/referenceable-files" &&
            request.query.includes(`search=${encodeURIComponent("上月预算")}`)
        )
      ).toBe(true)
    )
    expect(within(popover).queryByRole("option")).not.toBeInTheDocument()
    await interaction.clear(searchInput)
    await interaction.type(searchInput, "说明")
    const choice = await within(popover).findByRole("option", {
      name: "选择 上月预算 中的 预算说明.pdf",
    })
    expect(choice).not.toHaveTextContent("上月预算")
    expect(choice).toHaveClass("whitespace-nowrap", "[&>svg:last-child]:ml-0")
    expect(choice.querySelectorAll(".block")).toHaveLength(0)
    expect(choice.querySelector("img")).toHaveClass("size-5")
    const filename = choice.querySelector('[data-slot="reference-file-name"]')
    const size = choice.querySelector('[data-slot="reference-file-size"]')
    const time = choice.querySelector('[data-slot="reference-file-time"]')
    expect(filename).toHaveClass("max-w-80", "truncate", "text-xs")
    expect(size).toHaveTextContent("kB")
    expect(time).toHaveTextContent("2026")
    expect(size).toHaveClass("text-[length:var(--app-font-12)]")
    expect(time).toHaveClass("ml-auto", "text-[length:var(--app-font-12)]")
    expect(filename?.nextElementSibling).toBe(size)
    expect(size?.nextElementSibling).toBe(time)
    expect(
      within(popover).getByRole("button", { name: "添加所选文件（0）" })
    ).toHaveClass("bg-secondary")
    await interaction.click(choice)
    expect(choice).toHaveAttribute("data-checked", "true")
    await interaction.click(
      within(popover).getByRole("button", { name: "添加所选文件（1）" })
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "引用历史任务文件" })
      ).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.getByText("预算说明.pdf", { selector: ".composer-chip-label" })
      ).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "移除附件 预算说明.pdf" })
      ).toBeVisible()
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "请核对这份预算"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )?.body
      ).toMatchObject({ input_text: "请核对这份预算" })
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/referenceable-files" &&
          request.query.includes("search=%E8%AF%B4%E6%98%8E")
      )
    ).toBe(true)
  })

  it("adds multiple selected files from one task to the composer", async () => {
    const secondFileId = "30000000-0000-4000-8000-000000000002"
    const referencedAttachments: Array<{
      id: string
      name: string
      kind: string
      status: string
      size: number
      mime_type: string
    }> = []
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            execution_status: "completed",
            running_turn: null,
            turns: [],
            attachments: referencedAttachments,
          },
        }),
      referenceableFilesResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                id: sourceFileId,
                conversation_id: sourceTaskId,
                kind: "attachment",
                filename: "合同.pdf",
                mime_type: "application/pdf",
                size_bytes: 10,
                created_at: "2026-08-10T08:30:00.000Z",
                task: {
                  id: sourceTaskId,
                  title: "旧任务",
                  archive_status: "active",
                },
              },
              {
                id: secondFileId,
                conversation_id: sourceTaskId,
                kind: "artifact",
                filename: "数据.csv",
                mime_type: "text/csv",
                size_bytes: 20,
                created_at: "2026-08-10T08:20:00.000Z",
                task: {
                  id: sourceTaskId,
                  title: "旧任务",
                  archive_status: "active",
                },
              },
            ],
            next_cursor: null,
          },
        }),
      attachmentReferenceResponse: () => {
        const name =
          referencedAttachments.length === 0 ? "合同.pdf" : "数据.csv"
        const attachment = {
          id: `reference-${referencedAttachments.length + 1}`,
          name,
          kind: "attachment",
          status: "staged",
          size: 10,
          mime_type: name.endsWith("pdf") ? "application/pdf" : "text/csv",
        }
        referencedAttachments.push(attachment)
        return json({ success: true, data: attachment }, 201)
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: "引用文件" }))
    const popover = await screen.findByRole("dialog", {
      name: "引用历史任务文件",
    })
    const addSelected = within(popover).getByRole("button", {
      name: "添加所选文件（0）",
    })
    expect(addSelected).toBeDisabled()
    await interaction.click(
      await within(popover).findByRole("option", {
        name: "选择 旧任务 中的 合同.pdf",
      })
    )
    await interaction.click(
      within(popover).getByRole("option", {
        name: "选择 旧任务 中的 数据.csv",
      })
    )
    expect(
      within(popover).getByRole("button", { name: "添加所选文件（2）" })
    ).toBeEnabled()
    await interaction.click(
      within(popover).getByRole("button", { name: "添加所选文件（2）" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "引用历史任务文件" })
      ).not.toBeInTheDocument()
    )
    expect(
      await screen.findByRole("button", { name: "移除附件 合同.pdf" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "移除附件 数据.csv" })
    ).toBeVisible()
    expect(
      requests
        .filter((request) => request.path.endsWith("/attachments/references"))
        .map((request) => request.body)
    ).toEqual([
      { source_file_id: sourceFileId },
      { source_file_id: secondFileId },
    ])
  })

  it("keeps the selector open when the file can no longer be referenced", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [],
      },
      referenceableFilesResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                id: sourceFileId,
                conversation_id: sourceTaskId,
                kind: "attachment",
                filename: "旧文件.txt",
                mime_type: "text/plain",
                size_bytes: 8,
                created_at: "2026-08-10T08:30:00.000Z",
                task: {
                  id: sourceTaskId,
                  title: "旧任务",
                  archive_status: "active",
                },
              },
            ],
            next_cursor: null,
          },
        }),
      attachmentReferenceResponse: () =>
        json({ success: false, error_code: "NOT_FOUND" }, 404),
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: "引用文件" }))
    const popover = await screen.findByRole("dialog", {
      name: "引用历史任务文件",
    })
    await interaction.click(
      await within(popover).findByRole("option", {
        name: "选择 旧任务 中的 旧文件.txt",
      })
    )
    await interaction.click(
      within(popover).getByRole("button", { name: "添加所选文件（1）" })
    )
    expect(await within(popover).findByRole("alert")).toBeVisible()
    expect(
      within(popover).getByRole("option", {
        name: "取消选择 旧任务 中的 旧文件.txt",
      })
    ).toBeEnabled()
    expect(
      requests.filter((request) =>
        request.path.endsWith("/attachments/references")
      )
    ).toHaveLength(1)
  })

  it("creates one new task before staging multiple referenced files", async () => {
    const secondFileId = "30000000-0000-4000-8000-000000000002"
    const attachments: Array<{
      id: string
      name: string
      kind: string
      status: string
      size: number
      mime_type: string
    }> = []
    const { requests } = installApiMock({
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            id: "new-task-1",
            execution_status: "idle",
            messages: [],
            turns: [],
            running_turn: null,
            attachments,
          },
        }),
      referenceableFilesResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                id: sourceFileId,
                conversation_id: sourceTaskId,
                kind: "attachment",
                filename: "旧资料.txt",
                mime_type: "text/plain",
                size_bytes: 8,
                created_at: "2026-08-10T08:30:00.000Z",
                task: {
                  id: sourceTaskId,
                  title: "旧任务",
                  archive_status: "active",
                },
              },
              {
                id: secondFileId,
                conversation_id: sourceTaskId,
                kind: "attachment",
                filename: "补充资料.txt",
                mime_type: "text/plain",
                size_bytes: 8,
                created_at: "2026-08-10T08:20:00.000Z",
                task: {
                  id: sourceTaskId,
                  title: "旧任务",
                  archive_status: "active",
                },
              },
            ],
            next_cursor: null,
          },
        }),
      attachmentReferenceResponse: (_body, conversationId) => {
        expect(conversationId).toBe("new-task-1")
        const attachment = {
          id: `new-task-reference-${attachments.length + 1}`,
          name: attachments.length === 0 ? "旧资料.txt" : "补充资料.txt",
          kind: "attachment",
          status: "staged",
          size: 8,
          mime_type: "text/plain",
        }
        attachments.push(attachment)
        return json({ success: true, data: attachment }, 201)
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: "引用文件" }))
    const popover = await screen.findByRole("dialog", {
      name: "引用历史任务文件",
    })
    await interaction.click(
      await within(popover).findByRole("option", {
        name: "选择 旧任务 中的 旧资料.txt",
      })
    )
    await interaction.click(
      within(popover).getByRole("option", {
        name: "选择 旧任务 中的 补充资料.txt",
      })
    )
    await interaction.click(
      within(popover).getByRole("button", { name: "添加所选文件（2）" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/new-task-1/attachments/references" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      requests.findIndex(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "POST"
      )
    ).toBeLessThan(
      requests.findIndex(
        (request) =>
          request.path ===
            "/api/v1/conversations/new-task-1/attachments/references" &&
          request.method === "POST"
      )
    )
    expect(
      await screen.findByRole("button", { name: "移除附件 旧资料.txt" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "移除附件 补充资料.txt" })
    ).toBeVisible()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "POST"
      )
    ).toHaveLength(1)
    expect(
      requests
        .filter((request) => request.path.endsWith("/attachments/references"))
        .map((request) => request.body)
    ).toEqual([
      { source_file_id: sourceFileId },
      { source_file_id: secondFileId },
    ])
  })

  it("loads the next page when the file list approaches the bottom", async () => {
    let onIntersect: IntersectionObserverCallback | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          onIntersect = callback
        }
        observe = observe
        disconnect = disconnect
      }
    )
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [],
      },
      referenceableFilesResponse: (query) =>
        json({
          success: true,
          data: {
            items: [
              {
                id: query.get("cursor")
                  ? "30000000-0000-4000-8000-000000000003"
                  : sourceFileId,
                conversation_id: sourceTaskId,
                kind: "artifact",
                filename: query.get("cursor") ? "第二页.pdf" : "第一页.pdf",
                mime_type: "application/pdf",
                size_bytes: 20,
                created_at: "2026-08-10T08:30:00.000Z",
                task: {
                  id: sourceTaskId,
                  title: "旧任务",
                  archive_status: "active",
                },
              },
            ],
            next_cursor: query.get("cursor")
              ? null
              : `2026-08-10T08:30:00.000Z|${sourceFileId}`,
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: "引用文件" }))
    const popover = await screen.findByRole("dialog", {
      name: "引用历史任务文件",
    })
    expect(await within(popover).findByText("第一页.pdf")).toBeVisible()
    await waitFor(() => expect(observe).toHaveBeenCalled())
    expect(
      within(popover).queryByRole("button", { name: "加载更多" })
    ).not.toBeInTheDocument()
    await act(async () => {
      onIntersect?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })
    expect(await within(popover).findByText("第二页.pdf")).toBeVisible()
    expect(disconnect).toHaveBeenCalled()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/referenceable-files" &&
          request.query.includes("cursor=")
      )
    ).toBe(true)
  })
})
