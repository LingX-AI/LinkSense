import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationSchema,
  applicationShareInputSchema,
  applicationCenterSubmissionInputSchema,
} from "@linksense/shared"
import i18n from "@/i18n"
import { apiRequest } from "@/api/client"
import { ApplicationDistributionDialog } from "./application-distribution-dialog"
import { ApplicationUsageGuideDialog } from "./application-usage-guide-dialog"

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
  version_number: "1.10.0",
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
function show(mode: "direct" | "center" | "guide" = "direct") {
  const onClose = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Content() {
    const [open, setOpen] = useState(true)
    const close = () => {
      onClose()
      setOpen(false)
    }
    if (!open) return null
    return mode === "guide" ? (
      <ApplicationUsageGuideDialog
        application={application(false)}
        onClose={close}
      />
    ) : (
      <ApplicationDistributionDialog
        application={application(true)}
        mode={mode}
        onClose={close}
      />
    )
  }
  render(
    <QueryClientProvider client={client}>
      <Content />
    </QueryClientProvider>
  )
  return { onClose, client }
}
const settings = {
  version_number: "1.10.0",
  highest_version_number: "1.10.0",
  usage_instructions: publication.usage_instructions,
}
function mockRequests({
  failSubmission = false,
  hasGrants = true,
  guide = publication.usage_instructions,
} = {}) {
  let savedGuide = guide
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (options?.method === "POST") {
      if (failSubmission) throw new Error("Submission failed")
      const input = String(path).endsWith("/share")
        ? applicationShareInputSchema.parse(options.body)
        : applicationCenterSubmissionInputSchema.parse(options.body)
      savedGuide = input.usage_instructions
      return { ...publication, usage_instructions: savedGuide }
    }
    if (String(path).endsWith("/distribution/settings"))
      return { ...settings, usage_instructions: savedGuide }
    if (String(path).endsWith("/publication")) return publication
    if (String(path).endsWith("/grants"))
      return {
        items: hasGrants
          ? [
              {
                id,
                application_id: id,
                grantee_type: "user",
                target: { id, name: "Member" },
                status: "active",
                usage_modes: ["service"],
                created_at: "2026-09-16T00:00:00Z",
                updated_at: "2026-09-16T00:00:00Z",
              },
            ]
          : [],
        next_cursor: null,
      }
    return { items: [], next_cursor: null }
  })
}

