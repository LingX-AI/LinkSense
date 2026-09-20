import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiRequest } from "@/api/client"
import { userSchema, type User } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { CreditQuotaRefreshCenter } from "@/features/usage/credit-quota-refresh-center"

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: vi.fn(),
}))

const USER_ID = "10000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const FIRST_CURSOR = "completion-cursor-1"
const NEXT_CURSOR = "completion-cursor-2"

const user = userSchema.parse({
  id: USER_ID,
  name: "Member",
  email: "member@example.test",
  role: "user",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  login_method: "password",
  running_message_action: "queue",
  registration_source: "organization_invitation",
  user_groups: [],
  credit_quota: {
    weekly: {
      limit_credits: "1",
      used_credits: "0.001",
      remaining_credits: "0.999",
      remaining_percentage: 100,
      reset_at: "2026-09-21T16:00:00.000Z",
    },
  },
})

function renderCenter(currentUser: User | null = user) {
  const refreshUser = vi.fn().mockResolvedValue(undefined)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          status: currentUser ? "authenticated" : "anonymous",
          user: currentUser,
          acceptSession: vi.fn(),
          refreshUser,
          signOut: vi.fn(),
        }}
      >
        <CreditQuotaRefreshCenter />
      </AuthContext.Provider>
    </QueryClientProvider>
  )
  return { ...view, refreshUser }
}

function installCompletionFeed(
  status: "completed" | "failed" | "interrupted",
  source: "task" | "automation" = "task"
) {
  const turnId = `30000000-0000-4000-8000-00000000000${
    status === "completed" ? "1" : status === "failed" ? "2" : "3"
  }`
  vi.mocked(apiRequest).mockImplementation(async (_path, options) => {
    if (!options.query?.cursor) {
      return { items: [], next_cursor: FIRST_CURSOR }
    }
    if (options.query.cursor === FIRST_CURSOR) {
      const item = {
        turn_id: turnId,
        conversation_id: CONVERSATION_ID,
        source,
        task_title: "季度经营分析",
        status,
        terminal_at: "2026-08-31T10:00:01.000Z",
      }
      return { items: [item, item], next_cursor: NEXT_CURSOR }
    }
    return { items: [], next_cursor: NEXT_CURSOR }
  })
}

describe("CreditQuotaRefreshCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    { status: "completed", source: "task" },
    { status: "failed", source: "task" },
    { status: "interrupted", source: "task" },
    { status: "completed", source: "automation" },
  ] as const)(
    "refreshes the current user once after a $source turn becomes $status",
    async ({ source, status }) => {
      installCompletionFeed(status, source)
      const { refreshUser } = renderCenter()

      await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1))
      expect(apiRequest).toHaveBeenNthCalledWith(
        1,
        "/completion-notifications",
        expect.objectContaining({ query: { limit: 100 } })
      )
      expect(apiRequest).toHaveBeenNthCalledWith(
        2,
        "/completion-notifications",
        expect.objectContaining({
          query: { cursor: FIRST_CURSOR, limit: 100 },
        })
      )
    }
  )

  it("does not refresh from the initial completion-feed baseline", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [],
      next_cursor: FIRST_CURSOR,
    })
    const { refreshUser } = renderCenter()

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
    expect(refreshUser).not.toHaveBeenCalled()
  })

  it("does not poll when the current user has no token quota", async () => {
    const userWithoutQuota = userSchema.parse({
      ...user,
      credit_quota: { weekly: null },
    })

    renderCenter(userWithoutQuota)

    await Promise.resolve()
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
