import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"
import i18n from "@/i18n"
import { ApplicationDevelopmentCreateDialog } from "./application-development-create-dialog"
import { ApplicationMetadataDialog } from "./application-metadata-dialog"
import { ApplicationInstallationDialog } from "./application-installation-dialog"
import { InteractiveApplicationImportDialog } from "./application-catalog-panel"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.resetAllMocks()
})

function show(content: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{content}</MemoryRouter>
    </QueryClientProvider>
  )
}

function expectRequiredLabel(control: HTMLElement, label: string) {
  const indicator = control
    .closest('[data-slot="field"]')
    ?.querySelector('[data-slot="field-label"] span[aria-hidden="true"]')
  expect(indicator).toHaveTextContent("*")
  expect(indicator).toHaveClass("text-destructive")
  expect(indicator).toBeVisible()
  expect(control).toHaveAccessibleName(label)
}

describe.each([...supportedLocales, "de-DE"])(
  "application required fields (%s)",
  (locale) => {
    it("marks the application development name as required", async () => {
      await i18n.changeLanguage(locale)
      show(<ApplicationDevelopmentCreateDialog onClose={vi.fn()} />)
      const label = i18n.t("applicationDevelopment.name")
      expectRequiredLabel(screen.getByRole("textbox", { name: label }), label)
      expect(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.start"),
        })
      ).toBeDisabled()
    })

    it("marks the metadata name and leaves its description optional", async () => {
      await i18n.changeLanguage(locale)
      show(
        <ApplicationMetadataDialog
          initial={{
            name: "Reports",
            description: null,
            icon: { type: "preset", preset: "bot" },
          }}
          onSave={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />
      )
      const label = i18n.t("common.name")
      expectRequiredLabel(screen.getByRole("textbox", { name: label }), label)
      const description = screen.getByRole("textbox", {
        name: i18n.t("common.description"),
      })
      expect(description).not.toBeRequired()
      expect(
        description
          .closest('[data-slot="field"]')
          ?.querySelector('[data-slot="field-label"]')
      ).not.toHaveTextContent("*")
      expect(
        screen.getByRole("button", { name: i18n.t("common.save") })
      ).toBeEnabled()
    })

    it("marks the installation name as required", async () => {
      await i18n.changeLanguage(locale)
      show(
        <ApplicationInstallationDialog
          target={{
            id: "10000000-0000-4000-8000-000000000001",
            name: "Reports",
            versionId: "10000000-0000-4000-8000-000000000002",
            channel: "center",
          }}
          onClose={vi.fn()}
          onInstalled={vi.fn()}
        />
      )
      const label = i18n.t("applications.distribution.installationName")
      expectRequiredLabel(screen.getByRole("textbox", { name: label }), label)
    })

    it("marks the application package as required before importing", async () => {
      await i18n.changeLanguage(locale)
      show(
        <InteractiveApplicationImportDialog
          open
          application={null}
          onOpenChange={vi.fn()}
          onCompleted={vi.fn(async () => undefined)}
        />
      )
      const label = i18n.t("applications.applicationPackage")
      const file = screen.getByLabelText(new RegExp(`^${label}\\s*\\*?$`))
      expectRequiredLabel(file, label)
      expect(
        screen.getByRole("button", {
          name: i18n.t("applications.dependencies.preview"),
        })
      ).toBeDisabled()
    })
  }
)
