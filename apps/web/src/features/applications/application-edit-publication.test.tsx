import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiRequest } from "@/api/client"
import { applicationSchema } from "@/api/contracts"
import i18n from "@/i18n"
import { ApplicationEditorDialog } from "./application-catalog-panel"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const id = "10000000-0000-4000-8000-000000000001"
const application = applicationSchema.parse({
  id,
  owner: { id, name: "Owner" },
  name: "Review",
  description: "Existing description",
  kind: "standard",
  icon: { type: "preset", preset: "bot" },
  instructions: "Existing instructions",
  model: null,
  reasoning_effort: null,
  status: "active",
  is_owner: true,
  can_manage: true,
  access_source: "owner",
  capability_count: 0,
  knowledge_base_count: 0,
  mcp_server_count: 0,
  dependencies_available: true,
  capabilities: [],
  knowledge_bases: [],
  mcp_servers: [],
  created_at: "2026-09-18T00:00:00Z",
  updated_at: "2026-09-18T00:00:00Z",
})

function show(
  highest: string | null = "1.2.3",
  settingsError?: Error,
  kind: "standard" | "interactive" = "standard"
) {
  const completed = vi.fn(async () => undefined)
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path.endsWith("/distribution/settings")) {
      if (settingsError) throw settingsError
      return {
        version_number: highest ? "1.2.4" : "0.0.1",
        highest_version_number: highest,
        usage_instructions: "Keep the existing guide.",
      }
    }
    if (path === "/me/model-preference") return { models: [] }
    if (path.endsWith("/edit-and-publish")) return application
    return { items: [], next_cursor: null }
  })
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
      <ApplicationEditorDialog
        open
        application={{ ...application, kind }}
        onOpenChange={vi.fn()}
        onCompleted={completed}
      />
    </QueryClientProvider>
  )
  return { completed, user: userEvent.setup() }
}

describe("edit and publish a standard application", () => {
  it("preserves the resource configuration flow of an existing interactive copy", async () => {
    await i18n.changeLanguage("zh-CN")
    const { user, completed } = show(null, undefined, "interactive")
    expect(
      screen.queryByRole("textbox", { name: "版本号" })
    ).not.toBeInTheDocument()
    const submit = screen.getByRole("button", { name: "保存" })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}`,
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          instructions: application.instructions,
        }),
      })
    )
    expect(apiRequest).not.toHaveBeenCalledWith(
      `/applications/${id}/edit-and-publish`,
      expect.anything()
    )
  })
  it.each([
    ["zh-CN", "保存"],
    ["en-US", "Save"],
    ["de-DE", "保存"],
  ])(
    "keeps the current version and saves edited fields in one request in %s",
    async (locale, label) => {
      await i18n.changeLanguage(locale)
      const { completed, user } = show()
      const version = screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
      expect(screen.getByRole("button", { name: label })).toBeDisabled()
      await waitFor(() => expect(version).toHaveValue("1.2.3"))
      expect(
        version
          .closest('[data-slot="input-group"]')
          ?.querySelector('[data-slot="input-group-addon"]')
      ).toHaveTextContent("v")
      const name = screen.getByRole("textbox", { name: i18n.t("common.name") })
      await user.clear(name)
      await user.type(name, "Updated review")
      await user.clear(version)
      await user.type(version, "v2.0.0")
      await user.click(screen.getByRole("button", { name: label }))
      await waitFor(() => expect(completed).toHaveBeenCalledOnce())
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/edit-and-publish`,
        expect.objectContaining({
          method: "POST",
          body: {
            changes: expect.objectContaining({
              name: "Updated review",
              instructions: application.instructions,
            }),
            release: {
              version_number: "2.0.0",
              usage_instructions: "Keep the existing guide.",
            },
          },
        })
      )
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.filter(
            ([, options]) =>
              options?.method === "POST" || options?.method === "PATCH"
          )
      ).toHaveLength(1)
    }
  )

  it("allows keeping the same version when publishing edits", async () => {
    await i18n.changeLanguage("zh-CN")
    const { user, completed } = show()
    const version = screen.getByRole("textbox", { name: "版本号" })
    await waitFor(() => expect(version).toHaveValue("1.2.3"))
    const submit = screen.getByRole("button", { name: "保存" })
    expect(submit).toBeEnabled()
    await user.click(submit)
    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}/edit-and-publish`,
      expect.objectContaining({
        body: expect.objectContaining({
          release: {
            version_number: "1.2.3",
            usage_instructions: "Keep the existing guide.",
          },
        }),
      })
    )
  })

  it("initializes an application with no version to 0.0.1", async () => {
    await i18n.changeLanguage("zh-CN")
    show(null)
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "版本号" })).toHaveValue(
        "0.0.1"
      )
    )
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
  })

  it("keeps publication disabled if version settings cannot be loaded", async () => {
    await i18n.changeLanguage("zh-CN")
    const { user, completed } = show(
      "1.2.3",
      new ApiError({ status: 503, errorCode: "INTERNAL_ERROR" })
    )
    const retry = await screen.findByRole("button", {
      name: i18n.t("common.retry"),
    })
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "版本号" })).toBeDisabled()
    const original = vi.mocked(apiRequest).getMockImplementation()!
    vi.mocked(apiRequest).mockImplementation(async (path, options) =>
      path.endsWith("/distribution/settings")
        ? {
            version_number: "1.2.4",
            highest_version_number: "1.2.3",
            usage_instructions: "Keep the existing guide.",
          }
        : original(path, options)
    )
    await user.click(retry)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    )
    expect(completed).not.toHaveBeenCalled()
  })

  it("rejects invalid or lower versions and retains edits after a rejected publication", async () => {
    await i18n.changeLanguage("zh-CN")
    const { user, completed } = show()
    const version = screen.getByRole("textbox", { name: "版本号" })
    await waitFor(() => expect(version).toHaveValue("1.2.3"))
    const submit = screen.getByRole("button", { name: "保存" })
    for (const value of ["1.2.2", "1.2", "1.3.0-beta"]) {
      await user.clear(version)
      await user.type(version, value)
      expect(submit).toBeDisabled()
    }
    await user.clear(version)
    await user.type(version, "1.2.4")
    const original = vi.mocked(apiRequest).getMockImplementation()!
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path.endsWith("/edit-and-publish"))
        throw new ApiError({
          status: 409,
          errorCode: "APPLICATION_DEPENDENCY_UNAVAILABLE",
        })
      return original(path, options)
    })
    await user.click(submit)
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(version).toHaveValue("1.2.4")
    expect(completed).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("Review")
  })
})
