import { preloadApplicationDestination } from "./application-page-loaders"
import { StrictMode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applicationDevelopmentSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { applicationDevelopmentKeys } from "./application-development-api"
import {
  useOpenApplicationConversation,
  useOpenApplicationDevelopment,
} from "./application-opening"
import { ApplicationOpeningPage } from "./application-opening-page"

vi.mock("./application-page-loaders", () => ({
  preloadApplicationDestination: vi.fn(),
}))

const auth = vi.hoisted(() => ({ userId: "owner" }))
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: auth.userId } }),
}))
const id = "10000000-0000-4000-8000-000000000001"
const task = "20000000-0000-4000-8000-000000000001"
const project = applicationDevelopmentSchema.parse({
  id,
  conversation_id: task,
  name: "Example",
  directory: "applications/example",
  application_id: null,
  preview_application_id: null,
  preview_conversation_id: null,
  preview_current: false,
  revision: 0,
  source_hash: null,
  installed_source_hash: null,
  source_error: null,
  manifest: null,
  diagnostics: [],
  updated_at: "2026-09-19T00:00:00Z",
})
const clients: QueryClient[] = []
beforeEach(() => {
  auth.userId = "owner"
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Uninitialized")
  }
  let reject: (error: Error) => void = () => {
    throw new Error("Uninitialized")
  }
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function Launcher() {
  const develop = useOpenApplicationDevelopment()
  const use = useOpenApplicationConversation()
  const center = useOpenApplicationConversation("center")
  return (
    <>
      <button onClick={() => develop.mutate({ developmentId: id })}>
        develop
      </button>
      <button onClick={() => develop.mutate({ applicationId: id })}>
        new version
      </button>
      <button onClick={() => develop.mutate({ name: "Example" })}>
        create
      </button>
      <button onClick={() => use.mutate({ id, kind: "interactive" })}>
        use
      </button>
      <button onClick={() => center.mutate({ id, kind: "standard" })}>
        center
      </button>
      <button
        onClick={() => {
          use.mutate({ id, kind: "interactive" })
          use.mutate({ id, kind: "interactive" })
        }}
      >
        twice
      </button>
    </>
  )
}
function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>
}
function show(entry = "/list") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const tree = () => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Link to="/elsewhere">leave</Link>
          <Link to="/list">list</Link>
          <Location />
          <Routes>
            <Route path="/list" element={<Launcher />} />
            <Route
              path="/applications/open/:openingId"
              element={<ApplicationOpeningPage />}
            />
            <Route path="*" element={<p>ready</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  )
  return { ...render(tree()), client, tree }
}