describe("separate application distribution forms", () => {
  it.each([
    ["direct", "zh-CN"],
    ["direct", "en-US"],
    ["direct", "fr"],
    ["center", "zh-CN"],
    ["center", "en-US"],
    ["center", "fr"],
  ] as const)(
    "keeps the %s header and actions outside the scrolling body with only a top close button in %s",
    async (mode, locale) => {
      await i18n.changeLanguage(locale)
      mockRequests()
      const { onClose } = show(mode)
      const version = await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
      const dialog = screen.getByRole("dialog", {
        name: i18n.t(
          mode === "direct"
            ? "applications.distribution.direct"
            : "applications.distribution.applyListing"
        ),
      })
      const body = dialog.querySelector(
        '[data-slot="application-distribution-body"]'
      )
      const header = dialog.querySelector<HTMLDivElement>(
        '[data-slot="dialog-header"]'
      )
      const footer = dialog.querySelector('[data-slot="dialog-footer"]')
      const submit = within(dialog).getByRole("button", {
        name: i18n.t(
          mode === "direct"
            ? "applications.distribution.saveSharing"
            : "applications.distribution.submit"
        ),
      })
      expect(dialog).toHaveClass(
        "flex",
        "flex-col",
        "overflow-hidden",
        "max-h-[calc(100dvh-2rem)]"
      )
      expect(dialog).not.toHaveClass("overflow-y-auto")
      expect(header).toHaveClass("shrink-0")
      expect(body).toHaveClass("min-h-0", "flex-1", "overflow-y-auto")
      expect(body).toContainElement(version)
      expect(body).not.toContainElement(header)
      expect(body).not.toContainElement(submit)
      const descriptions = body?.querySelectorAll(
        '[data-slot="field-description"]'
      )
      expect(descriptions?.length).toBeGreaterThanOrEqual(4)
      for (const description of descriptions ?? []) {
        expect(description).toHaveClass(
          "text-[length:var(--app-font-13)]",
          "leading-5"
        )
      }
      expect(
        dialog.querySelectorAll('[data-slot="dialog-footer"]')
      ).toHaveLength(1)
      expect(footer).toHaveClass("shrink-0", "flex-row", "justify-end")
      expect(footer?.lastElementChild).toBe(submit)
      expect(footer?.querySelectorAll("button")).toHaveLength(1)
      const close = within(dialog).getByRole("button", {
        name: i18n.t("common.close"),
      })
      expect(close).toHaveAttribute("data-slot", "dialog-close")
      expect(body).not.toContainElement(close)
      expect(footer).not.toContainElement(close)
      await userEvent.click(close)
      expect(onClose).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ["direct", "zh-CN"],
    ["center", "zh-CN"],
    ["direct", "en-US"],
    ["center", "en-US"],
    ["direct", "fr"],
    ["center", "fr"],
  ] as const)(
    "marks required %s fields with red asterisks in %s",
    async (mode, locale) => {
      await i18n.changeLanguage(locale)
      mockRequests({ hasGrants: false })
      show(mode)
      const fields = ["applications.distribution.versionNumber"]
      for (const key of fields) {
        const input = await screen.findByRole("textbox", { name: i18n.t(key) })
        expect(input).toBeRequired()
      }
      expect(
        screen.getByRole("textbox", {
          name: i18n.t("applications.distribution.guide"),
        })
      ).not.toBeRequired()
      expect(
        within(
          screen.getByText(i18n.t("applications.distribution.guide"))
        ).queryByText("*")
      ).not.toBeInTheDocument()
      if (mode === "center") {
        expect(
          screen.getByRole("textbox", {
            name: i18n.t("applications.distribution.releaseNotes"),
          })
        ).not.toBeRequired()
        expect(
          within(
            screen.getByText(i18n.t("applications.distribution.releaseNotes"))
          ).queryByText("*")
        ).not.toBeInTheDocument()
      }
      for (const key of [
        ...fields,
        "applications.distribution.usageModes",
        ...(mode === "direct" ? ["applications.shareUserTarget"] : []),
      ]) {
        const marker = within(screen.getByText(i18n.t(key))).getByText("*")
        expect(marker).toHaveClass("text-destructive")
        expect(marker).toHaveAttribute("aria-hidden", "true")
      }
      if (mode === "direct") {
        expect(
          screen.getByRole("combobox", {
            name: i18n.t("applications.shareUserTarget"),
          })
        ).toHaveAttribute("aria-required", "true")
        await userEvent.click(
          screen.getByRole("tab", {
            name: i18n.t("applications.shareToGroups"),
          })
        )
        expect(
          within(
            screen.getByText(i18n.t("applications.shareGroupTarget"))
          ).getByText("*")
        ).toBeVisible()
        expect(
          screen.getByRole("combobox", {
            name: i18n.t("applications.shareGroupTarget"),
          })
        ).toHaveAttribute("aria-required", "true")
      }
    }
  )

  it("keeps a new sharing target optional when updating existing shares", async () => {
    await i18n.changeLanguage("zh-CN")
    mockRequests()
    show()
    await screen.findByText("Member")
    expect(
      within(
        screen.getByText(i18n.t("applications.shareUserTarget"))
      ).queryByText("*")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("combobox", {
        name: i18n.t("applications.shareUserTarget"),
      })
    ).not.toHaveAttribute("aria-required", "true")
  })

  it.each(["direct", "center"] as const)(
    "distributes the selected published version without allowing draft edits in %s",
    async (mode) => {
      await i18n.changeLanguage("zh-CN")
      mockRequests()
      show(mode)
      const version = await screen.findByRole("textbox", { name: i18n.t("applications.distribution.versionNumber") })
      expect(version).toHaveValue("1.10.0")
      expect(version).toHaveAttribute("readonly")
      const guide = screen.getByRole("textbox", { name: i18n.t("applications.distribution.guide") })
      expect(guide).toHaveAttribute("readonly")
      const submit = screen.getByRole("button", { name: i18n.t(mode === "direct" ? "applications.distribution.saveSharing" : "applications.distribution.submit") })
      await waitFor(() => expect(submit).toBeEnabled())
      await userEvent.click(submit)
      await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
        mode === "direct" ? `/applications/${id}/share` : `/application-center/${id}/submissions`,
        expect.objectContaining({ method: "POST", body: expect.objectContaining({ version_number: "1.10.0", usage_instructions: publication.usage_instructions }) })
      ))
    }
  )
  it.each(["zh-CN", "en-US"])(
    "submits unchanged version labels with an inline notice in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockRequests()
      show()
      await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
      expect(
        screen.queryByRole("tab", { name: "发布版本" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "发布版本" })
      ).not.toBeInTheDocument()
      const submit = screen.getByRole("button", {
        name: i18n.t("applications.distribution.saveSharing"),
      })
      await waitFor(() => expect(submit).toBeEnabled())
      await userEvent.click(submit)
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          `/applications/${id}/share`,
          expect.objectContaining({
            method: "POST",
            body: {
              version_number: "1.10.0",
              usage_instructions: publication.usage_instructions,
              target: null,
            },
          })
        )
      )
    }
  )
  it.each(["direct", "center"] as const)(
    "retains the published guide and keeps the %s dialog open after a failed submission",
    async (mode) => {
      await i18n.changeLanguage("zh-CN")
      mockRequests({ failSubmission: true })
      const { onClose } = show(mode)
      const guide = await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.guide"),
      })
      const submit = screen.getByRole("button", {
        name: i18n.t(
          mode === "direct"
            ? "applications.distribution.saveSharing"
            : "applications.distribution.submit"
        ),
      })
      expect(guide).toHaveAttribute("readonly")
      expect(submit).toBeEnabled()
      await userEvent.click(submit)
      await screen.findByRole("alert")
      expect(guide).toHaveValue(publication.usage_instructions)
      expect(screen.getByRole("dialog")).toBeVisible()
      expect(onClose).not.toHaveBeenCalled()
    }
  )
  it.each([
    ["direct", "Updated usage guide"],
    ["center", "Updated usage guide"],
    ["direct", ""],
    ["center", ""],
  ] as const)(
    "prefills the published instructions for %s with guide '%s' when reopening either channel",
    async (mode, nextGuide) => {
      await i18n.changeLanguage("zh-CN")
      mockRequests({ guide: nextGuide })
      show(mode)
      const guide = await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.guide"),
      })
      expect(guide).toHaveValue(nextGuide)
      expect(guide).toHaveAttribute("readonly")
      if (mode === "center")
        await userEvent.type(
          screen.getByRole("textbox", {
            name: i18n.t("applications.distribution.releaseNotes"),
          }),
          "Updated release"
        )
      const submit = screen.getByRole("button", {
        name: i18n.t(
          mode === "direct"
            ? "applications.distribution.saveSharing"
            : "applications.distribution.submit"
        ),
      })
      await waitFor(() => expect(submit).toBeEnabled())
      await userEvent.click(submit)
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          mode === "direct"
            ? `/applications/${id}/share`
            : `/application-center/${id}/submissions`,
          expect.objectContaining({
            method: "POST",
            body: expect.objectContaining({ usage_instructions: nextGuide }),
          })
        )
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      cleanup()
      show(mode === "direct" ? "center" : "direct")
      expect(
        await screen.findByRole("textbox", {
          name: i18n.t("applications.distribution.guide"),
        })
      ).toHaveValue(nextGuide)
    }
  )

  it.each(["direct", "center"] as const)(
    "allows the first %s submission without instructions",
    async (mode) => {
      await i18n.changeLanguage("en-US")
      mockRequests({ guide: "" })
      const { onClose, client } = show(mode)
      const invalidate = vi.spyOn(client, "invalidateQueries")
      const guide = await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.guide"),
      })
      expect(guide).toHaveValue("")
      const submit = screen.getByRole("button", {
        name: i18n.t(
          mode === "direct"
            ? "applications.distribution.saveSharing"
            : "applications.distribution.submit"
        ),
      })
      await waitFor(() => expect(submit).toBeEnabled())
      await userEvent.click(submit)
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          mode === "direct"
            ? `/applications/${id}/share`
            : `/application-center/${id}/submissions`,
          expect.objectContaining({
            method: "POST",
            body: expect.objectContaining({ usage_instructions: "" }),
          })
        )
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(onClose).toHaveBeenCalledOnce()
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["applications"] })
    }
  )
  it("shows a read-only service guide with the v-prefixed version", async () => {
    await i18n.changeLanguage("zh-CN")
    mockRequests()
    show("guide")
    expect(
      await screen.findByText(publication.usage_instructions)
    ).toBeVisible()
    expect(screen.getByText("v1.10.0")).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "发布版本" })
    ).not.toBeInTheDocument()
  })
})
