import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import {
  publicKnowledgeSettingsSchema,
  supportedLocales,
} from "@linksense/shared"
import i18n from "@/i18n"
import { PublicKnowledgeCreateDialog } from "./create-dialog"
import { PublicKnowledgeEditDialog } from "./edit-dialog"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(async () => ({ models: [], items: [] })),
}))
vi.mock("@/features/knowledge-bases/knowledge-base-hooks", () => ({
  useKnowledgeBaseList: () => ({ isPending: false, data: { pages: [] } }),
}))
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getPublicKnowledgeManagement: vi.fn(async () => ({
    settings: publicKnowledgeSettingsSchema.parse({
      name: "Website assistant",
      instructions: "Answer from evidence",
      model: "test-model",
      reasoning_effort: "medium",
      knowledge_base_ids: ["00000000-0000-4000-8000-000000000001"],
      allowed_origins: ["https://example.test"],
    }),
  })),
}))
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

it.each(
  supportedLocales.flatMap((locale) =>
    (["create", "edit"] as const).map((mode) => ({ locale, mode }))
  )
)(
  "fixes the $mode header and compact right-aligned actions around the scrollable form in $locale",
  async ({ locale, mode }) => {
    await i18n.changeLanguage(locale)
    const onClose = vi.fn()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          {mode === "create" ? (
            <PublicKnowledgeCreateDialog
              onClose={onClose}
              onCreated={vi.fn()}
            />
          ) : (
            <PublicKnowledgeEditDialog
              applicationId="public-application"
              onClose={onClose}
              onSaved={vi.fn()}
            />
          )}
        </MemoryRouter>
      </QueryClientProvider>
    )
    const dialog = screen.getByRole("dialog", {
      name: i18n.t(
        mode === "create" ? "publicKnowledge.create" : "publicKnowledge.edit"
      ),
    })
    const submit = await within(dialog).findByRole("button", {
      name: i18n.t(
        mode === "create"
          ? "applications.createAndPublish"
          : "publicKnowledge.publish"
      ),
    })
    const header = dialog.querySelector<HTMLElement>(
      '[data-slot="dialog-header"]'
    )
    const body = dialog.querySelector<HTMLElement>(
      '[data-slot="public-knowledge-settings-body"]'
    )
    const footer = dialog.querySelector<HTMLElement>(
      '[data-slot="dialog-footer"]'
    )
    const cancel = within(dialog).getByRole("button", {
      name: i18n.t("common.cancel"),
    })
    expect(dialog).toHaveClass(
      "sm:max-w-5xl",
      "max-h-[calc(100dvh-2rem)]",
      "flex",
      "flex-col",
      "gap-0",
      "overflow-hidden",
      "p-0"
    )
    expect(dialog).not.toHaveClass("overflow-y-auto")
    expect(header).toHaveClass("shrink-0", "border-b", "px-6", "py-5")
    expect(body).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "px-6",
      "py-5"
    )
    expect(body).toContainElement(
      screen.getByRole("textbox", { name: i18n.t("publicKnowledge.name") })
    )
    expect(body).not.toContainElement(header)
    expect(body).not.toContainElement(footer)
    expect(footer).toHaveClass(
      "shrink-0",
      "flex-row",
      "justify-end",
      "border-t",
      "px-6",
      "py-4"
    )
    expect(footer).toContainElement(cancel)
    expect(footer?.lastElementChild).toBe(submit)
    expect(footer?.querySelectorAll("button")).toHaveLength(2)
    for (const action of [cancel, submit]) {
      expect(action).toHaveClass("h-8", "px-3")
      expect(action).not.toHaveClass("w-full", "md:col-span-2")
    }
    expect(submit).toHaveAttribute("type", "submit")
    expect(submit.closest("form")).toContainElement(body)
    expect(cancel).toHaveAttribute("type", "button")
    await userEvent.click(cancel)
    expect(onClose).toHaveBeenCalledOnce()
    expect(
      within(dialog).getByRole("button", { name: i18n.t("common.close") })
    ).toHaveAttribute("data-slot", "dialog-close")
  }
)
