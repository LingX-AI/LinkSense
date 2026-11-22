import { type ComponentProps, useState } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom"

import type { DesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"
import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import { notify } from "@/components/feedback/notification"
import { desktopExecutionMessages } from "@/features/desktop-execution/messages"
import { browserPanelMessages } from "@/features/browser-panel/messages"
import i18n from "@/i18n"
import { ConversationPage } from "@/pages/conversation-pages"

const authMock = vi.hoisted(() => {
  const initial = {
    id: "user-1",
    name: "测试用户",
    role: "user",
    status: "active",
    running_message_action: "queue" as const,
  }
  return { initial, user: { ...initial } }
})

const hostMock = vi.hoisted(() => ({ mac: true }))

const readDesktopDeviceMock = vi.hoisted(() => vi.fn())

const deviceStatusMock = vi.hoisted(() => {
  type Status = {
    state: "unpaired" | "connecting" | "online" | "offline" | "revoked"
    deviceId?: string
    executionReady?: boolean
  }
  type Snapshot = { data: Status | undefined; isError: boolean }
  let value: Snapshot = { data: undefined, isError: false }
  const listeners = new Set<() => void>()
  const publish = (next: Snapshot) => {
    value = next
    for (const listener of listeners) listener()
  }
  return {
    get: () => value,
    setData(data: Status | undefined) {
      publish({ data, isError: false })
    },
    setError(data?: Status) {
      // TanStack keeps the last data through a failed background refetch.
      publish({ data, isError: true })
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset() {
      value = { data: undefined, isError: false }
    },
  }
})

vi.mock("@/app/auth-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/auth-state")>()),
  useAuth: () => ({ user: authMock.user, refreshUser: vi.fn() }),
}))

vi.mock("@/adapters/desktop/desktop-adapter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/adapters/desktop/desktop-adapter")
  >()),
  isMacDesktopHost: () => hostMock.mac,
}))

vi.mock(
  "@/adapters/desktop/desktop-device-adapter",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/adapters/desktop/desktop-device-adapter")
    >()),
    readDesktopDeviceStatus: readDesktopDeviceMock,
  })
)

vi.mock("@/features/desktop-devices/use-desktop-device-status", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useDesktopDeviceStatus: () => {
      const snapshot = useSyncExternalStore(
        deviceStatusMock.subscribe,
        deviceStatusMock.get,
        deviceStatusMock.get
      )
      return { data: snapshot.data, isError: snapshot.isError }
    },
  }
})

