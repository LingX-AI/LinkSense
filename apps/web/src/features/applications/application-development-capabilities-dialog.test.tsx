import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applicationDevelopmentCapabilitiesUpdateSchema,
  type InteractiveDependencyType,
} from "@linksense/shared"
import { apiRequest, ApiError } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentCapabilitiesDialog } from "./application-development-capabilities-dialog"
import { applicationDevelopmentKeys } from "./application-development-api"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
const id = "10000000-0000-4000-8000-000000000001"
const plugin = { id: "20000000-0000-4000-8000-000000000001", name: "Calendar" }
const skill = { id: "20000000-0000-4000-8000-000000000002", name: "Writing" }
const knowledge = {
  id: "20000000-0000-4000-8000-000000000003",
  name: "Research",
}
const mcp = { id: "20000000-0000-4000-8000-000000000004", name: "Reports" }
const allOptions = {
  plugin: [plugin],
  skill: [skill],
  knowledge_base: [knowledge],
  mcp_server: [mcp],
}
const empty = { source_hash: "a".repeat(64), dependencies: { items: [] } }
const next = { id, source_hash: "b".repeat(64), revision: 2 }
const clients: QueryClient[] = []
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const close = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ApplicationDevelopmentCapabilitiesDialog
        developmentId={id}
        onClose={close}
      />
    </QueryClientProvider>
  )
  return { client, close, user: userEvent.setup() }
}
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (options?.method === "PATCH") return next
    if (path.endsWith("/capabilities")) return empty
    return {
      items:
        allOptions[options?.query?.type as InteractiveDependencyType] ?? [],
      next_cursor: null,
    }
  })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.resetAllMocks()
})
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  type: InteractiveDependencyType,
  name: string
) {
  await user.click(
    await screen.findByRole("combobox", {
      name: i18n.t(`applications.dependencies.types.${type}`),
    })
  )
  await user.click(await screen.findByRole("option", { name }))
  await user.keyboard("{Escape}")
}

describe("development capability editor", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "adds four types to a previously empty manifest and saves them in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { user, close, client } = show()
      expect(
        screen.getByRole("dialog", {
          name: i18n.t("applicationDevelopment.capabilities"),
        })
      ).toBeVisible()
      for (const [type, item] of [
        ["plugin", plugin],
        ["skill", skill],
        ["knowledge_base", knowledge],
        ["mcp_server", mcp],
      ] as const)
        await pick(user, type, item.name)
      await user.click(
        screen.getByRole("button", { name: i18n.t("common.save") })
      )
      await waitFor(() => expect(close).toHaveBeenCalledOnce())
      const request = vi
        .mocked(apiRequest)
        .mock.calls.find(([, options]) => options?.method === "PATCH")
      expect(request?.[0]).toBe(`/application-developments/${id}/capabilities`)
      expect(
        applicationDevelopmentCapabilitiesUpdateSchema.parse(request?.[1]?.body)
      ).toEqual({
        source_hash: empty.source_hash,
        dependencies: {
          plugins: [plugin],
          skills: [skill],
          knowledge_bases: [knowledge],
          mcp_servers: [mcp],
        },
      })
      expect(
        client.getQueryData(applicationDevelopmentKeys.preview("owner", id))
      ).toEqual(next)
      expect(document.body).not.toHaveTextContent("applicationDevelopment.")
    }
  )
  it("retains unavailable selections until removed and permits saving an empty configuration", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (options?.method === "PATCH") return next
      if (path.endsWith("/capabilities"))
        return {
          ...empty,
          dependencies: {
            items: [
              {
                type: "skill",
                ...skill,
                resource_id: null,
                resource_name: null,
                available: false,
              },
            ],
          },
        }
      return { items: [], next_cursor: null }
    })
    const { user, close } = show()
    expect(
      await screen.findByText(
        i18n.t("applicationDevelopment.capabilitiesUnavailable")
      )
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("applications.removeResource", { name: skill.name }),
      })
    )
    await user.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      `/application-developments/${id}/capabilities`,
      expect.objectContaining({
        method: "PATCH",
        body: {
          source_hash: empty.source_hash,
          dependencies: {
            plugins: [],
            skills: [],
            knowledge_bases: [],
            mcp_servers: [],
          },
        },
      })
    )
  })
  it("keeps mapped selections outside the first page, loads more options and searches without dropping chosen items", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path.endsWith("/capabilities"))
        return {
          ...empty,
          dependencies: {
            items: [
              {
                type: "skill",
                id,
                name: "Imported skill",
                resource_id: skill.id,
                resource_name: skill.name,
                available: true,
              },
            ],
          },
        }
      if (options?.query?.type !== "skill")
        return { items: [], next_cursor: null }
      if (options.query.cursor || options.query.search)
        return { items: [mcp], next_cursor: null }
      return { items: [plugin], next_cursor: plugin.id }
    })
    const { user } = show()
    const picker = await screen.findByRole("combobox", { name: "技能" })
    expect(screen.getByText(skill.name)).toBeVisible()
    await user.click(picker)
    await user.click(await screen.findByRole("button", { name: "加载更多" }))
    await user.click(await screen.findByRole("option", { name: mcp.name }))
    await user.keyboard("{Escape}")
    expect(screen.getByText(skill.name)).toBeVisible()
    await user.type(picker, "Report")
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/applications/interactive-dependency-options",
        expect.objectContaining({
          query: expect.objectContaining({ type: "skill", search: "Report" }),
        })
      )
    )
    await user.keyboard("{Escape}")
    expect(
      screen.getByRole("button", {
        name: i18n.t("applications.removeResource", { name: skill.name }),
      })
    ).toBeVisible()
  })
  it("prevents duplicate saves and closing while pending, then preserves selections on a source conflict", async () => {
    let rejectSave: (error: Error) => void = () => {}
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (options?.method === "PATCH")
        return new Promise((_resolve, reject) => {
          rejectSave = reject
        })
      if (path.endsWith("/capabilities")) return empty
      return {
        items: allOptions[options?.query?.type as InteractiveDependencyType],
        next_cursor: null,
      }
    })
    const { user, close } = show()
    await pick(user, "plugin", plugin.name)
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    )
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole("combobox", { name: "插件" })).toBeDisabled()
    await act(async () =>
      rejectSave(
        new ApiError({
          status: 409,
          errorCode: "APPLICATION_DEVELOPMENT_SOURCE_CHANGED",
        })
      )
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("applicationDevelopment.capabilitiesChanged")
    )
    expect(screen.getByText(plugin.name)).toBeVisible()
    expect(screen.getByRole("button", { name: "重新读取配置" })).toBeEnabled()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.filter(([, options]) => options?.method === "PATCH")
    ).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "重新读取配置" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(screen.queryByText(plugin.name)).not.toBeInTheDocument()
  })
  it("shows loading and a retry action on configuration failures without sending an empty replacement", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("offline"))
    const { user, close } = show()
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    await user.click(await screen.findByRole("button", { name: "重试" }))
    expect(close).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.every(([, options]) => options?.method !== "PATCH")
    ).toBe(true)
  })
})
