import { type ComponentProps, type ReactNode, useEffect, useState } from "react"
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
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"

import type { DesktopDeviceStatus } from "@/adapters/desktop/desktop-device-adapter"
import {
  bootstrapSchema,
  type AccessSession,
  type BootstrapStatus,
  type User,
} from "@/api/contracts"
import { apiRequest, refreshSession } from "@/api/client"
import {
  getAccessToken,
  getLoginSessionBoundary,
  setAccessToken,
} from "@/api/session"
import { AuthProvider } from "@/app/auth-context"
import { useAuth } from "@/app/auth-state"
import { BootstrapContext, bootstrapQueryKey } from "@/app/bootstrap-state"
import {
  readLocalConversationDraft,
  writeLocalConversationDraft,
} from "@/features/conversations/conversation-local-draft"
import { getPendingConversationTurnSubmission } from "@/features/conversations/conversation-pending-turn-submission"
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
  return { initial, user: { ...initial }, useRealProvider: false }
})

const hostMock = vi.hoisted(() => ({ mac: true }))

const readDesktopDeviceMock = vi.hoisted(() => vi.fn())

const clearDesktopSessionMock = vi.hoisted(() => vi.fn())

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

vi.mock("@/app/auth-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/auth-state")>()
  return {
    ...actual,
    useAuth: () =>
      authMock.useRealProvider
        ? actual.useAuth()
        : { user: authMock.user, refreshUser: vi.fn() },
  }
})

vi.mock("@/adapters/desktop/desktop-adapter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/adapters/desktop/desktop-adapter")
  >()),
  isMacDesktopHost: () => hostMock.mac,
  clearDesktopSession: clearDesktopSessionMock,
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

function desktopRollout(desktop?: {
  local_computer?: boolean
  cloud_target?: boolean
}): BootstrapStatus {
  return bootstrapSchema.parse({
    initialized: true,
    ...(desktop ? { desktop } : {}),
  })
}

const refreshedAccessToken = "refreshed-execution-target-token-00000000"

function authSession(accessToken: string) {
  return {
    access_token: accessToken,
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_session_expires_at: "2099-03-01T00:00:00.000Z",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "person@example.com",
      name: "Person",
      avatar_object_key: null,
      role: "admin",
      status: "active",
      preferred_locale: "zh-CN",
      running_message_action: "queue",
      last_login_at: "2026-08-31T08:00:00.000Z",
      last_login_method: "password",
      password_updated_at: "2026-08-01T08:00:00.000Z",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-31T08:00:00.000Z",
    },
  }
}

const authUserA: User = {
  id: "user-1",
  name: "One",
  email: "one@example.com",
  role: "user",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  running_message_action: "queue",
  weekly_credit_limit: null,
  login_method: "password",
  registration_source: "organization_invitation",
  user_groups: [],
}

const authUserB: User = {
  ...authUserA,
  id: "user-2",
  name: "Two",
  email: "two@example.com",
}

function AuthSessionControl({
  nextSession,
  beforeAccept,
}: {
  nextSession: AccessSession
  beforeAccept: () => void
}) {
  const { status, user, acceptSession, refreshUser, signOut } = useAuth()
  return (
    <>
      <output data-testid="session-status">{status}</output>
      <output data-testid="session-user">{user?.id ?? ""}</output>
      <button type="button" onClick={() => void signOut()}>
        注销当前会话
      </button>
      <button
        type="button"
        onClick={() => {
          beforeAccept()
          void acceptSession(nextSession)
        }}
      >
        建立新会话
      </button>
      <button
        type="button"
        onClick={() => void refreshUser().catch(() => undefined)}
      >
        触发会话失效
      </button>
    </>
  )
}

function AuthOnlyProbe({
  nextSession,
  onRequest,
}: {
  nextSession?: AccessSession
  onRequest?: (path: string, request: Promise<unknown>) => void
}) {
  const { status, user, acceptSession, refreshUser, signOut } = useAuth()
  const [completedSignOuts, setCompletedSignOuts] = useState(0)
  const finishSignOut = () => setCompletedSignOuts((count) => count + 1)
  return (
    <>
      <output data-testid="auth-only-status">{status}</output>
      <output data-testid="auth-only-user">{user?.id ?? ""}</output>
      <output data-testid="auth-only-sign-out-completions">
        {completedSignOuts}
      </output>
      {nextSession && (
        <button type="button" onClick={() => void acceptSession(nextSession)}>
          accept next login
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          void signOut().then(finishSignOut, finishSignOut)
        }}
      >
        sign out login
      </button>
      <button
        type="button"
        onClick={() => void refreshUser().catch(() => undefined)}
      >
        expire session
      </button>
      <button
        type="button"
        onClick={() => {
          const loginSessionBoundary = getLoginSessionBoundary()
          onRequest?.(
            "a",
            apiRequest("/race/a", {
              method: "POST",
              schema: z.object({ ok: z.boolean() }),
              loginSessionBoundary,
            })
          )
        }}
      >
        start A request
      </button>
      <button
        type="button"
        onClick={() => {
          const loginSessionBoundary = getLoginSessionBoundary()
          onRequest?.(
            "b",
            apiRequest("/race/b", {
              method: "POST",
              schema: z.object({ ok: z.boolean() }),
              loginSessionBoundary,
            })
          )
        }}
      >
        start B request
      </button>
    </>
  )
}

function renderAuthOnlyProvider(queryClient: QueryClient, children: ReactNode) {
  authMock.useRealProvider = true
  return render(
    <QueryClientProvider client={queryClient}>
      <BootstrapContext.Provider
        value={{
          bootstrap: desktopRollout(),
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }}
      >
        <AuthProvider>{children}</AuthProvider>
      </BootstrapContext.Provider>
    </QueryClientProvider>
  )
}