type DeferredResponse = {
  promise: Promise<Response>
  resolve: (response: Response) => void
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createDeferredResponse(): DeferredResponse {
  const deferred = createDeferred<Response>()
  return {
    promise: deferred.promise,
    resolve: deferred.resolve,
  }
}

function readyDeviceStatus(
  overrides: Partial<DesktopDeviceStatus> = {}
): DesktopDeviceStatus {
  return {
    state: "online",
    deviceId: "device-1",
    executionReady: true,
    ...overrides,
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function errorEnvelope(status: number, errorCode: string) {
  return new Response(
    JSON.stringify({ success: false, error_code: errorCode }),
    { status, headers: { "content-type": "application/json" } }
  )
}

function modelPreference() {
  return {
    configured: true,
    default_model: "model-a",
    selected_model: "model-a",
    selected_reasoning_effort: "medium",
    models: [
      {
        id: "model-a",
        display_name: "Model A",
        enabled: true,
        supported_reasoning_efforts: ["medium", "high"],
        default_reasoning_effort: "medium",
      },
    ],
  }
}

function conversationDetail(
  id: string,
  executionTarget?: "cloud" | "local",
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    title: "测试任务",
    project_id: null,
    ...(executionTarget ? { execution_target: executionTarget } : {}),
    archived: false,
    archive_status: "active",
    updated_at: "2026-11-21T00:00:00.000Z",
    execution_status: "idle",
    selected_knowledge_base_ids: [],
    messages: [],
    turns: [],
    pending_requests: [],
    attachments: [],
    artifacts: [],
    ...overrides,
  }
}

function installApi(
  options: {
    deferModelPreference?: boolean
    conversations?: Record<string, unknown>
    createResponse?: unknown
    browser?: { deferRelease?: boolean; rejectRelease?: boolean }
  } = {}
) {
  const prewarms: { body: unknown; response: DeferredResponse }[] = []
  const createdBodies: unknown[] = []
  const requests: { path: string; method: string; body?: unknown }[] = []
  const browserRequests: { path: string; action: string; token?: string }[] = []
  const browserReleases: DeferredResponse[] = []
  const browserControlTokenByConversation = new Map<
    string,
    string | undefined
  >()
  const modelPreferenceResponse = options.deferModelPreference
    ? createDeferredResponse()
    : null
  const browserState = (hasControl: boolean) => ({
    mode: hasControl ? "human" : "agent",
    has_control: hasControl,
    lease_expires_at: hasControl ? "2026-11-23T00:00:30.000Z" : null,
    frame: {
      image: "YQ==",
      url: "https://example.test/",
      title: "测试页面",
      width: 800,
      height: 600,
    },
  })

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const method = init?.method ?? "GET"
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      requests.push({ path, method, body })

      if (path === "/api/v1/conversations/prewarm" && method === "POST") {
        const response = createDeferredResponse()
        prewarms.push({ body, response })
        return response.promise
      }
      if (path === "/api/v1/conversations" && method === "POST") {
        createdBodies.push(body)
        return Promise.resolve(
          options.createResponse !== undefined
            ? json(options.createResponse)
            : errorEnvelope(503, "RUNNER_UNAVAILABLE")
        )
      }
      if (
        /^\/api\/v1\/conversations\/[^/]+\/turns$/u.test(path) &&
        method === "POST"
      ) {
        return Promise.resolve(
          json(
            {
              accepted: true,
              status: "starting",
              turn_id: "30000000-0000-4000-8000-000000000099",
            },
            202
          )
        )
      }
      if (
        /^\/api\/v1\/conversations\/[^/]+\/attachments$/u.test(path) &&
        method === "POST"
      ) {
        return Promise.resolve(
          json({
            id: "file-1",
            name: "notes.txt",
            mime_type: "text/plain",
            size: 5,
            kind: "attachment",
            turn_id: null,
            status: "staged",
            download_available: false,
          })
        )
      }
      if (path === "/api/v1/me/personalization") {
        return Promise.resolve(
          json({
            custom_instructions: "",
            memories_enabled: false,
            task_auto_naming: "first_message",
            show_reasoning: false,
          })
        )
      }
      if (path === "/api/v1/me/model-preference") {
        return modelPreferenceResponse
          ? modelPreferenceResponse.promise
          : Promise.resolve(json(modelPreference()))
      }
      if (
        path.endsWith("/model-preference") &&
        path.startsWith("/api/v1/conversations/")
      ) {
        return Promise.resolve(json(modelPreference()))
      }
      if (path === "/api/v1/projects") return Promise.resolve(json([]))
      if (path === "/api/v1/capabilities") {
        return Promise.resolve(json({ items: [], next_cursor: null }))
      }
      if (path === "/api/v1/knowledge-bases/search-capability") {
        return Promise.resolve(
          json({
            status: "available",
            reason_code: null,
            checked_at: "2026-11-21T00:00:00.000Z",
          })
        )
      }
      if (path === "/api/v1/knowledge-bases") {
        return Promise.resolve(json({ items: [], next_cursor: null }))
      }
      const browserMatch = path.match(
        /^\/api\/v1\/conversations\/([^/]+)\/browser$/u
      )
      if (browserMatch && method === "POST") {
        const conversationId = browserMatch[1]!
        const requestBody = body as { action: string; token?: string }
        browserRequests.push({
          path,
          action: requestBody.action,
          token: requestBody.token,
        })
        if (requestBody.action === "frame") {
          return Promise.resolve(
            json(
              browserState(
                browserControlTokenByConversation.get(conversationId) ===
                  requestBody.token
              )
            )
          )
        }
        if (requestBody.action === "claim") {
          browserControlTokenByConversation.set(
            conversationId,
            requestBody.token
          )
          return Promise.resolve(json(browserState(true)))
        }
        if (requestBody.action === "release") {
          if (options.browser?.rejectRelease)
            return Promise.resolve(errorEnvelope(409, "BROWSER_CONTROL_BUSY"))
          browserControlTokenByConversation.delete(conversationId)
          if (options.browser?.deferRelease) {
            const response = createDeferredResponse()
            browserReleases.push(response)
            return response.promise
          }
          return Promise.resolve(json(browserState(false)))
        }
        return Promise.resolve(json(browserState(true)))
      }
      const conversationMatch = path.match(
        /^\/api\/v1\/conversations\/([^/]+)$/u
      )
      if (conversationMatch && method === "GET") {
        const detail = options.conversations?.[conversationMatch[1]!]
        return Promise.resolve(
          detail ? json(detail) : errorEnvelope(404, "CONVERSATION_NOT_FOUND")
        )
      }
      if (/^\/api\/v1\/conversations\/[^/]+\/sources$/u.test(path)) {
        return Promise.resolve(json({ items: [] }))
      }
      if (/^\/api\/v1\/conversations\/[^/]+\/events$/u.test(path)) {
        return Promise.resolve(
          new Response("", {
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (method === "GET") {
        return Promise.resolve(json({ items: [], next_cursor: null }))
      }
      return Promise.resolve(errorEnvelope(404, "NOT_FOUND"))
    })
  )

  return {
    prewarms,
    createdBodies,
    requests,
    browserRequests,
    async resolveModelPreference() {
      if (!modelPreferenceResponse) return
      await act(async () => {
        modelPreferenceResponse.resolve(json(modelPreference()))
        await modelPreferenceResponse.promise
      })
    },
    async resolveBrowserRelease(index = 0) {
      const request = browserReleases[index]
      if (!request) throw new Error("browser release request missing")
      await act(async () => {
        request.resolve(json(browserState(false)))
        await request.promise
      })
    },
    async resolvePrewarm(index: number, id: string) {
      const request = prewarms[index]
      if (!request) throw new Error("prewarm request missing")
      await act(async () => {
        request.response.resolve(json({ accepted: true, conversation_id: id }))
        await request.response.promise
      })
    },
  }
}

type ConversationPageProps = Partial<ComponentProps<typeof ConversationPage>>

function ConversationPageWithNavigation({
  pageProps,
}: {
  pageProps?: ConversationPageProps
}) {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate("/conversations/other")}>
        切换任务
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        返回任务
      </button>
      <ConversationPage {...pageProps} />
    </>
  )
}

function ConversationPageWithAccountSwitch() {
  const [, setVersion] = useState(0)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          authMock.user = { ...authMock.initial, id: "user-2" }
          setVersion((value) => value + 1)
        }}
      >
        切换账号
      </button>
      <ConversationPage />
    </>
  )
}

