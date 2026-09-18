import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentPublishDialog } from "./application-development-publish-dialog"
import { applicationDistributionKeys } from "./application-distribution-queries"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

const id = "11000000-0000-4000-8000-000000000001"
let busy = false
let fail = false
const clients: QueryClient[] = []
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.useFakeTimers()
  busy = false
  fail = false
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path.endsWith("/publication-readiness")) {
      if (fail) throw new Error("offline")
      return { has_active_tasks: busy }
    }
    return {
      version_number: "1.0.1",
      highest_version_number: "1.0.0",
      usage_instructions: "Guide",
    }
  })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.useRealTimers()
  vi.resetAllMocks()
})
function show(cached?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  if (cached !== undefined)
    client.setQueryData(applicationDistributionKeys.publicationReadiness(id), {
      has_active_tasks: cached,
    })
  const confirm = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <ApplicationDevelopmentPublishDialog
        applicationId={id}
        name="Reports"
        updating
        pending={false}
        changed={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={confirm}
      />
    </QueryClientProvider>
  )
  return { ...view, confirm }
}
async function tick(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
const submit = () =>
  screen.getByRole("button", {
    name: i18n.t("applicationDevelopment.publish.confirm"),
  })

describe("publication activity preflight", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "shows task activity, blocks publishing, and automatically recovers without resetting the form in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      busy = true
      const { confirm } = show()
      expect(submit()).toBeDisabled()
      expect(
        screen.getByText(i18n.t("applicationDevelopment.publish.checking"))
      ).toBeVisible()
      await tick()
      expect(
        screen.getByText(i18n.t("applicationDevelopment.publish.activeTasks"))
      ).toBeVisible()
      expect(submit()).toBeDisabled()
      fireEvent.click(submit())
      expect(confirm).not.toHaveBeenCalled()
      fireEvent.change(
        screen.getByRole("textbox", {
          name: i18n.t("applications.distribution.versionNumber"),
        }),
        { target: { value: "2.0.0" } }
      )
      busy = false
      await tick(3_010)
      expect(submit()).toBeEnabled()
      expect(
        screen.queryByText(i18n.t("applicationDevelopment.publish.activeTasks"))
      ).not.toBeInTheDocument()
      fireEvent.click(submit())
      expect(confirm).toHaveBeenCalledWith({
        version_number: "2.0.0",
        usage_instructions: "Guide",
      })
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/publication-readiness`,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    }
  )

  it("requires a fresh check on open even if cached status says the app is idle", async () => {
    busy = true
    show(false)
    expect(submit()).toBeDisabled()
    await tick()
    expect(submit()).toBeDisabled()
    expect(
      screen.getByText(i18n.t("applicationDevelopment.publish.activeTasks"))
    ).toBeVisible()
  })

  it("disables publishing if a task starts after opening and stops polling after closing", async () => {
    const view = show()
    await tick()
    expect(submit()).toBeEnabled()
    busy = true
    await tick(3_010)
    expect(submit()).toBeDisabled()
    view.unmount()
    const calls = vi.mocked(apiRequest).mock.calls.length
    await tick(6_010)
    expect(apiRequest).toHaveBeenCalledTimes(calls)
  })

  it("fails closed after a check error, including background refresh errors, and supports retry", async () => {
    show()
    await tick()
    expect(submit()).toBeEnabled()
    fail = true
    await tick(3_010)
    expect(submit()).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("applicationDevelopment.publish.checkFailed")
    )
    fail = false
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )
    await tick()
    expect(submit()).toBeEnabled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
