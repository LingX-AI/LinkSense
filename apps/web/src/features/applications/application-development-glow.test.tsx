import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { conversationSchema, type Conversation } from "@/api/contracts"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentGlow } from "./application-development-glow"
import styles from "./application-development-glow.css?raw"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

const clients: QueryClient[] = []
const key = ["conversation", "development"]
function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return conversationSchema.parse({
    id: "development",
    title: "Develop app",
    project_id: null,
    updated_at: "2026-09-18T00:00:00Z",
    execution_status: "running",
    running_turn: { id: "turn-1", status: "running" },
    ...overrides,
  })
}
function show(initial?: Conversation) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  if (initial) client.setQueryData(key, initial)
  const view = render(
    <QueryClientProvider client={client}>
      <ApplicationDevelopmentGlow conversationId="development" visible />
    </QueryClientProvider>
  )
  const glow = view.container.querySelector(".application-development-glow")!
  return { ...view, client, glow }
}
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.clearAllMocks()
})

describe("application development activity glow", () => {
  it("observes only the developer task and starts no additional requests", async () => {
    const { client, glow } = show()
    expect(glow).toHaveAttribute("data-active", "false")
    await act(async () => {
      client.setQueryData(
        ["conversation", "preview"],
        conversation({ id: "preview" })
      )
    })
    expect(glow).toHaveAttribute("data-active", "false")
    await act(async () => {
      client.setQueryData(key, conversation())
    })
    await waitFor(() => expect(glow).toHaveAttribute("data-active", "true"))
    expect(glow).toHaveClass("pointer-events-none", "absolute", "inset-0")
    expect(glow).toHaveAttribute("aria-hidden", "true")
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it.each(["idle", "pending", "completed", "failed", "interrupted"] as const)(
    "stops the glow when the development task becomes %s",
    async (status) => {
      const { client, glow } = show(conversation())
      expect(glow).toHaveAttribute("data-active", "true")
      await act(async () => {
        client.setQueryData(
          key,
          conversation({ execution_status: status, running_turn: null })
        )
      })
      await waitFor(() => expect(glow).toHaveAttribute("data-active", "false"))
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    }
  )

  it.each(["pending", "answering"] as const)(
    "pauses while a user question is %s and resumes after answering",
    async (status) => {
      const request: Conversation["user_input_requests"][number] = {
        id: "request",
        conversation_id: "development",
        turn_id: "turn-1",
        item_id: "item",
        kind: "questions",
        status,
        questions: [],
        auto_resolve_at: null,
        resolved_at: null,
        resolved_action: null,
        created_at: "2026-09-18T00:00:00Z",
        updated_at: "2026-09-18T00:00:00Z",
      }
      // Cache data is already validated by the conversation API.
      const { client, glow } = show()
      await act(async () => {
        client.setQueryData(key, {
          ...conversation(),
          user_input_requests: [request],
        })
      })
      expect(glow).toHaveAttribute("data-active", "false")
      await act(async () => {
        client.setQueryData(key, {
          ...conversation(),
          user_input_requests: [{ ...request, status: "answered" }],
        })
      })
      await waitFor(() => expect(glow).toHaveAttribute("data-active", "true"))
    }
  )

  it("pauses for plan confirmation without treating optional asynchronous questions as blocked execution", async () => {
    const { client, glow } = show(conversation())
    const plan: NonNullable<Conversation["plan_reviews"]>[number] = {
      id: "plan",
      conversation_id: "development",
      source_turn_id: "turn-1",
      plan_message_id: "message",
      status: "pending",
      decision: null,
      follow_up_turn_id: null,
      resolved_at: null,
      created_at: "2026-09-18T00:00:00Z",
      updated_at: "2026-09-18T00:00:00Z",
    }
    await act(async () => {
      client.setQueryData(key, { ...conversation(), plan_reviews: [plan] })
    })
    await waitFor(() => expect(glow).toHaveAttribute("data-active", "false"))
    const question: Conversation["user_input_requests"][number] = {
      id: "async",
      conversation_id: "development",
      turn_id: "turn-1",
      item_id: "item",
      kind: "async_questions",
      status: "pending",
      questions: [],
      response_content: null,
      auto_resolve_at: null,
      resolved_at: null,
      resolved_action: null,
      created_at: "2026-09-18T00:00:00Z",
      updated_at: "2026-09-18T00:00:00Z",
    }
    await act(async () => {
      client.setQueryData(key, {
        ...conversation(),
        user_input_requests: [question],
      })
    })
    await waitFor(() => expect(glow).toHaveAttribute("data-active", "true"))
  })

  it("stops while the preview is hidden or a different development is opened", () => {
    const { client, glow, rerender } = show(conversation())
    rerender(
      <QueryClientProvider client={client}>
        <ApplicationDevelopmentGlow
          conversationId="development"
          visible={false}
        />
      </QueryClientProvider>
    )
    expect(glow).toHaveAttribute("data-active", "false")
    rerender(
      <QueryClientProvider client={client}>
        <ApplicationDevelopmentGlow
          conversationId="another-development"
          visible
        />
      </QueryClientProvider>
    )
    expect(glow).toHaveAttribute("data-active", "false")
    rerender(
      <QueryClientProvider client={client}>
        <ApplicationDevelopmentGlow conversationId={null} visible />
      </QueryClientProvider>
    )
    expect(glow).toHaveAttribute("data-active", "false")
  })

  it.each([
    ["zh-CN", "LinkSense正在自动开发"],
    ["en-US", "LinkSense is automatically developing the app"],
    ["de-DE", "LinkSense正在自动开发"],
  ])(
    "shows a localized development status with an icon at the bottom without intercepting the preview in %s",
    async (locale, label) => {
      await i18n.changeLanguage(locale)
      show(conversation())
      const status = screen.getByRole("status")
      expect(status).toHaveTextContent(label)
      expect(status).toBeVisible()
      expect(status).not.toHaveClass("sr-only")
      expect(status).toHaveClass("rounded-full")
      expect(status).not.toHaveClass("border")
      expect(status).not.toHaveClass("rounded-none")
      expect(status).not.toHaveClass("backdrop-blur-md")
      expect(status).toHaveClass(
        "pointer-events-none",
        "absolute",
        "bottom-6",
        "left-1/2",
        "isolate",
        "overflow-hidden",
        "max-w-[calc(100%-1.5rem)]"
      )
      expect(
        status.querySelector("svg.application-development-takeover-icon")
      ).toHaveAttribute("aria-hidden", "true")
    }
  )

  it("animates the status sheen and icon only while active and disables both for reduced motion", () => {
    expect(styles).toMatch(
      /\.application-development-takeover::before\s*\{[^}]*animation: application-development-takeover-sheen[^}]*infinite\s+paused/
    )
    expect(styles).toMatch(
      /\.application-development-takeover-icon\s*\{[^}]*animation: application-development-takeover-pulse[^}]*infinite\s+paused/
    )
    expect(styles).toMatch(
      /\.application-development-takeover\[aria-hidden="false"\]::before,[\s\S]*?\.application-development-takeover-icon\s*\{\s*animation-play-state: running/
    )
    expect(styles).toContain(
      "@keyframes application-development-takeover-sheen"
    )
    expect(styles).toContain(
      "@keyframes application-development-takeover-pulse"
    )
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.application-development-takeover::before,[\s\S]*\.application-development-takeover-icon\s*\{\s*animation: none/
    )
  })

  it("masks the content out, pauses inactive animation and respects reduced motion", () => {
    expect(styles).toContain("mask-composite: exclude")
    expect(styles).toContain("infinite paused")
    expect(styles).toContain("transition: opacity 350ms ease-out")
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/
    )
    expect(styles).toContain("--development-glow-color: var(--app-selection)")
    expect(styles).not.toContain("var(--color-sky-300)")
    expect(styles).toMatch(
      /\.application-development-glow\s*\{\s*border-radius: 6px/
    )
    expect(styles).toContain("background: var(--development-glow-color)")
    expect(styles).toContain("color: var(--color-white)")
    expect(styles).not.toContain("border-color:")
    expect(styles).toMatch(
      /\.application-development-glow::after\s*\{\s*padding: 2px/
    )
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.application-development-takeover-icon[\s\S]*animation: none/
    )
  })

  it("keeps the stronger preview perimeter and its orbit and breathing speed", () => {
    expect(styles).toMatch(
      /inset 0 0 0 2px\s+color-mix\(in srgb, var\(--development-glow-color\) 50%, transparent\)/
    )
    expect(styles).toContain(
      "application-development-glow-orbit 3.6s linear infinite paused"
    )
    expect(styles).toContain(
      "application-development-glow-breathe 2.4s ease-in-out infinite"
    )
  })

  it("slows each sweep across the full cycle while retaining the 1.8-second repeat frequency", () => {
    expect(styles).toContain(
      "application-development-takeover-sheen 1.8s linear infinite paused"
    )
    expect(styles).toMatch(
      /@keyframes application-development-takeover-sheen\s*\{\s*0%\s*\{\s*opacity: 0;\s*transform: translateX\(-150%\) skewX\(-18deg\);\s*\}\s*20%,\s*80%\s*\{\s*opacity: 1;\s*\}\s*100%\s*\{\s*opacity: 0;\s*transform: translateX\(350%\) skewX\(-18deg\);/
    )
  })
})
