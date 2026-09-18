import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { interactiveApplicationPackageSchema } from "@linksense/shared"
import { z } from "zod"

import {
  applicationSchema,
  conversationEventRecordSchema,
} from "@/api/contracts"
import { AppProviders } from "@/app/providers"
import { ProtectedRoute } from "@/app/route-guards"
import { InteractiveApplicationPage } from "@/features/applications/interactive-application-page"
import { ConversationPage } from "@/pages/conversation-pages"
import {
  conversation,
  installApiMock,
  json,
  setupApplicationTests,
} from "./fixture"

const application = applicationSchema
  .extend({
    interactive_package: interactiveApplicationPackageSchema,
  })
  .parse({
    id: "20000000-0000-4000-8000-000000000001",
    owner: { id: "10000000-0000-4000-8000-000000000001", name: "测试用户" },
    name: "预览连接测试",
    icon: { type: "preset", preset: "bot" },
    description: null,
    kind: "interactive",
    instructions: null,
    model: null,
    reasoning_effort: null,
    status: "active",
    is_owner: true,
    can_manage: true,
    access_source: "owner",
    capability_count: 0,
    knowledge_base_count: 0,
    mcp_server_count: 0,
    share_targets: [],
    dependencies_available: true,
    capabilities: [],
    knowledge_bases: [],
    mcp_servers: [],
    interactive_package: {
      id: "40000000-0000-4000-8000-000000000001",
      version: "1.0.0",
      manifest: {
        schema_version: 1,
        id: "preview-connection-test",
        name: "预览连接测试",
        version: "1.0.0",
        entry: "index.html",
        sdk_version: 1,
        permissions: ["tasks:write"],
        custom_events: [],
      },
      created_at: "2026-09-18T00:00:00.000Z",
    },
    created_at: "2026-09-18T00:00:00.000Z",
    updated_at: "2026-09-18T00:00:00.000Z",
  })

describe("interactive preview event connections", () => {
  setupApplicationTests()

  it("uses one stream for the preview and its chat, releases hidden-page sockets, and resumes without starting a task", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible")
    const emptyConversation = {
      ...conversation,
      execution_status: "idle",
      messages: [],
      turns: [],
      running_turn: null,
      activities: [],
      events: [],
    }
    const { requests } = installApiMock({
      conversationOverride: {
        ...emptyConversation,
        last_event_id: "c1:8",
        application: {
          id: application.id,
          name: application.name,
          kind: application.kind,
          package_id: application.interactive_package.id,
        },
      },
      conversationDetailResponse: async (id) =>
        json({
          success: true,
          data: { ...emptyConversation, id, last_event_id: `${id}:8` },
        }),
    })
    const baseFetch = globalThis.fetch
    const streams: Array<{
      path: string
      signal: AbortSignal | null | undefined
      cursor: string | null
    }> = []
    const historicalEvent = conversationEventRecordSchema.parse({
      id: "60000000-0000-4000-8000-000000000001",
      conversation_id: "30000000-0000-4000-8000-000000000001",
      turn_id: "50000000-0000-4000-8000-000000000001",
      sequence_no: 7,
      event_type: "linksense/application/custom-event",
      visibility: "user_visible",
      sse_event_id: "c1:7",
      created_at: "2026-09-18T00:00:00.000Z",
      payload: {
        schema_version: 1,
        source: "linksense_runner",
        method: "linksense/application/custom-event",
        params: {
          eventId: "70000000-0000-4000-8000-000000000001",
          threadId: "native-thread-1",
          turnId: "native-turn-1",
          name: "research.section_ready",
          eventSchemaVersion: 1,
          payload: { title: "之前的结果" },
        },
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === `/api/v1/applications/${application.id}`)
          return json({ success: true, data: application })
        if (
          url.pathname ===
          `/api/v1/applications/${application.id}/interactive-runtime-token`
        )
          return json({
            success: true,
            data: {
              runtime_url:
                "/api/v1/interactive-app-runtime/test-ticket/index.html",
              expires_at: "2099-09-18T00:00:00.000Z",
              manifest: application.interactive_package.manifest,
            },
          })
        if (/^\/api\/v1\/conversations\/[^/]+\/events$/u.test(url.pathname)) {
          streams.push({
            path: url.pathname,
            signal: init?.signal,
            cursor: new Headers(init?.headers).get("Last-Event-ID"),
          })
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.close(),
                  { once: true }
                )
                if (url.pathname === "/api/v1/conversations/c1/events") {
                  controller.enqueue(
                    new TextEncoder().encode(
                      `id: c1:7\nevent: ${historicalEvent.event_type}\ndata: ${JSON.stringify(historicalEvent)}\n\n`
                    )
                  )
                }
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } }
          )
        }
        return baseFetch(input, init)
      })
    )

    const page = render(
      <MemoryRouter initialEntries={["/conversations/c2"]}>
        <AppProviders>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route
                path="/conversations/c2"
                element={
                  <>
                    <ConversationPage conversationId="c2" development />
                    <InteractiveApplicationPage
                      applicationId={application.id}
                      conversationId="c1"
                      onDiagnostic={vi.fn()}
                    />
                  </>
                }
              />
            </Route>
          </Routes>
        </AppProviders>
      </MemoryRouter>
    )
    const frame = await screen.findByTitle(application.name)
    expect(frame).toHaveAttribute(
      "src",
      "/api/v1/interactive-app-runtime/test-ticket/index.html"
    )
    await waitFor(() => expect(streams).toHaveLength(2))
    expect(streams.map(({ path }) => path).sort()).toEqual([
      "/api/v1/conversations/c1/events",
      "/api/v1/conversations/c2/events",
    ])

    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow)
      throw new Error("Expected a preview frame with a window")
    const frameWindow = frame.contentWindow
    const postMessage = vi.spyOn(frameWindow, "postMessage")
    const protocol = "linksense.interactive.v1"
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          data: { protocol, type: "ready" },
        })
      )
    )
    const initialize = z
      .object({ instanceId: z.string().uuid() })
      .parse(postMessage.mock.calls[0]?.[0])
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frameWindow,
          data: {
            protocol,
            type: "initialized",
            instanceId: initialize.instanceId,
          },
        })
      )
    )
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "custom-event",
          event: expect.objectContaining({
            sequence: 7,
            payload: { title: "之前的结果" },
          }),
        }),
        "*"
      )
    )

    await userEvent.click(screen.getByRole("button", { name: "显示对话" }))
    await userEvent.click(screen.getByRole("button", { name: "隐藏聊天" }))
    expect(streams).toHaveLength(2)

    await act(async () => {
      visibility.mockReturnValue("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(streams.every(({ signal }) => signal?.aborted)).toBe(true)

    await act(async () => {
      visibility.mockReturnValue("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(streams).toHaveLength(4))
    expect(streams.filter(({ signal }) => !signal?.aborted)).toHaveLength(2)
    expect(
      streams
        .filter(({ path }) => path.endsWith("/c1/events"))
        .map(({ cursor }) => cursor)
    ).toEqual([null, "c1:7"])
    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(screen.getByTitle(application.name)).toBeInTheDocument()
    expect(
      requests.filter(
        ({ method, path }) =>
          method === "POST" &&
          (path === "/api/v1/conversations" || path.endsWith("/turns"))
      )
    ).toHaveLength(0)
    page.unmount()
    expect(streams.every(({ signal }) => signal?.aborted)).toBe(true)
  })
})
