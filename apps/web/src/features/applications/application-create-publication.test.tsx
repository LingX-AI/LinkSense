vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"

import { ApiError, apiRequest } from "@/api/client"
import { notify } from "@/components/feedback/notification"
import { capabilitySummarySchema } from "@/api/contracts"
import i18n from "@/i18n"
import {
  ApplicationCreateButton,
  ApplicationCreatePage,
} from "./application-catalog-panel"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const id = "10000000-0000-4000-8000-000000000001"
const skillId = "20000000-0000-4000-8000-000000000001"

function renderCreateFlow() {
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
      <MemoryRouter initialEntries={["/capabilities"]}>
        <Routes>
          <Route
            path="/capabilities"
            element={
              <>
                <div data-testid="application-catalog" />
                <ApplicationCreateButton onFeedback={vi.fn()} />
              </>
            }
          />
          <Route
            path="/capabilities/applications/new"
            element={<ApplicationCreatePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function openStandardApplication() {
  const user = userEvent.setup()
  renderCreateFlow()
  await user.click(
    screen.getByRole("button", { name: i18n.t("applications.create") })
  )
  await user.click(
    screen.getByRole("button", {
      name: new RegExp(i18n.t("applications.createStandardApp")),
    })
  )
  await user.type(
    await screen.findByRole("textbox", { name: i18n.t("common.name") }),
    "Research assistant"
  )
  await user.type(
    screen.getByRole("textbox", { name: i18n.t("applications.instructions") }),
    "Use the supplied sources."
  )
  return { user }
}

function mockRequests(withModel = false) {
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path === "/me/model-preference")
      return {
        models: withModel
          ? [
              {
                id: "test-model",
                display_name: "Test Model",
                enabled: true,
                context_window: null,
                supported_reasoning_efforts: ["medium", "high"],
                default_reasoning_effort: "medium",
              },
            ]
          : [],
      }
    if (path === "/applications" || path === `/applications/${id}`)
      return { id }
    if (path.endsWith("/publish"))
      return { version_id: id, version_number: "0.0.1", usage_instructions: "" }
    return { items: [], next_cursor: null }
  })
}

function mockSkillOptions(displayName?: string | null) {
  mockRequests()
  const original = vi.mocked(apiRequest).getMockImplementation()!
  const skill = capabilitySummarySchema.parse({
    id: skillId,
    type: "skill",
    name: "school-data-query",
    ...(displayName === undefined ? {} : { display_name: displayName }),
    slug: "campus-query-alias",
    description: "Query authorized school data through a connected service.",
    status: "active",
    source_type: "local",
    marketplace_listing_id: null,
    marketplace_release_id: null,
    logo_url: null,
    is_owner: true,
    can_manage: true,
    can_govern: false,
    can_select: true,
    has_logo: false,
    preference_status: "enabled",
    manifest: null,
    risk_summary: null,
    created_at: "2026-11-06T00:00:00Z",
    updated_at: "2026-11-06T00:00:00Z",
  })
  vi.mocked(apiRequest).mockImplementation(async (path, options) =>
    path === "/capabilities"
      ? { items: [skill], next_cursor: null }
      : original(path, options)
  )
}

describe("create and publish a standard application", () => {
  it.each(supportedLocales)(
    "finds a personal Skill by its display name and submits its existing ID in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockSkillOptions("学校数据查询")
      const success = vi.spyOn(notify, "success")
      const { user } = await openStandardApplication()
      const selector = screen.getByRole("combobox", {
        name: i18n.t("applications.skills"),
      })
      await user.click(selector)
      await user.type(selector, "学校")
      await user.click(
        await screen.findByRole("option", { name: /学校数据查询/u })
      )
      expect(
        screen.getByRole("button", {
          name: i18n.t("applications.removeResource", { name: "学校数据查询" }),
        })
      ).toBeVisible()
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("applications.createAndPublish"),
        })
      )
      await waitFor(() => expect(success).toHaveBeenCalledOnce())
      expect(apiRequest).toHaveBeenCalledWith(
        "/applications",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ capability_ids: [skillId] }),
        })
      )
    }
  )

  it.each(["school-data-query", "campus-query-alias", "authorized school"])(
    "finds a renamed Skill by its technical name, alias or description using %s",
    async (search) => {
      await i18n.changeLanguage("zh-CN")
      mockSkillOptions("学校数据查询")
      const { user } = await openStandardApplication()
      const selector = screen.getByRole("combobox", { name: "Skill" })
      await user.click(selector)
      await user.type(selector, search)
      expect(
        await screen.findByRole("option", { name: /学校数据查询/u })
      ).toBeVisible()
    }
  )

  it.each([undefined, null])(
    "keeps an existing Skill selectable when its display name is %s",
    async (displayName) => {
      await i18n.changeLanguage("zh-CN")
      mockSkillOptions(displayName)
      const { user } = await openStandardApplication()
      const selector = screen.getByRole("combobox", { name: "Skill" })
      await user.click(selector)
      await user.type(selector, "school-data-query")
      await user.click(
        await screen.findByRole("option", { name: /School Data Query/u })
      )
      expect(
        screen.getByRole("button", { name: "移除 School Data Query" })
      ).toBeVisible()
    }
  )

  it.each(supportedLocales)(
    "requires reasoning effort only when a fixed model is selected in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockRequests(true)
      const { user } = await openStandardApplication()
      const reasoning = screen.getByRole("combobox", {
        name: i18n.t("applications.reasoningEffort"),
      })
      const label = reasoning
        .closest('[data-slot="field"]')
        ?.querySelector('[data-slot="field-label"]')
      expect(label).not.toHaveTextContent("*")
      expect(reasoning).not.toHaveAttribute("aria-required", "true")

      const model = screen.getByRole("combobox", {
        name: i18n.t("applications.model"),
      })
      await user.click(model)
      await user.click(
        await screen.findByRole("option", { name: "Test Model" })
      )
      const indicator = label?.querySelector('span[aria-hidden="true"]')
      expect(indicator).toHaveTextContent("*")
      expect(indicator).toHaveClass("text-destructive")
      expect(reasoning).toHaveAttribute("aria-required", "true")

      await user.click(model)
      await user.click(
        await screen.findByRole("option", {
          name: i18n.t("applications.userSelectedModel"),
        })
      )
      expect(label).not.toHaveTextContent("*")
      expect(reasoning).not.toHaveAttribute("aria-required", "true")
    }
  )

  it.each([
    ["zh-CN", "创建"],
    ["en-US", "Create"],
    ["de-DE", "创建"],
  ])(
    "prefills the first version with a fixed prefix and publishes after creation in %s",
    async (locale, label) => {
      await i18n.changeLanguage(locale)
      const success = vi.spyOn(notify, "success")
      mockRequests()
      const { user } = await openStandardApplication()
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
      await waitFor(() => expect(success).toHaveBeenCalledOnce())
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
      expect(await screen.findByTestId("application-catalog")).toBeVisible()
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

  it("keeps a failed publication on the page and retries the same application without creating duplicates", async () => {
    await i18n.changeLanguage("zh-CN")
    const success = vi.spyOn(notify, "success")
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
    const { user } = await openStandardApplication()
    await user.click(screen.getByRole("button", { name: "创建" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(success).not.toHaveBeenCalled()
    expect(screen.queryByTestId("application-catalog")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "版本号" })).toHaveValue("0.0.1")
    await user.click(screen.getByRole("button", { name: "创建" }))
    await waitFor(() => expect(success).toHaveBeenCalledOnce())
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
