import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  supportedLocales,
  type AutomationNotificationTarget,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { AutomationNotificationField } from "./automation-notification-field"
import { automationNotificationMessages } from "./automation-notification-messages"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const target: AutomationNotificationTarget = {
  kind: "feishu",
  connection_id: "11111111-1111-4111-8111-111111111111",
  peer_session_id: "22222222-2222-4222-8222-222222222222",
}
const change = vi.fn()
function Host({
  initial = null,
}: {
  initial?: AutomationNotificationTarget | null
}) {
  const [value, setValue] = useState(initial)
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  return (
    <QueryClientProvider client={client}>
      <AutomationNotificationField
        value={value}
        onChange={(next) => {
          change(next)
          setValue(next)
        }}
      />
    </QueryClientProvider>
  )
}
describe("automation result destination", () => {
  it.each(supportedLocales)(
    "provides complete translations and fallback in %s",
    (locale) => {
      const messages = automationNotificationMessages
      expect(Object.keys(messages[locale]).sort()).toEqual(
        Object.keys(messages["zh-CN"]).sort()
      )
      for (const key of Object.keys(messages["zh-CN"])) {
        const fullKey = `automationNotifications.${key}`
        const translated = i18n.t(fullKey, { lng: locale })
        expect(translated).not.toBe(fullKey)
        expect((translated.match(/\{\{.*?\}\}/gu) ?? []).sort()).toEqual(
          (
            i18n.t(fullKey, { lng: "zh-CN" }).match(/\{\{.*?\}\}/gu) ?? []
          ).sort()
        )
        if (locale !== "zh-CN") {
          const fallback = i18n.cloneInstance({ forkResourceStore: true })
          fallback.removeResourceBundle(locale, "translation")
          expect(fallback.t(fullKey, { lng: locale })).toBe(
            i18n.t(fullKey, { lng: "zh-CN" })
          )
        }
      }
    }
  )
  it("starts with notifications off and selects only a server-provided destination", async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockResolvedValue({
      items: [{ target, provider: "feishu", title: "My private chat" }],
    })
    const interaction = userEvent.setup()
    render(<Host />)
    expect(
      await screen.findByText("In-app and browser notifications only")
    ).toBeInTheDocument()
    await interaction.click(
      screen.getByRole("combobox", { name: "Send result notices to" })
    )
    await interaction.click(
      await screen.findByRole("option", { name: "feishu · My private chat" })
    )
    expect(change).toHaveBeenLastCalledWith(target)
    await interaction.click(
      screen.getByRole("combobox", { name: "Send result notices to" })
    )
    await interaction.click(
      await screen.findByRole("option", {
        name: "In-app and browser notifications only",
      })
    )
    expect(change).toHaveBeenLastCalledWith(null)
  })
  it("preserves a saved destination when loading the target list fails", async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockRejectedValue(new Error("network"))
    change.mockClear()
    render(<Host initial={target} />)
    expect(
      await screen.findByText(/saved conversation is unavailable/)
    ).toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
  })
})
