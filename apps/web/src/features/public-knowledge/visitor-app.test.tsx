import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  supportedLocales,
  type publicKnowledgeTurnSchema,
} from "@linksense/shared"
import type { z } from "zod"
import i18n from "@/i18n"
import { PublicKnowledgeVisitorApp } from "./visitor-app"
import { PublicKnowledgeTurnView } from "./turn-view"
import { publicSearchEvent, publicProgressEvent } from "./progress.test-fixture"
import type { PublicKnowledgeFrame } from "./frame-contract"

const conversationId = "00000000-0000-4000-8000-000000000001",
  visitorId = "00000000-0000-4000-8000-000000000002",
  turnId = "00000000-0000-4000-8000-000000000003"
const config: PublicKnowledgeFrame = {
  public_id: "public-website-application-1234",
  parent_origin: "https://website.example.test",
  locale: "zh-CN" as const,
  name: "Website assistant",
  icon: { type: "preset", preset: "bot" },
  description: "Product information",
  retention_days: 30,
  show_references: true,
}
const conversation = {
  id: conversationId,
  visitor_id: visitorId,
  title: "",
  created_at: "2026-11-05T00:00:00Z",
  updated_at: "2026-11-05T00:00:00Z",
}
const initialTurn: z.infer<typeof publicKnowledgeTurnSchema> = {
  id: turnId,
  input_text: "Can I deploy privately?",
  output_text: "",
  status: "queued",
  model: "private-model",
  application_version: "1.0.0",
  citations: [],
  error_code: null,
  duration_ms: null,
  created_at: conversation.created_at,
}
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})
function show(overrides: Partial<typeof config> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return {
    queryClient: client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TooltipProvider>
            <PublicKnowledgeVisitorApp config={{ ...config, ...overrides }} />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  }
}

