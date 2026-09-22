vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
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
import {
  applicationDetailsSchema,
  applicationSchema,
  type ApplicationCatalogItem,
  type Application,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationsWorkspacePanel } from "./application-center-panel"
import { ApplicationCreateButton } from "./application-catalog-panel"

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
const ownedDistributions = [owned, installed].map((application) => ({
  application_id: application.id,
  published_version_id: application.id,
  published_version_number: "1.0.0",
  usage_modes: ["service"],
  installation: null,
  installed_application_id: null,
  service_installation: {
    installed_version_id: application.id,
    installed_version_number: "1.0.0",
    available_version_id: application.id,
    available_version_number: "1.0.0",
    update_available: false,
  },
}))
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
  return client
}
function mockCatalog(ownedApplications: Application[] = [owned, installed]) {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (path === "/applications/catalog")
      return {
        items: ownedApplications.map((application) => ({
          type: "application",
          application,
          development: null,
        })),
        next_cursor: null,
      }
    if (path === "/applications")
      return {
        items:
          options?.query?.scope === "owned"
            ? ownedApplications
            : [shared, group],
      }
    if (path === "/application-center") return { items: [release] }
    if (path.endsWith("/details"))
      return applicationDetailsSchema.parse({
        id,
        name: "Application overview",
        icon: owned.icon,
        description: "Full description",
        kind: "standard",
        model: null,
        status: "active",
        creator_name: "Publisher",
        view: "configuration",
        version_number: null,
        resources: [],
        created_at: timestamp,
        updated_at: timestamp,
      })
    return {
      items: path === "/applications/distribution" ? ownedDistributions : [],
    }
  })
}

