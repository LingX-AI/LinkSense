import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applicationSchema } from "@linksense/shared"
import i18n from "@/i18n"
import { apiRequest } from "@/api/client"
import { ApplicationPublicationDialog } from "./application-publication-dialog"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const id = "11000000-0000-4000-8000-000000000001"
const publication = {
  version_id: id,
  version_number: 1,
  allow_copy: false,
  usage_instructions: "Configure your own account.",
}
function application(isOwner: boolean) {
  return applicationSchema.parse({
    id,
    owner: { id, name: "Creator" },
    name: "Reports",
    icon: { type: "preset", preset: "bot" },
    description: null,
    instructions: isOwner ? "Write reports." : null,
    model: null,
    reasoning_effort: null,
    status: "active",
    is_owner: isOwner,
    can_manage: isOwner,
    access_source: isOwner ? "owner" : "direct",
    capability_count: 0,
    knowledge_base_count: 0,
    mcp_server_count: 0,
    share_targets: [],
    dependencies_available: true,
    capabilities: [],
    knowledge_bases: [],
    mcp_servers: [],
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
  })
}
function show(isOwner = true) {
  const onCopied = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ApplicationPublicationDialog
        application={application(isOwner)}
        onClose={vi.fn()}
        onCopied={onCopied}
      />
    </QueryClientProvider>
  )
  return { onCopied }
}

describe("application publishing and copying", () => {
  it.each(["zh-CN", "en-US"])(
    "publishes the guide and explicit copy choice in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest)
        .mockResolvedValueOnce(publication)
        .mockResolvedValue({
          ...publication,
          version_number: 2,
          allow_copy: true,
        })
      show()
      const guide = await screen.findByLabelText(
        i18n.t("applications.publication.guide")
      )
      await userEvent.clear(guide)
      await userEvent.type(guide, "Use your own MCP connection.")
      await userEvent.click(
        screen.getByRole("switch", {
          name: i18n.t("applications.publication.allowCopy"),
        })
      )
      await userEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applications.publication.publish"),
        })
      )
      await screen.findByText(i18n.t("applications.publication.published"))
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/publish`,
        expect.objectContaining({
          method: "POST",
          body: {
            usage_instructions: "Use your own MCP connection.",
            allow_copy: true,
          },
        })
      )
    }
  )
  it("shows a service guide without granting copying or publishing controls", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue(publication)
    show(false)
    await screen.findByText(publication.usage_instructions)
    expect(
      screen.queryByRole("button", {
        name: i18n.t("applications.publication.copy"),
      })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: i18n.t("applications.publication.publish"),
      })
    ).not.toBeInTheDocument()
  })
  it("saves an authorized copy under a chosen name and returns it for setup", async () => {
    const copied = {
      ...application(true),
      name: "My reports",
      status: "disabled",
    }
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ ...publication, allow_copy: true })
      .mockResolvedValue(copied)
    const f = show(false)
    const name = await screen.findByLabelText(
      i18n.t("applications.publication.copyName")
    )
    await userEvent.clear(name)
    await userEvent.type(name, "My reports")
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applications.publication.copy"),
      })
    )
    await waitFor(() => expect(f.onCopied).toHaveBeenCalledWith(copied))
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}/copy`,
      expect.objectContaining({ method: "POST", body: { name: "My reports" } })
    )
  })
  it("requires a guide and preserves edits after a failed publication", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ ...publication, usage_instructions: "" })
      .mockRejectedValue(new Error("failed"))
    show()
    const guide = await screen.findByLabelText(
      i18n.t("applications.publication.guide")
    )
    const publish = screen.getByRole("button", {
      name: i18n.t("applications.publication.publish"),
    })
    expect(publish).toBeDisabled()
    await userEvent.type(guide, "Read this guide.")
    await userEvent.click(publish)
    await screen.findByRole("alert")
    expect(guide).toHaveValue("Read this guide.")
  })
})
