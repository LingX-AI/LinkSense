import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { BootstrapProvider } from "./bootstrap-context"
import { useBootstrap } from "./bootstrap-state"
import { ClientUpdateNotice } from "@/components/shell/client-update-notice"
import i18n from "@/i18n"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("keeps the old page and unsent input mounted when the next bootstrap poll comes from a new deployment", async () => {
  await i18n.changeLanguage("zh-CN")
  const oldBuild = "a".repeat(64)
  const newBuild = "b".repeat(64)
  vi.stubEnv("VITE_LINKSENSE_BUILD_ID", oldBuild)
  let serverBuild = oldBuild
  const fetchMock = vi.fn(async () =>
    Response.json(
      { success: true, data: { initialized: true } },
      { headers: { "x-linksense-build": serverBuild } }
    )
  )
  vi.stubGlobal("fetch", fetchMock)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Page() {
    const { bootstrap, refetch } = useBootstrap()
    return bootstrap ? (
      <>
        <input aria-label="Draft" />
        <button onClick={refetch}>Poll</button>
      </>
    ) : null
  }
  try {
    render(
      <QueryClientProvider client={queryClient}>
        <BootstrapProvider>
          <Page />
        </BootstrapProvider>
        <ClientUpdateNotice />
      </QueryClientProvider>
    )
    const draft = await screen.findByRole("textbox", { name: "Draft" })
    fireEvent.change(draft, { target: { value: "Keep this unsent work" } })
    serverBuild = newBuild
    fireEvent.click(screen.getByRole("button", { name: "Poll" }))
    await screen.findByRole("dialog", { name: "系统已更新" })
    expect(draft).toHaveValue("Keep this unsent work")
    expect(queryClient.getQueryData(["system", "bootstrap"])).toMatchObject({
      initialized: true,
    })
    fireEvent.click(screen.getByRole("button", { name: "稍后更新" }))
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  } finally {
    queryClient.clear()
  }
})