describe("three application categories", () => {
  it.each(["zh-CN", "en-US", "de-DE"])(
    "shows the current standard application version beside its kind in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      mockCatalog([owned])
      show()
      const card = await screen.findByRole("article", { name: owned.name })
      const version = await within(card).findByText("v1.0.0")
      const metadata = card.querySelector(
        '[data-slot="application-card-metadata"]'
      )
      expect(metadata).toContainElement(version)
      expect(metadata).toHaveTextContent(
        i18n.t("applications.details.kinds.standard")
      )
      expect(metadata).toHaveTextContent(i18n.t("applications.status.active"))
    }
  )

  it.each([
    {
      selected: "1.2.0",
      copied: "1.1.0",
      published: "2.0.0",
      expected: "1.2.0",
    },
    { selected: null, copied: "1.1.0", published: "2.0.0", expected: "1.1.0" },
    { selected: null, copied: null, published: "2.0.0", expected: "2.0.0" },
    { selected: null, copied: null, published: null, expected: null },
  ])(
    "uses the actual standard application version without substituting an available update: $expected",
    async ({ selected, copied, published, expected }) => {
      await i18n.changeLanguage("zh-CN")
      mockCatalog([owned])
      const existingRequest = vi.mocked(apiRequest).getMockImplementation()!
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (path === "/applications/distribution")
          return {
            items: [
              {
                ...ownedDistributions[0],
                published_version_number: published,
                service_installation: {
                  installed_version_id: selected ? id : null,
                  installed_version_number: selected,
                  available_version_id: sharedId,
                  available_version_number: "3.0.0",
                  update_available: true,
                },
                installation: copied
                  ? {
                      source_application_id: sharedId,
                      channel: "direct",
                      installed_version_id: id,
                      installed_version_number: copied,
                      latest_version_id: groupId,
                      latest_version_number: "3.0.0",
                      update_available: true,
                      setup_required: false,
                    }
                  : null,
              },
            ],
          }
        return existingRequest(path, options)
      })
      const client = show()
      const card = await screen.findByRole("article", { name: owned.name })
      await waitFor(() => expect(client.isFetching()).toBe(0))
      const metadata = card.querySelector(
        '[data-slot="application-card-metadata"]'
      )
      if (expected) expect(metadata).toHaveTextContent(`v${expected}`)
      else expect(metadata).not.toHaveTextContent(/v\d/)
      expect(metadata).not.toHaveTextContent("v3.0.0")
    }
  )
  it.each([
    ["zh-CN", true],
    ["en-US", true],
    ["de-DE", false],
  ] as const)(
    "groups standard application actions without empty groups in %s (sharing: %s)",
    async (language, sharingEnabled) => {
      await i18n.changeLanguage(language)
      mockCatalog([owned])
      show(undefined, sharingEnabled)
      const card = await screen.findByRole("article", { name: owned.name })
      const user = userEvent.setup()
      await user.click(
        within(card).getByRole("button", {
          name: i18n.t("common.moreActionsNamed", { name: owned.name }),
        })
      )
      const menu = await screen.findByRole("menu")
      const groups = within(menu).getAllByRole("group")
      expect(
        groups.map((group) =>
          within(group)
            .getAllByRole("menuitem")
            .map((item) => item.textContent)
        )
      ).toEqual([
        [i18n.t("common.edit")],
        [
          i18n.t("applicationDevelopment.publish.confirm"),
          ...(sharingEnabled
            ? [
                i18n.t("applications.distribution.direct"),
                i18n.t("applications.distribution.applyListing"),
              ]
            : []),
        ],
        [
          i18n.t("applications.usage.action"),
          i18n.t("applications.externalAccess.action"),
          i18n.t("common.disable"),
        ],
        [i18n.t("applications.deleteAction")],
      ])
      expect(within(menu).getAllByRole("separator")).toHaveLength(3)
      const edit = within(groups[0]).getByRole("menuitem")
      edit.focus()
      await user.keyboard("{ArrowDown}")
      expect(
        within(groups[1]).getByRole("menuitem", {
          name: i18n.t("applicationDevelopment.publish.confirm"),
        })
      ).toHaveFocus()
      await user.keyboard("{Escape}")
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    }
  )
  it.each(["zh-CN", "en-US"])(
    "keeps the published card primary and exposes draft information in details and menu only in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const published = {
        ...owned,
        kind: "interactive" as const,
        description: "Published description",
      }
      const draft = {
        id: sharedId,
        conversation_id: groupId,
        name: "New draft name",
        description: "Unpublished description",
        icon: { type: "preset" as const, preset: "book-open" as const },
        capability_count: 2,
        knowledge_base_count: 1,
        mcp_server_count: 3,
        has_changes: true,
        updated_at: timestamp,
      }
      vi.mocked(apiRequest).mockImplementation(async (path) => {
        if (path === "/applications/catalog")
          return {
            items: [
              {
                type: "application",
                application: published,
                development: draft,
              },
            ],
            next_cursor: null,
          }
        if (path.endsWith("/details"))
          return applicationDetailsSchema.parse({
            id,
            name: published.name,
            icon: published.icon,
            description: published.description,
            kind: "interactive",
            model: null,
            status: "active",
            creator_name: "Publisher",
            view: "configuration",
            version_number: "1.0.0",
            resources: [],
            created_at: timestamp,
            updated_at: timestamp,
          })
        if (path.endsWith("/resume")) return { conversation_id: groupId }
        return {
          items:
            path === "/applications/distribution" ? ownedDistributions : [],
        }
      })
      show()
      const card = await screen.findByRole("article", { name: published.name })
      expect(screen.getAllByRole("article")).toHaveLength(1)
      expect(card).toHaveTextContent("Published description")
      expect(card).not.toHaveTextContent(draft.name)
      expect(card).not.toHaveTextContent(
        i18n.t("applicationDevelopment.catalog.developing")
      )
      expect(
        card.querySelector('[data-slot="application-card-development-overlay"]')
      ).toBeNull()
      const statistics = card.querySelector(
        '[data-slot="application-card-statistics"]'
      )!
      expect(statistics.lastElementChild).toHaveTextContent(
        i18n.t("applicationDevelopment.catalog.newDevelopment")
      )
      expect(
        within(card).getByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).toHaveClass("font-normal")
      expect(
        within(card).queryByRole("button", {
          name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
        })
      ).not.toBeInTheDocument()
      await userEvent.click(
        within(card).getByRole("button", {
          name: i18n.t("applications.details.open", { name: published.name }),
        })
      )
      const dialog = await screen.findByRole("dialog")
      expect(await within(dialog).findByText(draft.name)).toBeVisible()
      expect(dialog).toHaveTextContent(draft.description)
      const draftDetails = within(dialog).getByRole("region", {
        name: i18n.t("applicationDevelopment.catalog.draftDetails"),
      })
      expect(
        within(draftDetails).getByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).toHaveClass("font-normal")
      const draftName = within(draftDetails).getByText(draft.name)
      const draftDescription = within(draftDetails).getByText(draft.description)
      expect(draftName.parentElement).toHaveClass(
        "min-w-0",
        "flex-1",
        "flex-col"
      )
      expect(draftName.nextElementSibling).toBe(draftDescription)
      expect(draftName.parentElement?.previousElementSibling).toContainElement(
        draftDetails.querySelector('[data-application-icon-preset="book-open"]')
      )
      expect(
        draftDetails.querySelector('[data-application-icon-preset="book-open"]')
      ).not.toBeNull()
      expect(draftDetails).toHaveTextContent(
        i18n.t("applications.card.capabilityCount", { count: 2 })
      )
      expect(draftDetails).toHaveTextContent(
        i18n.t("applications.card.knowledgeBaseCount", { count: 1 })
      )
      expect(draftDetails).toHaveTextContent(
        i18n.t("applications.card.mcpServerCount", { count: 3 })
      )
      expect(card).toHaveTextContent(
        i18n.t("applications.card.mcpServerCount", { count: 0 })
      )
      expect(dialog).toHaveTextContent(
        i18n.t("applicationDevelopment.catalog.newDevelopment")
      )
      await userEvent.click(
        within(dialog).getByRole("button", { name: i18n.t("common.close") })
      )
      await userEvent.click(
        within(card).getByRole("button", {
          name: i18n.t("common.moreActionsNamed", { name: published.name }),
        })
      )
      expect(
        await screen.findByRole("menuitem", {
          name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
        })
      ).toBeVisible()
      const menu = screen.getByRole("menu")
      expect(
        within(menu).queryByRole("menuitem", {
          name: /配置所需资源|Configure required resources/,
        })
      ).not.toBeInTheDocument()
      const groups = within(menu).getAllByRole("group")
      expect(
        groups.map((group) =>
          within(group)
            .getAllByRole("menuitem")
            .map((item) => item.textContent)
        )
      ).toEqual([
        [
          i18n.t("common.edit"),
          i18n.t("applications.updateInteractivePackage"),
          i18n.t("applicationDevelopment.catalog.continueDevelopment"),
        ],
        [
          i18n.t("applicationDevelopment.publish.confirm"),
          i18n.t("applications.distribution.direct"),
          i18n.t("applications.distribution.applyListing"),
        ],
        [i18n.t("applications.usage.action"), i18n.t("common.disable")],
        [
          i18n.t("applicationDevelopment.catalog.deleteDraft"),
          i18n.t("applications.deleteAction"),
        ],
      ])
      expect(within(menu).getAllByRole("separator")).toHaveLength(3)
      expect(
        screen.getByRole("menuitem", {
          name: i18n.t("applicationDevelopment.catalog.deleteDraft"),
        })
      ).toHaveAttribute("data-variant", "default")
      expect(
        screen
          .getAllByRole("menuitem")
          .slice(-2)
          .map((item) => item.textContent)
      ).toEqual([
        i18n.t("applicationDevelopment.catalog.deleteDraft"),
        i18n.t("applications.deleteAction"),
      ])
      expect(
        screen.getByRole("menuitem", {
          name: i18n.t("applications.deleteAction"),
        })
      ).toHaveAttribute("data-variant", "destructive")
      await userEvent.click(
        screen.getByRole("menuitem", {
          name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
        })
      )
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-developments/${sharedId}/resume`,
        expect.objectContaining({ method: "POST" })
      )
    }
  )
  it("removes only the draft from a published card and keeps Use opening the published application", async () => {
    await i18n.changeLanguage("zh-CN")
    let hasDraft = true
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === "/applications/catalog")
        return {
          items: [
            {
              type: "application",
              application: { ...owned, kind: "interactive" },
              development: hasDraft
                ? {
                    id: sharedId,
                    conversation_id: groupId,
                    name: "Draft",
                    capability_count: 2,
                    knowledge_base_count: 1,
                    mcp_server_count: 3,
                    has_changes: true,
                    updated_at: timestamp,
                  }
                : null,
            },
          ],
          next_cursor: null,
        }
      if (
        path === `/application-developments/${sharedId}` &&
        options?.method === "DELETE"
      ) {
        hasDraft = false
        return { success: true }
      }
      if (path.endsWith("/conversations")) return { conversation_id: groupId }
      return {
        items: path === "/applications/distribution" ? ownedDistributions : [],
      }
    })
    show()
    const card = await screen.findByRole("article", { name: owned.name })
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: owned.name }),
      })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: i18n.t("applicationDevelopment.catalog.deleteDraft"),
      })
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent(
      i18n.t("applicationDevelopment.catalog.deleteDraftDescription")
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: i18n.t("common.delete") })
    )
    await waitFor(() =>
      expect(
        within(card).queryByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).not.toBeInTheDocument()
    )
    expect(screen.getAllByRole("article")).toHaveLength(1)
    expect(apiRequest).not.toHaveBeenCalledWith(
      `/applications/${id}`,
      expect.objectContaining({ method: "DELETE" })
    )
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("applications.distribution.useService"),
      })
    )
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}/conversations`,
      expect.objectContaining({ method: "POST" })
    )
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: owned.name }),
      })
    )
    expect(
      await screen.findByRole("menuitem", {
        name: i18n.t("applicationDevelopment.catalog.developNewVersion"),
      })
    ).toBeVisible()
  })
  it("clears the new-development notice after publication while keeping the existing development entry", async () => {
    await i18n.changeLanguage("en-US")
    const draft = {
      id: sharedId,
      conversation_id: groupId,
      name: "Draft",
      capability_count: 2,
      knowledge_base_count: 1,
      mcp_server_count: 3,
      has_changes: true,
      updated_at: timestamp,
    }
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path === "/applications/catalog"
        ? {
            items: [
              {
                type: "application",
                application: { ...owned, kind: "interactive" },
                development: { ...draft },
              },
            ],
            next_cursor: null,
          }
        : { items: [] }
    )
    const client = show()
    const card = await screen.findByRole("article", { name: owned.name })
    expect(
      within(card).getByText(
        i18n.t("applicationDevelopment.catalog.newDevelopment")
      )
    ).toBeVisible()
    draft.has_changes = false
    await client.invalidateQueries({ queryKey: ["applications"] })
    await waitFor(() =>
      expect(
        within(card).queryByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).not.toBeInTheDocument()
    )
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: owned.name }),
      })
    )
    expect(
      await screen.findByRole("menuitem", {
        name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
      })
    ).toBeVisible()
  })
  it("publishes interactive metadata and refreshes the card and details together", async () => {
    await i18n.changeLanguage("zh-CN")
    const interactive = { ...owned, kind: "interactive" as const }
    mockCatalog([interactive])
    const original = vi.mocked(apiRequest).getMockImplementation()!
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path.endsWith("/distribution/settings"))
        return {
          version_number: "1.0.1",
          highest_version_number: "1.0.0",
          usage_instructions: "",
        }
      if (path.endsWith("/edit-and-publish")) {
        Object.assign(interactive, {
          name: "Renamed app",
          description: "New description",
          icon: { type: "preset", preset: "book-open" },
        })
        return interactive
      }
      if (path.endsWith("/details"))
        return {
          ...interactive,
          creator_name: "Publisher",
          view: "published",
          version_number: "1.0.1",
          resources: [],
        }
      return original(path, options)
    })
    const client = show()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    await userEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: interactive.name }),
      })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: i18n.t("common.edit"),
      })
    )
    const dialog = screen.getByRole("dialog", {
      name: i18n.t("applications.editMetadata"),
    })
    expect(
      within(dialog).queryByText(i18n.t("applications.instructions"))
    ).not.toBeInTheDocument()
    await userEvent.clear(
      within(dialog).getByRole("textbox", { name: i18n.t("common.name") })
    )
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: i18n.t("common.name") }),
      "Renamed app"
    )
    await userEvent.type(
      within(dialog).getByRole("textbox", {
        name: i18n.t("common.description"),
      }),
      "New description"
    )
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: i18n.t("applications.iconPresets.book-open"),
      })
    )
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: i18n.t("applications.editAndPublish"),
      })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/edit-and-publish`,
        expect.objectContaining({
          method: "POST",
          body: {
            release: { version_number: "1.0.0", usage_instructions: "" },
            changes: {
              name: "Renamed app",
              description: "New description",
              icon: { type: "preset", preset: "book-open" },
            },
          },
        })
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["applications"] })
    const card = await screen.findByRole("article", { name: "Renamed app" })
    expect(within(card).getByText("New description")).toBeVisible()
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("applications.details.open", { name: "Renamed app" }),
      })
    )
    const details = await screen.findByRole("dialog")
    expect(await within(details).findByText("Renamed app")).toBeVisible()
    expect(await within(details).findByText("New description")).toBeVisible()
  })
  it("deletes an installed application's draft through its application entry and refreshes task associations", async () => {
    await i18n.changeLanguage("zh-CN")
    const interaction = userEvent.setup()
    let deleted = false
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (
        path === `/applications/${owned.id}` &&
        options?.method === "DELETE"
      ) {
        deleted = true
        return { success: true }
      }
      if (path === "/applications/catalog")
        return {
          items: deleted
            ? []
            : [
                {
                  type: "application",
                  application: { ...owned, kind: "interactive" },
                  development: {
                    id: sharedId,
                    conversation_id: null,
                    name: owned.name,
                    capability_count: 2,
                    knowledge_base_count: 1,
                    mcp_server_count: 3,
                    has_changes: true,
                    updated_at: timestamp,
                  },
                },
              ],
          next_cursor: null,
        }
      return {
        items: path === "/applications/distribution" ? ownedDistributions : [],
      }
    })
    const client = show()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const card = await screen.findByRole("article", { name: owned.name })
    await interaction.click(
      within(card).getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: owned.name }),
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", {
        name: i18n.t("applications.deleteAction"),
      })
    )
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent(
      i18n.t("applicationDevelopment.deleteDescription")
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: i18n.t("common.delete") })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("article", { name: owned.name })
      ).not.toBeInTheDocument()
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["application-development"],
    })
  })
  it.each(["zh-CN", "en-US"])(
    "shows drafts with installed applications and combines the state filter with search in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const draft = {
        id: sharedId,
        conversation_id: groupId,
        name: "Draft report",
        capability_count: 2,
        knowledge_base_count: 1,
        mcp_server_count: 3,
        has_changes: true,
        updated_at: timestamp,
      }
      const entries: ApplicationCatalogItem[] = [
        { type: "application", application: owned, development: null },
        {
          type: "application",
          application: installed,
          development: { ...draft, id: installedId, name: installed.name },
        },
        { type: "development", development: draft },
      ]
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (path === "/applications/catalog") {
          const search = String(options?.query?.search ?? "").toLowerCase()
          return {
            items: entries.filter(
              (entry) =>
                (options?.query?.state !== "developing" ||
                  entry.development?.has_changes) &&
                (entry.type === "application"
                  ? entry.application.name
                  : entry.development.name
                )
                  .toLowerCase()
                  .includes(search)
            ),
            next_cursor: null,
          }
        }
        return {
          items:
            path === "/applications/distribution" ? ownedDistributions : [],
        }
      })
      show()
      const draftCard = await screen.findByRole("article", { name: draft.name })
      expect(screen.getAllByRole("article")).toHaveLength(3)
      expect(
        within(draftCard).getByText(
          i18n.t("applicationDevelopment.publish.draft")
        )
      ).toBeVisible()
      expect(
        within(draftCard).queryByText(i18n.t("applications.status.active"))
      ).not.toBeInTheDocument()
      expect(
        draftCard.querySelector(
          '[data-slot="application-card-development-overlay"]'
        )
      ).not.toBeNull()
      const changedCard = screen.getByRole("article", { name: installed.name })
      const changedHeader = changedCard.querySelector(
        '[data-slot="application-card-metadata"]'
      )
      expect(changedHeader).not.toHaveTextContent(
        i18n.t("applicationDevelopment.catalog.developing")
      )
      expect(changedHeader).toHaveTextContent(
        i18n.t("applications.status.active")
      )
      expect(
        changedCard.querySelector(
          '[data-slot="application-card-development-overlay"]'
        )
      ).toBeNull()
      expect(
        within(changedCard).getByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).toBeVisible()
      expect(
        within(draftCard).queryByRole("button", {
          name: i18n.t("applications.distribution.useService"),
        })
      ).not.toBeInTheDocument()
      for (const card of [draftCard, changedCard]) {
        expect(
          within(card).queryByRole("button", {
            name: i18n.t("applicationDevelopment.continue"),
          })
        ).not.toBeInTheDocument()
      }
      const filter = screen.getByRole("combobox", {
        name: i18n.t("applicationDevelopment.catalog.filter"),
      })
      expect(filter).toHaveTextContent(
        i18n.t("applicationDevelopment.catalog.all")
      )
      expect(filter.querySelector(".lucide-list-filter")).not.toBeNull()
      const search = screen.getByRole("textbox", {
        name: i18n.t("applications.search"),
      })
      expect(
        search.compareDocumentPosition(filter) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      await interaction.click(filter)
      await interaction.click(
        await screen.findByRole("option", {
          name: i18n.t("applicationDevelopment.catalog.developing"),
        })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole("article", { name: owned.name })
        ).not.toBeInTheDocument()
      )
      expect(screen.getAllByRole("article")).toHaveLength(2)
      expect(
        within(screen.getByRole("article", { name: installed.name })).getByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).toBeVisible()
      expect(screen.getByTestId("application-location")).toHaveTextContent(
        "app_state=developing"
      )
      await interaction.type(search, "Draft")
      await waitFor(() =>
        expect(screen.getAllByRole("article")).toHaveLength(1)
      )
      expect(apiRequest).toHaveBeenLastCalledWith(
        "/applications/catalog",
        expect.objectContaining({
          query: expect.objectContaining({
            state: "developing",
            search: "Draft",
          }),
        })
      )
      await interaction.clear(search)
      await interaction.type(search, "missing")
      expect(
        await screen.findByText(i18n.t("applicationDevelopment.catalog.empty"))
      ).toBeVisible()
    }
  )

  it.each(["zh-CN", "en-US"])(
    "filters standard and interactive applications with search and URL restoration in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const interactive = { ...installed, kind: "interactive" as const }
      const draft = {
        id: sharedId,
        conversation_id: groupId,
        name: "Draft report",
        capability_count: 2,
        knowledge_base_count: 1,
        mcp_server_count: 3,
        has_changes: true,
        updated_at: timestamp,
      }
      const standardEntries: ApplicationCatalogItem[] = [
        { type: "application", application: owned, development: null },
      ]
      const interactiveEntries: ApplicationCatalogItem[] = [
        { type: "application", application: interactive, development: null },
        { type: "development", development: draft },
      ]
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (path !== "/applications/catalog")
          return {
            items:
              path === "/applications/distribution" ? ownedDistributions : [],
          }
        const state = options?.query?.state
        const entries =
          state === "standard"
            ? standardEntries
            : state === "interactive"
              ? interactiveEntries
              : [...standardEntries, ...interactiveEntries]
        const search = String(options?.query?.search ?? "").toLowerCase()
        return {
          items: entries.filter((entry) =>
            (entry.type === "application"
              ? entry.application.name
              : entry.development.name
            )
              .toLowerCase()
              .includes(search)
          ),
          next_cursor: null,
        }
      })
      show(
        "/capabilities?section=application&app_state=standard&app_search=report"
      )
      const filter = screen.getByRole("combobox", {
        name: i18n.t("applicationDevelopment.catalog.filter"),
      })
      expect(filter).toHaveTextContent(
        language === "zh-CN" ? "普通应用" : "Standard applications"
      )
      await screen.findByRole("article", { name: owned.name })
      expect(screen.getAllByRole("article")).toHaveLength(1)
      const interaction = userEvent.setup()
      await interaction.click(filter)
      await interaction.click(
        await screen.findByRole("option", {
          name:
            language === "zh-CN" ? "交互式应用" : "Interactive applications",
        })
      )
      await screen.findByRole("article", { name: draft.name })
      expect(
        screen.getByRole("article", { name: interactive.name })
      ).toBeVisible()
      expect(
        screen.queryByRole("article", { name: owned.name })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId("application-location")).toHaveTextContent(
        "app_state=interactive"
      )
      expect(screen.getByTestId("application-location")).toHaveTextContent(
        "app_search=report"
      )
      const search = screen.getByRole("textbox", {
        name: i18n.t("applications.search"),
      })
      await interaction.clear(search)
      await interaction.type(search, "missing")
      expect(
        await screen.findByText(i18n.t("applicationDevelopment.catalog.empty"))
      ).toBeVisible()
      expect(screen.queryByRole("article")).not.toBeInTheDocument()
      await interaction.clear(search)
      await interaction.click(filter)
      await interaction.click(
        await screen.findByRole("option", {
          name: i18n.t("applicationDevelopment.catalog.all"),
        })
      )
      await screen.findByRole("article", { name: owned.name })
      expect(screen.getAllByRole("article")).toHaveLength(3)
      expect(screen.getByTestId("application-location")).not.toHaveTextContent(
        "app_state="
      )
    }
  )

  it.each(["developing", "standard", "interactive"])(
    "restores the %s filter from the URL and retains it on the next catalog page",
    async (state) => {
      await i18n.changeLanguage("zh-CN")
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (path === "/applications/catalog")
          return {
            items: [
              {
                type: "application",
                application: options?.query?.cursor ? installed : owned,
                development: null,
              },
            ],
            next_cursor: options?.query?.cursor ? null : "next-page",
          }
        return {
          items:
            path === "/applications/distribution" ? ownedDistributions : [],
        }
      })
      show(`/capabilities?section=application&app_state=${state}`)
      expect(
        screen.getByRole("combobox", {
          name: i18n.t("applicationDevelopment.catalog.filter"),
        })
      ).toHaveTextContent(i18n.t(`applicationDevelopment.catalog.${state}`))
      await screen.findByRole("article", { name: owned.name })
      await userEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.catalog.loadMore"),
        })
      )
      expect(
        await screen.findByRole("article", { name: installed.name })
      ).toBeVisible()
      expect(apiRequest).toHaveBeenCalledWith(
        "/applications/catalog",
        expect.objectContaining({
          query: expect.objectContaining({
            cursor: "next-page",
            state,
          }),
        })
      )
      expect(
        screen.queryByRole("button", {
          name: i18n.t("applicationDevelopment.catalog.loadMore"),
        })
      ).not.toBeInTheDocument()
    }
  )
  it.each([true, false])(
    "keeps share summaries in the card footer and respects organization sharing=%s",
    async (organizationSharingEnabled) => {
      await i18n.changeLanguage("zh-CN")
      const sharedApplication = applicationSchema.parse({
        ...owned,
        share_targets: [{ id: groupId, type: "user_group", name: "IT 部门" }],
        capability_count: 2,
        knowledge_base_count: 1,
        model: "gpt-5.6-luna",
      })
      mockCatalog([sharedApplication])
      show("/capabilities?section=application", organizationSharingEnabled)
      const card = await screen.findByRole("article", { name: owned.name })
      const resources = within(card).getByRole("list", {
        name: i18n.t("applications.details.resources"),
      })
      const shareLabel = i18n.t("applications.shareTargets", {
        targets: "IT 部门",
      })
      expect(resources).not.toHaveTextContent(shareLabel)
      if (organizationSharingEnabled) {
        expect(
          within(card)
            .getByText(shareLabel)
            .closest('[data-slot="card-footer"]')
        ).not.toBeNull()
      } else {
        expect(within(card).queryByText(shareLabel)).not.toBeInTheDocument()
        expect(
          within(card).getByText(i18n.t("applications.createdByMe"))
        ).toBeVisible()
      }
      expect(
        within(card).getByRole("button", {
          name: i18n.t("applications.distribution.useService"),
        })
      ).toBeEnabled()
    }
  )

  it("keeps resource-unavailable warnings and prevents starting an otherwise enabled application", async () => {
    await i18n.changeLanguage("zh-CN")
    mockCatalog([
      applicationSchema.parse({ ...owned, dependencies_available: false }),
    ])
    show()
    const card = await screen.findByRole("article", { name: owned.name })
    expect(
      within(card).getByText(i18n.t("applications.status.active"))
    ).toBeVisible()
    expect(
      within(card).getByText(i18n.t("applications.dependencyUnavailable"))
    ).toBeVisible()
    expect(
      within(card).getByRole("button", {
        name: i18n.t("applications.distribution.useService"),
      })
    ).toBeDisabled()
  })

  it.each([
    ["owned", owned.name, id, "direct"],
    ["shared", shared.name, sharedId, "direct"],
    ["center", release.name, sharedId, "center"],
  ])(
    "opens a read-only details dialog from %s cards and restores keyboard focus",
    async (scope, name, applicationId, channel) => {
      await i18n.changeLanguage("zh-CN")
      mockCatalog()
      show(`/capabilities?section=application&app_scope=${scope}`)
      const user = userEvent.setup()
      const button = await screen.findByRole("button", {
        name: i18n.t("applications.details.open", { name }),
      })
      expect(button).toHaveAttribute("aria-haspopup", "dialog")
      expect(button.closest('[data-slot="card"]')).toHaveClass("relative")
      expect(button.closest('[data-slot="card-header"]')).toHaveClass(
        "@container-normal"
      )
      expect(button).toHaveClass("after:absolute", "after:inset-0")
      button.focus()
      await user.keyboard("{Enter}")
      const dialog = await screen.findByRole("dialog", { name: "应用详情" })
      expect(await within(dialog).findByText("Full description")).toBeVisible()
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${applicationId}/details`,
        expect.objectContaining({ query: { channel } })
      )
      await user.keyboard("{Escape}")
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      await waitFor(() => expect(button).toHaveFocus())
    }
  )

  it("keeps the card's more menu and Use action separate from details", async () => {
    await i18n.changeLanguage("zh-CN")
    mockCatalog()
    show()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: owned.name }),
      })
    )
    expect(await screen.findByRole("menu")).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "应用详情" })
    ).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    await user.click(screen.getAllByRole("button", { name: "使用" })[0]!)
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/conversations`,
        expect.objectContaining({ method: "POST" })
      )
    )
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.some(([path]) => path.endsWith("/details"))
    ).toBe(false)
  })

  it.each(["zh-CN", "en-US"])(
    "opens the development setup from the recommended creation option in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ApplicationCreateButton onFeedback={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>
      )
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("button", { name: i18n.t("applications.create") })
      )
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("applications.creation.interactiveTitle"),
        })
      )
      const dialog = await screen.findByRole("dialog", {
        name: i18n.t("applicationDevelopment.create"),
      })
      expect(
        within(dialog).getByRole("textbox", {
          name: i18n.t("applicationDevelopment.name"),
        })
      ).toBeVisible()
      expect(
        within(dialog).getByRole("button", {
          name: i18n.t("applicationDevelopment.start"),
        })
      ).toBeDisabled()
      expect(apiRequest).not.toHaveBeenCalled()
    }
  )
  it.each(["zh-CN", "en-US"])(
    "opens resource declarations from import and preserves the selected package when returning in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockCatalog()
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ApplicationCreateButton onFeedback={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>
      )
      const user = userEvent.setup()
      await user.click(
        await screen.findByRole("button", {
          name: i18n.t("applications.create"),
        })
      )
      expect(
        screen.queryByRole("button", {
          name: i18n.t("applications.declaration.title"),
        })
      ).not.toBeInTheDocument()
      await user.click(
        screen.getByRole("button", {
          name: new RegExp(i18n.t("applications.importInteractiveApp")),
        })
      )
      const packageInput = screen.getByLabelText(
        i18n.t("applications.applicationPackage")
      )
      const file = new File(["application package"], "my-app.zip", {
        type: "application/zip",
      })
      await user.upload(packageInput, file)
      const declaration = screen.getByRole("button", {
        name: i18n.t("applications.declaration.title"),
      })
      expect(declaration.parentElement?.closest("button")).toBeNull()
      expect(declaration).toHaveClass("h-6", "text-xs")
      expect(
        declaration.querySelector('svg[data-icon="inline-end"]')
      ).toHaveAttribute("aria-hidden", "true")
      await user.click(declaration)
      expect(
        await screen.findByRole("dialog", {
          name: i18n.t("applications.declaration.title"),
        })
      ).toBeVisible()
      const declarationDialog = screen.getByRole("dialog", {
        name: i18n.t("applications.declaration.title"),
      })
      const [closeButton] = within(declarationDialog).getAllByRole("button", {
        name: i18n.t("common.close"),
      })
      if (!closeButton) throw new Error("Expected declaration close button")
      await user.click(closeButton)
      expect(
        await screen.findByRole("dialog", {
          name: i18n.t("applications.importInteractiveApp"),
        })
      ).toBeVisible()
      expect(
        screen.getByLabelText(i18n.t("applications.applicationPackage"))
      ).toBe(packageInput)
      expect(packageInput).toBeInstanceOf(HTMLInputElement)
      if (!(packageInput instanceof HTMLInputElement))
        throw new Error("Expected package input")
      expect(packageInput.files?.[0]).toBe(file)
      expect(
        screen.getByRole("button", {
          name: i18n.t("applications.dependencies.preview"),
        })
      ).toBeEnabled()
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
          name: tab === "shared" ? "共享我的" : "应用中心",
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

  it("keeps the catalog search in the URL separate from the application center search", async () => {
    await i18n.changeLanguage("zh-CN")
    mockCatalog()
    show("/capabilities?section=application&app_search=report")
    const user = userEvent.setup()
    expect(screen.getByRole("textbox", { name: "搜索应用" })).toHaveValue(
      "report"
    )
    await user.click(screen.getByRole("tab", { name: "应用中心" }))
    const centerSearch = screen.getByRole("textbox", {
      name: i18n.t("applications.distribution.centerSearch"),
    })
    expect(centerSearch).toHaveValue("")
    await user.type(centerSearch, "research")
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/application-center",
        expect.objectContaining({ query: { search: "research" } })
      )
    )
    await user.click(screen.getByRole("tab", { name: "我的应用" }))
    expect(screen.getByRole("textbox", { name: "搜索应用" })).toHaveValue(
      "report"
    )
    expect(screen.getByTestId("application-location")).toHaveTextContent(
      "app_search=report"
    )
  })

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
        screen.queryByRole("tab", { name: "共享我的" })
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
      if (path === "/applications/catalog")
        return {
          items: didInstall
            ? [
                {
                  type: "application",
                  application: installed,
                  development: null,
                },
              ]
            : [],
          next_cursor: null,
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
      return {
        items: path === "/applications/distribution" ? ownedDistributions : [],
      }
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
    ).toBe("共享我的")
    expect(
      instance.t("applications.distribution.center", { lng: "en-US" })
    ).toBe("应用中心")
  })
})