function installApi(
  options: {
    deferModelPreference?: boolean
    conversations?: Record<string, unknown>
    createResponse?: unknown
    referenceableFiles?: unknown[]
    applications?: unknown[]
    browser?: { deferRelease?: boolean; rejectRelease?: boolean }
    deferRefresh?: boolean
    deferCreate?: boolean
    deferTurnStart?: boolean
    createUnauthorizedOnce?: boolean
    turnUnauthorizedOnce?: boolean
    deferLogout?: boolean
    deferConversationDetail?: boolean
    deferReference?: boolean
    refreshUnauthorized?: boolean
    meResponses?: (Response | Promise<Response>)[]
    authUser?: () => unknown
  } = {}
) {
  const prewarms: { body: unknown; response: DeferredResponse }[] = []
  const createResponses: DeferredResponse[] = []
  const turnStarts: DeferredResponse[] = []
  const logoutResponses: DeferredResponse[] = []
  const conversationDetailResponses: DeferredResponse[] = []
  const referenceResponses: DeferredResponse[] = []
  let deferConversationDetails = options.deferConversationDetail ?? false
  const refreshResponse = options.deferRefresh ? createDeferredResponse() : null
  let createAttempts = 0
  let turnAttempts = 0
  const createdBodies: unknown[] = []
  const requests: {
    path: string
    method: string
    body?: unknown
    authorization: string | null
  }[] = []
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
      requests.push({
        path,
        method,
        body,
        authorization: new Headers(init?.headers).get("Authorization"),
      })

      if (path === "/api/v1/conversations/prewarm" && method === "POST") {
        const response = createDeferredResponse()
        prewarms.push({ body, response })
        return response.promise
      }
      if (path === "/api/v1/auth/refresh" && method === "POST") {
        if (options.refreshUnauthorized)
          return Promise.resolve(errorEnvelope(401, "AUTH_SESSION_EXPIRED"))
        return refreshResponse
          ? refreshResponse.promise
          : Promise.resolve(json(authSession(refreshedAccessToken)))
      }
      if (path === "/api/v1/auth/logout" && method === "POST") {
        if (!options.deferLogout) return Promise.resolve(json(null))
        const response = createDeferredResponse()
        logoutResponses.push(response)
        return response.promise
      }
      if (path === "/api/v1/me" && method === "GET") {
        const nextMeResponse = options.meResponses?.shift()
        if (nextMeResponse) return Promise.resolve(nextMeResponse)
        return options.authUser
          ? Promise.resolve(json(options.authUser()))
          : Promise.resolve(errorEnvelope(401, "AUTH_REQUIRED"))
      }
      if (path === "/api/v1/conversations" && method === "POST") {
        createdBodies.push(body)
        if (options.createUnauthorizedOnce && createAttempts++ === 0) {
          return Promise.resolve(errorEnvelope(401, "AUTH_REQUIRED"))
        }
        if (options.deferCreate) {
          const response = createDeferredResponse()
          createResponses.push(response)
          return response.promise
        }
        return Promise.resolve(
          options.createResponse !== undefined
            ? json(options.createResponse)
            : errorEnvelope(503, "RUNNER_UNAVAILABLE")
        )
      }
      const turnStartMatch =
        method === "POST" &&
        /^\/api\/v1\/conversations\/[^/]+\/turns$/u.test(path)
      const goalStartMatch =
        method === "POST" &&
        /^\/api\/v1\/conversations\/[^/]+\/goal$/u.test(path)
      if (turnStartMatch) {
        turnAttempts += 1
        if (options.turnUnauthorizedOnce && turnAttempts === 1) {
          return Promise.resolve(errorEnvelope(401, "AUTH_SESSION_EXPIRED"))
        }
      }
      if (options.deferTurnStart && (turnStartMatch || goalStartMatch)) {
        const response = createDeferredResponse()
        turnStarts.push(response)
        return response.promise
      }
      if (turnStartMatch) {
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
        /^\/api\/v1\/conversations\/[^/]+\/attachments\/references$/u.test(
          path
        ) &&
        method === "POST" &&
        options.deferReference
      ) {
        const response = createDeferredResponse()
        referenceResponses.push(response)
        return response.promise
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
      if (path === "/api/v1/conversations/referenceable-files") {
        return Promise.resolve(
          json({ items: options.referenceableFiles ?? [], next_cursor: null })
        )
      }
      if (path === "/api/v1/applications" && method === "GET") {
        return Promise.resolve(
          json({ items: options.applications ?? [], next_cursor: null })
        )
      }
      if (
        /^\/api\/v1\/applications\/[^/]+\/conversations$/u.test(path) &&
        method === "POST"
      ) {
        return Promise.resolve(
          json({
            conversation_id: "71000000-0000-4000-8000-000000000020",
          })
        )
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
        if (deferConversationDetails) {
          const response = createDeferredResponse()
          conversationDetailResponses.push(response)
          return response.promise
        }
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
    createResponses,
    turnStarts,
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
    async respondPrewarm(index: number, response: Response) {
      const request = prewarms[index]
      if (!request) throw new Error("prewarm request missing")
      await act(async () => {
        request.response.resolve(response)
        await request.response.promise
      })
    },
    async resolveCreate(index = 0, response?: Response) {
      const request = createResponses[index]
      if (!request) throw new Error("create request missing")
      await act(async () => {
        request.resolve(response ?? json(options.createResponse))
        await request.promise
      })
    },
    async resolveTurn(index = 0, response: Response) {
      const request = turnStarts[index]
      if (!request) throw new Error("turn start request missing")
      await act(async () => {
        request.resolve(response)
        await request.promise
      })
    },
    async resolveRefresh() {
      if (!refreshResponse) throw new Error("refresh response missing")
      await act(async () => {
        refreshResponse.resolve(json(authSession(refreshedAccessToken)))
        await refreshResponse.promise
      })
    },
    async resolveLogout(index = 0) {
      const request = logoutResponses[index]
      if (!request) throw new Error("logout request missing")
      await act(async () => {
        request.resolve(json(null))
        await request.promise
      })
    },
    async resolveConversationDetail(index = 0, response?: Response) {
      const request = conversationDetailResponses[index]
      if (!request) throw new Error("conversation detail request missing")
      await act(async () => {
        request.resolve(response ?? json({}))
        await request.promise
      })
    },
    async resolveReference(index = 0, response: Response) {
      const request = referenceResponses[index]
      if (!request) throw new Error("reference request missing")
      await act(async () => {
        request.resolve(response)
        await request.promise
      })
    },
    deferFollowingConversationDetails() {
      deferConversationDetails = true
    },
    conversationDetailResponses,
    referenceResponses,
  }
}

function installRefreshRaceApi() {
  const accessTokenA = "refresh-race-account-a-token"
  const accessTokenB = "refresh-race-account-b-token"
  const refreshedTokenA = "refresh-race-account-a-refreshed-token"
  const refreshedTokenB = "refresh-race-account-b-refreshed-token"
  const refreshResponses = [createDeferredResponse(), createDeferredResponse()]
  const refreshRequests: { authorization: string | null }[] = []
  const raceRequests: { path: string; authorization: string | null }[] = []
  const raceAttempts = new Map<string, number>()

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const method = init?.method ?? "GET"
      const authorization = new Headers(init?.headers).get("Authorization")

      if (path === "/api/v1/auth/refresh" && method === "POST") {
        refreshRequests.push({ authorization })
        const response = refreshResponses[refreshRequests.length - 1]
        if (!response) throw new Error("unexpected refresh request")
        return response.promise
      }
      if (path === "/api/v1/me" && method === "GET") {
        if (
          authorization === `Bearer ${accessTokenB}` ||
          authorization === `Bearer ${refreshedTokenB}`
        ) {
          return Promise.resolve(json(authUserB))
        }
        if (
          authorization === `Bearer ${accessTokenA}` ||
          authorization === `Bearer ${refreshedTokenA}`
        ) {
          return Promise.resolve(json(authUserA))
        }
        return Promise.resolve(errorEnvelope(401, "AUTH_REQUIRED"))
      }
      if (path === "/api/v1/auth/logout" && method === "POST") {
        return Promise.resolve(json(null))
      }
      if (
        (path === "/api/v1/race/a" || path === "/api/v1/race/b") &&
        method === "POST"
      ) {
        const attempt = (raceAttempts.get(path) ?? 0) + 1
        raceAttempts.set(path, attempt)
        raceRequests.push({ path, authorization })
        if (attempt > 1 && authorization === `Bearer ${refreshedTokenB}`) {
          return Promise.resolve(json({ ok: true }))
        }
        return Promise.resolve(errorEnvelope(401, "AUTH_SESSION_EXPIRED"))
      }
      return Promise.resolve(errorEnvelope(404, "NOT_FOUND"))
    })
  )

  return {
    accessTokenA,
    accessTokenB,
    refreshedTokenA,
    refreshedTokenB,
    refreshRequests,
    raceRequests,
    async resolveRefreshA() {
      await act(async () => {
        refreshResponses[0]!.resolve(json(authSession(refreshedTokenA)))
        await refreshResponses[0]!.promise
      })
    },
    async resolveRefreshB() {
      await act(async () => {
        refreshResponses[1]!.resolve(json(authSession(refreshedTokenB)))
        await refreshResponses[1]!.promise
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
  const location = useLocation()
  return (
    <>
      <span aria-hidden="true" data-testid="conversation-route">
        {location.pathname}
      </span>
      <button type="button" onClick={() => navigate("/conversations/other")}>
        切换任务
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        返回任务
      </button>
      <button type="button" onClick={() => navigate("/settings/general")}>
        打开设置
      </button>
      <ConversationPage {...pageProps} />
    </>
  )
}

function SettingsPageWithNavigation() {
  const navigate = useNavigate()
  return (
    <>
      <button
        type="button"
        onClick={() => navigate("/conversations/new", { replace: true })}
      >
        返回新任务
      </button>
      <p>设置页面</p>
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
  options: {
    navigation?: boolean
    accountSwitch?: boolean
    bootstrap?: BootstrapStatus
    realAuth?: {
      nextSession: AccessSession
      beforeAccept: () => void
    }
  } = {}
) {
  authMock.useRealProvider = Boolean(options.realAuth)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (options.bootstrap) {
    queryClient.setQueryData(bootstrapQueryKey, options.bootstrap)
  }
  let updateBootstrap: ((value: BootstrapStatus) => void) | null = null
  function BootstrapHarness({ children }: { children: ReactNode }) {
    const [bootstrap, setBootstrap] = useState(options.bootstrap)
    useEffect(() => {
      updateBootstrap = setBootstrap
    }, [])
    return (
      <BootstrapContext.Provider
        value={{
          bootstrap,
          isLoading: false,
          error: null,
          refetch: () => undefined,
        }}
      >
        {children}
      </BootstrapContext.Provider>
    )
  }
  const routes = (
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
      <Route
        path="/settings/general"
        element={<SettingsPageWithNavigation />}
      />
    </Routes>
  )
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BootstrapHarness>
            {options.realAuth ? (
              <AuthProvider>
                {routes}
                <AuthSessionControl
                  nextSession={options.realAuth.nextSession}
                  beforeAccept={options.realAuth.beforeAccept}
                />
              </AuthProvider>
            ) : (
              routes
            )}
          </BootstrapHarness>
        </QueryClientProvider>
        <NotificationCenter />
      </ThemeProvider>
    </MemoryRouter>
  )
  return {
    ...view,
    queryClient,
    setBootstrap(next: BootstrapStatus) {
      queryClient.setQueryData(bootstrapQueryKey, next)
      act(() => updateBootstrap?.(next))
    },
  }
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

function findSendMutation(queryClient: QueryClient, input: string) {
  return queryClient
    .getMutationCache()
    .getAll()
    .find((mutation) => {
      const variables = mutation.state.variables as
        { input?: string } | undefined
      return variables?.input === input
    })
}

async function waitForMutationSettled(
  mutation: ReturnType<typeof findSendMutation>
) {
  await waitFor(() => expect(mutation?.state.status).not.toBe("pending"))
}

const realSessionExpiry = "2099-01-01T00:00:00.000Z"

describe("conversation execution target", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("execution-target-access-token")
    hostMock.mac = true
    authMock.user = { ...authMock.initial }
    authMock.useRealProvider = false
    deviceStatusMock.reset()
    readDesktopDeviceMock.mockReset()
    readDesktopDeviceMock.mockResolvedValue(readyDeviceStatus())
    clearDesktopSessionMock.mockReset().mockResolvedValue(undefined)
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    notify.dismiss()
    setAccessToken(null)
    authMock.user = { ...authMock.initial }
    authMock.useRealProvider = false
    deviceStatusMock.reset()
    readDesktopDeviceMock.mockReset()
    clearDesktopSessionMock.mockReset()
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

  it("does not create a local task when the task page unmounts during the readiness re-read", async () => {
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
    await interaction.type(input, "离开页面前的草稿")
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(readDesktopDeviceMock).toHaveBeenCalledOnce())

    // Settings is a different route tree, so this unmounts ConversationPage
    // instead of reusing it for another route parameter.
    await interaction.click(screen.getByRole("button", { name: "打开设置" }))
    expect(await screen.findByText("设置页面")).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()

    await act(async () => {
      freshRead.resolve(readyDeviceStatus())
      await freshRead.promise
    })

    expect(screen.getByText("设置页面")).toBeVisible()
    expect(fixture.createdBodies).toHaveLength(0)
    expect(
      fixture.requests.some(
        (request) =>
          request.method === "POST" && request.path.endsWith("/turns")
      )
    ).toBe(false)
    expect(
      readLocalConversationDraft(window.localStorage, "user-1", "new").input
    ).toBe("离开页面前的草稿")
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

  describe("desktop execution rollout", () => {
    const zh = desktopExecutionMessages["zh-CN"]
    // Toasts intentionally drop a trailing period.
    const toastText = (value: string) => value.replace(/[。.]+\s*$/u, "")

    it("keeps legacy target availability when the bootstrap has no desktop policy", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout(),
      })

      await selectLocalTarget(interaction)
      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "旧版接口仍可本地运行")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      expect(fixture.createdBodies[0]).toMatchObject({
        execution_target: "local",
        desktop_device_id: "device-1",
      })
    })

    it("blocks a cloud task without prewarm or POST when the cloud entry is closed", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({ cloud_target: false }),
      })

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "云端入口已关闭")

      await interaction.click(screen.getByRole("button", { name: /运行位置/u }))
      expect(
        await screen.findByRole("radio", { name: "云电脑" })
      ).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByText(zh.cloudTargetUnavailable)).toBeVisible()
      await interaction.keyboard("{Escape}")

      const send = screen.getByRole("button", { name: "发送" })
      await waitFor(() => expect(send).toBeEnabled())
      await interaction.click(send)
      expect(
        await screen.findByText(toastText(zh.cloudTargetUnavailable))
      ).toBeVisible()
      expect(fixture.prewarms).toHaveLength(0)
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("云端入口已关闭")
      expect(
        screen.getByRole("button", { name: /运行位置/u })
      ).toHaveTextContent("云电脑")
    })

    it("allows choosing local explicitly while the cloud entry is closed", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferModelPreference: true })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({ cloud_target: false }),
      })

      await selectLocalTarget(interaction)
      await fixture.resolveModelPreference()
      expect(fixture.prewarms).toHaveLength(0)

      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "显式选择本地电脑")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      expect(fixture.createdBodies[0]).toMatchObject({
        execution_target: "local",
        desktop_device_id: "device-1",
      })
      expect(fixture.createdBodies[0]).not.toHaveProperty(
        "prewarmed_conversation_id"
      )
    })

    it("keeps local closed for a healthy device when the rollout flag is off", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({ local_computer: false }),
      })

      await interaction.click(screen.getByRole("button", { name: /运行位置/u }))
      expect(
        await screen.findByRole("radio", { name: "本地电脑" })
      ).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByText(zh.localComputerUnavailable)).toBeVisible()
      expect(
        screen.queryByRole("link", { name: "管理设备" })
      ).not.toBeInTheDocument()
      await interaction.keyboard("{Escape}")

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(
        0,
        "71000000-0000-4000-8000-000000000010"
      )

      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "云端仍然可用")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      expect(fixture.createdBodies[0]).toEqual({
        collaboration_mode: "default",
        prewarmed_conversation_id: "71000000-0000-4000-8000-000000000010",
        project_id: null,
      })
      expect(readDesktopDeviceMock).not.toHaveBeenCalled()
    })

    it("explains that no run location is available and blocks creation", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: false,
          cloud_target: false,
        }),
      })

      expect(await screen.findByText(zh.noTargetAvailable)).toBeVisible()
      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "没有可用运行位置")
      expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
      expect(fixture.prewarms).toHaveLength(0)
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("没有可用运行位置")

      await interaction.click(screen.getByRole("button", { name: /运行位置/u }))
      expect(
        await screen.findByRole("radio", { name: "云电脑" })
      ).toHaveAttribute("aria-disabled", "true")
      expect(screen.getByRole("radio", { name: "本地电脑" })).toHaveAttribute(
        "aria-disabled",
        "true"
      )
    })

    it("keeps the application picker usable when no run location is available", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const applicationId = "50000000-0000-4000-8000-000000000001"
      const fixture = installApi({
        applications: [
          {
            id: applicationId,
            owner: {
              id: "50000000-0000-4000-8000-000000000002",
              name: "运营",
            },
            name: "运营分析助手",
            icon: { type: "preset", preset: "sparkles" },
            description: "分析运营数据",
            instructions: null,
            model: null,
            reasoning_effort: null,
            status: "active",
            is_owner: false,
            can_manage: false,
            access_source: "direct",
            capability_count: 0,
            knowledge_base_count: 0,
            mcp_server_count: 0,
            dependencies_available: true,
            capabilities: [],
            knowledge_bases: [],
            mcp_servers: [],
            created_at: "2026-07-30T00:00:00.000Z",
            updated_at: "2026-07-30T00:00:00.000Z",
          },
        ],
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: false,
          cloud_target: false,
        }),
      })

      expect(await screen.findByText(zh.noTargetAvailable)).toBeVisible()
      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "应用仍可使用")
      expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()

      await interaction.type(input, " /")
      await interaction.click(
        await screen.findByRole("option", { name: /应用列表/ })
      )
      await interaction.click(
        await screen.findByRole("option", { name: /运营分析助手/ })
      )

      await waitFor(() =>
        expect(
          fixture.requests.some(
            (request) =>
              request.path ===
                `/api/v1/applications/${applicationId}/conversations` &&
              request.method === "POST"
          )
        ).toBe(true)
      )
      expect(fixture.createdBodies).toHaveLength(0)
      expect(fixture.prewarms).toHaveLength(0)
    })

    it("preserves the selected local target and draft when the rollout closes it", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await selectLocalTarget(interaction)
      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "保留的本地草稿")

      view.setBootstrap(desktopRollout({ local_computer: false }))

      const trigger = screen.getByRole("button", { name: /运行位置/u })
      expect(trigger).toHaveTextContent("本地电脑")
      expect(input).toHaveValue("保留的本地草稿")

      const send = screen.getByRole("button", { name: "发送" })
      await waitFor(() => expect(send).toBeEnabled())
      await interaction.click(send)
      expect(
        await screen.findByText(toastText(zh.localComputerUnavailable))
      ).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("保留的本地草稿")

      // The available target is chosen explicitly; nothing switches on its own.
      await interaction.click(trigger)
      expect(
        await screen.findByRole("radio", { name: "本地电脑" })
      ).toHaveAttribute("aria-disabled", "true")
      await interaction.click(screen.getByRole("radio", { name: "云电脑" }))
      expect(trigger).toHaveTextContent("云电脑")
      expect(input).toHaveValue("保留的本地草稿")

      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      expect(fixture.createdBodies[0]).not.toHaveProperty("execution_target")
    })

    it("rechecks the rollout after the native readiness read before creating", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const freshRead = createDeferred<DesktopDeviceStatus>()
      readDesktopDeviceMock.mockReturnValue(freshRead.promise)
      const fixture = installApi()
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await selectLocalTarget(interaction)
      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "读取期间关闭开关")
      const send = screen.getByRole("button", { name: "发送" })
      await waitFor(() => expect(send).toBeEnabled())
      await interaction.click(send)
      await waitFor(() => expect(readDesktopDeviceMock).toHaveBeenCalledOnce())

      // The bootstrap poll writes the shared TanStack cache entry. The gate
      // after the awaited read must see that same current policy, not a
      // render-time snapshot or a second key that could drift.
      act(() => {
        view.queryClient.setQueryData(
          bootstrapQueryKey,
          desktopRollout({ local_computer: false })
        )
      })
      await act(async () => {
        freshRead.resolve(readyDeviceStatus())
        await freshRead.promise
      })

      expect(
        await screen.findByText(toastText(zh.localComputerUnavailable))
      ).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("读取期间关闭开关")
    })

    it("stops the post-refresh create retry when the rollout closes the target", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({
        deferRefresh: true,
        createUnauthorizedOnce: true,
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "刷新期间关闭云入口")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      // The auth preHandler rejects the first physical create without a
      // business side effect, so the client refreshes before retrying.
      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      // The poll updates the shared cache while the refresh is still pending.
      act(() => {
        view.queryClient.setQueryData(
          bootstrapQueryKey,
          desktopRollout({ cloud_target: false })
        )
      })
      await fixture.resolveRefresh()

      expect(
        await screen.findByText(toastText(zh.cloudTargetUnavailable))
      ).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(1)
      expect(
        fixture.requests.some(
          (request) =>
            request.method === "POST" &&
            /^\/api\/v1\/conversations\/[^/]+\/turns$/u.test(request.path)
        )
      ).toBe(false)
      expect(input).toHaveValue("刷新期间关闭云入口")
      expect(getAccessToken()).toBe(refreshedAccessToken)
    })

    it("does not create a paused fresh Mac task after leaving for Settings", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-paused-mac", "cloud")
      const fixture = installApi({
        createResponse: created,
        conversations: { "new-paused-mac": created },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000021")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "暂停后离开页面")

      onlineManager.setOnline(false)
      try {
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
          expect(paused[0]?.state.variables).toMatchObject({
            input: "暂停后离开页面",
          })
        })
        expect(fixture.createdBodies).toHaveLength(0)

        await interaction.click(
          screen.getByRole("button", { name: "打开设置" })
        )
        expect(await screen.findByText("设置页面")).toBeVisible()

        onlineManager.setOnline(true)
        await waitFor(() => {
          const mutations = view.queryClient.getMutationCache().getAll()
          expect(mutations.some((mutation) => mutation.state.isPaused)).toBe(
            false
          )
          expect(
            mutations.every((mutation) => mutation.state.status !== "pending")
          ).toBe(true)
        })

        expect(fixture.createdBodies).toHaveLength(0)
        expect(screen.getByText("设置页面")).toBeVisible()
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" && request.path.endsWith("/turns")
          )
        ).toBe(false)
        expect(
          readLocalConversationDraft(window.localStorage, "user-1", "new").input
        ).toBe("暂停后离开页面")
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("keeps a second paused fresh Mac submission after an abandoned paused create fails", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-cache-owner-b", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        createResponse: created,
        conversations: { "new-cache-owner-b": created },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000026")
      const firstInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(firstInput, "离开页面后被放弃的提交")
      const getPendingSubmission = () =>
        getPendingConversationTurnSubmission(view.queryClient, "new")

      onlineManager.setOnline(false)
      try {
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
          expect(paused[0]?.state.variables).toMatchObject({
            input: "离开页面后被放弃的提交",
          })
        })
        const firstOptimisticId = getPendingSubmission()?.optimisticId
        expect(firstOptimisticId).toBeTruthy()
        expect(fixture.createdBodies).toHaveLength(0)

        await interaction.click(
          screen.getByRole("button", { name: "打开设置" })
        )
        expect(await screen.findByText("设置页面")).toBeVisible()
        await interaction.click(
          screen.getByRole("button", { name: "返回新任务" })
        )

        const secondInput = await screen.findByRole("textbox", {
          name: "任务输入框",
        })
        await interaction.clear(secondInput)
        await interaction.type(secondInput, "缓存属于第二个提交")
        await interaction.click(screen.getByRole("button", { name: "发送" }))

        let secondOptimisticId = ""
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(2)
          expect(paused[1]?.state.variables).toMatchObject({
            input: "缓存属于第二个提交",
          })
          secondOptimisticId = getPendingSubmission()?.optimisticId ?? ""
          expect(secondOptimisticId).not.toBe("")
        })
        expect(secondOptimisticId).not.toBe(firstOptimisticId)

        expect(getPendingSubmission()).toMatchObject({
          optimisticId: secondOptimisticId,
          message: { content: "缓存属于第二个提交" },
        })
        expect(
          readLocalConversationDraft(window.localStorage, "user-1", "new")
            .input
        ).toBe("缓存属于第二个提交")
        expect(fixture.createdBodies).toHaveLength(0)

        onlineManager.setOnline(true)
        await waitFor(() => {
          const errors = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.status === "error")
          expect(errors).toHaveLength(1)
        })
        await waitFor(() => {
          expect(fixture.createdBodies).toHaveLength(1)
          expect(fixture.createResponses).toHaveLength(1)
        })

        expect(getPendingSubmission()).toMatchObject({
          optimisticId: secondOptimisticId,
          message: { content: "缓存属于第二个提交" },
        })
        expect(
          readLocalConversationDraft(window.localStorage, "user-1", "new")
            .input
        ).toBe("缓存属于第二个提交")
        expect(await screen.findByText("缓存属于第二个提交")).toBeVisible()
        expect(fixture.createdBodies).toHaveLength(1)
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" && request.path.endsWith("/turns")
          )
        ).toBe(false)

        await fixture.resolveCreate()
        await waitFor(() =>
          expect(screen.getByTestId("conversation-route")).toHaveTextContent(
            "/conversations/new-cache-owner-b"
          )
        )
        await waitFor(() =>
          expect(
            fixture.requests.filter(
              (request) =>
                request.method === "POST" &&
                request.path === "/api/v1/conversations/new-cache-owner-b/turns"
            )
          ).toHaveLength(1)
        )
        expect(
          fixture.requests.find(
            (request) =>
              request.method === "POST" &&
              request.path === "/api/v1/conversations/new-cache-owner-b/turns"
          )?.body
        ).toMatchObject({ input_text: "缓存属于第二个提交" })
        expect(fixture.createdBodies).toHaveLength(1)
        await fixture.resolveTurn(
          0,
          json(
            {
              accepted: true,
              status: "starting",
              turn_id: "30000000-0000-4000-8000-000000000098",
            },
            202
          )
        )
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("keeps a second fresh Mac submission and its draft when an abandoned create resolves", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail("new-promotion-owner-a", "cloud")
      const createdB = conversationDetail("new-promotion-owner-b", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        conversations: {
          "new-promotion-owner-a": createdA,
          "new-promotion-owner-b": createdB,
        },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })
      act(() => {
        view.queryClient.setQueryData(["conversations", "sidebar"], {
          pages: [{ items: [], next_cursor: null, total_count: 0 }],
          pageParams: [undefined],
        })
      })
      const sidebarItems = () =>
        view.queryClient
          .getQueryData<{
            pages: { items: { id: string; execution_status?: string }[] }[]
          }>(["conversations", "sidebar"])
          ?.pages.flatMap((page) => page.items) ?? []
      const placeholderSubmission = () =>
        getPendingConversationTurnSubmission(view.queryClient, "new")
      const pendingExecution = (id: string) =>
        view.queryClient.getQueryData(["conversation", id, "pending-execution"])

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000041")
      const firstInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(firstInput, "离开页面后被放弃的创建")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(1)
        expect(fixture.createResponses).toHaveLength(1)
      })
      const firstOptimisticId = placeholderSubmission()?.optimisticId
      expect(firstOptimisticId).toBeTruthy()
      expect(sidebarItems()).toMatchObject([
        { id: "new", execution_status: "running" },
      ])
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("离开页面后被放弃的创建")

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await interaction.click(
        screen.getByRole("button", { name: "返回新任务" })
      )

      const secondInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.clear(secondInput)
      await interaction.type(secondInput, "第二个提交保持自己的创建")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(2)
        expect(fixture.createResponses).toHaveLength(2)
      })
      const secondOptimisticId = placeholderSubmission()?.optimisticId
      expect(secondOptimisticId).toBeTruthy()
      expect(secondOptimisticId).not.toBe(firstOptimisticId)
      expect(placeholderSubmission()).toMatchObject({
        optimisticId: secondOptimisticId,
        conversationId: "new",
        message: { content: "第二个提交保持自己的创建" },
      })
      expect(sidebarItems()).toMatchObject([
        { id: "new", execution_status: "running" },
      ])
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("第二个提交保持自己的创建")

      // A's admitted create resolves after its page instance is gone. It may
      // finish on its own conversation, but must not navigate B's fresh route
      // or replace B's placeholder markers, draft, or sidebar row.
      await fixture.resolveCreate(0, json(createdA))

      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-promotion-owner-a/turns"
          )
        ).toHaveLength(1)
      )
      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new"
      )
      expect(placeholderSubmission()).toMatchObject({
        optimisticId: secondOptimisticId,
        conversationId: "new",
        message: { content: "第二个提交保持自己的创建" },
      })
      expect(
        getPendingConversationTurnSubmission(
          view.queryClient,
          "new-promotion-owner-a"
        )
      ).toMatchObject({
        optimisticId: firstOptimisticId,
        message: { content: "离开页面后被放弃的创建" },
      })
      expect(pendingExecution("new")).toEqual({ turnId: null })
      expect(pendingExecution("new-promotion-owner-a")).toEqual({
        turnId: null,
      })
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("第二个提交保持自己的创建")
      expect(
        readLocalConversationDraft(
          window.localStorage,
          "user-1",
          "new-promotion-owner-a"
        ).input
      ).toBe("离开页面后被放弃的创建")
      expect(
        sidebarItems().find((item) => item.id === "new-promotion-owner-a")
      ).toMatchObject({ execution_status: "running" })
      expect(sidebarItems().find((item) => item.id === "new")).toMatchObject({
        execution_status: "running",
      })
      expect(fixture.createdBodies).toHaveLength(2)

      // A definite rejection of A's own first turn clears only A's own running
      // row; B's fresh placeholder row stays running until B settles.
      await fixture.resolveTurn(0, errorEnvelope(403, "FORBIDDEN"))
      await waitFor(() =>
        expect(
          sidebarItems().find((item) => item.id === "new-promotion-owner-a")
        ).not.toMatchObject({ execution_status: "running" })
      )
      expect(sidebarItems().find((item) => item.id === "new")).toMatchObject({
        execution_status: "running",
      })
      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new"
      )

      // B still creates and sends exactly once for its own payload when its
      // held create resolves.
      await fixture.resolveCreate(1, json(createdB))
      await waitFor(() =>
        expect(screen.getByTestId("conversation-route")).toHaveTextContent(
          "/conversations/new-promotion-owner-b"
        )
      )
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-promotion-owner-b/turns"
          )
        ).toHaveLength(1)
      )
      expect(
        fixture.requests.find(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/new-promotion-owner-b/turns"
        )?.body
      ).toMatchObject({ input_text: "第二个提交保持自己的创建" })
      expect(
        fixture.requests.find(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/new-promotion-owner-a/turns"
        )?.body
      ).toMatchObject({ input_text: "离开页面后被放弃的创建" })
      expect(fixture.createdBodies).toHaveLength(2)
      // B still owns the placeholder at its own promotion, so its exact draft
      // moves to its conversation and the shared placeholder is cleared.
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("")
      expect(
        readLocalConversationDraft(
          window.localStorage,
          "user-1",
          "new-promotion-owner-b"
        ).input
      ).toBe("第二个提交保持自己的创建")
      await fixture.resolveTurn(
        1,
        json(
          {
            accepted: true,
            status: "starting",
            turn_id: "30000000-0000-4000-8000-000000000097",
          },
          202
        )
      )
    })

    it("seeds an abandoned create after the newer submission claims the placeholder first", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail("new-late-owner-a", "cloud")
      const createdB = conversationDetail("new-late-owner-b", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        conversations: {
          "new-late-owner-a": createdA,
          "new-late-owner-b": createdB,
        },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })
      act(() => {
        view.queryClient.setQueryData(["conversations", "sidebar"], {
          pages: [{ items: [], next_cursor: null, total_count: 0 }],
          pageParams: [undefined],
        })
      })
      const sidebarItems = () =>
        view.queryClient
          .getQueryData<{
            pages: { items: { id: string; execution_status?: string }[] }[]
          }>(["conversations", "sidebar"])
          ?.pages.flatMap((page) => page.items) ?? []
      const placeholderSubmission = () =>
        getPendingConversationTurnSubmission(view.queryClient, "new")

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000043")
      const firstInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(firstInput, "较早的创建最后返回")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(1)
        expect(fixture.createResponses).toHaveLength(1)
      })
      const firstOptimisticId = placeholderSubmission()?.optimisticId
      expect(firstOptimisticId).toBeTruthy()

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await interaction.click(
        screen.getByRole("button", { name: "返回新任务" })
      )

      const secondInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.clear(secondInput)
      await interaction.type(secondInput, "较新的提交先完成创建")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(2)
        expect(fixture.createResponses).toHaveLength(2)
      })
      const secondOptimisticId = placeholderSubmission()?.optimisticId
      expect(secondOptimisticId).toBeTruthy()
      expect(secondOptimisticId).not.toBe(firstOptimisticId)

      await fixture.resolveCreate(1, json(createdB))
      await waitFor(() =>
        expect(screen.getByTestId("conversation-route")).toHaveTextContent(
          "/conversations/new-late-owner-b"
        )
      )
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path === "/api/v1/conversations/new-late-owner-b/turns"
          )
        ).toHaveLength(1)
      )
      expect(placeholderSubmission()).toBeNull()
      expect(
        getPendingConversationTurnSubmission(
          view.queryClient,
          "new-late-owner-b"
        )
      ).toMatchObject({
        optimisticId: secondOptimisticId,
        message: { content: "较新的提交先完成创建" },
      })

      // The newer submission already consumed the placeholder. The admitted
      // older create can only seed its own captured state.
      await fixture.resolveCreate(0, json(createdA))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path === "/api/v1/conversations/new-late-owner-a/turns"
          )
        ).toHaveLength(1)
      )
      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new-late-owner-b"
      )
      expect(placeholderSubmission()).toBeNull()
      expect(
        getPendingConversationTurnSubmission(
          view.queryClient,
          "new-late-owner-b"
        )
      ).toMatchObject({
        optimisticId: secondOptimisticId,
        message: { content: "较新的提交先完成创建" },
      })
      expect(
        getPendingConversationTurnSubmission(
          view.queryClient,
          "new-late-owner-a"
        )
      ).toMatchObject({
        optimisticId: firstOptimisticId,
        message: { content: "较早的创建最后返回" },
      })
      expect(
        view.queryClient.getQueryData([
          "conversation",
          "new-late-owner-a",
          "pending-execution",
        ])
      ).toEqual({ turnId: null })
      expect(
        sidebarItems().find((item) => item.id === "new-late-owner-a")
      ).toMatchObject({ execution_status: "running" })
      expect(
        sidebarItems().find((item) => item.id === "new-late-owner-b")
      ).toMatchObject({ execution_status: "running" })
      expect(fixture.createdBodies).toHaveLength(2)

      await fixture.resolveTurn(1, errorEnvelope(403, "FORBIDDEN"))
      await waitFor(() =>
        expect(
          sidebarItems().find((item) => item.id === "new-late-owner-a")
        ).not.toMatchObject({ execution_status: "running" })
      )
      expect(
        sidebarItems().find((item) => item.id === "new-late-owner-b")
      ).toMatchObject({ execution_status: "running" })
      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new-late-owner-b"
      )
      await fixture.resolveTurn(
        0,
        json(
          {
            accepted: true,
            status: "starting",
            turn_id: "30000000-0000-4000-8000-000000000096",
          },
          202
        )
      )
    })

    it("does not clear a draft typed on a new route when an abandoned create resolves", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail("new-abandoned-draft-a", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        conversations: { "new-abandoned-draft-a": createdA },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })
      act(() => {
        view.queryClient.setQueryData(["conversations", "sidebar"], {
          pages: [{ items: [], next_cursor: null, total_count: 0 }],
          pageParams: [undefined],
        })
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000042")
      const firstInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(firstInput, "被放弃且不该清空草稿")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(1)
        expect(fixture.createResponses).toHaveLength(1)
      })

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await interaction.click(
        screen.getByRole("button", { name: "返回新任务" })
      )

      const draftInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.clear(draftInput)
      await interaction.type(draftInput, "只输入但还没有发送")
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("只输入但还没有发送")

      await fixture.resolveCreate(0, json(createdA))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-abandoned-draft-a/turns"
          )
        ).toHaveLength(1)
      )
      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new"
      )
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
        "只输入但还没有发送"
      )
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("只输入但还没有发送")
      expect(
        readLocalConversationDraft(
          window.localStorage,
          "user-1",
          "new-abandoned-draft-a"
        ).input
      ).toBe("被放弃且不该清空草稿")
      expect(fixture.createdBodies).toHaveLength(1)
      expect(
        fixture.requests.filter((request) => request.path.endsWith("/turns"))
      ).toHaveLength(1)

      await fixture.resolveTurn(0, errorEnvelope(403, "FORBIDDEN"))
      await waitFor(() =>
        expect(
          view.queryClient
            .getQueryData<{
              pages: { items: { id: string; execution_status?: string }[] }[]
            }>(["conversations", "sidebar"])
            ?.pages.flatMap((page) => page.items)
            .find((item) => item.id === "new-abandoned-draft-a")
        ).not.toMatchObject({ execution_status: "running" })
      )
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("只输入但还没有发送")
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
        "只输入但还没有发送"
      )
    })

    it.each([
      {
        name: "a different account",
        nextUser: authUserB,
        nextToken: "replacement-account-access-token",
      },
      {
        name: "the same account signing back in",
        nextUser: authUserA,
        nextToken: "same-account-new-login-token",
      },
    ])(
      "does not promote an admitted create after sign-out and $name",
      async ({ nextUser, nextToken }) => {
        deviceStatusMock.setData(readyDeviceStatus())
        const createdA = conversationDetail("new-login-boundary-a", "cloud")
        let activeAuthUser: User = authUserA
        const fixture = installApi({
          deferCreate: true,
          createResponse: createdA,
          conversations: { [createdA.id]: createdA },
          authUser: () => activeAuthUser,
        })
        const interaction = userEvent.setup()
        const view = renderConversationPage("/conversations/new", undefined, {
          navigation: true,
          bootstrap: desktopRollout({
            local_computer: true,
            cloud_target: true,
          }),
          realAuth: {
            nextSession: {
              access_token: nextToken,
              access_token_expires_at: realSessionExpiry,
            },
            beforeAccept: () => {
              activeAuthUser = nextUser
            },
          },
        })

        await waitFor(() =>
          expect(screen.getByTestId("session-status")).toHaveTextContent(
            "authenticated"
          )
        )
        expect(screen.getByTestId("session-user")).toHaveTextContent("user-1")
        await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
        await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000061")
        const input = await screen.findByRole("textbox", {
          name: "任务输入框",
        })
        await interaction.type(input, "旧登录被准入的创建")
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => {
          expect(fixture.createdBodies).toHaveLength(1)
          expect(fixture.createResponses).toHaveLength(1)
        })
        const oldMutation = findSendMutation(
          view.queryClient,
          "旧登录被准入的创建"
        )
        expect(oldMutation).toBeDefined()

        await interaction.click(
          screen.getByRole("button", { name: "注销当前会话" })
        )
        await waitFor(() =>
          expect(screen.getByTestId("session-status")).toHaveTextContent(
            "anonymous"
          )
        )
        await interaction.click(
          screen.getByRole("button", { name: "建立新会话" })
        )
        await waitFor(() =>
          expect(screen.getByTestId("session-user")).toHaveTextContent(
            nextUser.id
          )
        )

        writeLocalConversationDraft(window.localStorage, nextUser.id, "new", {
          input: "新登录的草稿",
          capabilityIds: [],
          knowledgeBaseIds: [],
        })
        const seededSidebar = {
          pages: [
            {
              items: [
                conversationDetail("new", "cloud", {
                  title: "新登录占位",
                  execution_status: "running",
                }),
              ],
              next_cursor: null,
              total_count: 1,
            },
          ],
          pageParams: [undefined],
        }
        view.queryClient.setQueryData(["conversations", "sidebar"], {
          ...seededSidebar,
        })

        await fixture.resolveCreate(0, json(createdA))
        await waitForMutationSettled(oldMutation)

        expect(screen.getByTestId("conversation-route")).toHaveTextContent(
          "/conversations/new"
        )
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-login-boundary-a/turns"
          )
        ).toBe(false)
        expect(
          view.queryClient.getQueryData([
            "conversation",
            "new-login-boundary-a",
          ])
        ).toBeUndefined()
        expect(
          view.queryClient.getQueryData(["conversations", "sidebar"])
        ).toEqual(seededSidebar)
        expect(
          readLocalConversationDraft(window.localStorage, nextUser.id, "new")
            .input
        ).toBe("新登录的草稿")
        expect(
          readLocalConversationDraft(
            window.localStorage,
            nextUser.id,
            "new-login-boundary-a"
          ).input
        ).toBe("")
        expect(getAccessToken()).toBe(nextToken)
        expect(fixture.createdBodies).toHaveLength(1)
      }
    )

    it("does not retry an attempted first turn after logout replaces the login", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail("new-login-refresh-a", "cloud")
      let activeAuthUser: User = authUserA
      const nextToken = "post-logout-refresh-login-token"
      const fixture = installApi({
        deferCreate: true,
        deferRefresh: true,
        turnUnauthorizedOnce: true,
        createResponse: createdA,
        conversations: { [createdA.id]: createdA },
        authUser: () => activeAuthUser,
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
        realAuth: {
          nextSession: {
            access_token: nextToken,
            access_token_expires_at: realSessionExpiry,
          },
          beforeAccept: () => {
            activeAuthUser = authUserB
          },
        },
      })

      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "authenticated"
        )
      )
      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000062")
      const input = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(input, "首轮刷新跨越登录")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createResponses).toHaveLength(1))
      const oldMutation = findSendMutation(view.queryClient, "首轮刷新跨越登录")
      expect(oldMutation).toBeDefined()

      await fixture.resolveCreate(0, json(createdA))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path === "/api/v1/conversations/new-login-refresh-a/turns"
          )
        ).toHaveLength(1)
      )
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      await interaction.click(
        screen.getByRole("button", { name: "注销当前会话" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "anonymous"
        )
      )
      await interaction.click(
        screen.getByRole("button", { name: "建立新会话" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("session-user")).toHaveTextContent("user-2")
      )

      writeLocalConversationDraft(window.localStorage, authUserB.id, "new", {
        input: "新登录保持的草稿",
        capabilityIds: [],
        knowledgeBaseIds: [],
      })
      const seededSidebar = {
        pages: [
          {
            items: [
              conversationDetail("new", "cloud", {
                title: "新登录占位",
                execution_status: "running",
              }),
            ],
            next_cursor: null,
            total_count: 1,
          },
        ],
        pageParams: [undefined],
      }
      view.queryClient.setQueryData(["conversations", "sidebar"], {
        ...seededSidebar,
      })

      await fixture.resolveRefresh()
      await waitForMutationSettled(oldMutation)

      expect(
        fixture.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/new-login-refresh-a/turns"
        )
      ).toHaveLength(1)
      expect(
        fixture.requests.filter(
          (request) => request.path === "/api/v1/auth/refresh"
        )
      ).toHaveLength(1)
      expect(getAccessToken()).toBe(nextToken)
      expect(
        view.queryClient.getQueryData(["conversations", "sidebar"])
      ).toEqual(seededSidebar)
      expect(
        readLocalConversationDraft(window.localStorage, authUserB.id, "new")
          .input
      ).toBe("新登录保持的草稿")
    })

    it("retries an authenticated first turn once after a same-session refresh", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-same-session-refresh", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferRefresh: true,
        turnUnauthorizedOnce: true,
        createResponse: created,
        conversations: { [created.id]: created },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000063")
      const input = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(input, "同会话刷新后只重试一次首轮")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createResponses).toHaveLength(1))
      await fixture.resolveCreate(0, json(created))

      const turnRequests = () =>
        fixture.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path ===
              "/api/v1/conversations/new-same-session-refresh/turns"
        )
      await waitFor(() => expect(turnRequests()).toHaveLength(1))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )
      await fixture.resolveRefresh()
      await waitFor(() => expect(turnRequests()).toHaveLength(2))

      expect(turnRequests()[0]?.body).toMatchObject({
        input_text: "同会话刷新后只重试一次首轮",
      })
      expect(turnRequests()[1]?.body).toMatchObject({
        input_text: "同会话刷新后只重试一次首轮",
      })
      expect(
        (turnRequests()[0]?.body as { idempotency_key?: string })
          .idempotency_key
      ).toBe(
        (turnRequests()[1]?.body as { idempotency_key?: string })
          .idempotency_key
      )
      expect(getAccessToken()).toBe(refreshedAccessToken)
      expect(fixture.createdBodies).toHaveLength(1)
    })

    it("keeps a byte-identical draft typed on the new route after an abandoned send resolves", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail("new-identical-draft-a", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        createResponse: createdA,
        conversations: { [createdA.id]: createdA },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000064")
      const firstInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(firstInput, "完全相同的新草稿")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createResponses).toHaveLength(1))

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await interaction.click(
        screen.getByRole("button", { name: "返回新任务" })
      )
      const editableInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.clear(editableInput)
      await interaction.type(editableInput, "完全相同的新草稿")
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("完全相同的新草稿")

      await fixture.resolveCreate(0, json(createdA))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-identical-draft-a/turns"
          )
        ).toHaveLength(1)
      )
      expect(fixture.turnStarts).toHaveLength(1)

      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new"
      )
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
        "完全相同的新草稿"
      )
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("完全相同的新草稿")
      expect(
        readLocalConversationDraft(
          window.localStorage,
          "user-1",
          "new-identical-draft-a"
        ).input
      ).toBe("完全相同的新草稿")
      expect(fixture.createdBodies).toHaveLength(1)
      expect(
        fixture.requests.filter((request) => request.path.endsWith("/turns"))
      ).toHaveLength(1)
      await fixture.resolveTurn(
        0,
        json(
          {
            accepted: true,
            status: "starting",
            turn_id: "30000000-0000-4000-8000-000000000094",
          },
          202
        )
      )
    })

    it("keeps a different draft typed on the new route after an abandoned Goal resolves", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail("new-abandoned-goal-a", "cloud")
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        createResponse: createdA,
        conversations: { [createdA.id]: createdA },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000065")
      const firstInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.type(firstInput, "被放弃的目标")
      const addMenu = await screen.findByRole("button", { name: "添加内容" })
      await waitFor(() => expect(addMenu).toBeEnabled())
      await interaction.click(addMenu)
      await interaction.click(screen.getByRole("option", { name: /目标/u }))
      const send = screen.getByRole("button", { name: "发送" })
      await waitFor(() => expect(send).toBeEnabled())
      await interaction.click(send)
      await waitFor(() => expect(fixture.createResponses).toHaveLength(1))

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await interaction.click(
        screen.getByRole("button", { name: "返回新任务" })
      )
      const editableInput = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await interaction.clear(editableInput)
      await interaction.type(editableInput, "返回后新输入的目标草稿")
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("返回后新输入的目标草稿")

      await fixture.resolveCreate(0, json(createdA))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path === "/api/v1/conversations/new-abandoned-goal-a/goal"
          )
        ).toHaveLength(1)
      )

      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new"
      )
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("返回后新输入的目标草稿")
      expect(
        readLocalConversationDraft(
          window.localStorage,
          "user-1",
          "new-abandoned-goal-a"
        ).input
      ).toBe("被放弃的目标")
      expect(fixture.createdBodies).toHaveLength(1)
      await fixture.resolveTurn(
        0,
        json(
          {
            accepted: true,
            status: "starting",
            turn_id: "30000000-0000-4000-8000-000000000095",
          },
          202
        )
      )
    })

    it.each([
      {
        name: "send",
        endpoint: "/turns",
        goal: false,
        conversationId: "new-first-turn-refused",
        prewarmId: "71000000-0000-4000-8000-000000000030",
        inputValue: "首轮拒绝后保留输入",
      },
      {
        name: "Goal",
        endpoint: "/goal",
        goal: true,
        conversationId: "new-goal-refused",
        prewarmId: "71000000-0000-4000-8000-000000000031",
        inputValue: "目标拒绝后保留输入",
      },
    ])(
      "restores a refused first $name submission after the Mac route is promoted",
      async ({ endpoint, goal, conversationId, prewarmId, inputValue }) => {
        deviceStatusMock.setData(readyDeviceStatus())
        const created = conversationDetail(conversationId, "cloud")
        const fixture = installApi({
          deferCreate: true,
          deferTurnStart: true,
          createResponse: created,
          conversations: { [conversationId]: created },
        })
        const interaction = userEvent.setup()
        renderConversationPage("/conversations/new", undefined, {
          navigation: true,
          bootstrap: desktopRollout({
            local_computer: true,
            cloud_target: true,
          }),
        })

        await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
        await fixture.resolvePrewarm(0, prewarmId)
        const input = await screen.findByRole("textbox", { name: "任务输入框" })
        await interaction.type(input, inputValue)
        if (goal) {
          const addMenu = await screen.findByRole("button", {
            name: "添加内容",
          })
          await waitFor(() => expect(addMenu).toBeEnabled())
          await interaction.click(addMenu)
          await interaction.click(screen.getByRole("option", { name: /目标/u }))
          await waitFor(() =>
            expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
          )
        }

        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => {
          expect(fixture.createdBodies).toHaveLength(1)
          expect(fixture.createResponses).toHaveLength(1)
        })
        await fixture.resolveCreate()

        await waitFor(() =>
          expect(screen.getByTestId("conversation-route")).toHaveTextContent(
            `/conversations/${conversationId}`
          )
        )
        expect(
          screen.getByRole("heading", { level: 1, name: "测试任务" })
        ).toBeVisible()
        const turnRequests = () =>
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                `/api/v1/conversations/${conversationId}${endpoint}`
          )
        expect(turnRequests()).toHaveLength(1)

        await fixture.resolveTurn(0, errorEnvelope(503, "RUNNER_UNAVAILABLE"))

        expect(
          await screen.findByText(toastText("执行服务暂不可用，请稍后重试。"))
        ).toBeVisible()
        expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
          inputValue
        )
        expect(screen.getByTestId("conversation-route")).toHaveTextContent(
          `/conversations/${conversationId}`
        )
        expect(fixture.createdBodies).toHaveLength(1)
        expect(turnRequests()).toHaveLength(1)
      }
    )

    it("does not reuse a changed route for a paused fresh Mac task", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const other = conversationDetail("other", "cloud")
      const fixture = installApi({
        conversations: { other },
        createResponse: conversationDetail("new-paused-route", "cloud"),
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000022")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "只属于原任务")

      onlineManager.setOnline(false)
      try {
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
          expect(paused[0]?.state.variables).toMatchObject({
            input: "只属于原任务",
          })
        })

        await interaction.click(
          screen.getByRole("button", { name: "切换任务" })
        )
        expect(
          await screen.findByRole("heading", { name: "未命名任务" })
        ).toBeVisible()

        onlineManager.setOnline(true)
        await waitFor(() => {
          const mutations = view.queryClient.getMutationCache().getAll()
          expect(mutations.some((mutation) => mutation.state.isPaused)).toBe(
            false
          )
          expect(
            mutations.every((mutation) => mutation.state.status !== "pending")
          ).toBe(true)
        })

        expect(fixture.createdBodies).toHaveLength(0)
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" &&
              request.path === "/api/v1/conversations/other/turns"
          )
        ).toBe(false)
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("does not create a paused fresh Mac task after the account changes", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-paused-owner", "cloud")
      const fixture = installApi({
        createResponse: created,
        conversations: { "new-paused-owner": created },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        accountSwitch: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000023")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "切换账号前提交")

      onlineManager.setOnline(false)
      try {
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
          expect(paused[0]?.state.variables).toMatchObject({
            input: "切换账号前提交",
          })
        })

        await interaction.click(
          screen.getByRole("button", { name: "切换账号" })
        )

        onlineManager.setOnline(true)
        await waitFor(() => {
          const mutations = view.queryClient.getMutationCache().getAll()
          expect(mutations.some((mutation) => mutation.state.isPaused)).toBe(
            false
          )
          expect(
            mutations.every((mutation) => mutation.state.status !== "pending")
          ).toBe(true)
        })

        expect(fixture.createdBodies).toHaveLength(0)
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" && request.path.endsWith("/turns")
          )
        ).toBe(false)
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("does not create a paused fresh Mac Goal after leaving for Settings", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(
        0,
        "71000000-0000-4000-8000-000000000026"
      )
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "暂停的目标")
      const addMenu = await screen.findByRole("button", { name: "添加内容" })
      await waitFor(() => expect(addMenu).toBeEnabled())
      await interaction.click(addMenu)
      await interaction.click(screen.getByRole("option", { name: /目标/u }))
      const send = screen.getByRole("button", { name: "发送" })
      await waitFor(() => expect(send).toBeEnabled())

      onlineManager.setOnline(false)
      try {
        await interaction.click(send)
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
          expect(paused[0]?.state.variables).toMatchObject({
            input: "暂停的目标",
          })
        })
        expect(fixture.createdBodies).toHaveLength(0)

        await interaction.click(
          screen.getByRole("button", { name: "打开设置" })
        )
        expect(await screen.findByText("设置页面")).toBeVisible()

        onlineManager.setOnline(true)
        await waitFor(() => {
          const mutations = view.queryClient.getMutationCache().getAll()
          expect(mutations.some((mutation) => mutation.state.isPaused)).toBe(
            false
          )
          expect(
            mutations.every((mutation) => mutation.state.status !== "pending")
          ).toBe(true)
        })

        expect(fixture.createdBodies).toHaveLength(0)
        expect(screen.getByText("设置页面")).toBeVisible()
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" && request.path.endsWith("/goal")
          )
        ).toBe(false)
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("does not upload a paused fresh Mac attachment after leaving for Settings", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(
        0,
        "71000000-0000-4000-8000-000000000027"
      )
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "附件草稿")
      const attachInput = screen.getByLabelText("添加附件")
      await waitFor(() => expect(attachInput).toBeEnabled())

      onlineManager.setOnline(false)
      try {
        await interaction.upload(
          attachInput,
          new File(["hello"], "notes.txt", { type: "text/plain" })
        )
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
        })
        expect(fixture.createdBodies).toHaveLength(0)

        await interaction.click(
          screen.getByRole("button", { name: "打开设置" })
        )
        expect(await screen.findByText("设置页面")).toBeVisible()

        onlineManager.setOnline(true)
        await waitFor(() => {
          const mutations = view.queryClient.getMutationCache().getAll()
          expect(mutations.some((mutation) => mutation.state.isPaused)).toBe(
            false
          )
          expect(
            mutations.every((mutation) => mutation.state.status !== "pending")
          ).toBe(true)
        })

        expect(fixture.createdBodies).toHaveLength(0)
        expect(screen.getByText("设置页面")).toBeVisible()
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" &&
              /^\/api\/v1\/conversations\/[^/]+\/attachments$/u.test(
                request.path
              )
          )
        ).toBe(false)
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("does not reference a paused fresh Mac file after leaving for Settings", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({
        referenceableFiles: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            conversation_id: "20000000-0000-4000-8000-000000000002",
            kind: "artifact",
            filename: "预算说明.pdf",
            mime_type: "application/pdf",
            size_bytes: 12,
            created_at: "2026-08-10T08:30:00.000Z",
            task: {
              id: "20000000-0000-4000-8000-000000000002",
              title: "上月预算",
              archive_status: "archived",
            },
          },
        ],
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(
        0,
        "71000000-0000-4000-8000-000000000028"
      )
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "引用草稿")
      const addMenu = await screen.findByRole("button", { name: "添加内容" })
      await waitFor(() => expect(addMenu).toBeEnabled())
      await interaction.click(addMenu)
      await interaction.click(screen.getByRole("option", { name: "引用文件" }))
      const popover = await screen.findByRole("dialog", {
        name: "引用历史任务文件",
      })
      await interaction.click(
        await within(popover).findByRole("option", {
          name: "选择 上月预算 中的 预算说明.pdf",
        })
      )

      onlineManager.setOnline(false)
      try {
        await interaction.click(
          within(popover).getByRole("button", { name: "添加所选文件（1）" })
        )
        await waitFor(() => {
          const paused = view.queryClient
            .getMutationCache()
            .getAll()
            .filter((mutation) => mutation.state.isPaused)
          expect(paused).toHaveLength(1)
        })
        expect(fixture.createdBodies).toHaveLength(0)

        await interaction.click(
          screen.getByRole("button", { name: "打开设置" })
        )
        expect(await screen.findByText("设置页面")).toBeVisible()

        onlineManager.setOnline(true)
        await waitFor(() => {
          const mutations = view.queryClient.getMutationCache().getAll()
          expect(mutations.some((mutation) => mutation.state.isPaused)).toBe(
            false
          )
          expect(
            mutations.every((mutation) => mutation.state.status !== "pending")
          ).toBe(true)
        })

        expect(fixture.createdBodies).toHaveLength(0)
        expect(screen.getByText("设置页面")).toBeVisible()
        expect(
          fixture.requests.some(
            (request) =>
              request.method === "POST" &&
              request.path.endsWith("/attachments/references")
          )
        ).toBe(false)
      } finally {
        onlineManager.setOnline(true)
      }
    })

    it("does not retry a create after the task page unmounts during the auth refresh", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({
        deferRefresh: true,
        createUnauthorizedOnce: true,
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "刷新期间离开页面")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await fixture.resolveRefresh()

      expect(screen.getByText("设置页面")).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(1)
      expect(getAccessToken()).toBe(refreshedAccessToken)
      expect(
        readLocalConversationDraft(window.localStorage, "user-1", "new").input
      ).toBe("刷新期间离开页面")
    })

    it("promotes a fresh Mac cloud task whose accepted create completes after the rollout closes", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-cloud-rollout-success", "cloud")
      const fixture = installApi({
        deferCreate: true,
        createResponse: created,
        conversations: { "new-cloud-rollout-success": created },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000024")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "成功创建后关闭云入口")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(1)
        expect(fixture.createResponses).toHaveLength(1)
      })

      view.setBootstrap(desktopRollout({ cloud_target: false }))
      await fixture.resolveCreate()

      expect(
        await screen.findByRole("heading", { level: 1, name: "测试任务" })
      ).toBeVisible()
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-cloud-rollout-success/turns"
          )
        ).toHaveLength(1)
      )
      expect(
        fixture.requests.find(
          (request) =>
            request.method === "POST" &&
            request.path ===
              "/api/v1/conversations/new-cloud-rollout-success/turns"
        )?.body
      ).toMatchObject({ input_text: "成功创建后关闭云入口" })
      expect(fixture.createdBodies).toHaveLength(1)
      expect(fixture.prewarms).toHaveLength(1)
    })

    it("keeps an accepted fresh Mac create after the task page navigates away", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-cloud-navigation-success", "cloud")
      const fixture = installApi({
        deferCreate: true,
        createResponse: created,
        conversations: { "new-cloud-navigation-success": created },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000029")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "离开后仍完成任务")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => {
        expect(fixture.createdBodies).toHaveLength(1)
        expect(fixture.createResponses).toHaveLength(1)
      })

      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await fixture.resolveCreate()

      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-cloud-navigation-success/turns"
          )
        ).toHaveLength(1)
      )
      expect(
        fixture.requests.find(
          (request) =>
            request.method === "POST" &&
            request.path ===
              "/api/v1/conversations/new-cloud-navigation-success/turns"
        )?.body
      ).toMatchObject({ input_text: "离开后仍完成任务" })
      expect(screen.getByText("设置页面")).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(1)
    })

    it("stops the post-refresh prewarm retry when the rollout closes the target", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferRefresh: true })
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.respondPrewarm(0, errorEnvelope(401, "AUTH_REQUIRED"))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      act(() => {
        view.queryClient.setQueryData(
          bootstrapQueryKey,
          desktopRollout({ cloud_target: false })
        )
      })
      await fixture.resolveRefresh()

      await waitFor(() =>
        expect(getAccessToken()).toBe(refreshedAccessToken)
      )
      expect(fixture.prewarms).toHaveLength(1)
      expect(
        screen.getByRole("textbox", { name: "任务输入框" })
      ).toBeVisible()
    })

    it("rechecks the rollout at the actual prewarm start, not only at render", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferModelPreference: true })
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      expect(fixture.prewarms).toHaveLength(0)
      // The cache flips before the prewarm is scheduled; the context snapshot
      // still says the cloud entry is open, so only the start guard can stop it.
      act(() => {
        view.queryClient.setQueryData(
          bootstrapQueryKey,
          desktopRollout({ cloud_target: false })
        )
      })
      await fixture.resolveModelPreference()
      expect(fixture.prewarms).toHaveLength(0)

      // The same guard accepts the write once the rollout reopens.
      act(() => {
        view.queryClient.setQueryData(
          bootstrapQueryKey,
          desktopRollout({ cloud_target: true })
        )
      })
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(
        0,
        "71000000-0000-4000-8000-000000000012"
      )
    })

    it("claims an in-flight prewarm that succeeds while the cloud entry is closed", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const prewarmedId = "71000000-0000-4000-8000-000000000025"
      const created = conversationDetail("new-prewarm-rollout-success", "cloud")
      const fixture = installApi({
        createResponse: created,
        conversations: { "new-prewarm-rollout-success": created },
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      view.setBootstrap(desktopRollout({ cloud_target: false }))
      await fixture.resolvePrewarm(0, prewarmedId)
      view.setBootstrap(
        desktopRollout({ local_computer: true, cloud_target: true })
      )

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "使用已完成的预热")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      expect(fixture.createdBodies[0]).toMatchObject({
        prewarmed_conversation_id: prewarmedId,
      })
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.path ===
                "/api/v1/conversations/new-prewarm-rollout-success/turns"
          )
        ).toHaveLength(1)
      )
      expect(fixture.prewarms).toHaveLength(1)
      expect(fixture.createdBodies).toHaveLength(1)
    })

    it("does not retry a prewarm after switching to the local target during the auth refresh", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferRefresh: true })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.respondPrewarm(0, errorEnvelope(401, "AUTH_REQUIRED"))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      // The cloud entry stays open, but the scope is no longer cloud.
      await selectLocalTarget(interaction)
      expect(
        screen.getByRole("button", { name: /运行位置/u })
      ).toHaveTextContent("本地电脑")
      await fixture.resolveRefresh()
      await waitFor(() => expect(getAccessToken()).toBe(refreshedAccessToken))

      expect(fixture.prewarms).toHaveLength(1)
    })

    it("does not retry a prewarm after the task page unmounts during the auth refresh", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferRefresh: true })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.respondPrewarm(0, errorEnvelope(401, "AUTH_REQUIRED"))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      // The gated page is gone, so its stale scope must not warm a cloud
      // reservation after the refresh completes.
      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()
      await fixture.resolveRefresh()
      await waitFor(() => expect(getAccessToken()).toBe(refreshedAccessToken))

      expect(fixture.prewarms).toHaveLength(1)
    })

    it("does not retry a prewarm after foreground creation claims the reservation during the auth refresh", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferRefresh: true })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.respondPrewarm(0, errorEnvelope(401, "AUTH_REQUIRED"))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      // The foreground submission claims the page before its own create POST.
      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "刷新期间提交")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))

      await fixture.resolveRefresh()
      await waitFor(() => expect(getAccessToken()).toBe(refreshedAccessToken))

      expect(fixture.createdBodies).toHaveLength(1)
      expect(fixture.prewarms).toHaveLength(1)
    })

    it("retries a prewarm after an authenticated refresh when the scope is unchanged", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({ deferRefresh: true })
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.respondPrewarm(0, errorEnvelope(401, "AUTH_REQUIRED"))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/refresh"
          )
        ).toHaveLength(1)
      )

      await fixture.resolveRefresh()
      await waitFor(() => expect(fixture.prewarms).toHaveLength(2))
      expect(fixture.prewarms[1]?.body).toEqual(fixture.prewarms[0]?.body)
      await fixture.resolvePrewarm(
        1,
        "71000000-0000-4000-8000-000000000013"
      )
    })

    it("applies the same create gate to an attachment upload", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({ cloud_target: false }),
      })

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "附件草稿")
      const attachInput = screen.getByLabelText("添加附件")
      await waitFor(() => expect(attachInput).toBeEnabled())
      await interaction.upload(
        attachInput,
        new File(["hello"], "notes.txt", { type: "text/plain" })
      )

      expect(
        await screen.findByText(toastText(zh.cloudTargetUnavailable))
      ).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("附件草稿")
    })

    it("applies the same create gate to a reference operation", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi({
        referenceableFiles: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            conversation_id: "20000000-0000-4000-8000-000000000002",
            kind: "artifact",
            filename: "预算说明.pdf",
            mime_type: "application/pdf",
            size_bytes: 12,
            created_at: "2026-08-10T08:30:00.000Z",
            task: {
              id: "20000000-0000-4000-8000-000000000002",
              title: "上月预算",
              archive_status: "archived",
            },
          },
        ],
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({ cloud_target: false }),
      })

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "引用草稿")
      const addMenu = await screen.findByRole("button", { name: "添加内容" })
      await waitFor(() => expect(addMenu).toBeEnabled())
      await interaction.click(addMenu)
      await interaction.click(screen.getByRole("option", { name: "引用文件" }))
      const popover = await screen.findByRole("dialog", {
        name: "引用历史任务文件",
      })
      await interaction.click(
        await within(popover).findByRole("option", {
          name: "选择 上月预算 中的 预算说明.pdf",
        })
      )
      await interaction.click(
        within(popover).getByRole("button", { name: "添加所选文件（1）" })
      )

      expect(
        await within(popover).findByText(zh.cloudTargetUnavailable)
      ).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("引用草稿")
    })

    it("applies the same create gate to a Goal start", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({ cloud_target: false }),
      })

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "目标草稿")
      const addMenu = await screen.findByRole("button", { name: "添加内容" })
      await waitFor(() => expect(addMenu).toBeEnabled())
      await interaction.click(addMenu)
      await interaction.click(screen.getByRole("option", { name: /目标/u }))
      const send = screen.getByRole("button", { name: "发送" })
      await waitFor(() => expect(send).toBeEnabled())
      await interaction.click(send)

      expect(
        await screen.findByText(toastText(zh.cloudTargetUnavailable))
      ).toBeVisible()
      expect(fixture.createdBodies).toHaveLength(0)
      expect(input).toHaveValue("目标草稿")
    })

    it("keeps ordinary Web creation unchanged when both rollout flags are off", async () => {
      hostMock.mac = false
      const fixture = installApi()
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        bootstrap: desktopRollout({
          local_computer: false,
          cloud_target: false,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(
        0,
        "71000000-0000-4000-8000-000000000011"
      )
      expect(screen.queryByText(zh.noTargetAvailable)).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /运行位置/u })
      ).not.toBeInTheDocument()

      const input = screen.getByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "普通 Web 不受影响")
      await interaction.click(screen.getByRole("button", { name: "发送" }))

      await waitFor(() => expect(fixture.createdBodies).toHaveLength(1))
      expect(fixture.createdBodies[0]).toEqual({
        collaboration_mode: "default",
        prewarmed_conversation_id: "71000000-0000-4000-8000-000000000011",
        project_id: null,
      })
    })

    it("keeps a legacy stored task without execution_target while the rollout is closed", async () => {
      hostMock.mac = true
      const fixture = installApi({
        conversations: { "task-1": conversationDetail("task-1") },
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/task-1", undefined, {
        bootstrap: desktopRollout({
          local_computer: false,
          cloud_target: false,
        }),
      })

      expect(screen.queryByText(zh.noTargetAvailable)).not.toBeInTheDocument()
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "旧任务仍可继续")
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
      expect(fixture.createdBodies).toHaveLength(0)
      expect(readDesktopDeviceMock).not.toHaveBeenCalled()
    })
  })

  describe("login session restore and replacement boundaries", () => {
    function createRaceQueryClient() {
      return new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
    }

    it("cold-restores a refresh session and verifies the user without rotating the login generation", async () => {
      setAccessToken(null)
      const initialBoundary = getLoginSessionBoundary()
      const fixture = installApi({ authUser: () => authUserA })
      const queryClient = createRaceQueryClient()

      renderAuthOnlyProvider(queryClient, <AuthOnlyProbe />)

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "authenticated"
        )
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-1")
      expect(getLoginSessionBoundary()).toBe(initialBoundary)
      expect(getAccessToken()).toBe(refreshedAccessToken)
      expect(
        fixture.requests.filter(
          (request) => request.path === "/api/v1/auth/refresh"
        )
      ).toHaveLength(1)
    })

    it("reports a cold-restored /me protocol failure instead of leaving loading", async () => {
      setAccessToken(null)
      const initialBoundary = getLoginSessionBoundary()
      installApi({
        authUser: () => authUserA,
        meResponses: [json({})],
      })
      const queryClient = createRaceQueryClient()

      renderAuthOnlyProvider(queryClient, <AuthOnlyProbe />)

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "error"
        )
      )
      expect(getLoginSessionBoundary()).toBe(initialBoundary)
      expect(getAccessToken()).toBe(refreshedAccessToken)
    })

    it("recovers a cold-restored /me retryable failure through the bounded restore retry", async () => {
      setAccessToken(null)
      const initialBoundary = getLoginSessionBoundary()
      const fixture = installApi({
        authUser: () => authUserA,
        meResponses: [
          errorEnvelope(503, "SERVICE_TEMPORARILY_UNAVAILABLE"),
          json(authUserA),
        ],
      })
      const queryClient = createRaceQueryClient()

      renderAuthOnlyProvider(queryClient, <AuthOnlyProbe />)

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "loading"
        )
      )
      await waitFor(
        () =>
          expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
            "authenticated"
          ),
        { timeout: 4_000 }
      )
      expect(getLoginSessionBoundary()).toBe(initialBoundary)
      expect(getAccessToken()).toBe(refreshedAccessToken)
      expect(
        fixture.requests.filter(
          (request) => request.path === "/api/v1/auth/refresh"
        )
      ).toHaveLength(1)
      expect(
        fixture.requests.filter((request) => request.path === "/api/v1/me")
      ).toHaveLength(2)
    })

    it("keeps B's refresh and credentials separate from A's held refresh", async () => {
      const race = installRefreshRaceApi()
      setAccessToken(race.accessTokenA, realSessionExpiry)
      const queryClient = createRaceQueryClient()
      const logicalRequests: {
        path: string
        promise: Promise<unknown>
        settled: boolean
        value?: unknown
        error?: unknown
      }[] = []
      const recordRequest = (path: string, promise: Promise<unknown>) => {
        const entry = {
          path,
          promise,
          settled: false,
        } as (typeof logicalRequests)[number]
        promise.then(
          (value) => {
            entry.value = value
            entry.settled = true
          },
          (error) => {
            entry.error = error
            entry.settled = true
          }
        )
        logicalRequests.push(entry)
      }

      renderAuthOnlyProvider(
        queryClient,
        <AuthOnlyProbe
          nextSession={{
            access_token: race.accessTokenB,
            access_token_expires_at: realSessionExpiry,
          }}
          onRequest={recordRequest}
        />
      )

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "authenticated"
        )
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-1")
      queryClient.setQueryData(["conversation", "account-a"], {
        title: "account A detail",
      })

      fireEvent.click(screen.getByRole("button", { name: "start A request" }))
      await waitFor(() => expect(race.refreshRequests).toHaveLength(1))
      expect(race.refreshRequests[0]?.authorization).toBeNull()
      expect(logicalRequests[0]?.settled).toBe(false)

      fireEvent.click(screen.getByRole("button", { name: "sign out login" }))
      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "anonymous"
        )
      )
      fireEvent.click(screen.getByRole("button", { name: "accept next login" }))
      await waitFor(() =>
        expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      )
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "authenticated"
      )
      expect(getAccessToken()).toBe(race.accessTokenB)
      queryClient.setQueryData(["conversation", "account-b"], {
        title: "account B detail",
      })

      fireEvent.click(screen.getByRole("button", { name: "start B request" }))
      expect(race.refreshRequests).toHaveLength(1)
      expect(logicalRequests[1]?.settled).toBe(false)

      await race.resolveRefreshA()
      await waitFor(() => expect(logicalRequests[0]?.settled).toBe(true))
      expect(logicalRequests[0]?.error).toMatchObject({
        status: 401,
        errorCode: "AUTH_SESSION_EXPIRED",
      })
      expect(
        race.raceRequests.filter((request) => request.path === "/api/v1/race/a")
      ).toHaveLength(1)
      await waitFor(() => expect(race.refreshRequests).toHaveLength(2))
      expect(race.refreshRequests[1]?.authorization).toBeNull()
      expect(logicalRequests[1]?.settled).toBe(false)
      expect(getAccessToken()).toBe(race.accessTokenB)
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      expect(queryClient.getQueryData(["conversation", "account-b"])).toEqual({
        title: "account B detail",
      })

      const coalescedB = refreshSession(
        race.accessTokenB,
        getLoginSessionBoundary()
      ).catch((error: unknown) => error)
      expect(race.refreshRequests).toHaveLength(2)

      await race.resolveRefreshB()
      await waitFor(() => expect(logicalRequests[1]?.settled).toBe(true))
      expect(logicalRequests[1]?.value).toEqual({ ok: true })
      await expect(coalescedB).resolves.toMatchObject({
        access_token: race.refreshedTokenB,
      })
      const bAttempts = race.raceRequests.filter(
        (request) => request.path === "/api/v1/race/b"
      )
      expect(bAttempts).toHaveLength(2)
      expect(bAttempts[1]?.authorization).toBe(`Bearer ${race.refreshedTokenB}`)
      expect(getAccessToken()).toBe(race.refreshedTokenB)
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "authenticated"
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      expect(queryClient.getQueryData(["conversation", "account-b"])).toEqual({
        title: "account B detail",
      })
    })

    it("does not commit a successful first-turn receipt after a replacement login", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const createdA = conversationDetail(
        "new-success-login-boundary-a",
        "cloud"
      )
      let activeAuthUser: User = authUserA
      const nextToken = "post-logout-success-receipt-token"
      const fixture = installApi({
        deferCreate: true,
        deferTurnStart: true,
        createResponse: createdA,
        conversations: { [createdA.id]: createdA },
        authUser: () => activeAuthUser,
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
        realAuth: {
          nextSession: {
            access_token: nextToken,
            access_token_expires_at: realSessionExpiry,
          },
          beforeAccept: () => {
            activeAuthUser = authUserB
          },
        },
      })

      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "authenticated"
        )
      )
      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000067")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "登录替换后不提交成功回执")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createResponses).toHaveLength(1))
      const oldMutation = findSendMutation(
        view.queryClient,
        "登录替换后不提交成功回执"
      )
      await fixture.resolveCreate(0, json(createdA))
      await waitFor(() => expect(fixture.turnStarts).toHaveLength(1))
      await interaction.click(screen.getByRole("button", { name: "打开设置" }))
      expect(await screen.findByText("设置页面")).toBeVisible()

      await interaction.click(
        screen.getByRole("button", { name: "建立新会话" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("session-user")).toHaveTextContent("user-2")
      )

      await fixture.resolveTurn(
        0,
        json(
          {
            accepted: true,
            status: "starting",
            turn_id: "30000000-0000-4000-8000-000000000087",
          },
          202
        )
      )
      await waitForMutationSettled(oldMutation)

      expect(
        fixture.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path ===
              "/api/v1/conversations/new-success-login-boundary-a/turns"
        )
      ).toHaveLength(1)
      expect(
        getPendingConversationTurnSubmission(view.queryClient, createdA.id)
      ).toMatchObject({
        conversationId: createdA.id,
        message: { content: "登录替换后不提交成功回执" },
      })
      expect(
        getPendingConversationTurnSubmission(view.queryClient, createdA.id)
      ).not.toHaveProperty("turnId")
      expect(
        view.queryClient.getQueryData([
          "conversation",
          createdA.id,
          "pending-execution",
        ])
      ).toEqual({ turnId: null })
      expect(getAccessToken()).toBe(nextToken)
      expect(screen.getByTestId("session-status")).toHaveTextContent(
        "authenticated"
      )
      expect(screen.getByTestId("session-user")).toHaveTextContent("user-2")
    })

    it.each([
      {
        name: "a different account",
        nextUser: authUserB,
        nextToken: "detail-replacement-account-b-token",
      },
      {
        name: "the same account signing back in",
        nextUser: authUserA,
        nextToken: "detail-same-account-login-token",
      },
    ])(
      "does not overwrite or remove B's fresh detail after $name replaces A with a held refresh",
      async ({ nextUser, nextToken }) => {
        deviceStatusMock.setData(readyDeviceStatus())
        const conversationId = "new-detail-login-boundary-a"
        const initialDetail = conversationDetail(conversationId, "cloud")
        const staleDetail = conversationDetail(conversationId, "cloud", {
          title: "过期登录返回的任务",
          starting_turn: {
            turn_id: "30000000-0000-4000-8000-000000000088",
            task_kind: "turn",
            idempotency_key: "stale-login-start",
            input_text: "过期登录的首轮",
            created_at: "2026-11-21T00:00:00.000Z",
            message_display: null,
            attachments: [],
          },
        })
        const freshDetail = conversationDetail(conversationId, "cloud", {
          title: "新登录重新打开的任务",
        })
        let activeAuthUser: User = authUserA
        const fixture = installApi({
          deferCreate: true,
          deferTurnStart: true,
          createResponse: initialDetail,
          conversations: { [conversationId]: initialDetail },
          authUser: () => activeAuthUser,
        })
        const interaction = userEvent.setup()
        const view = renderConversationPage("/conversations/new", undefined, {
          navigation: true,
          bootstrap: desktopRollout({
            local_computer: true,
            cloud_target: true,
          }),
          realAuth: {
            nextSession: {
              access_token: nextToken,
              access_token_expires_at: realSessionExpiry,
            },
            beforeAccept: () => {
              activeAuthUser = nextUser
            },
          },
        })

        await waitFor(() =>
          expect(screen.getByTestId("session-status")).toHaveTextContent(
            "authenticated"
          )
        )
        await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
        await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000066")
        const input = await screen.findByRole("textbox", {
          name: "任务输入框",
        })
        await interaction.type(input, "登录后详情的边界")
        await interaction.click(screen.getByRole("button", { name: "发送" }))
        await waitFor(() => expect(fixture.createResponses).toHaveLength(1))
        await fixture.resolveCreate(0, json(initialDetail))
        await waitFor(() =>
          expect(screen.getByTestId("conversation-route")).toHaveTextContent(
            `/conversations/${conversationId}`
          )
        )
        expect(
          await screen.findByRole("heading", { name: "测试任务" })
        ).toBeVisible()
        await waitFor(() => expect(fixture.turnStarts).toHaveLength(1))
        fixture.deferFollowingConversationDetails()
        await fixture.resolveTurn(
          0,
          json(
            {
              accepted: true,
              status: "starting",
              turn_id: "30000000-0000-4000-8000-000000000089",
            },
            202
          )
        )
        await waitFor(() =>
          expect(fixture.conversationDetailResponses.length).toBeGreaterThan(0)
        )
        const detailGets = () =>
          fixture.requests.filter(
            (request) =>
              request.method === "GET" &&
              request.path === `/api/v1/conversations/${conversationId}`
          )
        // The gated send refresh and any ordinary read still use the login
        // boundary that was current when they started. None of them can
        // become B's fresh detail after the login is replaced.
        const heldDetailIndex = 0
        const heldLoginSessionBoundary = getLoginSessionBoundary()
        expect(fixture.conversationDetailResponses.length).toBeGreaterThan(
          heldDetailIndex
        )
        expect(detailGets().length).toBeGreaterThan(0)
        expect(
          detailGets().every(
            (request) =>
              request.authorization === "Bearer execution-target-access-token"
          )
        ).toBe(true)

        await interaction.click(
          screen.getByRole("button", { name: "建立新会话" })
        )
        await waitFor(() =>
          expect(screen.getByTestId("session-user")).toHaveTextContent(
            nextUser.id
          )
        )
        expect(getAccessToken()).toBe(nextToken)
        expect(getLoginSessionBoundary()).not.toBe(heldLoginSessionBoundary)
        expect(fixture.conversationDetailResponses.length).toBeGreaterThan(
          heldDetailIndex
        )
        expect(
          detailGets().every(
            (request) =>
              request.authorization === "Bearer execution-target-access-token"
          )
        ).toBe(true)

        // A is still holding its gated detail response. B's fresh detail must
        // come from a read that starts under the replacement login; an A
        // request that was already in flight is never promoted to B.
        const preReplacementDetailCount =
          fixture.conversationDetailResponses.length
        expect(preReplacementDetailCount).toBeGreaterThan(heldDetailIndex)
        const freshDetailIndex = preReplacementDetailCount
        const freshRead = view.queryClient.refetchQueries({
          queryKey: ["conversation", conversationId],
          exact: true,
        })
        await waitFor(() =>
          expect(fixture.conversationDetailResponses.length).toBe(
            freshDetailIndex + 1
          )
        )
        expect(detailGets().at(-1)?.authorization).toBe(`Bearer ${nextToken}`)
        await fixture.resolveConversationDetail(
          freshDetailIndex,
          json(freshDetail)
        )
        await freshRead
        expect(
          view.queryClient.getQueryData(["conversation", conversationId])
        ).toMatchObject({
          id: conversationId,
          title: "新登录重新打开的任务",
        })

        view.queryClient.setQueryData(
          ["conversation", conversationId, "pending-turn-submission"],
          null
        )
        view.queryClient.setQueryData(
          ["conversation", conversationId, "pending-execution"],
          null
        )
        expect(
          fixture.conversationDetailResponses[heldDetailIndex]
        ).toBeDefined()
        for (let index = 0; index < preReplacementDetailCount; index += 1) {
          await fixture.resolveConversationDetail(index, json(staleDetail))
        }

        const freshCachedDetail = view.queryClient.getQueryData<
          typeof freshDetail
        >(["conversation", conversationId])
        expect(freshCachedDetail).toMatchObject({
          id: conversationId,
          title: "新登录重新打开的任务",
        })
        expect(freshCachedDetail).not.toHaveProperty("starting_turn")
        expect(
          getPendingConversationTurnSubmission(view.queryClient, conversationId)
        ).toBeNull()
        expect(
          view.queryClient.getQueryData([
            "conversation",
            conversationId,
            "pending-execution",
          ])
        ).toBeNull()
        expect(getAccessToken()).toBe(nextToken)
        expect(screen.getByTestId("session-user")).toHaveTextContent(
          nextUser.id
        )
      }
    )

    const referencedFile = {
      id: "30000000-0000-4000-8000-000000000001",
      conversation_id: "20000000-0000-4000-8000-000000000002",
      kind: "artifact",
      filename: "预算说明.pdf",
      mime_type: "application/pdf",
      size_bytes: 12,
      created_at: "2026-08-10T08:30:00.000Z",
      task: {
        id: "20000000-0000-4000-8000-000000000002",
        title: "上月预算",
        archive_status: "archived",
      },
    }

    async function addSelectedReference(
      interaction: ReturnType<typeof userEvent.setup>,
      inputText: string
    ) {
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, inputText)
      const addMenu = await screen.findByRole("button", { name: "添加内容" })
      await waitFor(() => expect(addMenu).toBeEnabled())
      await interaction.click(addMenu)
      await interaction.click(screen.getByRole("option", { name: "引用文件" }))
      const popover = await screen.findByRole("dialog", {
        name: "引用历史任务文件",
      })
      await interaction.click(
        await within(popover).findByRole("option", {
          name: "选择 上月预算 中的 预算说明.pdf",
        })
      )
      await interaction.click(
        within(popover).getByRole("button", { name: "添加所选文件（1）" })
      )
      return popover
    }

    function referencePosts(fixture: ReturnType<typeof installApi>) {
      return fixture.requests.filter(
        (request) =>
          request.method === "POST" &&
          request.path.endsWith("/attachments/references")
      )
    }

    it("does not retry or cache a paused fresh Mac reference after a same-owner re-login", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail(
        "new-reference-login-boundary",
        "cloud"
      )
      const nextToken = "same-owner-reference-login-token"
      let activeAuthUser: User = authUserA
      const fixture = installApi({
        deferReference: true,
        createResponse: created,
        conversations: { [created.id]: created },
        referenceableFiles: [referencedFile],
        authUser: () => activeAuthUser,
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
        realAuth: {
          nextSession: {
            access_token: nextToken,
            access_token_expires_at: realSessionExpiry,
          },
          beforeAccept: () => {
            activeAuthUser = authUserA
          },
        },
      })

      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "authenticated"
        )
      )
      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000065")
      await addSelectedReference(interaction, "引用登录边界")
      await waitFor(() => expect(fixture.referenceResponses).toHaveLength(1))
      await waitFor(() =>
        expect(screen.getByTestId("conversation-route")).toHaveTextContent(
          `/conversations/${created.id}`
        )
      )
      expect(referencePosts(fixture)).toHaveLength(1)
      expect(referencePosts(fixture)[0]?.authorization).toBe(
        "Bearer execution-target-access-token"
      )
      const referenceMutation = view.queryClient
        .getMutationCache()
        .getAll()
        .find(
          (mutation) =>
            (mutation.state.variables as { id?: string } | undefined)?.id ===
            referencedFile.id
        )
      expect(referenceMutation).toBeDefined()

      await interaction.click(
        screen.getByRole("button", { name: "注销当前会话" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "anonymous"
        )
      )
      await interaction.click(
        screen.getByRole("button", { name: "建立新会话" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("session-user")).toHaveTextContent("user-1")
      )
      expect(getAccessToken()).toBe(nextToken)

      const detailRequestsBefore = fixture.requests.filter(
        (request) =>
          request.method === "GET" &&
          request.path === `/api/v1/conversations/${created.id}`
      ).length
      const refreshRequestsBefore = fixture.requests.filter(
        (request) => request.path === "/api/v1/auth/refresh"
      ).length
      const invalidateQueries = vi.spyOn(view.queryClient, "invalidateQueries")

      await fixture.resolveReference(
        0,
        errorEnvelope(401, "AUTH_SESSION_EXPIRED")
      )
      await waitFor(() =>
        expect(referenceMutation?.state.status).not.toBe("pending")
      )
      await act(async () => {
        await Promise.resolve()
      })

      expect(invalidateQueries).not.toHaveBeenCalled()
      expect(referencePosts(fixture)).toHaveLength(1)
      expect(fixture.referenceResponses).toHaveLength(1)
      expect(
        fixture.requests.filter(
          (request) => request.path === "/api/v1/auth/refresh"
        )
      ).toHaveLength(refreshRequestsBefore)
      expect(
        fixture.requests.filter(
          (request) =>
            request.method === "GET" &&
            request.path === `/api/v1/conversations/${created.id}`
        )
      ).toHaveLength(detailRequestsBefore)
      invalidateQueries.mockRestore()
      expect(
        screen.queryByRole("button", { name: "移除附件 预算说明.pdf" })
      ).not.toBeInTheDocument()
      expect(getAccessToken()).toBe(nextToken)
      expect(screen.getByTestId("session-user")).toHaveTextContent("user-1")
    })

    it("retries a fresh Mac reference once after a same-session token rotation", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      const created = conversationDetail("new-reference-rotation", "cloud")
      const attachment = {
        id: "referenced-attachment-1",
        name: "预算说明.pdf",
        kind: "attachment",
        status: "staged",
        size: 12,
        mime_type: "application/pdf",
      }
      const fixture = installApi({
        deferReference: true,
        createResponse: created,
        conversations: { [created.id]: created },
        referenceableFiles: [referencedFile],
      })
      const interaction = userEvent.setup()
      renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
      })

      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000066")
      await addSelectedReference(interaction, "同会话引用重试")
      await waitFor(() => expect(fixture.referenceResponses).toHaveLength(1))

      await fixture.resolveReference(
        0,
        errorEnvelope(401, "AUTH_SESSION_EXPIRED")
      )
      await waitFor(() => expect(fixture.referenceResponses).toHaveLength(2))
      const posts = referencePosts(fixture)
      expect(posts).toHaveLength(2)
      expect(posts[0]?.authorization).toBe(
        "Bearer execution-target-access-token"
      )
      expect(posts[1]?.authorization).toBe(`Bearer ${refreshedAccessToken}`)

      await fixture.resolveReference(1, json(attachment, 201))
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "引用历史任务文件" })
        ).not.toBeInTheDocument()
      )
      expect(referencePosts(fixture)).toHaveLength(2)
      expect(getAccessToken()).toBe(refreshedAccessToken)
    })

    it("keeps a paused fresh Mac create out of the new session after a definitive refresh rejection", async () => {
      deviceStatusMock.setData(readyDeviceStatus())
      // Keep the persisted session coherent with the in-memory token so the
      // refresh path cannot mistake an empty storage read for a signed-out
      // session (a Mac host has no localStorage session at all).
      setAccessToken("execution-target-access-token", realSessionExpiry)
      const createdA = conversationDetail("new-definitive-session-end", "cloud")
      const fixture = installApi({
        deferCreate: true,
        createResponse: createdA,
        conversations: { [createdA.id]: createdA },
        meResponses: [json(authUserA), errorEnvelope(401, "AUTH_REQUIRED")],
        refreshUnauthorized: true,
      })
      const interaction = userEvent.setup()
      const view = renderConversationPage("/conversations/new", undefined, {
        navigation: true,
        bootstrap: desktopRollout({
          local_computer: true,
          cloud_target: true,
        }),
        realAuth: {
          nextSession: {
            access_token: "unused-replacement-token",
            access_token_expires_at: realSessionExpiry,
          },
          beforeAccept: () => undefined,
        },
      })

      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "authenticated"
        )
      )
      await waitFor(() => expect(fixture.prewarms).toHaveLength(1))
      await fixture.resolvePrewarm(0, "71000000-0000-4000-8000-000000000067")
      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.type(input, "会话结束后的旧创建")
      await interaction.click(screen.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(fixture.createResponses).toHaveLength(1))
      const oldMutation = findSendMutation(
        view.queryClient,
        "会话结束后的旧创建"
      )
      expect(oldMutation).toBeDefined()
      const boundaryBefore = getLoginSessionBoundary()

      await interaction.click(
        screen.getByRole("button", { name: "触发会话失效" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("session-status")).toHaveTextContent(
          "anonymous"
        )
      )
      expect(getLoginSessionBoundary()).toBeGreaterThan(boundaryBefore)
      expect(getAccessToken()).toBeNull()

      await fixture.resolveCreate(0, json(createdA))
      await waitForMutationSettled(oldMutation)

      expect(
        fixture.requests.filter(
          (request) =>
            request.method === "POST" && request.path.endsWith("/turns")
        )
      ).toHaveLength(0)
      expect(
        view.queryClient.getQueryData(["conversation", createdA.id])
      ).toBeUndefined()
      expect(
        readLocalConversationDraft(
          window.localStorage,
          authUserA.id,
          createdA.id
        ).input
      ).toBe("")
      expect(
        readLocalConversationDraft(window.localStorage, authUserA.id, "new")
          ?.input
      ).toBe("会话结束后的旧创建")
      expect(screen.getByTestId("conversation-route")).toHaveTextContent(
        "/conversations/new"
      )
      expect(screen.getByTestId("session-status")).toHaveTextContent(
        "anonymous"
      )
      expect(getAccessToken()).toBeNull()
    })

    it("removes the ended account's cache before a replacement login can reuse the same key", async () => {
      const queryClient = createRaceQueryClient()
      const replacementToken = "replacement-same-cache-key-token"
      setAccessToken("account-a-same-cache-key-token", realSessionExpiry)
      let activeAuthUser: User = authUserA
      installApi({ authUser: () => activeAuthUser })

      const bootstrapSnapshot = desktopRollout()
      const sharedKey = ["conversation", "shared-account-key"]
      const heldReadKey = ["conversation", "held-account-read"]
      queryClient.setQueryData(bootstrapQueryKey, bootstrapSnapshot)
      queryClient.setQueryData(sharedKey, { title: "account A detail" })
      queryClient.getMutationCache().build(queryClient, {
        mutationKey: ["account-a-mutation"],
      })

      let heldReadSignal: AbortSignal | undefined
      let finishHeldRead!: (value: { title: string }) => void
      const heldRead = queryClient
        .fetchQuery({
          queryKey: heldReadKey,
          queryFn: ({ signal }) => {
            heldReadSignal = signal
            return new Promise<{ title: string }>((resolve) => {
              finishHeldRead = resolve
            })
          },
        })
        .catch(() => undefined)

      renderAuthOnlyProvider(
        queryClient,
        <AuthOnlyProbe
          nextSession={{
            access_token: replacementToken,
            access_token_expires_at: realSessionExpiry,
          }}
        />
      )

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "authenticated"
        )
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-1")
      await waitFor(() => expect(heldReadSignal).toBeDefined())
      const boundaryBefore = getLoginSessionBoundary()

      await act(async () => {
        // The definitive credential clear the API client performs when a
        // refresh is definitively rejected ends the verified login here.
        setAccessToken(null)
        // The ended login's data must already be gone at this point, before
        // the replacement login receives credentials or can render it.
        expect(queryClient.getQueryData(sharedKey)).toBeUndefined()
        expect(
          queryClient.getQueryCache().find({ queryKey: sharedKey })
        ).toBeUndefined()
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
        expect(heldReadSignal?.aborted).toBe(true)
        expect(queryClient.getQueryData(bootstrapQueryKey)).toEqual(
          bootstrapSnapshot
        )

        // A replacement login is accepted in the same turn. This is the window
        // where the old asynchronous reset used to skip removal entirely.
        activeAuthUser = authUserB
        fireEvent.click(
          screen.getByRole("button", { name: "accept next login" })
        )
        await Promise.resolve()
      })

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      )
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "authenticated"
      )
      expect(getLoginSessionBoundary()).toBeGreaterThan(boundaryBefore)
      expect(getAccessToken()).toBe(replacementToken)
      const acceptedBoundary = getLoginSessionBoundary()

      // The replacement's own data under the reused key must survive the ended
      // login's cleanup.
      queryClient.setQueryData(sharedKey, { title: "account B detail" })

      // A late response from the ended account's read must not repopulate the
      // cache under the replacement login.
      await act(async () => {
        finishHeldRead({ title: "late account A detail" })
        await heldRead
      })

      expect(queryClient.getQueryData(heldReadKey)).toBeUndefined()
      expect(
        queryClient.getQueryCache().find({ queryKey: heldReadKey })
      ).toBeUndefined()
      expect(queryClient.getQueryData(sharedKey)).toEqual({
        title: "account B detail",
      })
      expect(queryClient.getQueryData(bootstrapQueryKey)).toEqual(
        bootstrapSnapshot
      )
      expect(getLoginSessionBoundary()).toBe(acceptedBoundary)
      expect(getAccessToken()).toBe(replacementToken)
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
    })

    it("keeps an explicit replacement login and its cache after the ended session is cleared", async () => {
      const queryClient = createRaceQueryClient()
      const replacementToken = "replacement-after-reset-token"
      setAccessToken("account-a-reset-token", realSessionExpiry)
      let activeAuthUser: User = authUserA
      installApi({
        meResponses: [json(authUserA), errorEnvelope(401, "AUTH_REQUIRED")],
        refreshUnauthorized: true,
        authUser: () => activeAuthUser,
      })
      const bootstrapSnapshot = desktopRollout()
      queryClient.setQueryData(bootstrapQueryKey, bootstrapSnapshot)

      renderAuthOnlyProvider(
        queryClient,
        <AuthOnlyProbe
          nextSession={{
            access_token: replacementToken,
            access_token_expires_at: realSessionExpiry,
          }}
        />
      )

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "authenticated"
        )
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-1")
      queryClient.setQueryData(["conversation", "account-a"], {
        title: "account A detail",
      })
      const boundaryBefore = getLoginSessionBoundary()

      fireEvent.click(screen.getByRole("button", { name: "expire session" }))
      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "anonymous"
        )
      )
      expect(getLoginSessionBoundary()).toBeGreaterThan(boundaryBefore)
      expect(getAccessToken()).toBeNull()
      expect(
        queryClient.getQueryData(["conversation", "account-a"])
      ).toBeUndefined()
      expect(queryClient.getQueryData(bootstrapQueryKey)).toEqual(
        bootstrapSnapshot
      )

      activeAuthUser = authUserB
      fireEvent.click(screen.getByRole("button", { name: "accept next login" }))
      await waitFor(() =>
        expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      )
      const acceptedBoundary = getLoginSessionBoundary()
      queryClient.setQueryData(["conversation", "account-b"], {
        title: "account B detail",
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "authenticated"
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      expect(getAccessToken()).toBe(replacementToken)
      expect(getLoginSessionBoundary()).toBe(acceptedBoundary)
      expect(queryClient.getQueryData(["conversation", "account-b"])).toEqual({
        title: "account B detail",
      })
      expect(queryClient.getQueryData(bootstrapQueryKey)).toEqual(
        bootstrapSnapshot
      )
    })

    it("keeps the Mac login closed and runs native cleanup before anonymous when the token is cleared while logout is pending", async () => {
      setAccessToken("account-a-native-cleanup-token", realSessionExpiry)
      const fixture = installApi({
        authUser: () => authUserA,
        deferLogout: true,
      })
      const queryClient = createRaceQueryClient()
      queryClient.setQueryData(["conversation", "account-a"], {
        title: "account A detail",
      })

      renderAuthOnlyProvider(queryClient, <AuthOnlyProbe />)

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "authenticated"
        )
      )
      fireEvent.click(screen.getByRole("button", { name: "sign out login" }))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/logout"
          )
        ).toHaveLength(1)
      )
      const loggingOutBoundary = getLoginSessionBoundary()
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "loading"
      )

      // A definitive credential clear during the pending logout must neither
      // expose the login early nor end the login a second time.
      act(() => setAccessToken(null))
      expect(getLoginSessionBoundary()).toBe(loggingOutBoundary)
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "loading"
      )
      expect(getAccessToken()).toBeNull()

      await fixture.resolveLogout()
      await waitFor(() =>
        expect(
          screen.getByTestId("auth-only-sign-out-completions")
        ).toHaveTextContent("1")
      )

      expect(clearDesktopSessionMock).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "anonymous"
      )
      expect(getAccessToken()).toBeNull()
      expect(getLoginSessionBoundary()).toBe(loggingOutBoundary)
      expect(
        queryClient.getQueryData(["conversation", "account-a"])
      ).toBeUndefined()
    })

    it("does not clear a replacement login's native session or a late old /me failure", async () => {
      // Web keeps accepting an explicit replacement while logout is pending.
      hostMock.mac = false
      setAccessToken("account-a-late-me-token", realSessionExpiry)
      const lateMe = createDeferredResponse()
      let activeAuthUser: User = authUserA
      const fixture = installApi({
        meResponses: [json(authUserA), lateMe.promise],
        authUser: () => activeAuthUser,
        deferLogout: true,
      })

      renderAuthOnlyProvider(
        createRaceQueryClient(),
        <AuthOnlyProbe
          nextSession={{
            access_token: "replacement-during-logout-token",
            access_token_expires_at: realSessionExpiry,
          }}
        />
      )

      await waitFor(() =>
        expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
          "authenticated"
        )
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-1")

      // Hold the old login's /me so its definitive failure can arrive after
      // the replacement is accepted.
      fireEvent.click(screen.getByRole("button", { name: "expire session" }))
      await waitFor(() =>
        expect(
          fixture.requests.filter((request) => request.path === "/api/v1/me")
        ).toHaveLength(2)
      )

      fireEvent.click(screen.getByRole("button", { name: "sign out login" }))
      await waitFor(() =>
        expect(
          fixture.requests.filter(
            (request) => request.path === "/api/v1/auth/logout"
          )
        ).toHaveLength(1)
      )

      activeAuthUser = authUserB
      fireEvent.click(screen.getByRole("button", { name: "accept next login" }))
      await waitFor(() =>
        expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      )
      const acceptedBoundary = getLoginSessionBoundary()

      await act(async () => {
        lateMe.resolve(errorEnvelope(401, "AUTH_REQUIRED"))
        await lateMe.promise
      })
      await act(async () => {
        await Promise.resolve()
      })

      // The late old /me neither advances the boundary nor clears the
      // replacement's credentials.
      expect(getLoginSessionBoundary()).toBe(acceptedBoundary)
      expect(getAccessToken()).toBe("replacement-during-logout-token")
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "authenticated"
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
      expect(
        fixture.requests.filter(
          (request) => request.path === "/api/v1/auth/refresh"
        )
      ).toHaveLength(0)

      await fixture.resolveLogout()
      await waitFor(() =>
        expect(
          screen.getByTestId("auth-only-sign-out-completions")
        ).toHaveTextContent("1")
      )

      // The ended login's late logout must not clear the replacement login's
      // native session or credentials.
      expect(clearDesktopSessionMock).not.toHaveBeenCalled()
      expect(getAccessToken()).toBe("replacement-during-logout-token")
      expect(getLoginSessionBoundary()).toBe(acceptedBoundary)
      expect(screen.getByTestId("auth-only-status")).toHaveTextContent(
        "authenticated"
      )
      expect(screen.getByTestId("auth-only-user")).toHaveTextContent("user-2")
    })
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
