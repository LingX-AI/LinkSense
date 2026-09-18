import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ApplicationDistributionSettings } from "@linksense/shared"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentPublishDialog } from "./application-development-publish-dialog"
import { ApplicationInstallationDialog } from "./application-installation-dialog"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const id = "11000000-0000-4000-8000-000000000001"
function mockPublishSettings(settings: ApplicationDistributionSettings) {
  vi.mocked(apiRequest).mockImplementation(async (path) =>
    path.endsWith("/publication-readiness")
      ? { has_active_tasks: false }
      : settings
  )
}
function show(child: React.ReactNode) {
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
      {child}
    </QueryClientProvider>
  )
}
describe("explicit release and service installation", () => {
  it.each([
    ["zh-CN", "发布应用", "发布"],
    ["en-US", "Publish application", "Publish"],
    ["fr-FR", "发布应用", "发布"],
  ])(
    "uses concise publishing labels and preserves readable description line breaks in %s",
    async (locale, title, action) => {
      await i18n.changeLanguage(locale)
      mockPublishSettings({
        version_number: "1.0.1",
        highest_version_number: "1.0.0",
        usage_instructions: "",
      })
      show(
        <ApplicationDevelopmentPublishDialog
          name="Reports"
          applicationId={id}
          updating
          pending={false}
          changed={false}
          error={null}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      )
      const dialog = screen.getByRole("dialog", { name: title })
      const description = dialog.querySelector(
        '[data-slot="dialog-description"]'
      )
      expect(description).toHaveClass("whitespace-pre-line", "wrap-anywhere")
      expect(description?.textContent).toBe(
        i18n.t("applicationDevelopment.publish.updateDescription", {
          name: "Reports",
        })
      )
      expect(description?.textContent?.split("\n")).toHaveLength(4)
      expect(dialog).toHaveClass("overflow-y-auto", "max-h-[calc(100dvh-2rem)]")
      await waitFor(() =>
        expect(screen.getByRole("button", { name: action })).toBeEnabled()
      )
    }
  )

  it("explains where to use a newly published app without update-only instructions", async () => {
    await i18n.changeLanguage("zh-CN")
    mockPublishSettings({
      version_number: "1.0.0",
      highest_version_number: null,
      usage_instructions: "",
    })
    show(
      <ApplicationDevelopmentPublishDialog
        name="Reports"
        applicationId={id}
        updating={false}
        pending={false}
        changed={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    const description = screen
      .getByRole("dialog")
      .querySelector('[data-slot="dialog-description"]')
    expect(description?.textContent).toBe(
      "发布“Reports”后，应用即可使用。\n你可以从“我的应用”中打开它。"
    )
    expect(description).not.toHaveTextContent("重新共享")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布" })).toBeEnabled()
    )
  })

  it.each(["zh-CN", "en-US", "fr"])(
    "requires a higher numeric release before confirmation in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      mockPublishSettings({
        version_number: "1.10.1",
        highest_version_number: "1.10.0",
        usage_instructions: "Guide",
      })
      const confirm = vi.fn()
      show(
        <ApplicationDevelopmentPublishDialog
          name="Reports"
          applicationId={id}
          updating
          pending={false}
          changed={false}
          error={null}
          onClose={vi.fn()}
          onConfirm={confirm}
        />
      )
      const version = await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
      const submit = screen.getByRole("button", {
        name: i18n.t("applicationDevelopment.publish.confirm"),
      })
      expect(version).toHaveValue("1.10.1")
      expect(confirm).not.toHaveBeenCalled()
      for (const value of ["", "1.10.0", "1.9.9", "1.11", "1.11.0+build.1"]) {
        await userEvent.clear(version)
        if (value) await userEvent.type(version, value)
        expect(submit).toBeDisabled()
      }
      await userEvent.clear(version)
      await userEvent.type(version, "1.11.0")
      await userEvent.click(submit)
      expect(confirm).toHaveBeenCalledWith({
        version_number: "1.11.0",
        usage_instructions: "Guide",
      })
    }
  )
  it.each(["zh-CN", "en-US", "fr"])(
    "keeps service installation explicit, shows both versions and preserves the dialog on failure in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockRejectedValue(new Error("Unavailable"))
      const installed = vi.fn()
      show(
        <ApplicationInstallationDialog
          target={{
            id,
            name: "Reports",
            versionId: id,
            channel: "direct",
            mode: "service",
            versionNumber: "2.0.0",
            installedVersionNumber: "1.0.0",
          }}
          onClose={vi.fn()}
          onInstalled={installed}
        />
      )
      expect(
        screen.getByText(
          i18n.t("applications.distribution.installedVersion", {
            version: "1.0.0",
          })
        )
      ).toBeVisible()
      expect(
        screen.getByText(
          i18n.t("applications.distribution.availableVersion", {
            version: "2.0.0",
          })
        )
      ).toBeVisible()
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
      expect(apiRequest).not.toHaveBeenCalled()
      await userEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applications.distribution.install"),
        })
      )
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          `/applications/${id}/service-installation`,
          expect.objectContaining({
            method: "POST",
            body: { channel: "direct", version_id: id },
          })
        )
      )
      expect(await screen.findByRole("alert")).toBeVisible()
      expect(installed).not.toHaveBeenCalled()
      expect(screen.getByRole("dialog")).toBeVisible()
    }
  )
})