describe("immediate application opening", () => {
  it.each(["develop", "use", "center"])(
    "shows the shared Loading after opening %s while the request is pending",
    async (button) => {
      const request = deferred<typeof project>()
      vi.mocked(apiRequest).mockReturnValue(request.promise)
      show()
      fireEvent.click(screen.getByRole("button", { name: button }))
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/applications/open/"
      )
      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
      expect(screen.getByRole("status")).toHaveClass(
        "page-state-loading",
        "size-full"
      )
      expect(screen.getByRole("status")).toHaveTextContent(
        i18n.t("common.pageLoading")
      )
      expect(
        document.querySelector('[data-slot="skeleton"]')
      ).not.toBeInTheDocument()
      await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
    }
  )

  it.each([
    ["zh-CN", "develop", `/application-developments/${id}/resume`],
    ["en-US", "new version", `/application-developments/by-application/${id}`],
    ["de", "create", "/application-developments"],
  ])(
    "opens the shared Loading before the development API responds in %s",
    async (locale, button, path) => {
      await i18n.changeLanguage(locale)
      const request = deferred<typeof project>()
      vi.mocked(apiRequest).mockReturnValue(request.promise)
      const { client } = show()
      const refresh = deferred<void>()
      vi.spyOn(client, "invalidateQueries").mockReturnValue(refresh.promise)
      fireEvent.click(screen.getByRole("button", { name: button }))
      expect(preloadApplicationDestination).toHaveBeenCalledExactlyOnceWith(
        false
      )
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/applications/open/"
      )
      expect(
        screen.queryByRole("button", { name: button })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent(
        locale === "en-US" ? "Loading…" : "正在加载…"
      )
      expect(screen.getByRole("status")).toHaveClass(
        "page-state-loading",
        "size-full"
      )
      expect(
        document.querySelector('[data-slot="skeleton"]')
      ).not.toBeInTheDocument()
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledExactlyOnceWith(
          path,
          expect.objectContaining({ method: "POST" })
        )
      )
      await act(async () => {
        request.resolve(project)
      })
      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent(
          `/conversations/${task}`
        )
      )
      expect(
        client.getQueryData(
          applicationDevelopmentKeys.conversation("owner", task)
        )
      ).toEqual(project)
      expect(
        client.getQueryData(
          applicationDevelopmentKeys.conversation("other", task)
        )
      ).toBeUndefined()
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      await act(async () => refresh.resolve(undefined))
    }
  )

  it.each([
    ["use", "direct", `/applications/${id}/run/${task}`],
    ["center", "center", `/conversations/${task}`],
  ])(
    "opens %s immediately and preserves the installation channel",
    async (button, channel, path) => {
      const request = deferred<{ conversation_id: string }>()
      vi.mocked(apiRequest).mockReturnValue(request.promise)
      show()
      fireEvent.click(screen.getByRole("button", { name: button }))
      expect(preloadApplicationDestination).toHaveBeenCalledExactlyOnceWith(
        button === "use"
      )
      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/applications/open/"
      )
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledExactlyOnceWith(
          `/applications/${id}/conversations`,
          expect.objectContaining({ body: { channel } })
        )
      )
      await act(async () => request.resolve({ conversation_id: task }))
      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent(path)
      )
    }
  )

  it("does not redirect the user after they leave the loading page", async () => {
    const request = deferred<{ conversation_id: string }>()
    vi.mocked(apiRequest).mockReturnValue(request.promise)
    show()
    fireEvent.click(screen.getByRole("button", { name: "use" }))
    fireEvent.click(screen.getByRole("link", { name: "leave" }))
    await act(async () => request.resolve({ conversation_id: task }))
    expect(screen.getByTestId("location")).toHaveTextContent("/elsewhere")
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it("deduplicates rapid clicks and Strict Mode remounts", async () => {
    const request = deferred<{ conversation_id: string }>()
    vi.mocked(apiRequest).mockReturnValue(request.promise)
    const view = show()
    fireEvent.click(screen.getByRole("button", { name: "twice" }))
    view.rerender(view.tree())
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
    await act(async () => request.resolve({ conversation_id: task }))
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    )
  })

  it("shows failure at the destination and retries only on an explicit click", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Failed"))
    show()
    fireEvent.click(screen.getByRole("button", { name: "use" }))
    await screen.findByRole("alert")
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/applications/open/"
    )
    expect(apiRequest).toHaveBeenCalledTimes(1)
    vi.mocked(apiRequest).mockResolvedValue({ conversation_id: task })
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/applications/${id}/run/${task}`
      )
    )
    expect(apiRequest).toHaveBeenCalledTimes(2)
  })

  it("does not replay a creation request when a loading URL is refreshed or belongs to another account", async () => {
    show(`/applications/open/${id}`)
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("applications.opening.expired")
    )
    expect(apiRequest).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("applications.opening.back") })
    )
    expect(screen.getByTestId("location")).toHaveTextContent("/capabilities")
  })

  it("hides the previous account's pending operation after account switching", async () => {
    const request = deferred<{ conversation_id: string }>()
    vi.mocked(apiRequest).mockReturnValue(request.promise)
    const view = show()
    fireEvent.click(screen.getByRole("button", { name: "use" }))
    auth.userId = "other"
    view.rerender(view.tree())
    await screen.findByRole("alert")
    await act(async () => request.resolve({ conversation_id: task }))
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/applications/open/"
    )
  })

  it("caches a pending retry under its initiating account even if the account changes", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Failed"))
    const view = show()
    fireEvent.click(screen.getByRole("button", { name: "develop" }))
    await screen.findByRole("alert")
    const request = deferred<typeof project>()
    vi.mocked(apiRequest).mockReturnValue(request.promise)
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
    auth.userId = "other"
    view.rerender(view.tree())
    await screen.findByRole("alert")
    await act(async () => request.resolve(project))
    expect(
      view.client.getQueryData(
        applicationDevelopmentKeys.conversation("owner", task)
      )
    ).toEqual(project)
    expect(
      view.client.getQueryData(
        applicationDevelopmentKeys.conversation("other", task)
      )
    ).toBeUndefined()
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/applications/open/"
    )
  })
})
