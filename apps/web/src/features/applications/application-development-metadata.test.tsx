import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applicationDevelopmentSchema,
  interactiveApplicationManifestSchema,
  type ApplicationDevelopment,
} from "@linksense/shared"
import { ApiError, apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentMetadata } from "./application-development-metadata"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
const initial = applicationDevelopmentSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  conversation_id: null,
  name: "Original",
  directory: "applications/example",
  application_id: null,
  preview_application_id: null,
  preview_conversation_id: null,
  preview_current: true,
  revision: 1,
  source_hash: "a".repeat(64),
  installed_source_hash: null,
  source_error: null,
  diagnostics: [],
  updated_at: "2026-09-17T00:00:00Z",
  manifest: interactiveApplicationManifestSchema.parse({
    schema_version: 1,
    sdk_version: 1,
    id: "example",
    name: "Original",
    version: "1.0.0",
    description: "Actual description",
    permissions: [],
  }),
})
const updated = vi.fn()
const editingChanged = vi.fn()
const reload = vi.fn()
const clients: QueryClient[] = []
function show(project = initial) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  clients.push(client)
  function Host() {
    const [value, setValue] = useState(project)
    return (
      <ApplicationDevelopmentMetadata
        project={value}
        published={false}
        disabled={false}
        onUpdated={(next) => {
          updated(next)
          setValue(next)
        }}
        onEditingChange={editingChanged}
        onReload={reload}
      />
    )
  }
  return render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>
  )
}
async function tick(ms = 701) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
function response(
  name: string,
  hash = "b".repeat(64),
  description: string | null = "Actual description"
): ApplicationDevelopment {
  return {
    ...initial,
    name,
    source_hash: hash,
    manifest: { ...initial.manifest!, name, description },
  }
}
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.useFakeTimers()
  vi.mocked(apiRequest).mockResolvedValue(response("Changed"))
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.useRealTimers()
  vi.resetAllMocks()
})
describe("development metadata autosave", () => {
  it("truncates the display to one line while preserving the complete description for editing and saving", async () => {
    const description =
      "输入一个主题，选择调研类型与关注重点，由 LinkSense 任务完成调研并回显分段结论。".repeat(
        8
      )
    show(response("Original", initial.source_hash!, description))
    const display = screen.getByRole("button", { name: "编辑应用描述" })
    expect(display).toHaveClass("min-w-0", "max-w-full")
    expect(screen.getByText(description)).toHaveClass("min-w-0", "truncate")
    fireEvent.click(display)
    const input = screen.getByRole("textbox", { name: "应用描述" })
    expect(input).toHaveValue(description)
    expect(input).not.toHaveClass("truncate")
    const edited = `${description}\n补充说明`
    vi.mocked(apiRequest).mockResolvedValue(
      response("Original", "b".repeat(64), edited)
    )
    fireEvent.change(input, { target: { value: edited } })
    fireEvent.blur(input)
    await tick(10)
    expect(apiRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: {
          name: "Original",
          description: edited,
          source_hash: initial.source_hash,
        },
      })
    )
    expect(
      screen.getByRole("button", { name: "编辑应用描述" })
    ).toHaveTextContent(edited.replace("\n", " "))
  })
  it.each([
    ["编辑应用名称", "text-sm", "md:text-sm", "font-semibold", "leading-5"],
    ["编辑应用描述", "text-xs", "md:text-xs", "font-normal", "leading-4"],
  ])(
    "preserves display typography when editing %s on desktop and mobile",
    (label, size, desktopSize, weight, lineHeight) => {
      show()
      const display = screen.getByRole("button", { name: label })
      expect(display).toHaveClass(size, weight, lineHeight)
      fireEvent.click(display)
      expect(screen.getByRole("textbox")).toHaveClass(
        size,
        desktopSize,
        weight,
        lineHeight,
        "border-[color:var(--app-border)]"
      )
      expect(screen.getByRole("textbox")).not.toHaveClass("border-transparent")
      fireEvent.focus(screen.getByRole("textbox"))
      expect(screen.getByRole("textbox")).toHaveClass(
        "border-[color:var(--app-border)]"
      )
      expect(screen.getByRole("textbox")).not.toHaveClass(
        "focus-visible:border-ring"
      )
    }
  )
  it("shows real description, removes save/cancel actions, and debounces rapid typing", async () => {
    show()
    expect(screen.getByText("Actual description")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    const input = screen.getByRole("textbox", { name: "应用名称" })
    expect(input).toHaveClass("max-w-72", "min-w-0")
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "取消" })
    ).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: "C" } })
    await tick(400)
    fireEvent.change(input, { target: { value: "Changed" } })
    await tick(699)
    expect(apiRequest).not.toHaveBeenCalled()
    await tick(2)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith(
      `/application-developments/${initial.id}/metadata`,
      expect.objectContaining({
        method: "PATCH",
        body: {
          name: "Changed",
          description: "Actual description",
          source_hash: initial.source_hash,
        },
      })
    )
    expect(input).toHaveValue("Changed")
    expect(input).toBeEnabled()
    await tick(5000)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    fireEvent.blur(input)
    await tick(2)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "编辑应用名称" })
    ).toHaveTextContent("Changed")
    expect(editingChanged).toHaveBeenLastCalledWith(false)
  })
  it("serializes saves and keeps later edits while using the returned revision", async () => {
    let finish: (value: ApplicationDevelopment) => void = () => {}
    vi.mocked(apiRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.mocked(apiRequest).mockResolvedValueOnce(
      response("Newest", "c".repeat(64))
    )
    show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "First" } })
    await tick()
    fireEvent.change(input, { target: { value: "Newest" } })
    await tick(2000)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish(response("First"))
    })
    expect(input).toHaveValue("Newest")
    await tick()
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(apiRequest).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: {
          name: "Newest",
          description: "Actual description",
          source_hash: "b".repeat(64),
        },
      })
    )
    expect(input).toHaveValue("Newest")
  })
  it("flushes the latest edit on blur even when a save is already pending", async () => {
    let finish: (value: ApplicationDevelopment) => void = () => {}
    vi.mocked(apiRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    vi.mocked(apiRequest).mockResolvedValueOnce(response("Latest"))
    show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "First" } })
    await tick()
    fireEvent.change(input, { target: { value: "Latest" } })
    fireEvent.blur(input)
    await tick()
    expect(apiRequest).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish(response("First"))
    })
    await tick(10)
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
  it("does not submit partial Chinese composition and flushes valid text on blur", async () => {
    vi.mocked(apiRequest).mockResolvedValue(response("主题调研"))
    show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    const input = screen.getByRole("textbox")
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: "zhu ti" } })
    await tick(1500)
    expect(apiRequest).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: "主题调研" } })
    fireEvent.compositionEnd(input)
    fireEvent.blur(input)
    await tick(10)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(screen.getByText("主题调研")).toBeVisible()
  })
  it("allows clearing the description without changing the name", async () => {
    vi.mocked(apiRequest).mockResolvedValue(
      response("Original", "b".repeat(64), null)
    )
    show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用描述" }))
    const input = screen.getByRole("textbox", { name: "应用描述" })
    expect(input).toHaveClass("max-w-lg", "min-w-0")
    fireEvent.change(input, { target: { value: "  " } })
    fireEvent.blur(input)
    await tick(10)
    expect(apiRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: {
          name: "Original",
          description: null,
          source_hash: initial.source_hash,
        },
      })
    )
    expect(screen.getByText("添加应用描述")).toBeVisible()
  })
  it.each(["", "a".repeat(161)])(
    "keeps invalid names editable without sending a request (%s)",
    async (value) => {
      show()
      fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
      const input = screen.getByRole("textbox")
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
      await tick(2000)
      expect(apiRequest).not.toHaveBeenCalled()
      expect(input).toHaveAttribute("aria-invalid", "true")
      expect(
        screen.getByText("请输入 1 至 160 个字符的应用名称。")
      ).toBeVisible()
    }
  )
  it("preserves drafts on a version conflict without retrying or overwriting it", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError({
        status: 409,
        errorCode: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED",
      })
    )
    show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Unsaved" } })
    await tick()
    await tick(5000)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue("Unsaved")
    expect(
      screen.getByText("应用内容已更新，请重新读取后再编辑。")
    ).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }))
    expect(reload).toHaveBeenCalledOnce()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
  it("retains failed input and retries only after a new edit", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("offline"))
    show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Failed" } })
    await tick(1000)
    await tick(4000)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue("Failed")
    fireEvent.change(input, { target: { value: "Changed" } })
    await tick(1000)
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(updated).toHaveBeenCalledOnce()
  })
  it("cancels pending debounce when the component unmounts", async () => {
    const view = show()
    fireEvent.click(screen.getByRole("button", { name: "编辑应用名称" }))
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Draft" },
    })
    view.unmount()
    await tick()
    expect(apiRequest).not.toHaveBeenCalled()
  })
  it.each([
    ["zh-CN", "编辑应用名称", "应用名称"],
    ["en-US", "Edit application name", "Application name"],
    ["de-DE", "编辑应用名称", "应用名称"],
  ])(
    "provides translated editing controls and fallback in %s",
    async (language, button, label) => {
      await i18n.changeLanguage(language)
      show()
      fireEvent.click(screen.getByRole("button", { name: button }))
      expect(screen.getByRole("textbox", { name: label })).toBeVisible()
    }
  )
})
