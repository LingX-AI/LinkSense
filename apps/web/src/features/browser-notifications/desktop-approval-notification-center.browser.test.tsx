import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"

import { apiRequest } from "@/api/client"
import { userSchema } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { DesktopApprovalNotificationCenter } from "@/features/browser-notifications/desktop-approval-notification-center"
import {
  persistBrowserNotificationPreference,
  persistDesktopApprovalReminder,
} from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"

vi.mock("mygo-runtime", () => ({
  isMyGo: () => false,
  bind: () => vi.fn(),
  event: () => ({ on: () => () => undefined }),
}))
vi.mock("@mygo-plugins/fetch", () => ({ fetch: vi.fn() }))
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return { ...actual, apiRequest: vi.fn() }
})

const USER_ID = "10000000-0000-4000-8000-000000000001"

const user = userSchema.parse({
  id: USER_ID,
  name: "Member",
  email: "member@example.test",
  role: "user",
  status: "active",
  avatar_url: null,
  language: "en-US",
  login_method: "password",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  user_groups: [],
})

describe("DesktopApprovalNotificationCenter in an ordinary browser", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    vi.clearAllMocks()
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it("never polls or shows approval reminders outside the Mac host", () => {
    persistBrowserNotificationPreference(USER_ID, true)
    persistDesktopApprovalReminder(USER_ID, true)
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <AuthContext.Provider
            value={{
              status: "authenticated",
              user,
              acceptSession: vi.fn(),
              refreshUser: vi.fn(),
              signOut: vi.fn(),
            }}
          >
            <DesktopApprovalNotificationCenter />
          </AuthContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    )
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
