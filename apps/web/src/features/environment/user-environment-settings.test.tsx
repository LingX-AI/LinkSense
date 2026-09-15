import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { apiRequest } from "@/api/client"
import { UserEnvironmentSettings } from "./user-environment-settings"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function showSettings() {
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
      <UserEnvironmentSettings />
    </QueryClientProvider>
  )
}

describe("user environment settings", () => {
  it.each(["zh-CN", "en-US"])(
    "persists the keep-running switch in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest)
        .mockResolvedValueOnce({ keep_running: false })
        .mockResolvedValueOnce({ keep_running: true })
      showSettings()
      const toggle = await screen.findByRole("switch", {
        name: i18n.t("settings.keepEnvironmentRunning"),
      })
      await waitFor(() => expect(toggle).toBeEnabled())
      await userEvent.click(toggle)
      await waitFor(() => expect(toggle).toBeChecked())
      expect(apiRequest).toHaveBeenLastCalledWith(
        "/me/environment",
        expect.objectContaining({ method: "PUT", body: { keep_running: true } })
      )
    }
  )

  it("retains the previous value and presents an error after a failed save", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ keep_running: false })
      .mockRejectedValueOnce(new Error("save failed"))
    showSettings()
    const toggle = await screen.findByRole("switch")
    await waitFor(() => expect(toggle).toBeEnabled())
    await userEvent.click(toggle)
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(toggle).not.toBeChecked()
  })
})