function renderConversationPage(
  path: string,
  pageProps?: ConversationPageProps,
  options: { navigation?: boolean; accountSwitch?: boolean } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={
                options.navigation ? (
                  <ConversationPageWithNavigation pageProps={pageProps} />
                ) : options.accountSwitch ? (
                  <ConversationPageWithAccountSwitch />
                ) : (
                  <ConversationPage {...pageProps} />
                )
              }
            />
          </Routes>
        </QueryClientProvider>
        <NotificationCenter />
      </ThemeProvider>
    </MemoryRouter>
  )
}

async function selectLocalTarget(
  interaction: ReturnType<typeof userEvent.setup>
) {
  await interaction.click(
    await screen.findByRole("button", { name: /运行位置/u })
  )
  const local = await screen.findByRole("radio", { name: "本地电脑" })
  await interaction.click(local)
}

describe("conversation execution target", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("execution-target-access-token")
    hostMock.mac = true
    authMock.user = { ...authMock.initial }
    deviceStatusMock.reset()
    readDesktopDeviceMock.mockReset()
    readDesktopDeviceMock.mockResolvedValue(readyDeviceStatus())
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    notify.dismiss()
    setAccessToken(null)
    authMock.user = { ...authMock.initial }
    deviceStatusMock.reset()
    readDesktopDeviceMock.mockReset()
    hostMock.mac = true
    window.innerWidth = 1024
    vi.unstubAllGlobals()
  })

  it("creates a local task with the ready device and without a cloud reservation", async () => {
    deviceStatusMock.setData({
      state: "online",
      deviceId: "device-1",
      executionReady: true,
    })
    const fixture = installApi({ deferModelPreference: true })
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new")

    await selectLocalTarget(interaction)
    expect(screen.getByRole("button", { name: /运行位置/u })).toHaveTextContent(
      "本地电脑"
    )

    // Resolve preferences only after local is selected: the cloud prewarm
    // condition becomes true now and must stay off for the local draft.
    await fixture.resolveModelPreference()
    expect(fixture.prewarms).toHaveLength(0)

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "在这台 Mac 上运行")
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
    expect(readDesktopDeviceMock).toHaveBeenCalledOnce()
    expect(fixture.createdBodies[0]).toEqual({
      collaboration_mode: "default",
      project_id: null,
      execution_target: "local",
      desktop_device_id: "device-1",
    })
    expect(fixture.createdBodies[0]).not.toHaveProperty(
      "prewarmed_conversation_id"
    )
  })

  it("keeps cloud creation unchanged for an old host without local readiness", async () => {
    deviceStatusMock.setData({
      state: "online",
      deviceId: "device-1",
      executionReady: false,
    })
    const fixture = installApi()
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new")

    await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
    await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000001")

    await interaction.click(
      await screen.findByRole("button", { name: /运行位置/u })
    )
    expect(
      await screen.findByRole("radio", { name: "本地电脑" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByText(desktopExecutionMessages["zh-CN"].deviceNotReady)
    ).toBeVisible()
    await interaction.keyboard("{Escape}")

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "在云端运行")
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
    expect(readDesktopDeviceMock).not.toHaveBeenCalled()
    expect(fixture.createdBodies[0]).toEqual({
      collaboration_mode: "default",
      prewarmed_conversation_id: "71000000-0000-4000-8000-000000000001",
      project_id: null,
    })
  })

  it("explains an offline Mac and links to the device settings section", async () => {
    deviceStatusMock.setData({ state: "offline" })
    installApi()
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new")

    await interaction.click(
      await screen.findByRole("button", { name: /运行位置/u })
    )
    expect(
      await screen.findByRole("radio", { name: "本地电脑" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByText(desktopExecutionMessages["zh-CN"].deviceOffline)
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "管理设备" })).toHaveAttribute(
      "href",
      "/settings/general#desktop-devices-heading"
    )
  })

  it("fails closed when device status cannot be read", async () => {
    // A failed background refetch keeps the last ready data, but isError wins.
    deviceStatusMock.setError(readyDeviceStatus())
    installApi()
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new")

    await interaction.click(
      await screen.findByRole("button", { name: /运行位置/u })
    )
    expect(
      await screen.findByRole("radio", { name: "本地电脑" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByText(
        desktopExecutionMessages["zh-CN"].deviceStatusUnavailable
      )
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "管理设备" })).toBeVisible()
  })

  it("blocks submission and keeps the local draft when the device goes offline", async () => {
    deviceStatusMock.setData({
      state: "online",
      deviceId: "device-1",
      executionReady: true,
    })
    const fixture = installApi()
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new")

    await selectLocalTarget(interaction)
    act(() => {
      deviceStatusMock.setData({ state: "offline" })
    })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /运行位置/u })
      ).toHaveTextContent("本地电脑")
    )

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "不要回退到云电脑")
    const send = screen.getByRole("button", { name: "发送" })
    expect(send).toBeEnabled()
    await interaction.click(send)

    expect(
      await screen.findByText(/这台 Mac 当前无法运行本地任务/u)
    ).toBeVisible()
    expect(fixture.createdBodies).toHaveLength(0)
    expect(input).toHaveTextContent("不要回退到云电脑")
  })

  it.each([
    {
      name: "reports offline",
      read: () => Promise.resolve(readyDeviceStatus({ state: "offline" })),
      message: /这台 Mac 当前无法运行本地任务/u,
    },
    {
      name: "returns another device",
      read: () => Promise.resolve(readyDeviceStatus({ deviceId: "device-2" })),
      message: /所选设备或任务页面已变化/u,
    },
    {
      name: "fails to read",
      read: () => Promise.reject(new Error("native read failed")),
      message: /无法读取这台 Mac 的设备状态/u,
    },
  ])(
    "rechecks the selected device before creating a local task: $name",
    async ({ read, message }) => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new")

      await selectLocalTarget(interaction)
      readDesktopDeviceMock.mockImplementation(read)

      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "先确认设备再创建")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      expect(await screen.findByText(message)).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveTextContent("先确认设备再创建")
    }
  )

  it("does not create a local task when the page changes during the readiness re-read", async () => {
    deviceStatusMock.setData(readyDeviceStatus())
    const freshRead = createDeferred<DesktopDeviceStatus>()
    readDesktopDeviceMock.mockReturnValue(freshRead.promise)
    const fixture = installApi()
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new", undefined, {
      navigation: true,
    })

    await selectLocalTarget(interaction)
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "切换前提交")
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(readDesktopDeviceMock).toHaveBeenCalledOnce())

    await interaction.click(screen.getByRole("button", { name: "切换任务" }))
    await act(async () => {
      freshRead.resolve(readyDeviceStatus())
      await freshRead.promise
    })

    expect(fixture.createdBodies).toHaveLength(0)
  })

  it("does not create a local task when the account changes during the readiness re-read", async () => {
    deviceStatusMock.setData(readyDeviceStatus())
    const freshRead = createDeferred<DesktopDeviceStatus>()
    readDesktopDeviceMock.mockReturnValue(freshRead.promise)
    const fixture = installApi()
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new", undefined, {
      accountSwitch: true,
    })

    await selectLocalTarget(interaction)
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "切换账号前提交")
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(readDesktopDeviceMock).toHaveBeenCalledOnce())

    await interaction.click(screen.getByRole("button", { name: "切换账号" }))
    await act(async () => {
      freshRead.resolve(readyDeviceStatus())
      await freshRead.promise
    })

    expect(fixture.createdBodies).toHaveLength(0)
  })

  it("reuses the guarded create boundary for a local upload", async () => {
    deviceStatusMock.setData(readyDeviceStatus())
    const localConversation = conversationDetail("new-local", "local")
    const fixture = installApi({
      createResponse: localConversation,
      conversations: { "new-local": localConversation },
    })
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/new")

    await selectLocalTarget(interaction)
    await interaction.upload(
      screen.getByLabelText("添加附件"),
      new File(["hello"], "notes.txt", { type: "text/plain" })
    )

    await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
    expect(fixture.createdBodies[0]).toMatchObject({
      execution_target: "local",
      desktop_device_id: "device-1",
    })
    expect(readDesktopDeviceMock).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(
        fixture.requests.some(
          (request) =>
            request.path === "/api/v1/conversations/new-local/attachments" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
  })

  it("does not gate an existing local task on this Mac's readiness", async () => {
    hostMock.mac = true
    deviceStatusMock.setError(readyDeviceStatus({ state: "offline" }))
    const fixture = installApi({
      conversations: { "task-1": conversationDetail("task-1", "local") },
    })
    const interaction = userEvent.setup()
    renderConversationPage("/conversations/task-1")

    const input = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "继续已有本地任务")
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() =>
      expect(
        fixture.requests.some(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    expect(readDesktopDeviceMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/无法运行本地任务|设备状态/u)).toBeNull()
  })

  it.each([
    ["local", "本地电脑"],
    ["cloud", "云电脑"],
  ] as const)(
    "shows the actual %s target on an existing task",
    async (target, label) => {
      hostMock.mac = true
      installApi({
        conversations: { "task-1": conversationDetail("task-1", target) },
      })
      renderConversationPage("/conversations/task-1")

      const banner = await screen.findByRole("banner")
      const badge = await within(banner).findByLabelText(`运行位置：${label}`)
      expect(badge).toHaveTextContent(label)
    }
  )

  it("keeps the read-only target badge Mac-only", async () => {
    hostMock.mac = false
    installApi({
      conversations: { "task-1": conversationDetail("task-1", "local") },
    })
    renderConversationPage("/conversations/task-1")

    await screen.findByRole("banner")
    expect(
      screen.queryByLabelText("运行位置：本地电脑")
    ).not.toBeInTheDocument()
  })

  it.each([
    ["development", { development: true }],
    ["embedded", { embedded: true, conversationId: "new" }],
  ] as const)(
    "does not offer the picker in an %s context",
    async (_, props) => {
      installApi()
      renderConversationPage("/conversations/new", props)

      await screen.findByRole("textbox", { name: "任务输入框" })
      expect(
        screen.queryByRole("button", { name: /运行位置/u })
      ).not.toBeInTheDocument()
    }
  )

  it("does not offer the target picker outside a Mac host", async () => {
    hostMock.mac = false
    installApi()
    renderConversationPage("/conversations/new")

    await screen.findByRole("textbox", { name: "任务输入框" })
    expect(
      screen.queryByRole("button", { name: /运行位置/u })
    ).not.toBeInTheDocument()
  })

  describe("Mac cloud browser panel", () => {
    const openLabel = browserPanelMessages["zh-CN"].open
    const continueLabel = browserPanelMessages["zh-CN"].continueTask
    const continuePrompt = browserPanelMessages["zh-CN"].continuePrompt

    function browserRequestsFor(
      fixture: ReturnType<typeof installApi>,
      conversationId: string
    ) {
      return fixture.browserRequests.filter((request) =>
        request.path.startsWith(
          `/api/v1/conversations/${conversationId}/browser`
        )
      )
    }

    it("opens on demand, requests frames only while open, and restores header focus", async () => {
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      const toggle = await screen.findByRole("button", { name: openLabel })
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      expect(browserRequestsFor(fixture, "task-1")).toHaveLength(0)

      await interaction.click(toggle)
      expect(toggle).toHaveAttribute("aria-expanded", "true")
      expect(await screen.findByRole("img", { name: "测试页面" })).toBeVisible()
      expect(screen.getByRole("button", { name: "刷新画面" })).toHaveFocus()
      expect(browserRequestsFor(fixture, "task-1")).toContainEqual(
        expect.objectContaining({ action: "frame" })
      )

      await interaction.click(
        screen.getByRole("button", { name: "关闭浏览器面板" })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "浏览器" })
        ).not.toBeInTheDocument()
      )
      await waitFor(() => expect(toggle).toHaveFocus())
      expect(toggle).toHaveAttribute("aria-expanded", "false")
    })

    it("treats an old cloud response without execution_target as cloud", async () => {
      installApi({
        conversations: { "task-1": conversationDetail("task-1") },
      })
      renderConversationPage("/conversations/task-1")

      expect(
        await screen.findByRole("button", { name: openLabel })
      ).toBeVisible()
    })

    it.each([
      {
        name: "a local task",
        host: true,
        detail: conversationDetail("task-1", "local"),
        props: undefined,
        ready: "composer" as const,
      },
      {
        name: "a non-Mac host",
        host: false,
        detail: conversationDetail("task-1", "cloud"),
        props: undefined,
        ready: "composer" as const,
      },
      {
        name: "an embedded view",
        host: true,
        detail: conversationDetail("task-1", "cloud"),
        props: { embedded: true, conversationId: "task-1" },
        ready: "composer" as const,
      },
      {
        name: "a hidden header",
        host: true,
        detail: conversationDetail("task-1", "cloud"),
        props: { showHeader: false },
        ready: "composer" as const,
      },
      {
        name: "an explicitly read-only view",
        host: true,
        detail: conversationDetail("task-1", "cloud"),
        props: { readOnly: true },
        ready: "banner" as const,
      },
    ])(
      "does not offer the browser entry for $name",
      async ({ host, detail, props, ready }) => {
        hostMock.mac = host
        const fixture = installApi({ conversations: { "task-1": detail } })
        renderConversationPage("/conversations/task-1", props)

        if (ready === "composer")
          await screen.findByRole("textbox", { name: "任务输入框" })
        else await screen.findByRole("banner")
        expect(screen.queryByRole("button", { name: openLabel })).toBeNull()
        expect(browserRequestsFor(fixture, "task-1")).toHaveLength(0)
      }
    )

    it.each([
      ["Plan mode", { collaboration_mode: "plan" }],
      ["an archived task", { archived: true, archive_status: "archived" }],
    ])("keeps %s frame-only", async (_, overrides) => {
      const fixture = installApi({
        conversations: {
          "task-1": conversationDetail("task-1", "cloud", overrides),
        },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      const frame = await screen.findByRole("img", { name: "测试页面" })
      expect(
        screen.queryByRole("button", { name: "接管浏览器" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("textbox", { name: "向页面当前焦点输入文字" })
      ).not.toBeInTheDocument()
      fireEvent.click(frame)
      expect(
        browserRequestsFor(fixture, "task-1").filter(
          (request) => request.action !== "frame"
        )
      ).toHaveLength(0)
    })

    it("releases its own control on task switch and does not reopen on return", async () => {
      const fixture = installApi({
        conversations: {
          "task-1": conversationDetail("task-1", "cloud"),
          other: conversationDetail("other", "cloud"),
        },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1", undefined, {
        navigation: true,
      })

      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await screen.findByRole("button", { name: "交还 Agent" })
      const framesBeforeSwitch = browserRequestsFor(fixture, "task-1").filter(
        (request) => request.action === "frame"
      ).length

      await interaction.click(screen.getByRole("button", { name: "切换任务" }))
      await waitFor(() =>
        expect(browserRequestsFor(fixture, "task-1")).toContainEqual(
          expect.objectContaining({ action: "release" })
        )
      )
      expect(
        screen.queryByRole("region", { name: "浏览器" })
      ).not.toBeInTheDocument()

      const framesAfterSwitch = browserRequestsFor(fixture, "task-1").filter(
        (request) => request.action === "frame"
      ).length
      expect(framesAfterSwitch).toBe(framesBeforeSwitch)

      await interaction.click(
        await screen.findByRole("button", { name: "返回任务" })
      )
      await screen.findByRole("button", { name: openLabel })
      expect(
        screen.queryByRole("region", { name: "浏览器" })
      ).not.toBeInTheDocument()
      expect(
        browserRequestsFor(fixture, "task-1").filter(
          (request) => request.action === "frame"
        ).length
      ).toBe(framesAfterSwitch)
    })

    it("gives the shared preview slot to the task overview without reopening the browser later", async () => {
      installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await screen.findByRole("region", { name: "浏览器" })

      await interaction.click(
        screen.getByRole("button", { name: "打开会话侧栏" })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "浏览器" })
        ).not.toBeInTheDocument()
      )

      await interaction.click(
        screen.getByRole("button", { name: "关闭会话侧栏" })
      )
      expect(
        screen.queryByRole("region", { name: "浏览器" })
      ).not.toBeInTheDocument()
    })

    it("continues an idle empty task through the ordinary composer after release", async () => {
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await interaction.click(
        await screen.findByRole("button", { name: continueLabel })
      )

      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/task-1/turns" &&
              request.method === "POST"
          )
        ).toHaveLength(1)
      )
      expect(
        fixture.requests.find(
          (request) => request.path === "/api/v1/conversations/task-1/turns"
        )?.body
      ).toMatchObject({ input_text: continuePrompt })
    })

    it("prefills the continuation instead of replacing an existing draft", async () => {
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "保留的草稿")
      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await interaction.click(
        await screen.findByRole("button", { name: continueLabel })
      )

      await waitFor(() =>
        expect(input).toHaveValue(`保留的草稿\n\n${continuePrompt}`)
      )
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
    })

    it("prefills instead of starting a turn while a goal is active", async () => {
      const fixture = installApi({
        conversations: {
          "task-1": conversationDetail("task-1", "cloud", {
            goal: {
              thread_id: "thread-1",
              objective: "完成目标",
              status: "active",
              token_budget: 1_000,
              tokens_used: 10,
              time_used_seconds: 1,
              created_at: "2026-11-21T00:00:00.000Z",
              updated_at: "2026-11-21T00:00:00.000Z",
            },
          }),
        },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await interaction.click(
        await screen.findByRole("button", { name: continueLabel })
      )

      await waitFor(() => expect(input).toHaveValue(continuePrompt))
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
    })

    it("does not continue another task when the release resolves after navigation", async () => {
      const fixture = installApi({
        conversations: {
          "task-1": conversationDetail("task-1", "cloud"),
          other: conversationDetail("other", "cloud"),
        },
        browser: { deferRelease: true },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1", undefined, {
        navigation: true,
      })

      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await interaction.click(
        await screen.findByRole("button", { name: continueLabel })
      )
      await waitFor(() =>
        expect(browserRequestsFor(fixture, "task-1")).toContainEqual(
          expect.objectContaining({ action: "release" })
        )
      )

      await interaction.click(screen.getByRole("button", { name: "切换任务" }))
      await waitFor(() =>
        expect(
          fixture.requests.some(
            (request) =>
              request.path === "/api/v1/conversations/other" &&
              request.method === "GET"
          )
        ).toBe(true)
      )
      await interaction.click(
        await screen.findByRole("button", { name: "返回任务" })
      )
      await screen.findByRole("button", { name: openLabel })
      await fixture.resolveBrowserRelease()

      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
          ""
        )
      )
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/other/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
    })

    it("keeps text typed after continue is dispatched, never submits it and keeps its focus", async () => {
      window.innerWidth = 1400
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
        browser: { deferRelease: true },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await interaction.click(
        await screen.findByRole("button", { name: continueLabel })
      )
      await waitFor(() =>
        expect(browserRequestsFor(fixture, "task-1")).toContainEqual(
          expect.objectContaining({ action: "release" })
        )
      )
      expect(screen.getByRole("button", { name: "刷新画面" })).toBeDisabled()

      await interaction.type(input, "发布后输入的草稿")
      expect(input).toHaveValue("发布后输入的草稿")
      await fixture.resolveBrowserRelease()

      await waitFor(() =>
        expect(input).toHaveValue(`发布后输入的草稿\n\n${continuePrompt}`)
      )
      expect(
        browserRequestsFor(fixture, "task-1").filter(
          (request) => request.action === "release"
        )
      ).toHaveLength(1)
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
      expect(input).toHaveFocus()
    })

    it("prefills instead of sending while the ordinary composer cannot send", async () => {
      authMock.user = {
        ...authMock.initial,
        credit_quota: {
          weekly: {
            limit_credits: "100",
            used_credits: "100",
            remaining_credits: "0",
            remaining_percentage: 0,
            reset_at: "2026-11-30T00:00:00.000Z",
          },
        },
      } as typeof authMock.user
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.click(
        await screen.findByRole("button", { name: openLabel })
      )
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await interaction.click(
        await screen.findByRole("button", { name: continueLabel })
      )

      await waitFor(() => expect(input).toHaveValue(continuePrompt))
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
    })

    it("closes a controlled panel even when the release is rejected", async () => {
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
        browser: { rejectRelease: true },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1")

      const toggle = await screen.findByRole("button", { name: openLabel })
      await interaction.click(toggle)
      await interaction.click(
        await screen.findByRole("button", { name: "接管浏览器" })
      )
      await screen.findByRole("button", { name: "交还 Agent" })

      await interaction.click(
        screen.getByRole("button", { name: "关闭浏览器面板" })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "浏览器" })
        ).not.toBeInTheDocument()
      )
      await waitFor(() => expect(toggle).toHaveFocus())
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      expect(browserRequestsFor(fixture, "task-1")).toContainEqual(
        expect.objectContaining({ action: "release" })
      )
      expect(
        fixture.requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/task-1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
    })

    it("inerts the covered workspace and restores header focus in the narrow layout", async () => {
      installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/task-1")

      const toggle = await screen.findByRole("button", { name: openLabel })
      await interaction.click(toggle)
      await screen.findByRole("img", { name: "测试页面" })
      const workspace = view.container.querySelector(".conversation-workspace")
      await waitFor(() => expect(workspace).toHaveAttribute("inert"))

      await interaction.click(
        screen.getByRole("button", { name: "关闭浏览器面板" })
      )
      await waitFor(() => expect(workspace).not.toHaveAttribute("inert"))
      await waitFor(() => expect(toggle).toHaveFocus())
    })

    it("restores header focus after closing in the wide layout", async () => {
      window.innerWidth = 1400
      installApi({
        conversations: { "task-1": conversationDetail("task-1", "cloud") },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/task-1")

      const toggle = await screen.findByRole("button", { name: openLabel })
      await interaction.click(toggle)
      await screen.findByRole("img", { name: "测试页面" })
      const workspace = view.container.querySelector(".conversation-workspace")
      expect(workspace).not.toHaveAttribute("inert")

      await interaction.click(
        screen.getByRole("button", { name: "关闭浏览器面板" })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "浏览器" })
        ).not.toBeInTheDocument()
      )
      await waitFor(() => expect(toggle).toHaveFocus())
      expect(workspace).not.toHaveAttribute("inert")
    })
  })
})
