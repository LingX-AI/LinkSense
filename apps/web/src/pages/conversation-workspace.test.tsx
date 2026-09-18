import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ConversationWorkspace } from "./conversation-workspace"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
vi.mock("./conversation-pages", () => ({
  ConversationPage: () => <input aria-label="Task draft" />,
}))
vi.mock("@/features/applications/application-development-panel", () => ({
  ApplicationDevelopmentPanel: () => <iframe title="Application preview" />,
}))

let measuredWidth = 1200
const clients: QueryClient[] = []
const development = { id: "development" }
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/conversations/builder"]}>
        <Routes>
          <Route
            path="/conversations/:conversationId"
            element={<ConversationWorkspace />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  measuredWidth = 1200
  vi.mocked(apiRequest).mockResolvedValue(development)
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      width: measuredWidth,
      height: 800,
      x: 0,
      y: 0,
      top: 0,
      bottom: 800,
      left: 0,
      right: measuredWidth,
      toJSON: () => ({}),
    })
  )
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

describe("application development workspace", () => {
  it("drags the chat/preview divider without remounting either pane or losing the draft", async () => {
    show()
    const draft = screen.getByRole("textbox", { name: "Task draft" })
    fireEvent.change(draft, { target: { value: "Keep my draft" } })
    const divider = await screen.findByRole("separator", {
      name: "调整应用预览宽度",
    })
    const preview = screen.getByTitle("Application preview")
    const layout = divider.parentElement
    expect(divider).toHaveAttribute("aria-valuenow", "480")
    fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 480 })
    expect(layout).toHaveAttribute("data-resizing", "true")
    expect(layout).toHaveClass("[&_iframe]:pointer-events-none")
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 640 })
    fireEvent.pointerUp(divider, { pointerId: 1 })
    await waitFor(() => expect(divider).toHaveAttribute("aria-valuenow", "640"))
    expect(layout).toHaveStyle("--application-development-chat-width: 640px")
    expect(layout).not.toHaveAttribute("data-resizing")
    expect(screen.getByRole("textbox")).toBe(draft)
    expect(draft).toHaveValue("Keep my draft")
    expect(screen.getByTitle("Application preview")).toBe(preview)
    expect(preview.parentElement).toHaveClass(
      "border-l",
      "border-[color:var(--app-border)]"
    )
  })

  it("supports keyboard adjustment, clamps both panes, and keeps the chosen ratio when the container changes", async () => {
    show()
    const divider = await screen.findByRole("separator", {
      name: "调整应用预览宽度",
    })
    expect(divider).toHaveAttribute("aria-valuemin", "320")
    expect(divider).toHaveAttribute("aria-valuemax", "720")
    fireEvent.keyDown(divider, { key: "Home" })
    expect(divider).toHaveAttribute("aria-valuenow", "320")
    fireEvent.keyDown(divider, { key: "ArrowLeft" })
    expect(divider).toHaveAttribute("aria-valuenow", "320")
    fireEvent.keyDown(divider, { key: "End" })
    expect(divider).toHaveAttribute("aria-valuenow", "720")
    fireEvent.keyDown(divider, { key: "ArrowRight" })
    expect(divider).toHaveAttribute("aria-valuenow", "720")
    measuredWidth = 1600
    fireEvent(window, new Event("resize"))
    expect(divider).toHaveAttribute("aria-valuenow", "960")
    fireEvent.keyDown(divider, { key: "ArrowLeft", shiftKey: true })
    expect(divider).toHaveAttribute("aria-valuenow", "936")
  })

  it("stacks both panes on narrow containers and restores resizing without reloading the preview", async () => {
    show()
    const divider = await screen.findByRole("separator", {
      name: "调整应用预览宽度",
    })
    const layout = divider.parentElement
    const preview = screen.getByTitle("Application preview")
    measuredWidth = 700
    fireEvent(window, new Event("resize"))
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
    expect(layout).toHaveAttribute("data-compact", "true")
    expect(screen.getByRole("textbox")).toBeVisible()
    expect(preview).toBeVisible()
    expect(preview.parentElement).toHaveClass(
      "border-t",
      "border-[color:var(--app-border)]"
    )
    expect(preview.parentElement).not.toHaveClass("border-l")
    measuredWidth = 1200
    fireEvent(window, new Event("resize"))
    expect(screen.getByRole("separator")).toBeVisible()
    expect(screen.getByTitle("Application preview")).toBe(preview)
  })

  it("keeps regular conversations full width without a preview or divider", async () => {
    vi.mocked(apiRequest).mockResolvedValue(null)
    show()
    await waitFor(() => expect(apiRequest).toHaveBeenCalled())
    expect(screen.getByRole("textbox")).toBeVisible()
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Application preview")).not.toBeInTheDocument()
  })

  it.each(["pointerCancel", "lostPointerCapture"] as const)(
    "finishes an interrupted drag on %s and restores preview interaction",
    async (eventName) => {
      show()
      const divider = await screen.findByRole("separator", {
        name: "调整应用预览宽度",
      })
      fireEvent.pointerDown(divider, { pointerId: 2, button: 0, clientX: 480 })
      fireEvent.pointerMove(divider, { pointerId: 2, clientX: 560 })
      fireEvent[eventName](divider, { pointerId: 2 })
      expect(divider).toHaveAttribute("aria-valuenow", "560")
      expect(divider.parentElement).not.toHaveAttribute("data-resizing")
      expect(divider.parentElement).not.toHaveClass(
        "[&_iframe]:pointer-events-none"
      )
    }
  )
})
