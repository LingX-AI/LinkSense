import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMemoryRouter, RouterProvider } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { SettingsPersonalizationPage } from "@/pages/settings-pages"

describe("personalization settings", () => {
  beforeEach(async () => {
    setAccessToken("personalization-access-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    setAccessToken(null)
    notify.dismiss()
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("shows memory as off when personalization cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope({ error_code: "RUNNER_UNAVAILABLE" }, 503))
    )
    renderPage()

    expect(
      await screen.findByRole("switch", { name: "启用记忆" })
    ).not.toBeChecked()
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "starts with memory off and allows explicit opt-in in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const settings = {
        custom_instructions: "",
        memories_enabled: false,
        task_auto_naming: "first_message",
      }
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "PATCH")
            return envelope({ ...settings, memories_enabled: true })
          return envelope(settings)
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const user = userEvent.setup()
      renderPage()

      const toggle = await screen.findByRole("switch")
      expect(toggle).not.toBeChecked()
      await user.click(toggle)
      await waitFor(() => expect(toggle).toBeChecked())
      expect(
        findRequest(fetchMock, "/api/v1/me/personalization", "PATCH", {
          memories_enabled: true,
        })
      ).toBeTruthy()
    }
  )

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "omits environment settings and does not request the removed endpoint in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const fetchMock = vi.fn(async () =>
        envelope({
          custom_instructions: "saved instructions",
          memories_enabled: true,
          task_auto_naming: "first_message",
        })
      )
      vi.stubGlobal("fetch", fetchMock)
      renderPage()
      expect(await screen.findByRole("textbox")).toHaveValue(
        "saved instructions"
      )
      expect(
        screen.queryByRole("switch", {
          name: /保持工作环境运行|Keep your environment running/,
        })
      ).not.toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/me/personalization",
        expect.anything()
      )
      expect(screen.getByRole("combobox")).toBeEnabled()
    }
  )

  it("saves custom instructions, toggles native memory, and resets it after confirmation", async () => {
    let finishReset!: () => void
    const resetPending = new Promise<void>((resolve) => {
      finishReset = resolve
    })
    let settings = {
      custom_instructions: "请优先使用中文。",
      memories_enabled: true,
      task_auto_naming: "first_message",
    }
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path === "/api/v1/me/personalization" && init?.method === "PATCH") {
          const update = JSON.parse(String(init.body)) as Partial<
            typeof settings
          >
          settings = { ...settings, ...update }
          return envelope(settings)
        }
        if (
          path === "/api/v1/me/personalization/memories/reset" &&
          init?.method === "POST"
        ) {
          await resetPending
          return envelope({ reset: true })
        }
        if (path === "/api/v1/me/personalization") {
          return envelope(settings)
        }
        return envelope({ error_code: "NOT_FOUND" }, 404)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    renderPage()

    const instructions = await screen.findByRole("textbox", {
      name: "自定义指令",
    })
    expect(instructions).toHaveValue("请优先使用中文。")
    expect(screen.getByRole("switch", { name: "启用记忆" })).toBeChecked()
    expect(screen.queryByText(/Chronicle/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText("允许从工具辅助聊天生成记忆")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("选择 ChatGPT 回复的默认语气")
    ).not.toBeInTheDocument()
    const customInstructionsHeading = screen.getByRole("heading", {
      name: "自定义指令",
    })
    const headingRow = customInstructionsHeading.closest(
      '[data-slot="settings-section-header"]'
    )
    expect(headingRow).not.toBeNull()
    const headingRowElement = headingRow as HTMLElement
    expect(headingRowElement).toHaveClass(
      "flex",
      "gap-3",
      "sm:flex-row",
      "sm:justify-between"
    )
    expect(
      within(headingRowElement).getByRole("button", { name: "保存" })
    ).toHaveAttribute("form", "custom-instructions-form")
    const instructionsFooter = document.querySelector(
      ".personalization-instructions-footer"
    )
    expect(instructionsFooter).not.toBeNull()
    expect(
      within(instructionsFooter as HTMLElement).queryByRole("button", {
        name: "保存",
      })
    ).not.toBeInTheDocument()

    await user.clear(instructions)
    await user.type(instructions, "请保持简洁并运行相关测试。")
    await user.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(
        findRequest(fetchMock, "/api/v1/me/personalization", "PATCH", {
          custom_instructions: "请保持简洁并运行相关测试。",
        })
      ).toBe(true)
    )

    await user.click(screen.getByRole("switch", { name: "启用记忆" }))
    await waitFor(() =>
      expect(
        findRequest(fetchMock, "/api/v1/me/personalization", "PATCH", {
          memories_enabled: false,
        })
      ).toBe(true)
    )
    expect(screen.getByRole("switch", { name: "启用记忆" })).not.toBeChecked()

    await user.click(screen.getByRole("button", { name: "重置" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText(
        "此操作无法撤销。你的任务、自定义指令、插件和 Skill 将保留。"
      )
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "重置" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    const loadingToast = await screen.findByText("正在重置记忆…")
    expect(loadingToast.closest("[data-sonner-toast]")).not.toBeNull()
    await waitFor(() =>
      expect(
        findRequest(
          fetchMock,
          "/api/v1/me/personalization/memories/reset",
          "POST",
          {}
        )
      ).toBe(true)
    )
    finishReset()
    expect(await screen.findByText("记忆已重置")).toBeVisible()
    expect(screen.queryByText("正在重置记忆…")).not.toBeInTheDocument()
  })

  it("restores the memory toggle and keeps reset confirmation closed when the runner rejects changes", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (
          path === "/api/v1/me/personalization" &&
          (init?.method ?? "GET") === "GET"
        ) {
          return envelope({
            custom_instructions: "",
            memories_enabled: true,
            task_auto_naming: "first_message",
          })
        }
        return errorEnvelope("RUNNER_UNAVAILABLE", 503)
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()

    renderPage()

    const toggle = await screen.findByRole("switch", { name: "启用记忆" })
    await user.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(await screen.findByRole("alert")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "重置" }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "重置" }))
    await waitFor(() =>
      expect(
        findRequest(
          fetchMock,
          "/api/v1/me/personalization/memories/reset",
          "POST",
          {}
        )
      ).toBe(true)
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("blocks navigation and page unload while custom instructions are unsaved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope({
          custom_instructions: "",
          memories_enabled: true,
          task_auto_naming: "first_message",
        })
      )
    )
    const user = userEvent.setup()
    const { router } = renderPage()

    const instructions = await screen.findByRole("textbox", {
      name: "自定义指令",
    })
    await user.type(instructions, "不要丢失这段内容")

    const beforeUnloadEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(beforeUnloadEvent)
    expect(beforeUnloadEvent.defaultPrevented).toBe(true)

    await act(() => router.navigate("/destination"))
    const dialog = await screen.findByRole("alertdialog", {
      name: "放弃未保存的修改？",
    })
    expect(screen.queryByRole("heading", { name: "目标页面" })).toBeNull()

    await user.click(within(dialog).getByRole("button", { name: "留在此页" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(instructions).toHaveValue("不要丢失这段内容")

    await act(() => router.navigate("/destination"))
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "放弃修改",
      })
    )
    expect(
      await screen.findByRole("heading", { name: "目标页面" })
    ).toBeVisible()
  })

  it.each([
    ["zh-CN", "首次对话时", "每次对话时"],
    ["en-US", "First message", "Every message"],
    ["fr-FR", "首次对话时", "每次对话时"],
  ])(
    "saves and reloads the naming preference in %s without duplicate submissions",
    async (language, first, every) => {
      await i18n.changeLanguage(language)
      let settings = {
        custom_instructions: "",
        memories_enabled: true,
        task_auto_naming: "first_message",
      }
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "PATCH") {
            await pending
            settings = { ...settings, task_auto_naming: "every_message" }
          }
          return envelope(settings)
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const user = userEvent.setup()
      const { unmount } = renderPage()
      const select = await screen.findByRole("combobox")
      expect(select).toHaveAccessibleName(
        language === "en-US" ? "Naming frequency" : "命名时机"
      )
      expect(select).toHaveTextContent(first)
      const namingSection = select.closest("section")
      const memorySection = screen
        .getByRole("switch", { name: i18n.t("settings.enableMemories") })
        .closest("section")
      if (!namingSection || !memorySection) {
        throw new Error("Expected naming and memory settings sections")
      }
      expect(memorySection.compareDocumentPosition(namingSection)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
      expect(select.closest(".personalization-memory-card")).toBeInTheDocument()
      expect(select.closest(".personalization-memory-row")).toBeInTheDocument()
      await user.click(select)
      await user.click(await screen.findByRole("option", { name: first }))
      expect(fetchMock).toHaveBeenCalledOnce()
      await user.click(select)
      await user.click(await screen.findByRole("option", { name: every }))
      expect(select).toBeDisabled()
      expect(screen.getByRole("status")).toHaveTextContent(
        language === "en-US" ? "Saving…" : "正在保存…"
      )
      await user.click(select)
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
      ).toHaveLength(1)
      expect(
        findRequest(fetchMock, "/api/v1/me/personalization", "PATCH", {
          task_auto_naming: "every_message",
        })
      ).toBe(true)
      finish()
      await waitFor(() => expect(select).toHaveTextContent(every))
      expect(select).toBeEnabled()
      unmount()
      renderPage()
      expect(await screen.findByRole("combobox")).toHaveTextContent(every)
    }
  )

  it("preserves the saved naming preference and permits retry when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PATCH"
          ? errorEnvelope("RUNNER_UNAVAILABLE", 503)
          : envelope({
              custom_instructions: "",
              memories_enabled: true,
              task_auto_naming: "first_message",
            })
      )
    )
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByRole("combobox", { name: "命名时机" })
    await user.click(select)
    await user.click(await screen.findByRole("option", { name: "每次对话时" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(select).toHaveTextContent("首次对话时")
    expect(select).toBeEnabled()
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const router = createMemoryRouter(
    [
      {
        path: "/settings/personalization",
        element: <SettingsPersonalizationPage />,
      },
      { path: "/destination", element: <h1>目标页面</h1> },
    ],
    { initialEntries: ["/settings/personalization"] }
  )
  return {
    router,
    ...render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
        <NotificationCenter />
      </ThemeProvider>
    ),
  }
}

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function errorEnvelope(errorCode: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error_code: errorCode }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  )
}

function findRequest(
  fetchMock: ReturnType<typeof vi.fn>,
  path: string,
  method: string,
  expectedBody: unknown
) {
  return fetchMock.mock.calls.some(([input, init]) => {
    const requestPath = new URL(String(input), window.location.origin).pathname
    if (requestPath !== path || init?.method !== method) return false
    return (
      JSON.stringify(JSON.parse(String(init.body))) ===
      JSON.stringify(expectedBody)
    )
  })
}
