vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationCenterReleaseSchema,
  applicationSchema,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationCenterSubmissionPanel } from "./application-center-submission-panel"
import { ApplicationCenterAdminItem } from "./application-center-admin-item"
import {
  ApplicationCenterPanel,
  ApplicationsWorkspacePanel,
} from "./application-center-panel"
import { ApplicationGrantPermissions } from "./application-grant-permissions"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const id = "11000000-0000-4000-8000-000000000001"
const version = "11000000-0000-4000-8000-000000000002"
const settings = {
  version_number: "2.0.0",
  highest_version_number: "2.0.0",
  usage_instructions: "Use a personal account when installing",
}
const release = {
  id,
  application_id: id,
  version_id: version,
  version_number: "2.0.0",
  name: "Reports",
  kind: "standard" as const,
  description: "A reporting tool",
  usage_instructions: "Use a personal account when installing",
  publisher_name: "Publisher",
  usage_modes: ["service" as const],
  release_notes: "Updated reporting",
  status: "pending" as const,
  listing_status: "draft" as const,
  review_comment: null,
  suspension_reason: null,
  submitted_at: "2026-09-16T00:00:00Z",
  reviewed_at: null,
  installed_application_id: null,
  service_installation: {
    installed_version_id: version,
    installed_version_number: "2.0.0",
    available_version_id: version,
    available_version_number: "2.0.0",
    update_available: false,
  },
}
function show(content: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{content}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe("application center user flows", () => {
  it.each(["standard", "interactive"] as const)(
    "uses the cube default for %s application cards",
    async (kind) => {
      vi.mocked(apiRequest).mockResolvedValue({
        items: [
          { ...release, kind, status: "approved", listing_status: "published" },
        ],
      })
      show(<ApplicationCenterPanel search="" />)
      const card = await screen.findByRole("article", { name: release.name })
      expect(
        card.querySelector('[data-application-icon-preset="bot"]')
      ).toBeInTheDocument()
      expect(
        card.querySelector('[data-application-icon-preset="sparkles"]')
      ).toBeNull()
    }
  )
  it("returns to personal applications after installing and offers setup before use", async () => {
    await i18n.changeLanguage("zh-CN")
    const installed = applicationSchema.parse({
      id,
      owner: { id, name: "Installer" },
      name: "Reports",
      icon: { type: "preset", preset: "bot" },
      description: null,
      instructions: "Write reports",
      model: null,
      reasoning_effort: null,
      status: "disabled",
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
      created_at: release.submitted_at,
      updated_at: release.submitted_at,
    })
    let didInstall = false
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (
        path === `/applications/${id}/install` &&
        options?.method === "POST"
      ) {
        didInstall = true
        return installed
      }
      if (path === "/application-center")
        return {
          items: [
            {
              ...release,
              usage_modes: ["install"],
              status: "approved",
              listing_status: "published",
            },
          ],
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
      if (path === "/applications/distribution")
        return {
          items: didInstall
            ? [
                {
                  application_id: id,
                  published_version_id: null,
                  published_version_number: null,
                  usage_modes: ["install", "service"],
                  installed_application_id: null,
                  installation: {
                    source_application_id: id,
                    channel: "center",
                    installed_version_id: version,
                    installed_version_number: "2.0.0",
                    latest_version_id: version,
                    latest_version_number: "2.0.0",
                    update_available: false,
                    setup_required: true,
                  },
                },
              ]
            : [],
        }
      return { items: [], models: [] }
    })
    show(<ApplicationsWorkspacePanel onFeedback={vi.fn()} />)
    await userEvent.click(screen.getByRole("tab", { name: "应用中心" }))
    await userEvent.click(
      await screen.findByRole("button", { name: "安装应用" })
    )
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "安装应用" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("tab", {
          name: i18n.t("applications.distribution.myApplications"),
        })
      ).toHaveAttribute("aria-selected", "true")
    )
    expect(await screen.findByText("已安装 · v2.0.0")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "使用" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole("button", { name: "完成配置" })
    )
    expect(
      await screen.findByRole("dialog", {
        name: i18n.t("applications.editTitle"),
      })
    ).toBeVisible()
  })

  it("shows the administrator suspension reason and prevents another submission", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      String(path).endsWith("/distribution/settings")
        ? settings
        : {
            items: [
              {
                ...release,
                status: "approved",
                listing_status: "suspended",
                suspension_reason: "请补充使用说明",
              },
            ],
          }
    )
    show(
      <ApplicationCenterSubmissionPanel
        applicationId={id}
        onSubmitted={vi.fn()}
      />
    )
    expect(await screen.findByText("请补充使用说明")).toBeVisible()
    expect(screen.getByText("已下架")).toBeVisible()
    expect(screen.queryByText("已停用")).not.toBeInTheDocument()
    await userEvent.type(
      screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.releaseNotes"),
      }),
      "New release"
    )
    expect(
      screen.getByRole("button", {
        name: i18n.t("applications.distribution.submit"),
      })
    ).toBeDisabled()
  })

  it.each(["zh-CN", "en-US"])(
    "submits selected usage modes and an exact version for review in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockImplementation(async (path, options) =>
        String(path).endsWith("/distribution/settings")
          ? settings
          : options?.method === "POST"
            ? release
            : { items: [] }
      )
      const onSubmitted = vi.fn()
      show(
        <ApplicationCenterSubmissionPanel
          applicationId={id}
          onSubmitted={onSubmitted}
        />
      )
      const submit = screen.getByRole("button", {
        name: i18n.t("applications.distribution.submit"),
      })
      expect(submit).toBeDisabled()
      await userEvent.type(
        screen.getByRole("textbox", {
          name: i18n.t("applications.distribution.releaseNotes"),
        }),
        "Updated reporting"
      )
      await userEvent.click(
        screen.getByRole("checkbox", {
          name: i18n.t("applications.distribution.modes.service"),
        })
      )
      await waitFor(() => expect(submit).toBeEnabled())
      await userEvent.click(submit)
      await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce())
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-center/${id}/submissions`,
        expect.objectContaining({
          method: "POST",
          body: {
            version_number: "2.0.0",
            usage_instructions: settings.usage_instructions,
            usage_modes: ["install", "service"],
            release_notes: "Updated reporting",
          },
        })
      )
    }
  )
  it.each(["published", "unlisted"] as const)(
    "keeps the %s listing action beside the submit button in the fixed footer",
    async (listingStatus) => {
      await i18n.changeLanguage("en-US")
      vi.mocked(apiRequest).mockImplementation(async (path, options) =>
        String(path).endsWith("/distribution/settings")
          ? settings
          : options?.method === "PATCH"
            ? {}
            : {
                items: [
                  {
                    ...release,
                    status: "approved",
                    listing_status: listingStatus,
                  },
                ],
              }
      )
      show(
        <ApplicationCenterSubmissionPanel
          applicationId={id}
          onSubmitted={vi.fn()}
        />
      )
      const listingAction = await screen.findByRole("button", {
        name: i18n.t(
          listingStatus === "published"
            ? "applications.distribution.unlist"
            : "applications.distribution.relist"
        ),
      })
      const submit = screen.getByRole("button", {
        name: i18n.t("applications.distribution.submit"),
      })
      const footer = listingAction.closest('[data-slot="dialog-footer"]')
      expect(footer).toHaveClass("shrink-0", "flex-row", "justify-end")
      expect(footer?.firstElementChild).toBe(listingAction)
      expect(footer?.lastElementChild).toBe(submit)
      expect(footer?.querySelectorAll("button")).toHaveLength(2)
      await userEvent.click(listingAction)
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          `/application-center/${id}/status`,
          expect.objectContaining({
            method: "PATCH",
            body: {
              status: listingStatus === "published" ? "unlisted" : "published",
              reason: "",
            },
          })
        )
      )
    }
  )

  it("prevents duplicate submissions while an earlier release awaits review", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      String(path).endsWith("/distribution/settings")
        ? settings
        : { items: [release] }
    )
    show(
      <ApplicationCenterSubmissionPanel
        applicationId={id}
        onSubmitted={vi.fn()}
      />
    )
    await screen.findByText("Updated reporting")
    await userEvent.type(
      screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.releaseNotes"),
      }),
      "Another release"
    )
    expect(
      screen.getByRole("button", {
        name: i18n.t("applications.distribution.submit"),
      })
    ).toBeDisabled()
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applications.distribution.withdraw"),
      })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-center/releases/${id}`,
        expect.objectContaining({ method: "DELETE" })
      )
    )
  })
  it("starts the already installed center service without offering a copy install when only service is allowed", async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockImplementation(async (_path, options) =>
      options?.method === "POST"
        ? { conversation_id: id }
        : {
            items: [
              { ...release, status: "approved", listing_status: "published" },
            ],
          }
    )
    show(<ApplicationCenterPanel search="" />)
    await screen.findByText("Reports")
    expect(screen.getByText(release.description)).toHaveClass(
      "text-[length:var(--app-font-13)]",
      "leading-5"
    )
    expect(screen.getByText(release.usage_instructions)).toHaveClass(
      "text-[length:var(--app-font-13)]",
      "leading-5"
    )
    expect(
      screen.queryByRole("button", {
        name: i18n.t("applications.distribution.install"),
      })
    ).not.toBeInTheDocument()
    const useButton = screen.getByRole("button", { name: "Use" })
    expect(useButton).toHaveClass("border-border", "bg-background")
    expect(
      useButton.querySelector('svg[data-icon="inline-end"]')
    ).toHaveAttribute("aria-hidden", "true")
    await userEvent.click(useButton)
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/conversations`,
        expect.objectContaining({ method: "POST", body: { channel: "center" } })
      )
    )
  })
  it.each(["success", "error"])(
    "shows loading only on the selected application and clears it after %s",
    async (outcome) => {
      await i18n.changeLanguage("zh-CN")
      let resolveStart:
        ((value: { conversation_id: string }) => void) | undefined
      let rejectStart: ((reason: Error) => void) | undefined
      const pending = new Promise<{ conversation_id: string }>(
        (resolve, reject) => {
          resolveStart = resolve
          rejectStart = reject
        }
      )
      vi.mocked(apiRequest).mockImplementation(async (_path, options) =>
        options?.method === "POST"
          ? pending
          : {
              items: [
                { ...release, status: "approved", listing_status: "published" },
                {
                  ...release,
                  id: version,
                  application_id: version,
                  name: "Other app",
                  status: "approved",
                  listing_status: "published",
                },
              ],
            }
      )
      show(<ApplicationCenterPanel search="" />)
      const [useButton, otherButton] = await screen.findAllByRole("button", {
        name: "使用",
      })
      await userEvent.click(useButton)
      await waitFor(() =>
        expect(useButton).toHaveAttribute("aria-busy", "true")
      )
      expect(useButton).toBeDisabled()
      expect(
        useButton.querySelector('[data-slot="spinner"]')
      ).toBeInTheDocument()
      expect(otherButton).not.toHaveAttribute("aria-busy")
      expect(
        otherButton.querySelector('[data-slot="spinner"]')
      ).not.toBeInTheDocument()
      await userEvent.click(useButton)
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.filter(([, options]) => options?.method === "POST")
      ).toHaveLength(1)
      await act(async () => {
        if (outcome === "success") resolveStart?.({ conversation_id: id })
        else rejectStart?.(new Error("Service unavailable"))
      })
      await waitFor(() => expect(useButton).toBeEnabled())
      expect(useButton).not.toHaveAttribute("aria-busy")
      expect(
        useButton.querySelector('[data-slot="spinner"]')
      ).not.toBeInTheDocument()
      expect(
        useButton.querySelector('svg[data-icon="inline-end"]')
      ).toBeInTheDocument()
    }
  )
  it("shows empty catalog and retriable errors", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue({ items: [] })
    show(<ApplicationCenterPanel search="" />)
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("common.retry") })
    )
    expect(
      await screen.findByText(
        i18n.t("applications.distribution.noCenterApplications")
      )
    ).toBeVisible()
  })
})

describe("application center review", () => {
  it.each(["approved", "rejected"] as const)(
    "reviews the exact release as %s, requiring a rejection explanation",
    async (decision) => {
      await i18n.changeLanguage("zh-CN")
      vi.mocked(apiRequest).mockImplementation(async (path) =>
        path === "/admin/application-center"
          ? { items: [release] }
          : {
              release,
              instructions: "Review these instructions",
              capabilities: [],
              knowledge_base_count: 0,
              mcp_server_count: 0,
              interactive_files: [],
            }
      )
      show(
        <ApplicationCenterAdminItem
          item={applicationCenterReleaseSchema.parse(release)}
          scope="reviews"
        />
      )
      await userEvent.click(
        await screen.findByRole("button", {
          name: i18n.t("applications.distribution.review"),
        })
      )
      const dialog = await screen.findByRole("dialog")
      await within(dialog).findByText("Review these instructions")
      const reject = within(dialog).getByRole("button", {
        name: i18n.t("applications.distribution.reject"),
      })
      expect(reject).toHaveClass(
        "bg-destructive",
        "text-destructive-foreground"
      )
      expect(reject).toBeDisabled()
      await userEvent.type(
        within(dialog).getByRole("textbox", {
          name: i18n.t("applications.distribution.reviewComment"),
        }),
        "Reviewed"
      )
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: i18n.t(
            decision === "approved"
              ? "applications.distribution.approve"
              : "applications.distribution.reject"
          ),
        })
      )
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          `/admin/application-center/${id}/review`,
          expect.objectContaining({
            method: "POST",
            body: { decision, comment: "Reviewed" },
          })
        )
      )
    }
  )
})

it("edits an existing grant with nonempty modes and preserves the selection on error", async () => {
  await i18n.changeLanguage("zh-CN")
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Update failed"))
  show(
    <ApplicationGrantPermissions
      grant={{
        id,
        application_id: id,
        grantee_type: "user",
        target: { id, name: "Member" },
        status: "active",
        usage_modes: ["service"],
        created_at: release.submitted_at,
        updated_at: release.submitted_at,
      }}
    />
  )
  await userEvent.click(
    screen.getByRole("button", {
      name: i18n.t("applications.distribution.editModes"),
    })
  )
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: i18n.t("applications.distribution.modes.service"),
    })
  )
  expect(
    screen.getByRole("button", { name: i18n.t("common.save") })
  ).toBeDisabled()
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: i18n.t("applications.distribution.modes.install"),
    })
  )
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("common.save") })
  )
  await screen.findByRole("alert")
  expect(
    screen.getByRole("checkbox", {
      name: i18n.t("applications.distribution.modes.install"),
    })
  ).toBeChecked()
  expect(apiRequest).toHaveBeenCalledWith(
    `/applications/${id}/grants/${id}`,
    expect.objectContaining({
      method: "PATCH",
      body: { usage_modes: ["install"] },
    })
  )
})
