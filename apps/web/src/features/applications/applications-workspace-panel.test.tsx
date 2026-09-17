import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applicationSchema, type Application } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationsWorkspacePanel } from "./application-center-panel"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const id = "11000000-0000-4000-8000-000000000001"
const sharedId = "11000000-0000-4000-8000-000000000002"
const groupId = "11000000-0000-4000-8000-000000000003"
const installedId = "11000000-0000-4000-8000-000000000004"
const timestamp = "2026-09-16T00:00:00Z"
function application(
  applicationId: string,
  name: string,
  access: Application["access_source"]
) {
  return applicationSchema.parse({
    id: applicationId,
    owner: { id, name: "Publisher" },
    name,
    icon: { type: "preset", preset: "bot" },
    description: null,
    instructions: access === "owner" ? "Generate reports" : null,
    model: null,
    reasoning_effort: null,
    status: "active",
    is_owner: access === "owner",
    can_manage: access === "owner",
    access_source: access,
    capability_count: 0,
    knowledge_base_count: 0,
    mcp_server_count: 0,
    dependencies_available: true,
    capabilities: [],
    knowledge_bases: [],
    mcp_servers: [],
    created_at: timestamp,
    updated_at: timestamp,
  })
}
const owned = application(id, "Created report", "owner")
const installed = application(installedId, "Installed report", "owner")
const shared = application(sharedId, "Member report", "direct")
const group = application(groupId, "Group report", "user_group")
const release = {
  id,
  application_id: sharedId,
  version_id: sharedId,
  version_number: "1.0.0",
  name: "Center report",
  kind: "standard",
  description: null,
  usage_instructions: "Write reports",
  publisher_name: "Publisher",
  usage_modes: ["service"],
  release_notes: "Release",
  status: "approved",
  listing_status: "published",
  review_comment: null,
  suspension_reason: null,
  submitted_at: timestamp,
  reviewed_at: timestamp,
  installed_application_id: null,
}
function LocationProbe() {
  return (
    <output data-testid="application-location">{useLocation().search}</output>
  )
}
function show(
  url = "/capabilities?section=application",
  organizationSharingEnabled = true
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ApplicationsWorkspacePanel
          onFeedback={vi.fn()}
          organizationSharingEnabled={organizationSharingEnabled}
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  )
}
function mockCatalog() {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (path === "/applications")
      return {
        items:
          options?.query?.scope === "owned"
            ? [owned, installed]
            : [shared, group],
      }
    if (path === "/application-center") return { items: [release] }
    return { items: [] }
  })
}

