import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { PublicKnowledgeCreateDialog } from "./create-dialog"

vi.mock("./settings-form", () => ({
  PublicKnowledgeSettingsForm: () => <form aria-label="Public settings" />,
}))
afterEach(cleanup)

it("provides a wider creation dialog with a scrollable form and viewport height limit", async () => {
  await i18n.changeLanguage("zh-CN")
  render(
    <MemoryRouter>
      <PublicKnowledgeCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />
    </MemoryRouter>
  )
  expect(
    screen.getByRole("dialog", { name: i18n.t("publicKnowledge.create") })
  ).toHaveClass("sm:max-w-4xl", "max-h-[calc(100dvh-2rem)]")
  expect(screen.getByRole("form").parentElement).toHaveClass(
    "min-h-0",
    "overflow-y-auto"
  )
})
