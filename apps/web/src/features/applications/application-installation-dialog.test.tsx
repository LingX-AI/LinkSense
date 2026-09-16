import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applicationSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import {
  ApplicationInstallationDialog,
  ApplicationInstallationUpdateDialog,
} from "./application-installation-dialog"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const id = "11000000-0000-4000-8000-000000000001"
const nextVersion = "11000000-0000-4000-8000-000000000002"
const application = applicationSchema.parse({
  id,
  owner: { id, name: "Installer" },
  name: "My reports",
  icon: { type: "preset", preset: "bot" },
  description: null,
  instructions: "Reports",
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
  created_at: "2026-09-16T00:00:00Z",
  updated_at: "2026-09-16T00:00:00Z",
})
function show(content: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{content}</QueryClientProvider>)
}

describe("application installation", () => {
  it.each(["zh-CN", "en-US"])(
    "installs the explicitly selected center version in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockResolvedValue(application)
      const installed = vi.fn()
      show(
        <ApplicationInstallationDialog
          target={{
            id,
            name: "Reports",
            versionId: nextVersion,
            channel: "center",
          }}
          onClose={vi.fn()}
          onInstalled={installed}
        />
      )
      const input = screen.getByLabelText(
        i18n.t("applications.distribution.installationName")
      )
      await userEvent.clear(input)
      await userEvent.type(input, "My reports")
      await userEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applications.distribution.install"),
        })
      )
      await waitFor(() => expect(installed).toHaveBeenCalledWith(application))
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/install`,
        expect.objectContaining({
          method: "POST",
          body: {
            name: "My reports",
            channel: "center",
            version_id: nextVersion,
          },
        })
      )
    }
  )

  it("keeps the chosen name after an installation failure", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockRejectedValue(
      new Error("Installation unavailable")
    )
    const installed = vi.fn()
    show(
      <ApplicationInstallationDialog
        target={{
          id,
          name: "My reports",
          versionId: nextVersion,
          channel: "direct",
        }}
        onClose={vi.fn()}
        onInstalled={installed}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "安装应用" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByLabelText("安装后的应用名称")).toHaveValue("My reports")
    expect(installed).not.toHaveBeenCalled()
  })
})

describe("manual application updates", () => {
  it("discovers an update without applying it, then updates only after the user clicks", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        current_version_id: id,
        latest_version_id: nextVersion,
        latest_version_number: "2.0.0",
        update_available: true,
        release_notes: "Improved reports",
        preserved_fields: ["instructions", "resources"],
        setup_required: false,
      })
      .mockResolvedValueOnce(application)
      .mockResolvedValue({
        current_version_id: nextVersion,
        latest_version_id: nextVersion,
        latest_version_number: "2.0.0",
        update_available: false,
        release_notes: null,
        preserved_fields: [],
        setup_required: false,
      })
    const updated = vi.fn()
    show(
      <ApplicationInstallationUpdateDialog
        applicationId={id}
        onClose={vi.fn()}
        onUpdated={updated}
      />
    )
    expect(await screen.findByText("Improved reports")).toBeVisible()
    expect(screen.getByText(/以下个人修改将保留/)).toHaveTextContent("应用指令")
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(updated).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "更新应用" }))
    await waitFor(() => expect(updated).toHaveBeenCalledWith(application))
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      `/applications/${id}/installation/update`,
      expect.objectContaining({
        method: "POST",
        body: { version_id: nextVersion },
      })
    )
  })

  it("disables updating when the source no longer offers an accessible version", async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockResolvedValue({
      current_version_id: id,
      latest_version_id: null,
      latest_version_number: null,
      update_available: false,
      release_notes: null,
      preserved_fields: [],
      setup_required: false,
    })
    show(
      <ApplicationInstallationUpdateDialog
        applicationId={id}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />
    )
    expect(
      await screen.findByText(
        i18n.t("applications.distribution.updateUnavailable")
      )
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Update application" })
    ).toBeDisabled()
  })
})
