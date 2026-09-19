vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationCreateButton } from "./application-catalog-panel"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const id = "10000000-0000-4000-8000-000000000001"

async function openStandardApplication() {
  const feedback = vi.fn()
  const user = userEvent.setup()
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>
        <ApplicationCreateButton onFeedback={feedback} />
      </MemoryRouter>
    </QueryClientProvider>
  )
  await user.click(
    screen.getByRole("button", { name: i18n.t("applications.create") })
  )
  await user.click(
    screen.getByRole("button", {
      name: new RegExp(i18n.t("applications.createStandardApp")),
    })
  )
  await user.type(
    screen.getByRole("textbox", { name: i18n.t("common.name") }),
    "Research assistant"
  )
  await user.type(
    screen.getByRole("textbox", { name: i18n.t("applications.instructions") }),
    "Use the supplied sources."
  )
  return { user, feedback }
}

function mockRequests() {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === "/me/model-preference") return { models: [] }
    if (path === "/applications" || path === `/applications/${id}`)
      return { id }
    if (path.endsWith("/publish"))
      return { version_id: id, version_number: "0.0.1", usage_instructions: "" }
    return { items: [], next_cursor: null }
  })
}

describe("create and publish a standard application", () => {
  it.each([
    ["zh-CN", "创建"],
    ["en-US", "Create"],
    ["fr-FR", "创建"],
  ])(
    "prefills the first version with a fixed prefix and publishes after creation in %s",
    async (locale, label) => {
      await i18n.changeLanguage(locale)
      mockRequests()
      const { user, feedback } = await openStandardApplication()
      const version = screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
      expect(version).toHaveValue("0.0.1")
      expect(version).toBeRequired()
      expect(
        version
          .closest('[data-slot="input-group"]')
          ?.querySelector('[data-slot="input-group-addon"]')
      ).toHaveTextContent("v")
      expect(apiRequest).not.toHaveBeenCalledWith(
        "/applications",
        expect.objectContaining({ method: "POST" })
      )
      await user.click(screen.getByRole("button", { name: label }))
      await waitFor(() => expect(feedback).toHaveBeenCalledOnce())
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/publish`,
        expect.objectContaining({
          method: "POST",
          body: { version_number: "0.0.1", usage_instructions: "" },
        })
      )
      const mutations = vi
        .mocked(apiRequest)
        .mock.calls.filter(([, options]) => options?.method === "POST")
      expect(mutations.map(([path]) => path)).toEqual([
        "/applications",
        `/applications/${id}/publish`,
      ])
    }
  )

  it("requires a numeric triplet and submits the edited version without its fixed prefix", async () => {
    await i18n.changeLanguage("zh-CN")
    mockRequests()
    const { user } = await openStandardApplication()
    const version = screen.getByRole("textbox", { name: "版本号" })
    const submit = screen.getByRole("button", { name: "创建" })
    for (const value of ["", "1.2", "01.2.3", "1.2.3-beta", "1.2.3+build.1"]) {
      await user.clear(version)
      if (value) await user.type(version, value)
      expect(submit).toBeDisabled()
      expect(version).toHaveAttribute("aria-invalid", "true")
    }
    await user.clear(version)
    await user.type(version, "v2.3.4")
    expect(version).toHaveValue("2.3.4")
    await user.click(submit)
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/publish`,
        expect.objectContaining({
          body: { version_number: "2.3.4", usage_instructions: "" },
        })
      )
    )
  })

  it("keeps a failed publication open and retries the same application without creating duplicates", async () => {
    await i18n.changeLanguage("zh-CN")
    mockRequests()
    const original = vi.mocked(apiRequest).getMockImplementation()!
    let attempts = 0
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path.endsWith("/publish") && attempts++ === 0)
        throw new ApiError({
          status: 409,
          errorCode: "APPLICATION_DEPENDENCY_UNAVAILABLE",
        })
      return original(path, options)
    })
    const { user, feedback } = await openStandardApplication()
    await user.click(screen.getByRole("button", { name: "创建" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(feedback).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "版本号" })).toHaveValue("0.0.1")
    await user.click(screen.getByRole("button", { name: "创建" }))
    await waitFor(() => expect(feedback).toHaveBeenCalledOnce())
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.filter(
          ([path, options]) =>
            path === "/applications" && options?.method === "POST"
        )
    ).toHaveLength(1)
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}`,
      expect.objectContaining({ method: "PATCH" })
    )
  })
})