describe("three application categories", () => {
  it.each(["zh-CN", "en-US"])(
    "opens resource declarations separately from import and returns to the choices in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockCatalog()
      show()
      const user = userEvent.setup()
      await user.click(
        await screen.findByRole("button", {
          name: i18n.t("applications.create"),
        })
      )
      const declaration = screen.getByRole("button", {
        name: i18n.t("applications.declaration.title"),
      })
      expect(declaration.parentElement?.closest("button")).toBeNull()
      expect(declaration).toHaveClass("h-6", "text-xs")
      expect(declaration).toHaveClass("font-normal", "text-muted-foreground")
      expect(
        declaration.querySelector('svg[data-icon="inline-end"]')
      ).toHaveAttribute("aria-hidden", "true")
      await user.click(declaration)
      expect(
        await screen.findByRole("dialog", {
          name: i18n.t("applications.declaration.title"),
        })
      ).toBeVisible()
      expect(
        screen.queryByText(i18n.t("applications.applicationPackage"))
      ).not.toBeInTheDocument()
      const [closeButton] = screen.getAllByRole("button", {
        name: i18n.t("common.close"),
      })
      if (!closeButton) throw new Error("Expected dialog close button")
      await user.click(closeButton)
      expect(
        await screen.findByRole("dialog", {
          name: i18n.t("applications.createTitle"),
        })
      ).toBeVisible()
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.some(([, options]) => options?.method === "POST")
      ).toBe(false)
    }
  )
  it.each(["zh-CN", "en-US"])(
    "separates personal, shared and center applications in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockCatalog()
      show()
      const tabs = screen.getByRole("tablist", {
        name: i18n.t("applications.scopeLabel"),
      })
      expect(
        within(tabs)
          .getAllByRole("tab")
          .map((tab) => tab.textContent)
      ).toEqual([
        i18n.t("applications.distribution.myApplications"),
        i18n.t("applications.distribution.sharedApplications"),
        i18n.t("applications.distribution.center"),
      ])
      expect(
        await screen.findByRole("heading", { name: owned.name })
      ).toBeVisible()
      expect(
        screen.getByRole("heading", { name: installed.name })
      ).toBeVisible()
      expect(
        screen.queryByRole("heading", { name: shared.name })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("combobox", {
          name: i18n.t("applications.scopeLabel"),
        })
      ).not.toBeInTheDocument()
      await userEvent.click(
        within(tabs).getByRole("tab", {
          name: i18n.t("applications.distribution.sharedApplications"),
        })
      )
      expect(
        await screen.findByRole("heading", { name: shared.name })
      ).toBeVisible()
      expect(screen.getByRole("heading", { name: group.name })).toBeVisible()
      expect(
        screen.queryByRole("heading", { name: owned.name })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: i18n.t("applications.create") })
      ).not.toBeInTheDocument()
      await userEvent.type(
        screen.getByRole("textbox", { name: i18n.t("applications.search") }),
        "report"
      )
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          "/applications",
          expect.objectContaining({
            query: { scope: "shared", search: "report" },
          })
        )
      )
      await userEvent.click(
        within(tabs).getByRole("tab", {
          name: i18n.t("applications.distribution.center"),
        })
      )
      expect(await screen.findByText("Center report")).toBeVisible()
      expect(screen.getByTestId("application-location")).toHaveTextContent(
        "app_scope=center"
      )
      expect(screen.getByTestId("application-location")).toHaveTextContent(
        "section=application"
      )
      expect(apiRequest).not.toHaveBeenCalledWith(
        "/applications",
        expect.objectContaining({
          query: expect.objectContaining({ scope: "all" }),
        })
      )
    }
  )

  it.each(["shared", "center"])(
    "restores the %s category from the URL",
    async (tab) => {
      await i18n.changeLanguage("zh-CN")
      mockCatalog()
      show(`/capabilities?section=application&app_scope=${tab}`)
      expect(
        screen.getByRole("tab", {
          name: tab === "shared" ? "共享给我的应用" : "应用中心",
        })
      ).toHaveAttribute("aria-selected", "true")
      expect(
        await screen.findByText(
          tab === "shared" ? shared.name : "Center report"
        )
      ).toBeVisible()
      expect(apiRequest).not.toHaveBeenCalledWith(
        "/applications",
        expect.objectContaining({
          query: expect.objectContaining({ scope: "owned" }),
        })
      )
    }
  )

  it.each(["shared", "center"])(
    "keeps personal access only when an organization-restricted user opens %s",
    async (tab) => {
      await i18n.changeLanguage("zh-CN")
      mockCatalog()
      show(`/capabilities?section=application&app_scope=${tab}`, false)
      expect(
        await screen.findByRole("heading", { name: owned.name })
      ).toBeVisible()
      expect(
        screen.queryByRole("tab", { name: "共享给我的应用" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("tab", { name: "应用中心" })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId("application-location")).toHaveTextContent(
        "app_scope=owned"
      )
      expect(apiRequest).not.toHaveBeenCalledWith(
        "/application-center",
        expect.anything()
      )
      expect(apiRequest).not.toHaveBeenCalledWith(
        "/applications",
        expect.objectContaining({
          query: expect.objectContaining({ scope: "shared" }),
        })
      )
    }
  )

  it("returns a newly installed shared application to My applications and clears the previous search", async () => {
    await i18n.changeLanguage("zh-CN")
    let didInstall = false
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === `/applications/${sharedId}/install`) {
        didInstall = true
        return installed
      }
      if (path === "/applications")
        return {
          items:
            options?.query?.scope === "shared"
              ? [shared]
              : didInstall
                ? [installed]
                : [],
        }
      if (path === "/applications/distribution")
        return {
          items: [
            {
              application_id: sharedId,
              published_version_id: sharedId,
              published_version_number: "1.0.0",
              usage_modes: ["install"],
              installation: null,
              installed_application_id: didInstall ? installedId : null,
            },
          ],
        }
      return { items: [] }
    })
    show("/capabilities?section=application&app_scope=shared&app_search=Member")
    await userEvent.click(
      await screen.findByRole("button", { name: "安装应用" })
    )
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "安装应用" })
    )
    expect(
      await screen.findByRole("heading", { name: installed.name })
    ).toBeVisible()
    expect(screen.getByRole("tab", { name: "我的应用" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByTestId("application-location")).not.toHaveTextContent(
      "app_search="
    )
    expect(
      screen.queryByRole("heading", { name: shared.name })
    ).not.toBeInTheDocument()
  })

  it("uses Chinese category labels when an English translation is missing", () => {
    const instance = i18n.cloneInstance({ forkResourceStore: true })
    instance.removeResourceBundle("en-US", "translation")
    expect(
      instance.t("applications.distribution.myApplications", { lng: "en-US" })
    ).toBe("我的应用")
    expect(
      instance.t("applications.distribution.sharedApplications", {
        lng: "en-US",
      })
    ).toBe("共享给我的应用")
    expect(
      instance.t("applications.distribution.center", { lng: "en-US" })
    ).toBe("应用中心")
  })
})