describe("anonymous visitor interactions", () => {
  it.each(supportedLocales)(
    "displays the configured logo beside the application name in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      show({ icon: { type: "preset", preset: "globe-2" } })
      const heading = screen.getByRole("heading", { name: config.name })
      expect(
        heading.parentElement?.querySelector(
          '[data-application-icon-preset="globe-2"]'
        )
      ).toBeVisible()
    }
  )

  it("displays the uploaded application logo in the visitor header", () => {
    const images: { src: string; onload: (() => void) | null }[] = []
    vi.stubGlobal(
      "Image",
      class {
        src = ""
        onload: (() => void) | null = null
        constructor() {
          images.push(this)
        }
      }
    )
    const url = "https://icons.example.test/website.png"
    show({ icon: { type: "custom", url, fallback_preset: "bot" } })
    act(() => images[0]?.onload?.())
    const heading = screen.getByRole("heading", { name: config.name })
    expect(heading.parentElement?.querySelector("img")).toHaveAttribute(
      "src",
      url
    )
  })

  it("streams search and intermediate messages before completion, then retains the full process after reload", async () => {
    await i18n.changeLanguage("zh-CN")
    window.sessionStorage.setItem(
      `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`,
      JSON.stringify({
        token: "a".repeat(64),
        visitor_id: visitorId,
        expires_at: "2099-01-01T00:00:00Z",
      })
    )
    let turn = { ...initialTurn }
    const events: ReturnType<typeof publicProgressEvent>[] = []
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    let closed = false
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(url), window.location.origin).pathname
        if (path.endsWith("/events"))
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller
                closed = false
                init?.signal?.addEventListener(
                  "abort",
                  () => {
                    if (!closed) {
                      closed = true
                      controller.close()
                    }
                  },
                  { once: true }
                )
              },
              cancel() {
                closed = true
              },
            }),
            { headers: { "content-type": "text/event-stream" } }
          )
        return Response.json({
          success: true,
          data: path.endsWith(`/conversations/${conversationId}`)
            ? {
                conversation,
                turns: [turn],
                events: events.filter(
                  (event) => event.event_type !== "item/agentMessage/delta"
                ),
                event_cursor: `${conversationId}:${turn.status === "completed" ? (events.at(-1)?.sequence_no ?? 0) : 0}`,
                queue_waiting_visitors:
                  turn.status === "queued" ? 3 : undefined,
              }
            : { items: [conversation], next_cursor: null },
        })
      }
    )
    vi.stubGlobal("fetch", fetcher)
    const first = show({ show_references: false })
    expect(
      await screen.findByText(
        i18n.t("publicKnowledge.queueWaiting", { count: 3 })
      )
    ).toBeVisible()
    await waitFor(() => expect(stream).toBeDefined())
    const send = async (event: ReturnType<typeof publicProgressEvent>) => {
      events.push(event)
      await act(async () => {
        if (!stream) throw new Error("SSE has not connected")
        stream.enqueue(
          new TextEncoder().encode(
            `id: ${event.sse_event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`
          )
        )
      })
    }
    turn = { ...turn, status: "running" }
    await send(publicSearchEvent(conversationId, turnId, 1))
    expect(
      await screen.findByText(
        i18n.t("conversation.nativeActivities.knowledgeSearchRunning")
      )
    ).toBeVisible()
    await send(publicSearchEvent(conversationId, turnId, 2, true))
    const native = (
      sequence: number,
      method: string,
      params: Record<string, unknown>
    ) =>
      publicProgressEvent(conversationId, turnId, sequence, method, {
        schema_version: 2,
        source: "codex_app_server",
        method,
        params: {
          threadId: conversationId,
          ...(method.startsWith("turn/") ? {} : { turnId }),
          ...params,
        },
      })
    await send(
      native(3, "item/completed", {
        item: {
          id: "comment",
          type: "agentMessage",
          phase: "commentary",
          text: "Checking the available evidence[1]",
        },
      })
    )
    await send(
      native(4, "item/started", {
        item: {
          id: "answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "",
        },
      })
    )
    await send(
      native(5, "item/agentMessage/delta", {
        itemId: "answer",
        delta: "Partial answer[1",
      })
    )
    expect(await screen.findByText("Partial answer")).toBeVisible()
    expect(first.container).not.toHaveTextContent("[1")
    expect(
      screen.getByRole("button", { name: i18n.t("conversation.stop") })
    ).toBeEnabled()
    await send(
      native(6, "item/agentMessage/delta", {
        itemId: "answer",
        delta: "] continues[1]",
      })
    )
    expect(await screen.findByText("Partial answer continues")).toBeVisible()
    expect(first.container).not.toHaveTextContent("[1]")
    expect(first.container.querySelector(".knowledge-citation-link")).toBeNull()
    await send(
      native(7, "item/completed", {
        item: {
          id: "answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "Complete answer[1]",
        },
      })
    )
    turn = {
      ...turn,
      status: "completed",
      output_text: "Complete answer[1]",
      duration_ms: 12_000,
    }
    await send(
      native(8, "turn/completed", {
        turn: { id: turnId, status: "completed", error: null },
      })
    )
    const summary = await screen.findByTestId(`turn-summary-${turnId}`)
    await waitFor(() =>
      expect(summary.querySelector(".turn-duration")).toHaveTextContent("12s")
    )
    await userEvent.setup().click(
      within(summary).getByRole("button", {
        name: i18n.t("conversation.expandActivity"),
      })
    )
    expect(
      await screen.findByText("Checking the available evidence")
    ).toBeVisible()
    expect(
      within(summary).getByText(
        i18n.t("conversation.nativeActivities.knowledgeSearchCompleted")
      )
    ).toBeVisible()
    const request = fetcher.mock.calls.find(([url]) =>
      String(url).includes("/events")
    )?.[1]
    expect(request?.credentials).toBe("omit")
    expect(new Headers(request?.headers).get("authorization")).toBe(
      `Bearer ${"a".repeat(64)}`
    )
    first.unmount()
    show({ show_references: false })
    expect(await screen.findByText("Complete answer")).toBeVisible()
    expect(screen.queryByText("Complete answer[1]")).not.toBeInTheDocument()
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: i18n.t("conversation.expandActivity"),
      })
    )
    expect(
      await screen.findByText("Checking the available evidence")
    ).toBeVisible()
  })
  it.each(supportedLocales)(
    "shows the ordinary elapsed time and knowledge-search activity in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      window.sessionStorage.setItem(
        `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`,
        JSON.stringify({
          token: "a".repeat(64),
          visitor_id: visitorId,
          expires_at: "2099-01-01T00:00:00Z",
        })
      )
      const turn = {
        ...initialTurn,
        status: "completed",
        output_text: "Public answer",
        duration_ms: 12_000,
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: RequestInfo | URL) =>
          Response.json({
            success: true,
            data: String(url).endsWith(`/conversations/${conversationId}`)
              ? {
                  conversation,
                  turns: [turn],
                  events: [
                    publicSearchEvent(conversationId, turnId, 1),
                    publicSearchEvent(conversationId, turnId, 2, true),
                  ],
                  event_cursor: `${conversationId}:2`,
                }
              : { items: [conversation], next_cursor: null },
          })
        )
      )
      show({ show_references: false })
      const summary = await screen.findByTestId(`turn-summary-${turnId}`)
      expect(summary).toHaveTextContent(i18n.t("conversation.elapsed"))
      expect(summary.querySelector(".turn-duration")).toHaveTextContent("12s")
      const expand = within(summary).getByRole("button", {
        name: i18n.t("conversation.expandActivity"),
      })
      await userEvent.setup().click(expand)
      expect(
        within(summary).getByText(
          i18n.t("conversation.nativeActivities.knowledgeSearchCompleted")
        )
      ).toBeVisible()
      expect(summary).not.toHaveTextContent(
        i18n.t("conversation.activities.tool_started")
      )
      expect(
        screen.queryByText(i18n.t("publicKnowledge.completed"))
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(i18n.t("publicKnowledge.running"))
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("heading", {
          name: i18n.t("publicKnowledge.sources"),
        })
      ).not.toBeInTheDocument()
    }
  )
  it("moves the waiting count out of the way when generation starts without a repeated answering label", async () => {
    await i18n.changeLanguage("zh-CN")
    window.sessionStorage.setItem(
      `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`,
      JSON.stringify({
        token: "a".repeat(64),
        visitor_id: visitorId,
        expires_at: "2099-01-01T00:00:00Z",
      })
    )
    let status: "queued" | "running" = "queued"
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) =>
        Response.json({
          success: true,
          data: String(url).endsWith(`/conversations/${conversationId}`)
            ? {
                conversation,
                turns: [{ ...initialTurn, status }],
                queue_waiting_visitors: status === "queued" ? 3 : undefined,
              }
            : { items: [conversation], next_cursor: null },
        })
      )
    )
    const view = show()
    expect(
      await screen.findByText(
        i18n.t("publicKnowledge.queueWaiting", { count: 3 })
      )
    ).toBeVisible()
    status = "running"
    await act(async () => {
      await view.queryClient.invalidateQueries({
        queryKey: ["public-knowledge-visitor"],
      })
    })
    await waitFor(() =>
      expect(
        screen.queryByText(i18n.t("publicKnowledge.queueWaiting", { count: 3 }))
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByText(i18n.t("publicKnowledge.running"))
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: i18n.t("conversation.messageInput") })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: i18n.t("conversation.stop") })
    ).toBeEnabled()
  })
  it.each(supportedLocales)(
    "starts, queues and cancels an independent conversation in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      let created = false,
        turns: z.infer<typeof publicKnowledgeTurnSchema>[] = []
      const fetcher = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname
          if (path.endsWith("/sessions"))
            return Response.json({
              success: true,
              data: {
                token: "a".repeat(64),
                visitor_id: visitorId,
                expires_at: "2099-01-01T00:00:00Z",
              },
            })
          if (path.endsWith("/interrupt")) {
            turns = [{ ...initialTurn, status: "interrupted" }]
            return new Response(null, { status: 204 })
          }
          if (path.endsWith("/turns")) {
            turns = [initialTurn]
            return Response.json(
              { success: true, data: initialTurn },
              { status: 202 }
            )
          }
          if (path.endsWith(`/conversations/${conversationId}`))
            return Response.json({
              success: true,
              data: {
                conversation,
                turns,
                queue_waiting_visitors: turns.some(
                  (turn) => turn.status === "queued"
                )
                  ? 3
                  : undefined,
              },
            })
          if (init?.method === "POST") {
            created = true
            return Response.json(
              { success: true, data: conversation },
              { status: 201 }
            )
          }
          return Response.json({
            success: true,
            data: { items: created ? [conversation] : [], next_cursor: null },
          })
        }
      )
      vi.stubGlobal("fetch", fetcher)
      show()
      const user = userEvent.setup()
      expect(fetcher).not.toHaveBeenCalled()
      await user.click(
        screen.getByRole("button", { name: i18n.t("publicKnowledge.start") })
      )
      const question = await screen.findByRole("textbox", {
        name: i18n.t("conversation.messageInput"),
      })
      await waitFor(() => expect(question).toBeEnabled())
      await user.type(question, initialTurn.input_text)
      await user.click(
        screen.getByRole("button", { name: i18n.t("conversation.send") })
      )
      expect(
        await screen.findByText(
          i18n.t("publicKnowledge.queueWaiting", { count: 3 })
        )
      ).toBeVisible()
      expect(
        screen.queryByText(i18n.t("publicKnowledge.running"))
      ).not.toBeInTheDocument()
      expect(
        document.querySelector('.embed-thread [role="status"]')
      ).not.toBeNull()
      expect(question).toBeDisabled()
      await user.click(
        screen.getByRole("button", { name: i18n.t("conversation.stop") })
      )
      expect(
        await screen.findByText(i18n.t("publicKnowledge.interrupted"))
      ).toBeVisible()
      await waitFor(() => expect(question).toBeEnabled())
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith("/turns"))
      ).toHaveLength(1)
      expect(
        window.sessionStorage.getItem(
          `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`
        )
      ).toContain(visitorId)
    }
  )
  it("keeps restored visitor identity scoped to the application and resets an expired identity", async () => {
    await i18n.changeLanguage("zh-CN")
    window.sessionStorage.setItem(
      `linksense:public-knowledge:another-application:${config.parent_origin}`,
      JSON.stringify({
        token: "b".repeat(64),
        visitor_id: visitorId,
        expires_at: "2099-01-01T00:00:00Z",
      })
    )
    const fetcher = vi.fn(async () =>
      Response.json({ error_code: "AUTH_REQUIRED" }, { status: 401 })
    )
    vi.stubGlobal("fetch", fetcher)
    const first = show()
    expect(fetcher).not.toHaveBeenCalled()
    first.unmount()
    window.sessionStorage.setItem(
      `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`,
      JSON.stringify({
        token: "a".repeat(64),
        visitor_id: visitorId,
        expires_at: "2099-01-01T00:00:00Z",
      })
    )
    show()
    expect(
      await screen.findByText(i18n.t("publicKnowledge.sessionExpired"))
    ).toBeVisible()
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: i18n.t("publicKnowledge.retry") })
      )
    expect(
      await screen.findByRole("button", {
        name: i18n.t("publicKnowledge.start"),
      })
    ).toBeVisible()
    expect(
      window.sessionStorage.getItem(
        `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`
      )
    ).toBeNull()
  })
  it("uses the ordinary chat and composer for completed public answers without private resource requests", async () => {
    await i18n.changeLanguage("en-US")
    window.sessionStorage.setItem(
      `linksense:public-knowledge:${config.public_id}:${config.parent_origin}`,
      JSON.stringify({
        token: "a".repeat(64),
        visitor_id: visitorId,
        expires_at: "2099-01-01T00:00:00Z",
      })
    )
    const turn = {
      ...initialTurn,
      status: "completed",
      output_text:
        "Answer [1]\n\n[docs](https://website.example.test/docs)\n\n![tracking](https://tracking.example.test/pixel)\n\n[private](/api/v1/files/secret)",
      citations: [
        {
          number: 1,
          knowledge_base_id: visitorId,
          document_id: conversationId,
          document_version_id: turnId,
          title: "Source document",
          page_numbers: [],
          excerpt: "Public source passage",
        },
      ],
    }
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      Response.json({
        success: true,
        data: String(url).endsWith(`/conversations/${conversationId}`)
          ? { conversation, turns: [turn] }
          : { items: [conversation], next_cursor: null },
      })
    )
    vi.stubGlobal("fetch", fetcher)
    const view = show()
    expect(await screen.findByText("[1] Source document")).toBeVisible()
    const marker = screen.getByRole("link", {
      name: i18n.t("conversation.openKnowledgeCitation", { number: 1 }),
    })
    expect(marker).toHaveClass("knowledge-citation-link")
    expect(marker.closest(".knowledge-citation-inline")).not.toBeNull()
    expect(marker).toHaveTextContent(/^1$/u)
    expect(marker).toHaveAttribute("title", "Source document")
    expect(marker).toHaveAttribute("href", `#knowledge-source-${turnId}-1`)
    expect(
      screen.getByText("[1] Source document").closest("li")
    ).toHaveAttribute("id", `knowledge-source-${turnId}-1`)
    expect(screen.queryByText("Public source passage")).not.toBeInTheDocument()
    expect(
      screen.queryByText(i18n.t("publicKnowledge.completed"))
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: i18n.t("publicKnowledge.sources") })
    ).toHaveClass("text-xs", "font-normal")
    expect(
      view.container.querySelector(".conversation-scroll-embedded")
    ).not.toBeNull()
    expect(view.container.querySelector(".composer-shell")).not.toBeNull()
    expect(view.container.querySelector("img, iframe, script")).toBeNull()
    expect(
      screen.queryByRole("link", { name: "private" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow"
    )
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).includes("/api/v1/public-knowledge/")
      )
    ).toBe(true)
    view.unmount()
    const hiddenView = show({ show_references: false })
    expect(await screen.findByText("Answer")).toBeVisible()
    expect(screen.queryByText(/Answer \[1\]/u)).not.toBeInTheDocument()
    expect(
      hiddenView.container.querySelector(".knowledge-citation-link")
    ).toBeNull()
    expect(screen.queryByText("[1] Source document")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: i18n.t("publicKnowledge.sources") })
    ).not.toBeInTheDocument()
  })
  it("shows evidence and review metadata while rejecting model-supplied HTML, images and unsafe links", async () => {
    await i18n.changeLanguage("en-US")
    const turn = {
      ...initialTurn,
      status: "completed" as const,
      duration_ms: 1250,
      output_text:
        "<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n![track](https://tracking.example.test/pixel)\n[documentation](https://website.example.test/docs)",
      citations: [
        {
          number: 1,
          knowledge_base_id: visitorId,
          document_id: conversationId,
          document_version_id: turnId,
          title: "Deployment",
          page_numbers: [],
          excerpt: "Supports private deployment",
        },
      ],
    }
    const view = render(<PublicKnowledgeTurnView turn={turn} review />)
    expect(screen.getByText("Supports private deployment")).toBeVisible()
    expect(screen.getByText("private-model")).toBeVisible()
    expect(view.container.querySelector("script, img")).toBeNull()
    expect(
      screen.queryByRole("link", { name: "unsafe" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "documentation" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow"
    )
  })
})
